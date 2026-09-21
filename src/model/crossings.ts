/**
 * Whether two people's walks would put them in the same place at once.
 *
 * The full version of this question is a real geometry problem: do two
 * *routed paths* pass near each other, not just through it, and "near" needs
 * a threshold nobody has measured. This is the version that needs no
 * invented constant -- two walks cross here only when their walking windows
 * overlap in clock time *and* the routes the campus graph gives each of them
 * pass through the exact same node. That is a fact about the map, not a
 * judgment call, which is what makes it safe to report without qualification.
 *
 * The cost of that conservatism is real: two people walking down opposite
 * sides of the same wide plaza, one metre apart, will not show up here unless
 * the graph happens to route them through a shared junction. This finds the
 * crossings it can prove, not every crossing that happens.
 */

import { adjacencyOf, shortestPath } from "../lib/route";
import { buildingByLabel, buildings, campusMap } from "../store/campus";
import { walkTransitions } from "./geography";
import { minutesOfDay } from "./meetings";
import { scheduleFor } from "./schedule";

export interface CrossingSide {
  from: string;
  to: string;
  /** Clock time each of them is walking, i.e. the gap between the two classes. */
  windowStart: string;
  windowEnd: string;
}

export interface Crossing {
  day: number;
  /** The overlap of both walking windows -- not either walk's full window. */
  overlapStart: string;
  overlapEnd: string;
  overlapMinutes: number;
  a: CrossingSide;
  b: CrossingSide;
  /** A mapped building whose own anchor node is one of the shared nodes, if any. */
  near: string | null;
  sharedNodes: number;
}

export interface CrossingsResult {
  studentA: string;
  studentB: string;
  term: string;
  /** False when either person has no timetable to check this against. */
  known: boolean;
  crossings: Crossing[];
}

const clock = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export function crossingsFor(
  studentA: string,
  studentB: string,
  term?: string,
): CrossingsResult {
  const scheduleA = scheduleFor(studentA, term);
  const scheduleB = scheduleFor(studentB, term);
  const resolvedTerm = scheduleA?.term ?? scheduleB?.term ?? term ?? "";

  if (!scheduleA || !scheduleB) {
    return { studentA, studentB, term: resolvedTerm, known: false, crossings: [] };
  }

  const map = campusMap();
  const adjacency = map ? adjacencyOf(map) : null;

  // Routing the same building pair more than once is wasted work -- several
  // transitions across the week often share a from/to, and this call can
  // touch dozens of pairs across a shared week.
  const routeCache = new Map<string, Set<number> | null>();
  function routedNodes(from: string, to: string): Set<number> | null {
    const key = `${from}>${to}`;
    const cached = routeCache.get(key);
    if (cached !== undefined) return cached;
    let nodes: Set<number> | null = null;
    if (map && adjacency) {
      const a = buildingByLabel(from);
      const b = buildingByLabel(to);
      if (a?.node != null && b?.node != null) {
        const path = shortestPath(map, a.node, b.node, adjacency);
        if (path) nodes = new Set(path.nodes);
      }
    }
    routeCache.set(key, nodes);
    return nodes;
  }

  // A node that happens to be a building's own anchor is worth naming; an
  // arbitrary waypoint along a footpath is not something a person would
  // recognise, so it is left out rather than described vaguely.
  const anchorByNode = new Map<number, string>();
  for (const building of buildings()) {
    if (building.node != null) anchorByNode.set(building.node, building.label);
  }

  const crossings: Crossing[] = [];

  for (let day = 0; day < 7; day++) {
    const blocksA = scheduleA.week.find((d) => d.day === day)?.blocks ?? [];
    const blocksB = scheduleB.week.find((d) => d.day === day)?.blocks ?? [];
    if (!blocksA.length || !blocksB.length) continue;

    const transitionsA = walkTransitions(blocksA, day);
    const transitionsB = walkTransitions(blocksB, day);
    if (!transitionsA.length || !transitionsB.length) continue;

    for (const ta of transitionsA) {
      const aStart = minutesOfDay(ta.fromEnd) ?? 0;
      const aEnd = minutesOfDay(ta.toStart) ?? 0;
      if (aEnd <= aStart) continue;

      for (const tb of transitionsB) {
        const bStart = minutesOfDay(tb.fromEnd) ?? 0;
        const bEnd = minutesOfDay(tb.toStart) ?? 0;
        if (bEnd <= bStart) continue;

        const overlapStart = Math.max(aStart, bStart);
        const overlapEnd = Math.min(aEnd, bEnd);
        if (overlapStart >= overlapEnd) continue;

        const nodesA = routedNodes(ta.from, ta.to);
        const nodesB = routedNodes(tb.from, tb.to);
        if (!nodesA || !nodesB) continue;

        let shared = 0;
        let near: string | null = null;
        for (const node of nodesA) {
          if (!nodesB.has(node)) continue;
          shared++;
          if (near === null) near = anchorByNode.get(node) ?? null;
        }
        if (!shared) continue;

        crossings.push({
          day,
          overlapStart: clock(overlapStart),
          overlapEnd: clock(overlapEnd),
          overlapMinutes: overlapEnd - overlapStart,
          a: {
            from: ta.from,
            to: ta.to,
            windowStart: ta.fromEnd,
            windowEnd: ta.toStart,
          },
          b: {
            from: tb.from,
            to: tb.to,
            windowStart: tb.fromEnd,
            windowEnd: tb.toStart,
          },
          near,
          sharedNodes: shared,
        });
      }
    }
  }

  crossings.sort((a, b) => a.day - b.day || a.overlapStart.localeCompare(b.overlapStart));
  return { studentA, studentB, term: resolvedTerm, known: true, crossings };
}
