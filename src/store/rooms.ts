/**
 * Every room a term's catalog actually teaches in.
 *
 * The only inventory of rooms that exists is "somewhere a section met," so
 * this is derived from the catalog rather than collected independently. Kept
 * per term and never deleted wholesale: a room the fall crawl didn't use but
 * the spring one did should still answer to a lookup.
 */

import { db } from "../db";

export interface RoomRow {
  term: string;
  building: string;
  room: string;
  campusLabel: string | null;
  sections: number;
  fetchedAt: string;
}

const ROOM_SELECT = `SELECT term, building, room, campus_label AS campusLabel, sections,
  fetched_at AS fetchedAt FROM rooms`;

export interface RoomInput {
  building: string;
  room: string;
  campusLabel: string | null;
  sections: number;
}

/** Replace one term's room list. Rooms belonging to other terms are untouched. */
export function replaceRooms(
  term: string,
  rows: RoomInput[],
  at = new Date().toISOString(),
): number {
  const database = db();
  const insert = database.query(
    `INSERT INTO rooms (term, building, room, campus_label, sections, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(term, building, room) DO UPDATE SET
       campus_label = excluded.campus_label, sections = excluded.sections,
       fetched_at = excluded.fetched_at`,
  );
  const clear = database.query("DELETE FROM rooms WHERE term = ? AND fetched_at < ?");

  const run = database.transaction(() => {
    for (const row of rows) {
      insert.run(term, row.building, row.room, row.campusLabel, row.sections, at);
    }
    if (rows.length) clear.run(term, at);
  });
  run();
  return rows.length;
}

export const roomsForTerm = (term: string): RoomRow[] =>
  db().query<RoomRow, [string]>(`${ROOM_SELECT} WHERE term = ? ORDER BY building, room`).all(term);

export const roomsInBuilding = (building: string, term: string): RoomRow[] =>
  db()
    .query<RoomRow, [string, string]>(
      `${ROOM_SELECT} WHERE term = ? AND building = ? ORDER BY room`,
    )
    .all(term, building);

/** Distinct buildings the catalog teaches in for a term, cheaper than scanning payloads. */
export const roomBuildings = (term: string): string[] =>
  db()
    .query<{ building: string }, [string]>(
      "SELECT DISTINCT building FROM rooms WHERE term = ? ORDER BY building",
    )
    .all(term)
    .map((row) => row.building);
