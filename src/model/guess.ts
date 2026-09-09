/**
 * The join the whole engine exists to make: a directory row, a merged
 * booklist, and the catalog's programs, resolved into "what is this person
 * most likely studying".
 */

import { fingerprintOf, fingerprints } from "../store/harvest";
import { type Person, personById } from "../store/people";
import { type Guess, model } from "./major";

export interface StudentGuess {
  studentId: string;
  name: string | null;
  studentClass: string | null;
  terms: string[];
  courses: string[];
  signal: number;
  guesses: Guess[];
}

const displayName = (person: Person | null) =>
  person ? `${person.nickname ?? person.firstName ?? ""} ${person.lastName ?? ""}`.trim() : null;

export function guessFor(studentId: string, top = 3, year?: string): StudentGuess | null {
  const fingerprint = fingerprintOf(studentId);
  if (!fingerprint) return null;
  const person = personById(studentId);
  const { ranked, signal } = model(year).guess(fingerprint.courses);
  return {
    studentId,
    name: displayName(person),
    studentClass: person?.studentClass ?? null,
    terms: fingerprint.terms,
    courses: fingerprint.courses,
    signal,
    guesses: ranked.slice(0, top),
  };
}

/** Everyone with any booklist data at all. */
export function guessAll(top = 3, year?: string): StudentGuess[] {
  const engine = model(year);
  const out: StudentGuess[] = [];
  for (const fingerprint of fingerprints().values()) {
    const person = personById(fingerprint.studentId);
    const { ranked, signal } = engine.guess(fingerprint.courses);
    out.push({
      studentId: fingerprint.studentId,
      name: displayName(person),
      studentClass: person?.studentClass ?? null,
      terms: fingerprint.terms,
      courses: fingerprint.courses,
      signal,
      guesses: ranked.slice(0, top),
    });
  }
  return out.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}
