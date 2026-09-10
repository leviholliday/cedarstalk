/**
 * Where the campus actually walks.
 *
 * The idea is lifted from assassins, which weighted each footpath by how many
 * players crossed it on their way between classes. It had real schedules to
 * work from; here the same picture comes out of data collected for something
 * else entirely: a booklist names a student's courses, the catalog says which
 * building each course meets in, and the directory says which dorm the student
 * sleeps in. Dorm to classroom, once per course, summed over everybody.
 *
 * Two honest limits, both visible in the output. A booklist names the course
 * but not the section, so a course taught in two buildings splits its trip
 * between them rather than pretending to know. And this is a term's worth of
 * journeys piled into one picture, not a Tuesday — the shape is right, the
 * timing is not modelled at all.
 */

import { db } from "../db";
import { adjacencyOf, shortestPath } from "../lib/route";
import { campusMap } from "../store/campus";

export interface TrafficBucket {
  /** 1 is the quietest band, `buckets` the busiest. */
  level: number;
  /** Share of the busiest edge's load, at the middle of this band. */
  share: number;
  /**
   * Runs of connected nodes rather than loose segments.
   *
   * Drawn a segment at a time, every junction grows a bead where the round
   * caps of four separate strokes pile up. Chained, a path is one stroke that
   * joins itself, which is also what it is.
   */
  paths: number[][];
}

/**
 * Thread a bucket's edges into as few continuous runs as possible.
 *
 * A trail decomposition, greedily: start where a run must start (a node with
 * an odd number of edges), then walk unused edges until stuck. Every edge ends
 * up in exactly one run.
 */
export function chain(edges: [number, number][]): number[][] {
  const adjacency = new Map<number, number[]>();
  const add = (from: number, to: number) => {
    const held = adjacency.get(from);
    if (held) held.push(to);
    else adjacency.set(from, [to]);
  };
  for (const [a, b] of edges) {
    add(a, b);
    add(b, a);
  }

  const used = new Set<string>();
  const key = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  const runs: number[][] = [];

  const walk = (start: number) => {
    let run: number[] = [start];
    let at = start;
    for (;;) {
      const next = (adjacency.get(at) ?? []).find((other) => !used.has(key(at, other)));
      if (next === undefined) break;
      used.add(key(at, next));
      run.push(next);
      at = next;
    }
    if (run.length > 1) runs.push(run);
    run = [];
  };

  // Odd-degree nodes first: a run that starts anywhere else leaves stubs.
  const nodes = [...adjacency.keys()];
  for (const node of nodes.filter((n) => (adjacency.get(n)?.length ?? 0) % 2 === 1)) walk(node);
  for (const node of nodes) {
    while ((adjacency.get(node) ?? []).some((other) => !used.has(key(node, other)))) walk(node);
  }
  return runs;
}

export interface Traffic {
  term: string;
  students: number;
  trips: number;
  busiest: number;
  buckets: TrafficBucket[];
  destinations: { label: string; trips: number }[];
  unrouted: string[];
}

const BUCKETS = 6;

/** Every building a course is taught in this term, from the meeting rows. */
function buildingsByCourse(term: string): Map<string, string[]> {
  const rows = db()
    .query<{ code: string | null; payload: string }, [string]>(
      "SELECT code, payload FROM sections WHERE term = ?",
    )
    .all(term);

  const byCourse = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.code) continue;
    const section = JSON.parse(row.payload) as {
      FormattedMeetingTimes?: { BuildingDisplay?: string; IsOnline?: boolean }[];
    };
    for (const meeting of section.FormattedMeetingTimes ?? []) {
      const building = meeting.BuildingDisplay?.trim();
      // Online sections are a real part of the timetable and no part of the
      // walking; they belong nowhere on this map.
      if (!building || meeting.IsOnline) continue;
      const held = byCourse.get(row.code) ?? new Set<string>();
      held.add(building);
      byCourse.set(row.code, held);
    }
  }
  return new Map([...byCourse].map(([code, set]) => [code, [...set]]));
}

export function campusTraffic(term: string): Traffic {
  const map = campusMap();
  if (!map) throw new Error("no campus collected yet");

  const adjacency = adjacencyOf(map);
  const courses = buildingsByCourse(term);

  const nodeOf = new Map<string, number>();
  for (const [label, anchor] of Object.entries(map.anchors)) nodeOf.set(label, anchor.node);

  const students = db()
    .query<{ codes: string; dorm: string }, [string]>(
      `SELECT b.codes, p.dorm_name AS dorm
       FROM booklists b JOIN people p ON p.id = b.student_id
       WHERE b.term = ? AND p.present = 1 AND p.dorm_name IS NOT NULL`,
    )
    .all(term);

  // One route per (dorm, building) pair rather than per student: five thousand
  // students walk between a few hundred distinct pairs.
  const paths = new Map<string, number[] | null>();
  const walk = (from: number, to: number): number[] | null => {
    const key = `${from}:${to}`;
    if (!paths.has(key)) paths.set(key, shortestPath(map, from, to, adjacency)?.nodes ?? null);
    return paths.get(key)!;
  };

  const load = new Map<string, number>();
  const destinations = new Map<string, number>();
  const unrouted = new Set<string>();
  let counted = 0;
  let trips = 0;

  for (const student of students) {
    const home = nodeOf.get(student.dorm);
    if (home === undefined) {
      unrouted.add(student.dorm);
      continue;
    }
    counted++;

    for (const code of JSON.parse(student.codes) as string[]) {
      const where = courses.get(code);
      if (!where?.length) continue;
      // The section is unknown, so the trip is split across the buildings the
      // course is taught in rather than assigned to a guess.
      const weight = 1 / where.length;

      for (const label of where) {
        const target = nodeOf.get(label);
        if (target === undefined) {
          unrouted.add(label);
          continue;
        }
        destinations.set(label, (destinations.get(label) ?? 0) + weight);
        trips += weight;

        const path = walk(home, target);
        if (!path) continue;
        for (let i = 1; i < path.length; i++) {
          const a = Math.min(path[i - 1]!, path[i]!);
          const b = Math.max(path[i - 1]!, path[i]!);
          const key = `${a}:${b}`;
          load.set(key, (load.get(key) ?? 0) + weight);
        }
      }
    }
  }

  const busiest = Math.max(1, ...load.values());
  const banded: [number, number][][] = Array.from({ length: BUCKETS }, () => []);
  for (const [key, count] of load) {
    const level = Math.min(BUCKETS - 1, Math.floor((count / busiest) * BUCKETS));
    const [a, b] = key.split(":").map(Number);
    banded[level]!.push([a!, b!]);
  }
  const buckets: TrafficBucket[] = banded.map((edges, i) => ({
    level: i + 1,
    share: (i + 0.5) / BUCKETS,
    paths: chain(edges),
  }));

  return {
    term,
    students: counted,
    trips: Math.round(trips),
    busiest: Math.round(busiest),
    buckets: buckets.filter((bucket) => bucket.paths.length),
    destinations: [...destinations]
      .map(([label, count]) => ({ label, trips: Math.round(count) }))
      .sort((a, b) => b.trips - a.trips),
    unrouted: [...unrouted],
  };
}
