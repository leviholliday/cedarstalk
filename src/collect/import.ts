/**
 * Bringing in what the earlier projects already collected.
 *
 * cedarengine replaces four tools that each kept their own file, and a fresh
 * engine that starts empty throws away a directory sweep, three thousand
 * courses, a whole printed catalog and a term of harvested booklists. So the
 * first run imports them, and the sweeps table records that it happened.
 *
 * Everything here is idempotent: importing twice changes nothing the second
 * time except timestamps.
 */

import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ProgramPage } from "./book";
import { ingestHarvest } from "../store/harvest";
import { finishSweep, startSweep } from "../store/history";
import { upsertPeople } from "../store/people";
import { replaceTerm, writeRule } from "../store/catalog";
import { replaceYear } from "../store/programs";

const open = (path: string) => new Database(path, { readonly: true });

/** cedarstalk-raycast's directory.db, whose columns are already ours. */
export function importDirectory(path: string) {
  const sweep = startSweep("directory", "import", basename(path));
  const source = open(path);
  const rows = source.query<Record<string, unknown>, []>("SELECT * FROM people").all();

  // Grouped by when they were first seen, and replayed oldest first, so the
  // imported history keeps the shape it had: an "appeared" event on the day
  // the old sweep actually found them, not on the day of the import.
  const byFirstSeen = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const at = String(row.first_seen ?? row.last_seen ?? new Date().toISOString());
    const bucket = byFirstSeen.get(at);
    if (bucket) bucket.push(row);
    else byFirstSeen.set(at, [row]);
  }

  let added = 0;
  let changed = 0;
  for (const at of [...byFirstSeen.keys()].sort()) {
    const tally = upsertPeople(byFirstSeen.get(at)!, at);
    added += tally.added;
    changed += tally.changed;
  }
  source.close();

  finishSweep(sweep, { seen: rows.length, added, changed });
  return { people: rows.length, added, changed };
}

/** the-cedarville-app's catalog.sqlite: sections, courses and resolved rules. */
export function importCatalog(path: string) {
  const sweep = startSweep("catalog", "import", basename(path));
  const source = open(path);

  const terms = source
    .query<{ term: string }, []>(
      "SELECT term FROM sections UNION SELECT term FROM courses ORDER BY term",
    )
    .all()
    .map((row) => row.term);

  let sections = 0;
  let courses = 0;
  for (const term of terms) {
    const sectionRows = source
      .query<{ payload: string; fetched_at: string }, [string]>(
        "SELECT payload, fetched_at FROM sections WHERE term = ?",
      )
      .all(term);
    const courseRows = source
      .query<{ payload: string; fetched_at: string }, [string]>(
        "SELECT payload, fetched_at FROM courses WHERE term = ?",
      )
      .all(term);

    const fetchedAt =
      [...sectionRows, ...courseRows]
        .map((row) => row.fetched_at)
        .sort()
        .at(-1) ?? new Date().toISOString();

    replaceTerm({
      term,
      fetchedAt,
      sections: sectionRows.map((row) => JSON.parse(row.payload)),
      courses: courseRows.map((row) => JSON.parse(row.payload)),
    });
    sections += sectionRows.length;
    courses += courseRows.length;
  }

  const rules = source
    .query<{ requirement: string; subrequirement: string; grp: string; courses: string }, []>(
      "SELECT requirement, subrequirement, grp, courses FROM rule_groups",
    )
    .all();
  for (const rule of rules) {
    writeRule(
      { requirement: rule.requirement, subrequirement: rule.subrequirement, group: rule.grp },
      JSON.parse(rule.courses) as string[],
    );
  }
  source.close();

  finishSweep(sweep, { seen: sections + courses, added: sections + courses, complete: true });
  return { terms, sections, courses, rules: rules.length };
}

/** the-cedarville-app's book-<year>.json. */
export function importBook(path: string) {
  const book = JSON.parse(readFileSync(path, "utf-8")) as {
    year: string;
    programs: ProgramPage[];
    fetchedAt?: string;
  };
  const sweep = startSweep("book", "import", book.year);
  const stored = replaceYear(book.year, book.programs, book.fetchedAt ?? new Date().toISOString());
  finishSweep(sweep, { seen: stored, added: stored, complete: true });
  return { year: book.year, programs: stored };
}

/** cedar-major-pipeline's data/harvests/<term>.json, one file per semester. */
export function importHarvests(dir: string) {
  const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
  const terms: { term: string; students: number; withBooks: number }[] = [];

  for (const file of files.sort()) {
    const term = file.replace(/\.json$/i, "");
    const rows = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    if (!Array.isArray(rows)) continue;
    const sweep = startSweep("booklists", "import", term);
    const tally = ingestHarvest(term, rows);
    finishSweep(sweep, {
      seen: tally.students,
      added: tally.added,
      changed: tally.changed,
      complete: true,
    });
    terms.push({ term, students: tally.students, withBooks: tally.withBooks });
  }
  return terms;
}

/** Where the earlier projects keep their data, relative to a sibling checkout. */
export const SIBLINGS = {
  directory: "../cedarstalk-raycast/data/directory.db",
  catalog: "../the-cedarville-app/.data/catalog.sqlite",
  book: "../the-cedarville-app/.data",
  harvests: "../cedar-major-pipeline/data/harvests",
};

export interface ImportReport {
  directory?: ReturnType<typeof importDirectory>;
  catalog?: ReturnType<typeof importCatalog>;
  book?: ReturnType<typeof importBook>;
  harvests?: ReturnType<typeof importHarvests>;
  skipped: string[];
}

/** Import whatever of the four is actually there. */
export function importAll(paths: Partial<typeof SIBLINGS> = {}): ImportReport {
  const where = { ...SIBLINGS, ...paths };
  const report: ImportReport = { skipped: [] };

  if (existsSync(where.directory)) report.directory = importDirectory(where.directory);
  else report.skipped.push(where.directory);

  if (existsSync(where.catalog)) report.catalog = importCatalog(where.catalog);
  else report.skipped.push(where.catalog);

  // The book is named by year, so take the newest one sitting in the folder.
  const books = existsSync(where.book)
    ? readdirSync(where.book)
        .filter((file) => /^book-\d{4}-\d{4}\.json$/.test(file))
        .sort()
    : [];
  const newest = books.at(-1);
  if (newest) report.book = importBook(join(where.book, newest));
  else report.skipped.push(`${where.book}/book-*.json`);

  if (existsSync(where.harvests)) report.harvests = importHarvests(where.harvests);
  else report.skipped.push(where.harvests);

  return report;
}
