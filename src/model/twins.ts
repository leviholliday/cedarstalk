/**
 * Who else is moving through the week alongside you.
 *
 * The roster inversion (`store/rosters.ts`) already answers "who's in this
 * section"; a twin is just that question asked for every section on one
 * person's own schedule at once, tallied by how many they share.
 */

import { enrolmentOf } from "../store/harvest";
import { peopleByIds } from "../store/people";
import { sectionRosters } from "../store/rosters";

export interface Twin {
  studentId: string;
  name: string | null;
  sharedSections: string[];
}

/**
 * Everyone who shares at least `minShared` sections with this student, most
 * shared first. Two people in the same 300-person gen-ed lecture are not
 * "moving through the week together" -- the default of 2 asks for it to keep
 * happening, not to coincide once.
 */
export function twinSchedulesFor(term: string, studentId: string, minShared = 2): Twin[] {
  const mySections = enrolmentOf(studentId, term)[0]?.sections ?? [];
  if (!mySections.length) return [];

  const bySection = new Map(sectionRosters(term).map((r) => [r.sectionName, r.studentIds]));

  const shared = new Map<string, string[]>();
  for (const name of mySections) {
    for (const other of bySection.get(name.toUpperCase()) ?? []) {
      if (other === studentId) continue;
      const sections = shared.get(other) ?? [];
      sections.push(name);
      shared.set(other, sections);
    }
  }

  const candidates = [...shared.entries()].filter(([, sections]) => sections.length >= minShared);
  const people = peopleByIds(candidates.map(([id]) => id));
  const byId = new Map(people.map((p) => [p.id, p]));

  return candidates
    .map(([id, sections]) => {
      const person = byId.get(id) ?? null;
      return {
        studentId: id,
        name: person
          ? `${person.nickname ?? person.firstName ?? ""} ${person.lastName ?? ""}`.trim()
          : null,
        sharedSections: sections.sort(),
      };
    })
    .sort((a, b) => b.sharedSections.length - a.sharedSections.length);
}
