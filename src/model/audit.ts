/**
 * "Of the courses this program lists, which ones has this booklist seen."
 *
 * The printed catalog gives 79 programs' course lists (the same vocabulary
 * the major model scores against); booklists give courses actually taken.
 * Matching one against the other is a rough audit, not a real one -- and the
 * gap between the two is wide enough that the caveat belongs in the response
 * body, not buried in a doc comment nobody reading raw JSON will see.
 */

import { fingerprintOf } from "../store/harvest";
import type { Program } from "../store/programs";

export interface AuditCourse {
  code: string;
  covered: boolean;
}

export interface DegreeAudit {
  studentId: string;
  program: string;
  totalCourses: number;
  coveredCourses: number;
  totalCredits: number | null;
  courses: AuditCourse[];
  /** Every term a booklist was actually harvested for this student -- the true extent of what this audit can see. */
  termsSeen: string[];
  caveat: string;
}

const CAVEAT =
  "Built only from harvested booklists, not a real transcript. A course taken before harvesting began, or in a term never harvested, shows as not covered even if it was actually completed -- see termsSeen for what this audit could actually check.";

/** Null only when the student has no booklist data at all -- there is nothing to audit against. */
export function degreeAudit(studentId: string, program: Program): DegreeAudit | null {
  const fingerprint = fingerprintOf(studentId);
  if (!fingerprint) return null;

  const known = new Set(fingerprint.courses);
  const courses: AuditCourse[] = program.courses.map((code) => ({
    code,
    covered: known.has(code),
  }));

  return {
    studentId,
    program: program.title,
    totalCourses: courses.length,
    coveredCourses: courses.filter((c) => c.covered).length,
    totalCredits: program.totalCredits,
    courses,
    termsSeen: fingerprint.terms,
    caveat: CAVEAT,
  };
}
