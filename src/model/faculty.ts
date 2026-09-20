/**
 * Who teaches what, how much, and how early.
 *
 * `faculty` on `sections` is a display string straight off the registrar
 * ("Mrs. Lindsey M. Howell") -- there is no faculty id anywhere in this data,
 * so that string is the join key. Two people who happen to share a printed
 * name would collide; nothing in the catalog distinguishes them.
 */

import { sectionsForTerm } from "../store/catalog";
import { creditsOf, enrolledOf, expand, meetingsOf } from "./meetings";

/** A meeting starting at or before this is "early" -- 8:00am, the traditional cutoff. */
const EARLY_CUTOFF_MIN = 8 * 60;

export interface FacultyLoad {
  faculty: string;
  sections: number;
  enrolled: number;
  credits: number;
  distinctRooms: number;
  distinctBuildings: number;
  /** Meeting-days starting at or before 8am, across the week. */
  earlyMeetings: number;
}

interface Acc {
  sectionIds: Set<string>;
  enrolled: number;
  credits: number;
  rooms: Set<string>;
  buildings: Set<string>;
  early: number;
}

/**
 * Colleague's FacultyDisplay is one string, and for a team-taught section
 * (a clinical rotation supervised by seven people is a real example in this
 * catalog) that string is every name joined with commas. Split it, or the
 * "who teaches the most" ranking crowns a comma-joined string that is nobody.
 */
function namesOf(faculty: string): string[] {
  return faculty
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function accumulate(term: string): Map<string, Acc> {
  const sections = sectionsForTerm(term);
  const byFaculty = new Map<string, Acc>();

  for (const section of sections) {
    const raw = section.faculty?.trim();
    if (!raw) continue;

    for (const faculty of namesOf(raw)) {
      const acc = byFaculty.get(faculty) ?? {
        sectionIds: new Set(),
        enrolled: 0,
        credits: 0,
        rooms: new Set(),
        buildings: new Set(),
        early: 0,
      };
      if (!acc.sectionIds.has(section.sectionId)) {
        acc.sectionIds.add(section.sectionId);
        acc.enrolled += enrolledOf(section) ?? 0;
        acc.credits += creditsOf(section) ?? 0;
      }
      for (const meeting of expand(section)) {
        if (meeting.building) acc.buildings.add(meeting.building);
        if (meeting.building && meeting.room) acc.rooms.add(`${meeting.building}::${meeting.room}`);
        if (meeting.startMin <= EARLY_CUTOFF_MIN) acc.early++;
      }
      byFaculty.set(faculty, acc);
    }
  }
  return byFaculty;
}

/** Every instructor of record for a term, busiest first by section count. */
export function facultyLoad(term: string): FacultyLoad[] {
  return [...accumulate(term).entries()]
    .map(([faculty, acc]) => ({
      faculty,
      sections: acc.sectionIds.size,
      enrolled: acc.enrolled,
      credits: Math.round(acc.credits * 10) / 10,
      distinctRooms: acc.rooms.size,
      distinctBuildings: acc.buildings.size,
      earlyMeetings: acc.early,
    }))
    .sort((a, b) => b.sections - a.sections);
}

export interface FacultySection {
  code: string | null;
  name: string | null;
  title: string | null;
  credits: number | null;
  enrolled: number | null;
  meetings: {
    days: number[];
    start: string | null;
    end: string | null;
    building: string | null;
    room: string | null;
  }[];
}

export interface FacultyDetail extends FacultyLoad {
  taught: FacultySection[];
}

/** One instructor's full load for a term -- the summary plus every section by name. */
export function facultyDetail(term: string, faculty: string): FacultyDetail | null {
  // A team-taught section's raw FacultyDisplay is a comma-joined string, so
  // membership -- not equality -- is the right test here too.
  const sections = sectionsForTerm(term).filter((s) => {
    const raw = s.faculty?.trim();
    return raw ? namesOf(raw).includes(faculty) : false;
  });
  if (!sections.length) return null;

  const summary = facultyLoad(term).find((f) => f.faculty === faculty);
  if (!summary) return null;

  return {
    ...summary,
    taught: sections.map((section) => ({
      code: section.code,
      name: section.name,
      title: section.title,
      credits: creditsOf(section),
      enrolled: enrolledOf(section),
      meetings: meetingsOf(section)
        .filter((m) => !m.online)
        .map((m) => ({
          days: m.days,
          start: m.start,
          end: m.end,
          building: m.building,
          room: m.room,
        })),
    })),
  };
}
