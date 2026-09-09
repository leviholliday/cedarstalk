/**
 * The stored campus: outlines, a walking graph, and the door you arrive at for
 * every building somebody in the directory lives or works in.
 *
 * The graph is kept whole in one row because that is how it is used — routing
 * needs all of it or none of it, and it is a few hundred kilobytes. Buildings
 * get real rows because those are what everything else joins against.
 */

import { db } from "../db";

export interface Anchor {
  node: number;
  name: string;
  kind: string;
  source: "osm" | "tour";
  centre: [number, number];
  lat: number;
  lon: number;
  ring: [number, number][];
}

export interface CampusMap {
  origin: { lat: number; lon: number };
  box: [number, number, number, number];
  buildings: { name: string | null; ring: [number, number][]; focus: boolean }[];
  nodes: [number, number][];
  edges: [number, number, number][];
  anchors: Record<string, Anchor>;
  missing: string[];
}

export interface Building {
  label: string;
  osmName: string | null;
  kind: string | null;
  lat: number | null;
  lon: number | null;
  x: number | null;
  y: number | null;
  node: number | null;
  ring: string;
  source: string;
  fetchedAt: string;
}

const BUILDING_SELECT = `SELECT label, osm_name AS osmName, kind, lat, lon, x, y, node, ring,
  source, fetched_at AS fetchedAt FROM buildings`;

/** Replace the whole map. Returns how many buildings got coordinates. */
export function replaceCampus(map: CampusMap, at = new Date().toISOString()): number {
  const database = db();
  const putMap = database.query(
    `INSERT INTO campus (key, payload, fetched_at) VALUES ('map', ?, ?)
     ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
  );
  const putBuilding = database.query(
    `INSERT INTO buildings (label, osm_name, kind, lat, lon, x, y, node, ring, source, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(label) DO UPDATE SET
       osm_name = excluded.osm_name, kind = excluded.kind, lat = excluded.lat, lon = excluded.lon,
       x = excluded.x, y = excluded.y, node = excluded.node, ring = excluded.ring,
       source = excluded.source, fetched_at = excluded.fetched_at`,
  );
  const clear = database.query("DELETE FROM buildings WHERE fetched_at < ?");

  const run = database.transaction(() => {
    putMap.run(JSON.stringify(map), at);
    for (const [label, anchor] of Object.entries(map.anchors)) {
      putBuilding.run(
        label,
        anchor.name,
        anchor.kind,
        anchor.lat,
        anchor.lon,
        anchor.centre[0],
        anchor.centre[1],
        anchor.node,
        JSON.stringify(anchor.ring),
        anchor.source,
        at,
      );
    }
    clear.run(at);
  });
  run();
  return Object.keys(map.anchors).length;
}

let cached: { at: string; map: CampusMap } | undefined;

/** The map, parsed once. A few hundred kilobytes of JSON is not a per-request cost. */
export function campusMap(): CampusMap | null {
  const row = db()
    .query<{ payload: string; fetched_at: string }, []>(
      "SELECT payload, fetched_at FROM campus WHERE key = 'map'",
    )
    .get();
  if (!row) return null;
  if (cached?.at !== row.fetched_at) {
    cached = { at: row.fetched_at, map: JSON.parse(row.payload) as CampusMap };
  }
  return cached.map;
}

export const buildings = (kind?: string): Building[] =>
  kind
    ? db().query<Building, [string]>(`${BUILDING_SELECT} WHERE kind = ? ORDER BY label`).all(kind)
    : db().query<Building, []>(`${BUILDING_SELECT} ORDER BY label`).all();

export const buildingByLabel = (label: string): Building | null =>
  db().query<Building, [string]>(`${BUILDING_SELECT} WHERE label = ?`).get(label);

/**
 * Where a person is, in the only sense the engine can honestly claim: the
 * building they are listed against. A student's dorm, a professor's office.
 */
export interface Located {
  label: string;
  kind: string;
  lat: number;
  lon: number;
  node: number;
  room: string | null;
}

export function locate(studentId: string): Located | null {
  return db()
    .query<Located, [string]>(
      `SELECT b.label, b.kind, b.lat, b.lon, b.node,
              COALESCE(p.dorm_room, p.office_room) AS room
       FROM people p
       JOIN buildings b ON b.label = COALESCE(p.dorm_name, p.office_name)
       WHERE p.id = ? AND b.lat IS NOT NULL`,
    )
    .get(studentId);
}

/** Everyone with a building, for drawing the campus as a population. */
export interface Occupancy {
  label: string;
  kind: string | null;
  lat: number | null;
  lon: number | null;
  people: number;
  breakdown: Record<string, number>;
}

export function occupancy(by: "class" | "type" | "department" = "class"): Occupancy[] {
  const column = { class: "student_class", type: "student_type", department: "department" }[by];
  const rows = db()
    .query<
      {
        label: string;
        kind: string | null;
        lat: number | null;
        lon: number | null;
        bucket: string;
        n: number;
      },
      []
    >(
      `SELECT b.label, b.kind, b.lat, b.lon,
              COALESCE(p.${column}, 'unknown') AS bucket, COUNT(*) AS n
       FROM people p
       JOIN buildings b ON b.label = COALESCE(p.dorm_name, p.office_name)
       WHERE p.present = 1
       GROUP BY b.label, bucket`,
    )
    .all();

  const out = new Map<string, Occupancy>();
  for (const row of rows) {
    let entry = out.get(row.label);
    if (!entry) {
      entry = {
        label: row.label,
        kind: row.kind,
        lat: row.lat,
        lon: row.lon,
        people: 0,
        breakdown: {},
      };
      out.set(row.label, entry);
    }
    entry.people += row.n;
    entry.breakdown[row.bucket] = row.n;
  }
  return [...out.values()].sort((a, b) => b.people - a.people);
}
