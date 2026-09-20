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
import { buildingByLabel, campusMap } from "../store/campus";
import { harvestedStudentIds } from "../store/harvest";
import { sectionRosters } from "../store/rosters";
import { minutesOfDay } from "./meetings";
import { scheduleFor } from "./schedule";

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

export interface EdgeLoad {
  /** Edge key "a:b" (a < b) -> weighted trip count crossing it. */
  load: Map<string, number>;
  destinations: Map<string, number>;
  unrouted: Set<string>;
  students: number;
  trips: number;
}

/**
 * The routing core, shared by `campusTraffic`'s bucketed picture and
 * `nodeTraffic`'s per-building foot-traffic figure. Walking a term's
 * dorm-to-class trips over the graph is the expensive part; both callers want
 * a different shape of the same load map, not a second walk.
 */
function edgeLoad(term: string): EdgeLoad {
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

  return { load, destinations, unrouted, students: counted, trips };
}

export function campusTraffic(term: string): Traffic {
  const { load, destinations, unrouted, students: counted, trips } = edgeLoad(term);

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

/**
 * Foot traffic at every node, as measured rather than modelled: the summed
 * weight of every edge touching it, from the same dorm-to-class walks
 * `campusTraffic` buckets for the map. A building's door node is loud when a
 * lot of that traffic passes through it -- which is a real corridor-noise
 * signal, not a proxy for one.
 */
export function nodeTraffic(term: string): Map<number, number> {
  const { load } = edgeLoad(term);
  const perNode = new Map<number, number>();
  for (const [key, weight] of load) {
    const [a, b] = key.split(":").map(Number) as [number, number];
    perNode.set(a, (perNode.get(a) ?? 0) + weight);
    perNode.set(b, (perNode.get(b) ?? 0) + weight);
  }
  return perNode;
}

/** Matches the walking speed `routes/campus.ts` assumes for /v1/campus/route. */
const WALK_METRES_PER_SECOND = 1.35;

export interface TimedTraffic {
  term: string;
  day: number;
  minute: number;
  /** Booklist-observed people-in-transit this instant, before scaling by roster coverage. */
  observed: number;
  /** observed, scaled up by each transition's own section coverage -- the estimated true flow. */
  estimated: number;
  busiest: number;
  buckets: TrafficBucket[];
  unrouted: string[];
}

/** One student's walk between two classes: the route, when they're on it, and what it stands for. */
interface Walk {
  nodes: number[];
  /** 1 / the origin section's roster coverage -- see `walksOn`. */
  weight: number;
  startMinute: number;
  endMinute: number;
}

/**
 * Every between-class walk on one weekday, routed once.
 *
 * Gathered in a single pass because the expensive parts -- reading 400-odd
 * schedules and running a Dijkstra per transition -- do not depend on what
 * time anyone asks about. Doing this per instant meant redoing all of it for
 * every question; doing it once means a whole day costs about what one
 * instant used to.
 *
 * Each walk is scaled by 1 / (its origin section's roster coverage): a
 * booklist harvest samples the population, so one observed walk out of a
 * section only 10% covered stands in for roughly ten people making it. The
 * coverage table is built once here too -- `rosterFor` rebuilds the whole
 * roster map on every call, which is fine once and ruinous per transition.
 */
function walksOn(term: string, day: number): { walks: Walk[]; unrouted: Set<string> } {
  const map = campusMap();
  if (!map) throw new Error("no campus collected yet");
  const adjacency = adjacencyOf(map);

  const coverageOf = new Map(
    sectionRosters(term).map((roster) => [roster.sectionName, roster.coverage]),
  );
  const routes = new Map<string, ReturnType<typeof shortestPath>>();

  const walks: Walk[] = [];
  const unrouted = new Set<string>();

  for (const studentId of harvestedStudentIds(term)) {
    const schedule = scheduleFor(studentId, term);
    const today = schedule?.week.find((d) => d.day === day);
    if (!today) continue;

    const blocks = [...today.blocks].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < blocks.length; i++) {
      const prev = blocks[i - 1]!;
      const next = blocks[i]!;
      if (!prev.building || !next.building || prev.building === next.building) continue;

      const from = buildingByLabel(prev.building);
      const to = buildingByLabel(next.building);
      if (from?.node == null || to?.node == null) {
        unrouted.add(prev.building);
        unrouted.add(next.building);
        continue;
      }

      // Hundreds of students walk between the same few dozen building pairs.
      const key = `${from.node}:${to.node}`;
      if (!routes.has(key)) routes.set(key, shortestPath(map, from.node, to.node, adjacency));
      const path = routes.get(key);
      if (!path) continue;

      const coverage = coverageOf.get(prev.section.toUpperCase());
      const startMinute = minutesOfDay(prev.end) ?? 0;
      walks.push({
        nodes: path.nodes,
        weight: coverage && coverage > 0 ? 1 / coverage : 1,
        startMinute,
        endMinute: startMinute + path.metres / WALK_METRES_PER_SECOND / 60,
      });
    }
  }

  return { walks, unrouted };
}

/** Band a set of edge loads into the same six levels the whole-term view draws. */
function band(load: Map<string, number>, against: number): TrafficBucket[] {
  const banded: [number, number][][] = Array.from({ length: BUCKETS }, () => []);
  for (const [key, count] of load) {
    const level = Math.min(BUCKETS - 1, Math.floor((count / against) * BUCKETS));
    const [a, b] = key.split(":").map(Number);
    banded[level]!.push([a!, b!]);
  }
  return banded
    .map((edges, i) => ({ level: i + 1, share: (i + 0.5) / BUCKETS, paths: chain(edges) }))
    .filter((bucket) => bucket.paths.length);
}

/** Sum the edges under every walk in progress at one instant. */
function loadAt(
  walks: Walk[],
  minute: number,
): { load: Map<string, number>; observed: number; estimated: number } {
  const load = new Map<string, number>();
  let observed = 0;
  let estimated = 0;

  for (const walk of walks) {
    if (minute < walk.startMinute || minute > walk.endMinute) continue;
    observed++;
    estimated += walk.weight;
    for (let j = 1; j < walk.nodes.length; j++) {
      const a = Math.min(walk.nodes[j - 1]!, walk.nodes[j]!);
      const b = Math.max(walk.nodes[j - 1]!, walk.nodes[j]!);
      load.set(`${a}:${b}`, (load.get(`${a}:${b}`) ?? 0) + walk.weight);
    }
  }
  return { load, observed, estimated };
}

/**
 * Chokepoints at one moment, not a whole term averaged into one picture.
 *
 * `campusTraffic` answers "where does the term walk, overall" from dorms to
 * class buildings; this answers "who is between two classes right now."
 */
export function campusTrafficAt(term: string, day: number, minute: number): TimedTraffic {
  const { walks, unrouted } = walksOn(term, day);
  const { load, observed, estimated } = loadAt(walks, minute);
  const busiest = Math.max(1, ...load.values());

  return {
    term,
    day,
    minute,
    observed,
    estimated: Math.round(estimated),
    busiest: Math.round(busiest),
    buckets: band(load, busiest),
    unrouted: [...unrouted],
  };
}

export interface TrafficFrame {
  minute: number;
  observed: number;
  estimated: number;
  busiest: number;
  buckets: TrafficBucket[];
}

export interface DayTraffic {
  term: string;
  day: number;
  bucketMinutes: number;
  /** The busiest edge anywhere in the day. Every frame is banded against this. */
  peak: number;
  frames: TrafficFrame[];
  unrouted: string[];
}

/**
 * A whole weekday, frame by frame -- everything a time-lapse needs in one
 * request rather than one request per frame.
 *
 * Every frame is banded against the *day's* peak rather than its own, which
 * matters: self-normalising each frame would paint a deserted 2pm corridor
 * exactly as hot as the 9:50 crush, and an animation that does that is
 * lying in the most convincing way available to it.
 */
export function campusTrafficDay(term: string, day: number, bucketMinutes = 10): DayTraffic {
  const { walks, unrouted } = walksOn(term, day);

  const frames: {
    minute: number;
    load: Map<string, number>;
    observed: number;
    estimated: number;
  }[] = [];
  let peak = 1;

  if (walks.length) {
    const first =
      Math.floor(Math.min(...walks.map((w) => w.startMinute)) / bucketMinutes) * bucketMinutes;
    const last =
      Math.ceil(Math.max(...walks.map((w) => w.endMinute)) / bucketMinutes) * bucketMinutes;
    for (let minute = first; minute <= last; minute += bucketMinutes) {
      const frame = loadAt(walks, minute);
      peak = Math.max(peak, ...frame.load.values());
      frames.push({ minute, ...frame });
    }
  }

  return {
    term,
    day,
    bucketMinutes,
    peak: Math.round(peak),
    frames: frames.map((frame) => ({
      minute: frame.minute,
      observed: frame.observed,
      estimated: Math.round(frame.estimated),
      busiest: Math.round(Math.max(0, ...frame.load.values())),
      buckets: band(frame.load, peak),
    })),
    unrouted: [...unrouted],
  };
}
