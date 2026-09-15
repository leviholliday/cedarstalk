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

/**
 * The coarse half of the answer, and the half a thin booklist can carry.
 *
 * Four courses name a school far better than they name a program. Scored
 * against the labelled set, a top five that unanimously agrees on one school
 * has it right about nine times in ten, while the program at the head of that
 * same list is right about one time in five: the ranking knows the
 * neighbourhood and is guessing at the house. A scattered top five is right
 * about the school two thirds of the time.
 *
 * So agreement is reported rather than folded into the ordering, and the only
 * threshold drawn is the one the labels actually separate — unanimity. The
 * bands below it score alike, and inventing a "medium" would be dressing noise
 * up as a measurement.
 */
export interface SchoolCall {
  /** The school of the top guess, from the registrar's taxonomy where it has one. */
  name: string | null;
  /** How many of the top five share that school. */
  agreement: number;
  /** Out of how many, which is five unless the model returned fewer. */
  of: number;
  unanimous: boolean;
}

export interface StudentGuess {
  studentId: string;
  name: string | null;
  studentClass: string | null;
  terms: string[];
  courses: string[];
  signal: number;
  school: SchoolCall;
  guesses: Ranked[];
}

/** How far the top of the ranking is looked at when calling a school. */
const PANEL = 5;

function callSchool(ranked: Guess[]): SchoolCall {
  const panel = ranked.slice(0, PANEL);
  const top = panel[0];
  // clusterOf already prefers the registrar's school and falls back to its own
  // patterns, so it is the one place that decides what bucket a title is in.
  const name = top ? clusterOf(top.title) : "";
  if (!name) return { name: null, agreement: 0, of: panel.length, unanimous: false };
  const agreement = panel.filter((g) => clusterOf(g.title) === name).length;
  return { name, agreement, of: panel.length, unanimous: agreement === panel.length };
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
    school: callSchool(ranked),
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
      school: callSchool(ranked),
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
