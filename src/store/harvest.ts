/**
 * Harvested booklists, the known majors used to score them, and the accuracy
 * log.
 *
 * The campus store's per-student booklist leaks `Department / Course / Section`
 * for every book it wants to sell. Collected across a population and merged
 * over terms, that is a course fingerprint — which is all the major model
 * needs. Codes are extracted on write so scoring never re-parses a book title.
 */

import { db } from "../db";

export interface Book {
  department?: string;
  course?: string;
  section?: string;
  [key: string]: unknown;
}

export interface HarvestRow {
  id: string | number;
  books?: Book[];
}

/** "MATH-1710-01" and "MATH / 1710 / 01" both collapse to "MATH-1710". */
export function codesFromBooks(books: Book[] | undefined): string[] {
  const codes = new Set<string>();
  if (!Array.isArray(books)) return [];
  for (const book of books) {
    const subject = String(book.department ?? "")
      .split("-")[0]
      ?.trim();
    const number = String(book.course ?? "")
      .split("-")[0]
      ?.trim();
    if (!subject || !number) continue;
    codes.add(`${subject}-${number}`.toUpperCase());
  }
  return [...codes].sort();
}

/**
 * The same books, read one level finer.
 *
 * `codesFromBooks` drops the section on purpose: the major model wants a course
 * fingerprint, and which lab slot somebody drew says nothing about what they
 * study. A timetable is the one question where it says everything, so it is
 * parsed here rather than smuggled into the fingerprint.
 *
 * "BIO-Biology / 2500-General Botany / 01-01" collapses to "BIO-2500-01".
 */
export function sectionsFromBooks(books: Book[] | undefined): string[] {
  const names = new Set<string>();
  if (!Array.isArray(books)) return [];
  for (const book of books) {
    const subject = String(book.department ?? "")
      .split("-")[0]
      ?.trim();
    const number = String(book.course ?? "")
      .split("-")[0]
      ?.trim();
    const section = String(book.section ?? "")
      .split("-")[0]
      ?.trim();
    if (!subject || !number || !section) continue;
    names.add(`${subject}-${number}-${section}`.toUpperCase());
  }
  return [...names].sort();
}

export interface Enrolment {
  term: string;
  /** Section names as the catalog writes them, e.g. "BIO-2500-01". */
  sections: string[];
  fetchedAt: string;
}

/** What one student's booklists say they are sitting in, oldest term first. */
export function enrolmentOf(studentId: string, term?: string): Enrolment[] {
  const where = term ? "student_id = ? AND term = ?" : "student_id = ?";
  const args = term ? [studentId, term] : [studentId];
  return db()
    .query<{ term: string; books: string; fetchedAt: string }, string[]>(
      `SELECT term, books, fetched_at AS fetchedAt FROM booklists WHERE ${where} ORDER BY term`,
    )
    .all(...args)
    .map((row) => ({
      term: row.term,
      sections: sectionsFromBooks(JSON.parse(row.books) as Book[]),
      fetchedAt: row.fetchedAt,
    }));
}

export interface IngestTally {
  students: number;
  withBooks: number;
  added: number;
  changed: number;
}

/**
 * File one term's harvest, keeping the delta.
 *
 * Re-ingesting a term refreshes it, and the difference between the old code
 * set and the new one is a schedule change: a course added in week two, one
 * dropped before the deadline. The merged fingerprint flattens all of that, so
 * it is written down separately before the flattening happens.
 */
export function ingestHarvest(
  term: string,
  rows: HarvestRow[],
  at = new Date().toISOString(),
): IngestTally {
  const database = db();
  const insert = database.query(
    `INSERT INTO booklists (term, student_id, books, codes, first_seen, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(term, student_id) DO UPDATE SET
       books = excluded.books, codes = excluded.codes, fetched_at = excluded.fetched_at`,
  );
  const before = database.query<{ codes: string }, [string, string]>(
    "SELECT codes FROM booklists WHERE term = ? AND student_id = ?",
  );
  const event = database.query(
    `INSERT INTO booklist_events (student_id, term, at, kind, added, removed)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const tally: IngestTally = { students: 0, withBooks: 0, added: 0, changed: 0 };
  const run = database.transaction(() => {
    for (const row of rows) {
      const id = String(row.id ?? "").trim();
      if (!id) continue;
      tally.students++;

      const codes = codesFromBooks(row.books);
      if (codes.length) tally.withBooks++;

      const previous = before.get(term, id);
      insert.run(term, id, JSON.stringify(row.books ?? []), JSON.stringify(codes), at, at);

      if (!previous) {
        tally.added++;
        if (codes.length) event.run(id, term, at, "first", JSON.stringify(codes), "[]");
        continue;
      }
      const had = new Set(JSON.parse(previous.codes) as string[]);
      const now = new Set(codes);
      const added = codes.filter((c) => !had.has(c));
      const removed = [...had].filter((c) => !now.has(c));
      if (!added.length && !removed.length) continue;
      tally.changed++;
      event.run(id, term, at, "changed", JSON.stringify(added), JSON.stringify(removed));
    }
  });
  run();
  return tally;
}

export interface Fingerprint {
  studentId: string;
  courses: string[];
  terms: string[];
}

/**
 * Every student's courses unioned across every term collected. More semesters
 * is a sharper fingerprint, which is the entire premise: a freshman's booklist
 * is gen-eds and says nothing, a junior's is their major.
 */
export function fingerprints(): Map<string, Fingerprint> {
  const merged = new Map<string, Fingerprint>();
  const rows = db()
    .query<{ term: string; student_id: string; codes: string }, []>(
      "SELECT term, student_id, codes FROM booklists ORDER BY term",
    )
    .all();

  for (const row of rows) {
    const codes = JSON.parse(row.codes) as string[];
    if (!codes.length) continue;
    let entry = merged.get(row.student_id);
    if (!entry) {
      entry = { studentId: row.student_id, courses: [], terms: [] };
      merged.set(row.student_id, entry);
    }
    for (const code of codes) if (!entry.courses.includes(code)) entry.courses.push(code);
    if (!entry.terms.includes(row.term)) entry.terms.push(row.term);
  }
  return merged;
}

export function fingerprintOf(studentId: string): Fingerprint | null {
  const rows = db()
    .query<{ term: string; codes: string }, [string]>(
      "SELECT term, codes FROM booklists WHERE student_id = ? ORDER BY term",
    )
    .all(studentId);
  if (!rows.length) return null;

  const courses = new Set<string>();
  const terms: string[] = [];
  for (const row of rows) {
    for (const code of JSON.parse(row.codes) as string[]) courses.add(code);
    terms.push(row.term);
  }
  return { studentId, courses: [...courses].sort(), terms };
}

export const harvestTerms = (): { term: string; students: number; fetchedAt: string }[] =>
  db()
    .query<{ term: string; students: number; fetchedAt: string }, []>(
      `SELECT term, COUNT(*) AS students, MAX(fetched_at) AS fetchedAt
       FROM booklists GROUP BY term ORDER BY term`,
    )
    .all();

export interface Label {
  studentId: string;
  source: string;
  major: string;
  major2: string | null;
}

export function saveLabels(labels: Label[], at = new Date().toISOString()): number {
  const database = db();
  const insert = database.query(
    `INSERT INTO labels (student_id, source, major, major2, at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(student_id) DO UPDATE SET
       source = excluded.source, major = excluded.major, major2 = excluded.major2, at = excluded.at`,
  );
  const run = database.transaction(() => {
    for (const l of labels) insert.run(l.studentId, l.source, l.major, l.major2, at);
  });
  run();
  return labels.length;
}

export const allLabels = (): Label[] =>
  db()
    .query<Label, []>(
      "SELECT student_id AS studentId, source, major, major2 FROM labels ORDER BY student_id",
    )
    .all();

export interface Metric {
  at: string;
  source: string;
  terms: string;
  scored: number;
  exact: number;
  top3: number;
  cluster: number;
}

export function recordMetric(metric: Metric): void {
  db()
    .query(
      `INSERT INTO metrics (at, source, terms, scored, exact, top3, cluster)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(at, source) DO UPDATE SET
         terms = excluded.terms, scored = excluded.scored, exact = excluded.exact,
         top3 = excluded.top3, cluster = excluded.cluster`,
    )
    .run(
      metric.at,
      metric.source,
      metric.terms,
      metric.scored,
      metric.exact,
      metric.top3,
      metric.cluster,
    );
}

export const metricHistory = (): Metric[] =>
  db().query<Metric, []>("SELECT * FROM metrics ORDER BY at").all();
