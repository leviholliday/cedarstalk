/**
 * Section -> students, inverted from booklists.
 *
 * A booklist says what one student bought books for; a roster is the same
 * fact asked the other way -- who a section actually holds. The inversion is
 * never complete: a section with no assigned book is invisible here no
 * matter how full it really is, which is why every roster carries its own
 * coverage figure (known / catalog Enrolled) rather than a bare list a caller
 * might mistake for the whole class.
 */

import { db } from "../db";
import { type Book, sectionsFromBooks } from "./harvest";

export interface Roster {
  term: string;
  /** As the catalog names it, e.g. "BIO-2500-01". */
  sectionName: string;
  /** The catalog's own section id, when the name resolves. */
  sectionId: string | null;
  studentIds: string[];
  /** Enrolled headcount off the catalog, when the section resolves. */
  enrolled: number | null;
  /** studentIds.length / enrolled, 0-1. Null when there is nothing to divide by. */
  coverage: number | null;
}

interface CatalogHit {
  sectionId: string;
  enrolled: number | null;
}

function catalogByName(term: string): Map<string, CatalogHit> {
  const rows = db()
    .query<{ name: string | null; sectionId: string; payload: string }, [string]>(
      "SELECT name, section_id AS sectionId, payload FROM sections WHERE term = ?",
    )
    .all(term);

  const out = new Map<string, CatalogHit>();
  for (const row of rows) {
    if (!row.name) continue;
    const payload = JSON.parse(row.payload) as { Enrolled?: number };
    out.set(row.name.toUpperCase(), {
      sectionId: row.sectionId,
      enrolled: typeof payload.Enrolled === "number" ? payload.Enrolled : null,
    });
  }
  return out;
}

/** Every section a term's booklists name, inverted to who holds it. */
export function sectionRosters(term: string): Roster[] {
  const rows = db()
    .query<{ studentId: string; books: string }, [string]>(
      "SELECT student_id AS studentId, books FROM booklists WHERE term = ?",
    )
    .all(term);

  const bySection = new Map<string, Set<string>>();
  for (const row of rows) {
    const names = sectionsFromBooks(JSON.parse(row.books) as Book[]);
    for (const name of names) {
      const students = bySection.get(name) ?? new Set<string>();
      students.add(row.studentId);
      bySection.set(name, students);
    }
  }

  const catalog = catalogByName(term);

  return [...bySection.entries()]
    .map(([sectionName, students]) => {
      const hit = catalog.get(sectionName);
      const studentIds = [...students].sort();
      return {
        term,
        sectionName,
        sectionId: hit?.sectionId ?? null,
        studentIds,
        enrolled: hit?.enrolled ?? null,
        coverage:
          hit?.enrolled && hit.enrolled > 0
            ? Math.round((studentIds.length / hit.enrolled) * 1000) / 1000
            : null,
      };
    })
    .sort((a, b) => a.sectionName.localeCompare(b.sectionName));
}

/** One section's roster by the catalog's name, e.g. "BIO-2500-01". */
export function rosterFor(term: string, sectionName: string): Roster | null {
  const wanted = sectionName.toUpperCase();
  return sectionRosters(term).find((roster) => roster.sectionName === wanted) ?? null;
}
