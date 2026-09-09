/**
 * Degree programs, read out of the printed catalog.
 *
 * Colleague knows what a degree requires; the book knows the arithmetic behind
 * it, and it is the only place the two are stated together. The course list on
 * each page is also the vocabulary the major model scores against, so it is
 * lifted into its own column rather than left inside the payload.
 */

import type { ProgramPage } from "../collect/book";
import { db } from "../db";

export interface ProgramRow {
  year: string;
  page: number;
  title: string;
  totalCredits: number | null;
  courses: string;
  payload: string;
  fetchedAt: string;
}

export interface Program extends Omit<ProgramRow, "courses" | "payload"> {
  courses: string[];
  page: number;
  summary: ProgramPage["summary"];
  doubleCounts: ProgramPage["doubleCounts"];
  sequence: ProgramPage["sequence"];
}

const SELECT = `SELECT year, page, title, total_credits AS totalCredits, courses, payload,
  fetched_at AS fetchedAt FROM programs`;

const TOTAL = /^Total\b/i;

const hydrate = (row: ProgramRow): Program => {
  const page = JSON.parse(row.payload) as ProgramPage;
  return {
    year: row.year,
    page: row.page,
    title: row.title,
    totalCredits: row.totalCredits,
    fetchedAt: row.fetchedAt,
    courses: JSON.parse(row.courses) as string[],
    summary: page.summary,
    doubleCounts: page.doubleCounts,
    sequence: page.sequence,
  };
};

/** Replace a catalog year wholesale. Returns how many program pages landed. */
export function replaceYear(year: string, pages: ProgramPage[], fetchedAt: string): number {
  const database = db();
  const insert = database.query(
    `INSERT INTO programs (year, page, title, total_credits, courses, payload, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(year, page) DO UPDATE SET
       title = excluded.title, total_credits = excluded.total_credits,
       courses = excluded.courses, payload = excluded.payload, fetched_at = excluded.fetched_at`,
  );
  const clear = database.query("DELETE FROM programs WHERE year = ? AND fetched_at < ?");

  const run = database.transaction(() => {
    for (const page of pages) {
      insert.run(
        year,
        page.page,
        page.title,
        page.summary.find((l) => TOTAL.test(l.label))?.min ?? null,
        JSON.stringify(page.courses),
        JSON.stringify(page),
        fetchedAt,
      );
    }
    if (pages.length) clear.run(year, fetchedAt);
  });
  run();
  return pages.length;
}

export const programYears = (): { year: string; programs: number; fetchedAt: string }[] =>
  db()
    .query<{ year: string; programs: number; fetchedAt: string }, []>(
      `SELECT year, COUNT(*) AS programs, MAX(fetched_at) AS fetchedAt
       FROM programs GROUP BY year ORDER BY year DESC`,
    )
    .all();

/** The most recent year on file, which is what everything defaults to. */
export const latestYear = (): string | null =>
  db().query<{ year: string | null }, []>("SELECT MAX(year) AS year FROM programs").get()?.year ??
  null;

export function listPrograms(year: string, q?: string): Program[] {
  const rows = q
    ? db()
        .query<ProgramRow, [string, string]>(
          `${SELECT} WHERE year = ? AND title LIKE ? ORDER BY title`,
        )
        .all(year, `%${q}%`)
    : db().query<ProgramRow, [string]>(`${SELECT} WHERE year = ? ORDER BY title`).all(year);
  return rows.map(hydrate);
}

export function programByPage(year: string, page: number): Program | null {
  const row = db()
    .query<ProgramRow, [string, number]>(`${SELECT} WHERE year = ? AND page = ?`)
    .get(year, page);
  return row ? hydrate(row) : null;
}

/** The vocabulary the major model is built from: every program's course list. */
export const programVocabulary = (year: string): { title: string; courses: string[] }[] =>
  db()
    .query<{ title: string; courses: string }, [string]>(
      "SELECT title, courses FROM programs WHERE year = ?",
    )
    .all(year)
    .map((r) => ({ title: r.title, courses: JSON.parse(r.courses) as string[] }));
