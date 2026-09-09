/**
 * What to ask next.
 *
 * The sweep's splitting logic lives here rather than in whatever is doing the
 * asking, so the browser extension can stay a courier: it fetches a list of
 * queries, runs them against a page it is already signed into, and posts the
 * rows back. Every decision about coverage — which prefix is hiding rows, when
 * the sweep has settled — stays in one place next to the data it reasons about.
 */

import { db } from "../db";

export interface Query {
  last: string;
  first: string;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");

/**
 * The result cap, recognised by the plateau it makes.
 *
 * A server that truncates every answer at N produces ties at exactly N, over
 * and over, from queries with nothing else in common. A single largest result
 * is just the largest result — splitting behind it costs twenty-six requests
 * and finds nothing. So a cap is only believed once two queries have hit the
 * same ceiling.
 */
export function capOf(counts: Iterable<number>): number {
  const seen = new Map<number, number>();
  for (const count of counts) seen.set(count, (seen.get(count) ?? 0) + 1);
  let cap = 0;
  for (const [count, times] of seen) if (times >= 2 && count > cap) cap = count;
  return cap;
}

export interface PlanState {
  cap: number;
  /** Queries already answered. */
  asked: number;
  pending: number;
  stuck: number;
}

interface Plan extends PlanState {
  queries: Query[];
}

/**
 * The next slice of directory queries, plus where the sweep stands.
 *
 * A query pegged at the result cap is hiding rows behind it and gets split;
 * one that came back short is complete. When nothing is pending and nothing is
 * pegged, the sweep has seen everybody.
 */
export function planDirectory(limit = 100, maxDepth = 4): Plan {
  const rows = db()
    .query<{ last: string; first: string; count: number }, []>(
      "SELECT last, first, count FROM sweep_queries",
    )
    .all();

  const done = new Map(rows.map((row) => [`${row.last}|${row.first}`, row.count]));
  const cap = capOf(rows.map((row) => row.count));

  const queries: Query[] = [];
  const seen = new Set<string>();
  const push = (last: string, first: string) => {
    const key = `${last}|${first}`;
    if (done.has(key) || seen.has(key)) return;
    seen.add(key);
    queries.push({ last, first });
  };

  // Seeds first: a-z on the last name covers the whole population.
  for (const letter of ALPHABET) push(letter, "");

  let stuck = 0;
  for (const [key, count] of done) {
    if (!cap || count < cap) continue;
    const [last = "", first = ""] = key.split("|");
    if (!last) continue;
    if (last.length >= maxDepth && first.length >= maxDepth) {
      stuck++;
      continue;
    }
    if (last.length < maxDepth) for (const letter of ALPHABET) push(last + letter, first);
    else for (const letter of ALPHABET) push(last, first + letter);
  }

  return {
    cap,
    asked: done.size,
    pending: queries.length,
    stuck,
    queries: queries.slice(0, limit),
  };
}

/** Students with no booklist on file for a term. The harvester's to-do list. */
export function planBooklists(term: string, limit = 500, types = ["UG", "UGO", "GS", "P4"]) {
  const rows = db()
    .query<{ id: string }, string[]>(
      `SELECT p.id FROM people p
       WHERE p.present = 1
         AND p.student_type IN (${types.map(() => "?").join(",")})
         AND NOT EXISTS (
           SELECT 1 FROM booklists b WHERE b.term = ? AND b.student_id = p.id
         )
       ORDER BY p.last_name, p.first_name`,
    )
    .all(...types, term);
  return { term, remaining: rows.length, ids: rows.slice(0, limit).map((r) => r.id) };
}
