/**
 * The campus itself, off OpenStreetMap.
 *
 * Merged in from the assassins project, where this was built to chase people
 * around a map. The interesting part here is the join it unlocks: every person
 * in the directory already carries a dorm or an office name, and every section
 * in the catalog carries a building, so once those names have coordinates the
 * engine can answer where people are without collecting one new field about
 * anybody.
 *
 * Overpass is slow and rate limited, and campus buildings move about as often
 * as you would expect, so the extract is fetched once and kept. Everything
 * downstream reads the stored map.
 */

import { db } from "../db";
import { type CampusMap, replaceCampus } from "../store/campus";
import { meetingBuildings } from "../store/catalog";
import { finishSweep, startSweep } from "../store/history";
import buildingsTsv from "./assets/buildings.tsv" with { type: "text" };
import dormGenderTsv from "./assets/dorm-gender.tsv" with { type: "text" };
import pinsTsv from "./assets/pins.tsv" with { type: "text" };
import tourJson from "./assets/tour-buildings.json";
import { fetchTour, tourKey } from "./tour";

/**
 * South, west, north, east.
 *
 * Wider than it looks like it needs to be, deliberately. The obvious box around
 * the academic core cuts off the townhouses and residence-life centres to the
 * west, the security house to the north, and the operations centre past both —
 * three hundred people housed or working outside a box drawn by eye.
 */
const BBOX = [39.736, -83.8215, 39.7595, -83.796] as const;
// Two mirrors, because the main one refuses anonymous clients when it is busy
// and a campus map is not worth a failed run.
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const USER_AGENT = "cedarstalk (a fork of github.com/taciturnaxolotl/cedarengine by Kieran Klukas)";

/**
 * Ways you can actually walk, and how much you mind walking them. A footpath
 * is the baseline; roads cost more so a route only uses them when there is no
 * path.
 */
const WALKABLE: Record<string, number> = {
  footway: 1,
  path: 1,
  pedestrian: 1,
  steps: 1.4,
  cycleway: 1.1,
  service: 1.2,
  track: 1.3,
  living_street: 1.2,
  residential: 1.3,
  unclassified: 1.4,
  tertiary: 1.8,
  secondary: 2.2,
  primary: 2.6,
};

const QUERY = `
[out:json][timeout:120];
(
  way["building"](${BBOX});
  relation["building"](${BBOX});
  way["highway"~"^(footway|path|pedestrian|steps|cycleway|service|residential|unclassified|tertiary|secondary|primary|living_street|track)$"](${BBOX});
  node["amenity"~"^(parking|cafe|restaurant|library)$"](${BBOX});
);
out body geom;
`;

const round = (n: number) => Math.round(n * 10) / 10;

interface OsmPoint {
  lat: number;
  lon: number;
}

export interface OsmElement {
  tags?: Record<string, string>;
  geometry?: OsmPoint[];
  nodes?: number[];
  members?: { role?: string; geometry?: OsmPoint[] }[];
}

/**
 * The curated name map, carried over from assassins.
 *
 * The directory abbreviates ("Ctr for Bib and Theo Studies") and OSM spells
 * out, and no amount of fuzzy matching bridges that reliably. Six halls OSM
 * has never traced come from Cedarville's own campus tour instead.
 */
export function labelMap(): { label: string; osm: string | null }[] {
  const rows: { label: string; osm: string | null }[] = [];
  for (const line of buildingsTsv.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [label, osm] = trimmed.split("\t");
    if (!label || label === "label") continue;
    rows.push({ label, osm: osm?.trim() || null });
  }
  return rows;
}

/**
 * Which halls are men's and which are women's.
 *
 * The directory does not carry gender and never will, but it does say who
 * lives where, and the halls are single-sex. Carried over from cedarstalk,
 * where it was worked out once from exactly that.
 */
export function dormGender(): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of dormGenderTsv.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [dorm, gender] = trimmed.split("\t");
    if (!dorm || !gender || dorm === "Dorm") continue;
    rows.set(dorm, gender);
  }
  return rows;
}

export interface Pin {
  label: string;
  lat: number;
  lon: number;
  note: string;
}

/**
 * Buildings nobody draws, positioned rather than outlined.
 *
 * The last resort, and deliberately a separate file from the name map: a pin
 * is a claim about where something is, not a claim about what it is called,
 * and the two go stale for different reasons.
 */
export function pins(): Pin[] {
  const rows: Pin[] = [];
  for (const line of pinsTsv.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [label, lat, lon, note] = trimmed.split("\t");
    if (!label || label === "label" || !lat || !lon) continue;
    rows.push({ label, lat: Number(lat), lon: Number(lon), note: note ?? "" });
  }
  return rows;
}

export const tourBuildings = (): Record<string, { ring: [number, number][] }> =>
  tourJson.buildings as unknown as Record<string, { ring: [number, number][] }>;

/** Names the engine actually needs coordinates for, taken from its own data. */
export function occupiedBuildings(): { label: string; kind: string }[] {
  return db()
    .query<{ label: string; kind: string }, []>(
      `SELECT dorm_name AS label, 'dorm' AS kind FROM people
       WHERE present = 1 AND dorm_name IS NOT NULL GROUP BY dorm_name
       UNION ALL
       SELECT office_name, 'office' FROM people
       WHERE present = 1 AND office_name IS NOT NULL GROUP BY office_name`,
    )
    .all();
}

export async function fetchOsm(): Promise<{ elements: OsmElement[] }> {
  let last = "";
  for (const endpoint of OVERPASS) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": USER_AGENT,
      },
      body: new URLSearchParams({ data: QUERY }),
    });
    if (response.ok) return (await response.json()) as { elements: OsmElement[] };
    last = `${new URL(endpoint).host} returned HTTP ${response.status}`;
  }
  throw new Error(`overpass is not answering: ${last}`);
}

/**
 * The directory's own shorthand, expanded.
 *
 * "Ctr for Bib and Theo Studies" and "Center for Biblical and Theological
 * Studies" are the same building, and the curated list covers the ones that
 * matter most. This catches the rest: normalise both names, then accept the
 * best word-overlap above a threshold. Below it, a label is better left
 * unmapped than pinned to the wrong building.
 */
const ABBREVIATIONS: [RegExp, string][] = [
  [/\bctr\b|\bcntr\b/g, "center"],
  [/\bbldg\b/g, "building"],
  [/\bapt\b/g, "apartment"],
  [/\badmin\b/g, "administration"],
  [/\bbib\b/g, "biblical"],
  [/\btheo\b/g, "theological"],
  [/\bcomm\b/g, "communication"],
  [/\bbus\b/g, "business"],
  [/\bsci\b/g, "science"],
  [/\brec\b/g, "recreation"],
  [/\bfit\b/g, "fitness"],
  [/\beng\b|\begr\b/g, "engineering"],
];

const words = (name: string): Set<string> => {
  let text = name.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  for (const [pattern, full] of ABBREVIATIONS) text = text.replace(pattern, full);
  return new Set(text.split(" ").filter((word) => word && word !== "and" && word !== "the"));
};

export function bestName(label: string, candidates: Iterable<string>): string | null {
  const wanted = words(label);
  if (!wanted.size) return null;
  let best: { name: string; score: number } | null = null;

  for (const candidate of candidates) {
    const other = words(candidate);
    let shared = 0;
    for (const word of wanted) if (other.has(word)) shared++;
    const score = shared / (wanted.size + other.size - shared);
    if (!best || score > best.score) best = { name: candidate, score };
  }
  return best && best.score >= 0.6 ? best.name : null;
}

/**
 * Turn the extract into something drawable and routable: outlines in metres,
 * and a walking graph of every footpath, stair and service drive.
 */
export function buildMap(
  osm: { elements: OsmElement[] },
  labels: { label: string; osm: string | null; kind?: string; gender?: string | null }[],
  extra: Record<string, { ring: [number, number][] }> = {},
  pinned: Record<string, Pin> = {},
): CampusMap {
  const points = osm.elements.flatMap((e) => e.geometry ?? []);
  if (!points.length) throw new Error("the extract has no geometry in it");

  // Flat-earth projection about the middle of the extract. Over a campus the
  // error is centimetres, and metres beat degrees for everything downstream.
  const lat0 = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lon0 = points.reduce((sum, p) => sum + p.lon, 0) / points.length;
  const project = (p: OsmPoint): [number, number] => [
    round((p.lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180)),
    round((lat0 - p.lat) * 110540), // y grows downward, the way SVG likes it
  ];
  const unproject = ([x, y]: [number, number]) => ({
    lat: lat0 - y / 110540,
    lon: lon0 + x / (111320 * Math.cos((lat0 * Math.PI) / 180)),
  });

  // ---- buildings ---------------------------------------------------------

  const byName = new Map<string, { name: string | null; ring: [number, number][] }>();
  const buildings: { name: string | null; ring: [number, number][]; fromTour?: boolean }[] = [];
  for (const element of osm.elements) {
    if (!element.tags?.building) continue;
    // A simple building is one closed way; a complicated one is a multipolygon
    // relation, and its outer members are the outlines we want.
    const rings = element.geometry
      ? [element.geometry]
      : (element.members ?? [])
          .filter((m) => m.role !== "inner" && m.geometry)
          .map((m) => m.geometry as OsmPoint[]);
    for (const geometry of rings) {
      const building = { name: element.tags.name ?? null, ring: geometry.map(project) };
      buildings.push(building);
      if (building.name && !byName.has(building.name)) byName.set(building.name, building);
    }
  }

  // ---- walking graph -----------------------------------------------------

  const index = new Map<number, number>();
  const nodes: [number, number][] = [];
  const adjacency = new Map<number, Map<number, number>>();

  const nodeAt = (id: number, point: OsmPoint): number => {
    let known = index.get(id);
    if (known === undefined) {
      known = nodes.length;
      index.set(id, known);
      nodes.push(project(point));
    }
    return known;
  };
  const link = (a: number, b: number, weight: number) => {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      let edges = adjacency.get(from);
      if (!edges) adjacency.set(from, (edges = new Map()));
      const seen = edges.get(to);
      if (seen === undefined || weight < seen) edges.set(to, weight);
    }
  };

  for (const element of osm.elements) {
    const cost = WALKABLE[element.tags?.highway ?? ""];
    if (!cost || !element.geometry || !element.nodes) continue;
    for (let i = 1; i < element.nodes.length; i++) {
      const a = nodeAt(element.nodes[i - 1]!, element.geometry[i - 1]!);
      const b = nodeAt(element.nodes[i]!, element.geometry[i]!);
      if (a === b) continue;
      const [ax, ay] = nodes[a]!;
      const [bx, by] = nodes[b]!;
      link(a, b, Math.hypot(bx - ax, by - ay) * cost);
    }
  }

  // A route can only exist inside one connected component, so keep the big one
  // and drop the stray fragments that would silently break routing.
  const main = largestComponent(nodes.length, adjacency);
  const renumber = new Map([...main].sort((a, b) => a - b).map((old, i) => [old, i]));
  const kept = [...renumber.keys()].map((old) => nodes[old]!);
  const edges: [number, number, number][] = [];
  for (const [from, links] of adjacency) {
    const a = renumber.get(from);
    if (a === undefined) continue;
    for (const [to, weight] of links) {
      const b = renumber.get(to);
      if (b !== undefined && from < to) edges.push([a, b, Math.round(weight)]);
    }
  }

  // ---- anchors -----------------------------------------------------------

  // Where you stand when you arrive: the graph node closest to the building's
  // outline, which is a door often enough and never far from one.
  const anchors: CampusMap["anchors"] = {};
  const missing: string[] = [];
  const focus = new Set<string>();

  for (const { label, osm: name, kind, gender } of labels) {
    let ring: [number, number][] | null = null;
    let source: "osm" | "tour" | "pin" = "osm";
    const matched = name && byName.has(name) ? name : bestName(label, byName.keys());
    if (matched && byName.has(matched)) {
      ring = byName.get(matched)!.ring;
      focus.add(matched);
    } else if (extra[label]) {
      ring = extra[label]!.ring.map(([lat, lon]) => project({ lat, lon }));
      buildings.push({ name: label, ring, fromTour: true });
      focus.add(label);
      source = "tour";
    } else if (pinned[label]) {
      // A pin has no footprint, so its "ring" is the single point it is. The
      // anchor search below reads it the same way and lands on the nearest
      // path node, which is all an outline was ever used for.
      const pin = pinned[label]!;
      ring = [project({ lat: pin.lat, lon: pin.lon })];
      source = "pin";
    }
    if (!ring) {
      missing.push(label);
      continue;
    }

    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < kept.length; i++) {
      const [x, y] = kept[i]!;
      for (const [rx, ry] of ring) {
        const distance = (rx - x) ** 2 + (ry - y) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
    }

    const centre: [number, number] = [
      round(ring.reduce((sum, p) => sum + p[0], 0) / ring.length),
      round(ring.reduce((sum, p) => sum + p[1], 0) / ring.length),
    ];
    anchors[label] = {
      node: best,
      name: matched ?? name ?? label,
      kind: kind ?? "unknown",
      gender: gender ?? null,
      source,
      centre,
      ...unproject(centre),
      ring,
    };
  }

  // Keep the walkable neighbourhood of the places people actually go.
  const anchored = Object.values(anchors).map((a) => kept[a.node]!);
  const pad = 130;
  const box: [number, number, number, number] = anchored.length
    ? [
        Math.min(...anchored.map((p) => p[0])) - pad,
        Math.min(...anchored.map((p) => p[1])) - pad,
        Math.max(...anchored.map((p) => p[0])) + pad,
        Math.max(...anchored.map((p) => p[1])) + pad,
      ]
    : [0, 0, 0, 0];
  const inside = ([x, y]: [number, number]) =>
    x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];

  return {
    origin: { lat: lat0, lon: lon0 },
    box: box.map(Math.round) as [number, number, number, number],
    // OpenStreetMap carries some buildings twice: a way and a relation over the
    // same footprint, or a building:part traced on top of its building.
    // Identical outline means identical building, so it is drawn once.
    buildings: dedupe(buildings.filter((b) => b.ring.some(inside))).map((b) => ({
      name: b.name,
      ring: b.ring,
      focus: b.name ? focus.has(b.name) : false,
    })),
    nodes: kept,
    edges,
    anchors,
    missing,
  };
}

function dedupe<T extends { name: string | null; ring: [number, number][] }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    const key = item.ring.map((p) => p.join(",")).join(" ");
    // Keep whichever copy has a name, since one of a pair often does not.
    if (!seen.has(key) || (!seen.get(key)!.name && item.name)) seen.set(key, item);
  }
  return [...seen.values()];
}

function largestComponent(count: number, adjacency: Map<number, Map<number, number>>): Set<number> {
  const seen = new Uint8Array(count);
  let best = new Set<number>();
  for (let start = 0; start < count; start++) {
    if (seen[start] || !adjacency.has(start)) continue;
    const component = new Set([start]);
    const queue = [start];
    seen[start] = 1;
    while (queue.length) {
      for (const next of adjacency.get(queue.pop()!)?.keys() ?? []) {
        if (seen[next]) continue;
        seen[next] = 1;
        component.add(next);
        queue.push(next);
      }
    }
    if (component.size > best.size) best = component;
  }
  return best;
}

/**
 * Fetch, build and store the campus. The label list comes from the directory,
 * so a building nobody lives or works in is not something we go looking for.
 */
export async function collectCampus(): Promise<{
  buildings: number;
  fromTour: number;
  pinned: number;
  missing: string[];
}> {
  const sweep = startSweep("campus", "cli");
  const curated = new Map(labelMap().map((row) => [row.label, row.osm]));
  const kinds = new Map<string, string>();
  for (const { label, kind } of occupiedBuildings()) {
    const held = kinds.get(label);
    kinds.set(label, held && held !== kind ? "both" : kind);
  }

  // Everything the curated map knows about, plus every building the directory
  // actually puts somebody in.
  // Classrooms count too: a building nobody is listed against is still a place
  // five hundred people walk to on a Tuesday.
  for (const label of meetingBuildings()) {
    if (!kinds.has(label)) kinds.set(label, "class");
  }

  const genders = dormGender();
  const labels = [...new Set([...curated.keys(), ...kinds.keys()])].map((label) => ({
    label,
    osm: curated.get(label) ?? label,
    kind: kinds.get(label) ?? "unknown",
    gender: genders.get(label) ?? null,
  }));

  // The tour draws the dorms OSM never traced. Its outlines are the fallback,
  // so they are gathered before the map is built rather than after it fails.
  const extra: Record<string, { ring: [number, number][] }> = { ...tourBuildings() };
  let fromTour = 0;
  try {
    const tour = await fetchTour();
    for (const { label } of labels) {
      const drawn = tour.buildings.get(tourKey(label));
      if (drawn && !extra[label]) {
        extra[label] = { ring: drawn.ring };
        fromTour++;
      }
    }
  } catch {
    // The tour is a nicety. A campus without the six unmapped halls still
    // routes, and the cached outlines cover the ones that matter most.
  }

  const pinned = Object.fromEntries(pins().map((pin) => [pin.label, pin]));

  const osm = await fetchOsm();
  const map = buildMap(osm, labels, extra, pinned);
  const stored = replaceCampus(map);

  finishSweep(sweep, {
    seen: stored,
    added: stored,
    complete: true,
    note: map.missing.length ? `${map.missing.length} unmapped` : undefined,
  });
  return {
    buildings: stored,
    fromTour,
    pinned: Object.values(map.anchors).filter((anchor) => anchor.source === "pin").length,
    missing: map.missing,
  };
}
