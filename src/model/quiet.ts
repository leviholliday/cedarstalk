/**
 * "Which of these free rooms is actually quiet."
 *
 * There is no turnstile in this data, so this is not a headcount -- it is a
 * proxy built from what the catalog does carry: how many people have a class
 * scheduled in the same building right now, how many are about to spill into
 * the halls on the way in or out, and how much real foot traffic passes the
 * building's door on an ordinary walk to class. Class load is the dominant
 * driver of campus noise, so the proxy is a good one -- it is just a proxy,
 * and every score says so by shipping its inputs alongside it rather than
 * hiding them behind one number.
 */

import { buildingByLabel, buildings } from "../store/campus";
import { buildingLoad, type FreeRoom, roomsFreeAt } from "./occupancy";
import { nodeTraffic } from "./traffic";

const SPILL_MINUTES = 15;
const WEIGHTS = { ambient: 0.5, spill: 0.3, centrality: 0.2 };

export interface QuietRoom extends FreeRoom {
  /** 0-100, lower is quieter. A ranking, not a measurement. */
  quiet: number;
  /** Enrolled headcount in the same building right now. */
  ambient: number;
  /** Enrolled headcount in the same building 15 minutes either side -- passing periods. */
  spill: number;
  /** Weighted footpath traffic through the building's door, this term. */
  centrality: number;
}

/** Foot traffic per building, from the term's real dorm-to-class walks. Empty if uncollected. */
function centralityByBuilding(term: string): Map<string, number> {
  let traffic: Map<number, number>;
  try {
    traffic = nodeTraffic(term);
  } catch {
    return new Map();
  }
  const out = new Map<string, number>();
  for (const [label, node] of buildingNodes()) {
    const value = traffic.get(node);
    if (value !== undefined) out.set(label, value);
  }
  return out;
}

let nodesCached: { at: number; nodes: [string, number][] } | undefined;

/** buildingByLabel is one row at a time; this is every labelled node, cached for a batch score. */
function buildingNodes(): [string, number][] {
  if (nodesCached && Date.now() - nodesCached.at < 60_000) return nodesCached.nodes;
  const nodes: [string, number][] = [];
  for (const building of buildings()) {
    if (building.node !== null) nodes.push([building.label, building.node]);
  }
  nodesCached = { at: Date.now(), nodes };
  return nodes;
}

export interface QuietOptions {
  minMinutes?: number;
  /** Only rooms in buildings the campus map can place -- excludes partner-school rows. */
  onCampusOnly?: boolean;
}

/**
 * Free rooms at one instant, ranked quietest first.
 *
 * Every score reports its own inputs (ambient, spill, centrality) rather than
 * just the composite, since "quiet" is a judgment call this makes on the
 * caller's behalf and the caller should be able to check the work.
 */
export function quietRoomsAt(
  term: string,
  day: number,
  minute: number,
  options: QuietOptions = {},
): QuietRoom[] {
  const free = roomsFreeAt(term, day, minute, options.minMinutes ?? 0);
  const candidates = options.onCampusOnly ? free.filter((r) => r.campusLabel !== null) : free;
  if (!candidates.length) return [];

  const ambientNow = new Map(buildingLoad(term, day, minute).map((b) => [b.building, b.enrolled]));
  const before = new Map(
    buildingLoad(term, day, Math.max(0, minute - SPILL_MINUTES)).map((b) => [
      b.building,
      b.enrolled,
    ]),
  );
  const after = new Map(
    buildingLoad(term, day, Math.min(24 * 60 - 1, minute + SPILL_MINUTES)).map((b) => [
      b.building,
      b.enrolled,
    ]),
  );
  const centrality = centralityByBuilding(term);

  const maxAmbient = Math.max(1, ...candidates.map((r) => ambientNow.get(r.building) ?? 0));
  const maxSpill = Math.max(
    1,
    ...candidates.map((r) => ((before.get(r.building) ?? 0) + (after.get(r.building) ?? 0)) / 2),
  );
  const maxCentrality = Math.max(1, ...centrality.values());

  const scored: QuietRoom[] = candidates.map((room) => {
    const ambient = ambientNow.get(room.building) ?? 0;
    const spill = ((before.get(room.building) ?? 0) + (after.get(room.building) ?? 0)) / 2;
    const nodeLoad = centrality.get(room.campusLabel ?? room.building) ?? 0;

    const quiet = Math.round(
      (WEIGHTS.ambient * (ambient / maxAmbient) +
        WEIGHTS.spill * (spill / maxSpill) +
        WEIGHTS.centrality * (nodeLoad / maxCentrality)) *
        100,
    );

    return { ...room, quiet, ambient, spill: Math.round(spill), centrality: Math.round(nodeLoad) };
  });

  return scored.sort((a, b) => a.quiet - b.quiet);
}

/** Free, quiet, and off the beaten path -- the "good spot nobody thinks of" query. */
export function hiddenGems(term: string, day: number, minute: number): QuietRoom[] {
  const ranked = quietRoomsAt(term, day, minute, { minMinutes: 30, onCampusOnly: true });
  if (!ranked.length) return [];
  const cutoff = ranked[Math.max(0, Math.floor(ranked.length * 0.35) - 1)]!.quiet;
  return ranked.filter((room) => room.quiet <= cutoff);
}

/** One building's quietness across a whole day -- the input to a rhythm chart. */
export interface RhythmPoint {
  minute: number;
  ambient: number;
}

export function buildingRhythm(term: string, building: string, day: number): RhythmPoint[] {
  const resolved = buildingByLabel(building);
  const label = resolved?.label ?? building;
  const points: RhythmPoint[] = [];
  for (let minute = 0; minute < 24 * 60; minute += 30) {
    const load = buildingLoad(term, day, minute).find((b) => b.building === label);
    points.push({ minute, ambient: load?.enrolled ?? 0 });
  }
  return points;
}
