/**
 * The join the whole engine exists to make: a directory row, a merged
 * booklist, and the catalog's programs, resolved into "what is this person
 * most likely studying".
 */

import { fingerprintOf, fingerprints } from "../store/harvest";
import { schoolOf } from "../store/majors";
import { type Person, personById } from "../store/people";
import { clusterOf } from "./clusters";
import { type Guess, model } from "./major";

export interface Ranked extends Guess {
  /** The registrar's school, when the taxonomy has been imported. */
  school: string | null;
}

export interface StudentGuess {
  studentId: string;
  name: string | null;
  studentClass: string | null;
  terms: string[];
  courses: string[];
  signal: number;
  guesses: Ranked[];
}

const withSchool = (guesses: Guess[]): Ranked[] =>
  guesses.map((guess) => ({ ...guess, school: schoolOf(guess.title) }));

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
    guesses: withSchool(ranked.slice(0, top)),
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
      guesses: withSchool(ranked.slice(0, top)),
    });
  }
  return out.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

export interface Distribution {
  students: number;
  /** Students whose booklist carries at least `minimum` distinctive courses. */
  confident: number;
  schools: { school: string; students: number }[];
  programs: { program: string; students: number }[];
}

/**
 * What the population appears to be studying, by top guess.
 *
 * Counted only where the booklist has enough signal to be worth counting: a
 * freshman with four gen-eds ranks something first, and that something is
 * noise. The threshold is what separates a distribution from a rumour.
 */
export function distribution(minimum = 2, year?: string): Distribution {
  const schools = new Map<string, number>();
  const programs = new Map<string, number>();
  let confident = 0;
  const all = guessAll(1, year);

  for (const student of all) {
    if (student.signal < minimum) continue;
    const top = student.guesses[0];
    if (!top) continue;
    confident++;
    programs.set(top.title, (programs.get(top.title) ?? 0) + 1);
    const school = top.school ?? clusterOf(top.title);
    if (school) schools.set(school, (schools.get(school) ?? 0) + 1);
  }

  const rank = (counts: Map<string, number>) =>
    [...counts].sort((a, b) => b[1] - a[1]).map(([name, students]) => ({ name, students }));

  return {
    students: all.length,
    confident,
    schools: rank(schools).map(({ name, students }) => ({ school: name, students })),
    programs: rank(programs).map(({ name, students }) => ({ program: name, students })),
  };
}
