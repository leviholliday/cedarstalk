/**
 * Textbooks, which the harvest has always carried and nothing has ever read.
 *
 * Each booklist row holds an ISBN, and an ISBN is the thing that lets someone
 * buy a book anywhere other than the campus store. 877 distinct ISBNs across
 * ~31,500 rows, and 90% of titles are needed by five or more people -- enough
 * overlap that "who else needs this" is a real answer rather than a curiosity.
 *
 * Two things the store's data does not give, both handled rather than hidden:
 * `DIRECTACCESS` is a digital-materials placeholder and not a book at all, and
 * the price field comes back empty on every row ever harvested, so nothing
 * here pretends to know what anything costs.
 */

import { db } from "../db";
import { peopleByIds } from "../store/people";

export interface RawBook {
  title: string | null;
  department: string | null;
  course: string | null;
  section: string | null;
  isbn: string | null;
  edition: string | null;
  status: string | null;
  prices?: { condition: string | null; price: string | null }[];
}

export interface Book {
  isbn: string;
  title: string | null;
  edition: string | null;
  /** "required" or "optional", as the store labels it. */
  status: string | null;
  /** "COM-1150", rebuilt from the store's own department/course strings. */
  code: string | null;
  section: string | null;
  /** How many other students this term need the same ISBN. */
  alsoNeededBy: number;
}

/** A real ISBN, not a placeholder. `DIRECTACCESS` means digital materials. */
export function isRealIsbn(isbn: string | null | undefined): isbn is string {
  return typeof isbn === "string" && /^\d{10,13}$/.test(isbn);
}

/** "COM-Communication Arts" + "1150-Communication Seminar" -> "COM-1150". */
export function codeOf(book: RawBook): string | null {
  const subject = book.department?.split("-")[0]?.trim();
  const number = book.course?.split("-")[0]?.trim();
  return subject && number ? `${subject}-${number}` : null;
}

function booksOfRow(raw: string): RawBook[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RawBook[]) : [];
  } catch {
    return [];
  }
}

/** ISBN -> every student needing it this term. One pass over the whole term. */
export function isbnIndex(term: string): Map<string, Set<string>> {
  const rows = db()
    .query<{ studentId: string; books: string }, [string]>(
      "SELECT student_id AS studentId, books FROM booklists WHERE term = ?",
    )
    .all(term);

  const index = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const book of booksOfRow(row.books)) {
      if (!isRealIsbn(book.isbn)) continue;
      const holders = index.get(book.isbn) ?? new Set<string>();
      holders.add(row.studentId);
      index.set(book.isbn, holders);
    }
  }
  return index;
}

export interface StudentBooks {
  studentId: string;
  term: string;
  /** Rows the store returned that carry no real ISBN -- digital access codes and the like. */
  withoutIsbn: number;
  books: Book[];
}

export function booksFor(term: string, studentId: string): StudentBooks | null {
  const row = db()
    .query<{ books: string }, [string, string]>(
      "SELECT books FROM booklists WHERE term = ? AND student_id = ?",
    )
    .get(term, studentId);
  if (!row) return null;

  const index = isbnIndex(term);
  const raw = booksOfRow(row.books);
  const books: Book[] = [];
  let withoutIsbn = 0;

  for (const book of raw) {
    if (!isRealIsbn(book.isbn)) {
      withoutIsbn++;
      continue;
    }
    books.push({
      isbn: book.isbn,
      title: book.title,
      edition: book.edition,
      status: book.status,
      code: codeOf(book),
      section: book.section?.split("-")[0] ?? null,
      // Everyone holding it, minus this student.
      alsoNeededBy: Math.max(0, (index.get(book.isbn)?.size ?? 1) - 1),
    });
  }

  books.sort((a, b) => b.alsoNeededBy - a.alsoNeededBy);
  return { studentId, term, withoutIsbn, books };
}

export interface BookHolders {
  isbn: string;
  term: string;
  title: string | null;
  students: { id: string; name: string | null; studentClass: string | null }[];
}

export function holdersOf(term: string, isbn: string): BookHolders {
  const rows = db()
    .query<{ studentId: string; books: string }, [string]>(
      "SELECT student_id AS studentId, books FROM booklists WHERE term = ?",
    )
    .all(term);

  const ids: string[] = [];
  let title: string | null = null;
  for (const row of rows) {
    for (const book of booksOfRow(row.books)) {
      if (book.isbn !== isbn) continue;
      ids.push(row.studentId);
      title ??= book.title;
      break;
    }
  }

  const people = peopleByIds(ids);
  const students = people
    .map((p) => ({
      id: p.id,
      name: `${p.nickname ?? p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || null,
      studentClass: p.studentClass ?? null,
    }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return { isbn, term, title, students };
}
