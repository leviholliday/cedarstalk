/**
 * Booklists, without anyone having to keep a browser open.
 *
 * The campus store will render any student's course-materials page, which is
 * what makes the whole schedule inference possible -- but it sits behind an
 * AWS WAF challenge that only a real browser solves, so the existing
 * collectors both needed a human's Chrome to be running. This drives a real
 * Chrome of its own, headless, on a schedule.
 *
 * Three things it deliberately does the same way the userscript does, because
 * they are what make the sweep survive contact with the WAF:
 *
 *   - the per-student requests run *inside* the page, not from Node, so they
 *     carry the WAF token the page earned;
 *   - a response without `book-container` in it is a challenge, not an empty
 *     booklist, and is retried rather than filed as "this student has no
 *     books" -- filing it would be worse than failing, since it would look
 *     like real data;
 *   - after repeated failures it reloads the page to earn a fresh token.
 *
 * It writes the same JSON shape the userscript downloads, then hands it to
 * `engine ingest`, so the tested ingest path stays the only way data lands in
 * the database.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright-core";
import { currentTerm } from "../src/lib/terms";
import { studentIds } from "../src/store/people";

const STORE_URL = "https://store.cedarville.edu/textbook/index/search";
const ROOT = dirname(import.meta.dir);
/** A profile of its own, so this never touches the user's real Chrome session. */
const PROFILE = join(ROOT, "data", "chrome-profile");
const OUT_DIR = join(ROOT, "data", "harvests");

const term = process.argv[2] ?? currentTerm();
const limit = Number(process.env.HARVEST_LIMIT ?? "0");
const headless = process.env.HARVEST_HEADED !== "1";

function log(...parts: unknown[]) {
  console.log(new Date().toISOString().slice(0, 19).replace("T", " "), ...parts);
}

const ids = (() => {
  const all = studentIds(["UG", "UGO", "GS", "P4"]);
  return limit > 0 ? all.slice(0, limit) : all;
})();

if (!ids.length) {
  log("no student ids in the directory -- run a directory sweep first");
  process.exit(1);
}

log(`term ${term}, ${ids.length} students, headless=${headless}`);

mkdirSync(PROFILE, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  // The real Chrome rather than a downloaded Chromium: no 150MB fetch, and a
  // genuine browser build is what the challenge expects to be talking to.
  channel: "chrome",
  headless,
  viewport: { width: 1280, height: 900 },
});

const page = context.pages()[0] ?? (await context.newPage());

/** Set when the store answers 403: a block to wait out, not an error to retry. */
let blockedOut = false;

/** Load the store and wait until the WAF has actually let us through. */
async function earnToken(): Promise<boolean> {
  await page.goto(STORE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // A solved challenge navigates the page to the real store. Letting that
  // settle here is what stops it happening in the middle of a batch, which
  // destroys the execution context mid-fetch.
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  // The challenge resolves asynchronously after load; polling the page for a
  // working integration is more reliable than any fixed sleep.
  // A hard 403 is not a challenge waiting to be solved -- it is the store
  // refusing this address outright, which is what a rate-based WAF rule does
  // after a heavy sweep. Retrying it achieves nothing except extending the
  // block, so it is reported distinctly and the run gives up immediately.
  const blocked = await page
    .evaluate(
      async (probeId) =>
        (
          await fetch(`/textbook/index/books?student_id=${probeId}&_=${Date.now()}`, {
            headers: { "x-requested-with": "XMLHttpRequest" },
          })
        ).status,
      ids[0],
    )
    .catch(() => 0);
  if (blocked === 403) {
    blockedOut = true;
    return false;
  }

  // Probed with a real student rather than a sentinel. `student_id=0` looked
  // like a harmless canary and was the opposite: the store answers for it
  // perfectly well with a page containing no books, which is exactly what a
  // blocked request looks like, so a working page reported itself broken.
  const probeId = ids[0];
  for (let attempt = 0; attempt < 30; attempt++) {
    const ready = await page
      .evaluate(async (probeId) => {
        const waf = (window as unknown as { AwsWafIntegration?: { getToken?: () => Promise<unknown> } })
          .AwsWafIntegration;
        if (waf?.getToken) {
          try {
            await waf.getToken();
          } catch {
            return false;
          }
        }
        // Whether or not the integration is present, the only proof that
        // matters is a real request coming back as a real page.
        const probe = await fetch(`/textbook/index/books?student_id=${probeId}&_=${Date.now()}`, {
          headers: { "x-requested-with": "XMLHttpRequest" },
        }).then((r) => r.text());
        return probe.includes("book-container") || probe.includes("book-list-container");
      }, probeId)
      .catch(() => false);
    if (ready) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

interface Harvested {
  id: string;
  books: unknown[];
}

/**
 * One batch of students, fetched from inside the page.
 *
 * Returned separately from the failures so the caller can decide whether a
 * run of failures means "these students have no books" (it never does) or
 * "the token died" (it usually does).
 */
async function fetchBatch(batch: string[]): Promise<{ done: Harvested[]; failed: string[] }> {
  try {
    return await evaluateBatch(batch);
  } catch (error) {
    // The page navigated under us -- usually the WAF re-challenging. That is
    // indistinguishable here from a dead token, and the caller already knows
    // what to do about a batch that wholly failed.
    log(`batch aborted: ${(error as Error).message.split("\n")[0]}`);
    return { done: [], failed: batch };
  }
}

async function evaluateBatch(
  batch: string[],
): Promise<{ done: Harvested[]; failed: string[] }> {
  return page.evaluate(
    async ({ batch, delay }) => {
      const grab = (block: string, label: string) => {
        const m = block.match(new RegExp(`${label}:\\s*([^<]*?)\\s*</span>`, "i"));
        return m ? m[1].trim() : null;
      };
      // Kept deliberately identical to the userscript's parser: the store's
      // markup is the contract, and two parsers would drift apart silently.
      const parse = (html: string) => {
        const books = [];
        for (const block of html.split("book-container").slice(1)) {
          const titleM = block.match(/book-title">\s*([^<]*?)\s*<\/div>/i);
          const prices = [];
          for (const row of block.split('class="book-price"').slice(1)) {
            const cond = row.match(/sale_condition"\s*\n?\s*value="([^"]+)"/i);
            const amt = row.match(/book-price-right">\s*\$?\s*([\d,.]+)/i);
            if (cond || amt)
              prices.push({ condition: cond ? cond[1] : null, price: amt ? amt[1] : null });
          }
          books.push({
            title: titleM ? titleM[1].trim() : null,
            department: grab(block, "Department"),
            course: grab(block, "Course"),
            section: grab(block, "Section"),
            isbn: grab(block, "ISBN-13"),
            edition: grab(block, "Edition"),
            status: grab(block, "Status"),
            prices,
          });
        }
        return books;
      };

      const done: { id: string; books: unknown[] }[] = [];
      const failed: string[] = [];
      for (const id of batch) {
        try {
          const res = await fetch(`/textbook/index/books?student_id=${id}&_=${Date.now()}`, {
            headers: { "x-requested-with": "XMLHttpRequest" },
          });
          const text = await res.text();
          if (!text.includes("book-container") && !text.includes("book-list-container")) {
            failed.push(id);
          } else {
            done.push({ id: String(id), books: parse(text) });
          }
        } catch {
          failed.push(id);
        }
        if (delay) await new Promise((r) => setTimeout(r, delay));
      }
      return { done, failed };
    },
    { batch, delay: PER_REQUEST_DELAY_MS },
  );
}

const harvested = new Map<string, Harvested>();
let pending = [...ids];
let reloads = 0;

if (!(await earnToken())) {
  log(
    blockedOut
      ? "the store is returning 403 to this address -- rate-limited. Try again in a few hours; do not retry in a loop."
      : "could not get past the WAF challenge",
  );
  await context.close();
  process.exit(blockedOut ? 4 : 2);
}
log("through the WAF; starting");

// Roughly four requests a second, sustained. The earlier extension sweep
// managed about 2.5/s across 5,900 students without trouble; this stays in
// that neighbourhood deliberately rather than going as fast as it can.
const PER_REQUEST_DELAY_MS = 250;
const BATCH = 60;
const MAX_RELOADS = 12;
const started = Date.now();

while (pending.length && reloads <= MAX_RELOADS) {
  const batch = pending.slice(0, BATCH);
  const { done, failed } = await fetchBatch(batch);
  for (const row of done) harvested.set(row.id, row);
  pending = pending.slice(batch.length);

  const rate = harvested.size / Math.max(1, (Date.now() - started) / 1000);
  log(
    `${harvested.size}/${ids.length} harvested · ${pending.length} left · ` +
      `${failed.length} failed this batch · ${rate.toFixed(1)}/s`,
  );

  // A whole batch failing is the token dying, not sixty students without
  // books. Put them back and earn a new one.
  if (failed.length === batch.length) {
    pending = [...failed, ...pending];
    reloads++;
    log(`batch failed entirely — reloading for a fresh token (${reloads}/${MAX_RELOADS})`);
    if (!(await earnToken())) {
      log(
        blockedOut
          ? "403 from the store mid-sweep -- rate-limited; filing what we have"
          : "could not re-earn a token; filing what we have",
      );
      break;
    }
  } else if (failed.length) {
    // A scattering of failures is worth one retry at the end, not a reload.
    pending.push(...failed);
  }
}

await context.close();

if (!harvested.size) {
  log("nothing harvested");
  process.exit(3);
}

const outFile = join(OUT_DIR, `${term}.json`);
writeFileSync(outFile, JSON.stringify([...harvested.values()]));
log(`wrote ${harvested.size} students to ${outFile}`);

// Ingest through the CLI rather than calling the store directly, so the one
// tested path into the database stays the only path into the database.
const ingest = spawnSync(
  process.execPath,
  ["run", "src/cli.ts", "ingest", outFile, "--term", term],
  { cwd: ROOT, stdio: "inherit" },
);
process.exit(ingest.status ?? 0);
