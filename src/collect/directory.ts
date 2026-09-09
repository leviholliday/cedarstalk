/**
 * Sweeping the whole directory into the engine.
 *
 * The directory only answers name searches and only ever returns the first N
 * matches, so enumeration means splitting the name space until every query
 * fits under that cap. A query that comes back pegged at the cap is hiding
 * rows and gets split; one that comes back short is complete and that branch
 * stops. When a pass adds no work, nothing is pegged and we have provably seen
 * everything.
 *
 * Splitting walks the last-name prefix first and only constrains the first
 * name once that axis bottoms out, so `smit` becomes `smit + a` through
 * `smit + z` rather than a dead end. A last-name sweep alone covers the
 * population: everyone in the directory has an a-z last name.
 *
 * Every finished query is recorded as it lands, so a run that dies resumes.
 */

import { db } from "../db";
import { finishSweep, startSweep } from "../store/history";
import { retireUnseen, upsertPeople } from "../store/people";
import { AuthExpiredError, search, sessionCookie, sleep } from "./directory-api";
import { capOf } from "./plan";

export interface SweepOptions {
  concurrency?: number;
  /** Gap between requests, per worker. */
  delayMs?: number;
  /** Prefix length per axis, so twice this in total. */
  maxDepth?: number;
  alphabet?: string;
  /** Add the redundant first-name sweep. Roughly triples the run. */
  alsoFirst?: boolean;
  /** Forget which queries are done and sweep again. Rows are kept. */
  refresh?: boolean;
  cookieFile?: string;
  /** Who is running this, for the sweep log. */
  source?: "cli" | "extension" | "import";
  onProgress?: (progress: SweepProgress) => void;
}

export interface SweepProgress {
  current: string;
  cap: number;
  queued: number;
  done: number;
  added: number;
  seen: number;
  requests: number;
  errors: number;
  stuck: number;
  changed: number;
  vanished: number;
}

export interface SweepResult extends SweepProgress {
  expired: boolean;
  /** True when the sweep settled with nothing pegged, so it saw everybody. */
  complete: boolean;
  elapsedMs: number;
}

const SEP = "|";
const key = (last: string, first: string) => `${last}${SEP}${first}`;

export async function sweepDirectory(options: SweepOptions = {}): Promise<SweepResult> {
  const {
    concurrency = 4,
    delayMs = 120,
    maxDepth = 4,
    alphabet = "abcdefghijklmnopqrstuvwxyz",
    alsoFirst = false,
    refresh = false,
    cookieFile,
    source = "cli",
    onProgress,
  } = options;

  const database = db();
  if (refresh) database.exec("DELETE FROM sweep_queries");

  const noteQuery = database.query(
    "INSERT OR REPLACE INTO sweep_queries (last, first, count, at) VALUES (?, ?, ?, ?)",
  );

  const done = new Map<string, number>();
  for (const row of database
    .query<{ last: string; first: string; count: number }, []>(
      "SELECT last, first, count FROM sweep_queries",
    )
    .all()) {
    done.set(key(row.last, row.first), row.count);
  }

  // The result cap, recovered from the db so a resumed run knows it before
  // making a single request. Recognised by ties rather than by the maximum —
  // see capOf.
  let cap = capOf(done.values());

  const split = new Set<string>();
  const queue: { last: string; first: string }[] = [];
  const push = (last: string, first: string) => {
    if (!done.has(key(last, first))) queue.push({ last, first });
  };

  const letters = alphabet.split("");
  const exhausted = (last: string, first: string) =>
    last.length >= maxDepth && first.length >= maxDepth;

  // A pegged query is hiding rows. Narrow it: lengthen the last-name prefix
  // while there is room, and once that axis bottoms out, pin the first name.
  const expand = (last: string, first: string) => {
    if (split.has(key(last, first))) return;
    split.add(key(last, first));
    if (last.length < maxDepth) for (const c of letters) push(last + c, first);
    else for (const c of letters) push(last, first + c);
  };

  for (const c of letters) push(c, "");
  if (alsoFirst) for (const c of letters) push("", c);

  const state: SweepProgress = {
    current: "",
    cap,
    queued: queue.length,
    done: done.size,
    added: 0,
    seen: 0,
    requests: 0,
    errors: 0,
    stuck: 0,
    changed: 0,
    vanished: 0,
  };
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const sweep = startSweep("directory", source);

  const record = (last: string, first: string, people: Record<string, unknown>[]) => {
    const at = new Date().toISOString();
    const tally = upsertPeople(people, at);
    noteQuery.run(last, first, people.length, at);
    state.added += tally.added;
    state.changed += tally.changed;
    state.seen += tally.seen - tally.added;
    done.set(key(last, first), people.length);
  };

  const cookie = await sessionCookie({ cookieFile });
  let expired = false;

  const worker = async () => {
    while (queue.length && !expired) {
      const job = queue.shift()!;
      state.current = `${job.last || "*"}${job.first ? ` +${job.first}` : ""}`;
      try {
        const people = await search(cookie, {
          LastNameSearch: job.last,
          FirstNameSearch: job.first,
        });
        state.requests++;
        record(job.last, job.first, people);
      } catch (error) {
        if (error instanceof AuthExpiredError) {
          expired = true;
          break;
        }
        state.errors++;
        // A query that keeps failing must not be retried forever; mark it seen
        // as empty so the settle pass moves on.
        done.set(key(job.last, job.first), 0);
      }
      state.queued = queue.length;
      state.done = done.size;
      onProgress?.(state);
      if (delayMs) await sleep(delayMs);
    }
  };

  // Each settle pass drains the queue, then re-checks every finished query
  // against the cap we now know about and splits the ones that were pegged. It
  // converges once a pass adds no work.
  while (true) {
    await Promise.all(Array.from({ length: concurrency }, worker));
    if (expired) break;
    const before = queue.length;
    state.stuck = 0;
    cap = capOf(done.values());
    state.cap = cap;
    for (const [entry, count] of done) {
      if (!cap || count < cap) continue;
      const [last = "", first = ""] = entry.split(SEP);
      if (!last) continue; // an also-first probe; the last-name axis covers it
      if (exhausted(last, first)) state.stuck++;
      else expand(last, first);
    }
    state.queued = queue.length;
    if (queue.length === before) break;
  }

  // Retiring a row claims "the directory has stopped listing them", so only a
  // run that asked the whole name space this time may do it. A resumed sweep
  // skips every query an earlier run finished, which means most people were
  // never asked about — retiring on that would graduate the whole school.
  const complete = refresh && !expired && state.stuck === 0 && !options.alphabet;
  if (complete) state.vanished = retireUnseen(startedAt);

  finishSweep(sweep, {
    seen: state.seen + state.added,
    added: state.added,
    changed: state.changed,
    vanished: state.vanished,
    complete,
    note: expired ? "session expired mid-run" : undefined,
  });

  return { ...state, expired, complete, elapsedMs: Date.now() - started };
}
