/**
 * Who is standing in a building right now.
 *
 * Two halves that already existed and had never been put together: the
 * materialised occupancy grid knows which sections meet where at any minute,
 * and the roster inversion knows who is in a section. Joining them answers a
 * question the registrar does not publish and nothing else on campus can.
 *
 * The honesty rule from the rosters carries over unchanged: a named student is
 * really enrolled, a missing one is invisible rather than absent. Sections with
 * no reconstructed roster are still listed, with their real enrolled count and
 * an empty student list, because dropping them would quietly understate how
 * busy a building is.
 */

import { db } from "../db";
import { peopleByIds } from "../store/people";
import { sectionRosters } from "../store/rosters";

export interface PresentStudent {
  id: string;
  name: string | null;
  studentClass: string | null;
  dormName: string | null;
}

export interface PresentSection {
  sectionId: string;
  name: string | null;
  title: string | null;
  room: string;
  start: string;
  end: string;
  kind: string | null;
  /** The registrar's headcount. */
  enrolled: number | null;
  /** Reconstructed students over enrolled, 0-1, or null when there is nothing to divide by. */
  coverage: number | null;
  students: PresentStudent[];
}

export interface Presence {
  building: string;
  day: number;
  minute: number;
  /** Distinct students, so somebody cross-listed into two sections counts once. */
  people: number;
  /** The registrar's headcounts summed the same way -- distinct sections, not distinct people. */
  enrolled: number;
  sections: PresentSection[];
}

/** 905 -> "15:05". The grid stores minutes; people read clocks. */
function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

interface OccupancyRow {
  room: string;
  startMin: number;
  endMin: number;
  sectionId: string;
  name: string | null;
  title: string | null;
  kind: string | null;
  enrolled: number | null;
}

export function presenceAt(
  term: string,
  building: string,
  day: number,
  minute: number,
): Presence {
  const rows = db()
    .query<OccupancyRow, [string, string, number, number, number]>(
      `SELECT room, start_min AS startMin, end_min AS endMin, section_id AS sectionId,
              name, title, kind, enrolled
         FROM room_occupancy
        WHERE term = ? AND building = ? AND day = ?
          AND start_min <= ? AND end_min > ?
        ORDER BY start_min, room`,
    )
    .all(term, building, day, minute, minute);

  if (!rows.length) {
    return { building, day, minute, people: 0, enrolled: 0, sections: [] };
  }

  // One pass over the booklists for the whole request. `rosterFor` rebuilds
  // this map on every call, so asking it per section would rescan every
  // booklist in the term once per section meeting in the building.
  const rosters = new Map(sectionRosters(term).map((r) => [r.sectionName, r]));

  const wanted = new Set<string>();
  for (const row of rows) {
    const roster = row.name ? rosters.get(row.name.toUpperCase()) : undefined;
    for (const id of roster?.studentIds ?? []) wanted.add(id);
  }
  const byId = new Map(peopleByIds([...wanted]).map((p) => [p.id, p]));

  const sections: PresentSection[] = rows.map((row) => {
    const roster = row.name ? rosters.get(row.name.toUpperCase()) : undefined;
    const students = (roster?.studentIds ?? []).map((id) => {
      const person = byId.get(id);
      return {
        id,
        name: person
          ? `${person.nickname ?? person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || null
          : null,
        studentClass: person?.studentClass ?? null,
        dormName: person?.dormName ?? null,
      };
    });
    students.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

    return {
      sectionId: row.sectionId,
      name: row.name,
      title: row.title,
      room: row.room,
      start: clock(row.startMin),
      end: clock(row.endMin),
      kind: row.kind,
      enrolled: row.enrolled,
      coverage: roster?.coverage ?? null,
      students,
    };
  });

  return {
    building,
    day,
    minute,
    people: wanted.size,
    enrolled: rows.reduce((sum, row) => sum + (row.enrolled ?? 0), 0),
    sections,
  };
}
