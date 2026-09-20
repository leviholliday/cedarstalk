/**
 * When the dining hall actually fills up, predicted from class end times.
 *
 * There is no headcount sensor at the door -- this is built entirely from
 * when classes near dining let out, offset by how long the walk over
 * actually takes, plus a small constant for people who live close enough to
 * just wander over without a class driving it. It is a forecast from a
 * proxy, not a measurement, same as the quietness score in `model/quiet.ts`.
 *
 * Which buildings count as "dining" is not derivable from anything collected
 * -- OSM, the directory and the catalog all decline to say. See
 * `collect/assets/dining.tsv`.
 */

import diningTsv from "../collect/assets/dining.tsv" with { type: "text" };
import { db } from "../db";
import { adjacencyOf, shortestPath } from "../lib/route";
import { buildingByLabel, campusMap, occupancy } from "../store/campus";

const WALK_METRES_PER_SECOND = 1.35;
const BUCKET_MINUTES = 10;
/** Rough share of nearby residents who wander over without a class ending nearby. Not measured. */
const RESIDENTIAL_PARTICIPATION = 0.1;

export function diningBuildingLabels(): string[] {
  const labels: string[] = [];
  for (const line of diningTsv.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed === "label") continue;
    labels.push(trimmed);
  }
  return labels;
}

export interface ArrivalBucket {
  minute: number;
  fromClasses: number;
  baseline: number;
  total: number;
}

export interface DiningForecast {
  day: number;
  diningBuildings: string[];
  radiusMinutes: number;
  buckets: ArrivalBucket[];
  peak: { minute: number; total: number } | null;
  /** The lowest-traffic bucket within the day's active window -- not 3am, the actual trough between rushes. */
  quietest: { minute: number; total: number } | null;
}

export interface DiningOptions {
  /** Overrides `dining.tsv` for a one-off call without editing the file. */
  buildings?: string[];
  /** Max walk time counted as "near dining." Default 15 minutes. */
  radiusMinutes?: number;
}

/**
 * A day's predicted arrival curve at dining, in 10-minute buckets.
 *
 * Null when there's nothing to build it from: no dining buildings configured
 * (and none passed via `options.buildings`), or no campus map to route on.
 */
export function diningForecast(
  term: string,
  day: number,
  options: DiningOptions = {},
): DiningForecast | null {
  const diningLabels = options.buildings?.length ? options.buildings : diningBuildingLabels();
  if (!diningLabels.length) return null;

  const map = campusMap();
  if (!map) return null;
  const adjacency = adjacencyOf(map);

  const diningNodes = diningLabels
    .map((label) => buildingByLabel(label))
    .filter((b): b is NonNullable<typeof b> => b?.node != null);
  if (!diningNodes.length) return null;

  const radiusMinutes = options.radiusMinutes ?? 15;

  const walkCache = new Map<string, number | null>();
  const walkMinutesFrom = (buildingLabel: string): number | null => {
    if (walkCache.has(buildingLabel)) return walkCache.get(buildingLabel)!;
    const building = buildingByLabel(buildingLabel);
    if (building?.node == null) {
      walkCache.set(buildingLabel, null);
      return null;
    }
    let best: number | null = null;
    for (const dining of diningNodes) {
      const path = shortestPath(map, building.node!, dining.node!, adjacency);
      if (!path) continue;
      const minutes = path.metres / WALK_METRES_PER_SECOND / 60;
      if (best === null || minutes < best) best = minutes;
    }
    walkCache.set(buildingLabel, best);
    return best;
  };

  const fromClasses = new Map<number, number>();
  const rows = db()
    .query<{ building: string; endMin: number; enrolled: number | null }, [string, number]>(
      "SELECT building, end_min AS endMin, enrolled FROM room_occupancy WHERE term = ? AND day = ?",
    )
    .all(term, day);

  for (const row of rows) {
    const walkMinutes = walkMinutesFrom(row.building);
    if (walkMinutes === null || walkMinutes > radiusMinutes) continue;
    const arrival = row.endMin + walkMinutes;
    const bucket = Math.floor(arrival / BUCKET_MINUTES) * BUCKET_MINUTES;
    fromClasses.set(bucket, (fromClasses.get(bucket) ?? 0) + (row.enrolled ?? 0));
  }

  if (!fromClasses.size) {
    return {
      day,
      diningBuildings: diningLabels,
      radiusMinutes,
      buckets: [],
      peak: null,
      quietest: null,
    };
  }

  let nearbyResidents = 0;
  for (const building of occupancy("type")) {
    if (building.residents <= 0) continue;
    const walkMinutes = walkMinutesFrom(building.label);
    if (walkMinutes !== null && walkMinutes <= radiusMinutes) nearbyResidents += building.residents;
  }
  const baselinePerActiveBucket = (nearbyResidents * RESIDENTIAL_PARTICIPATION) / fromClasses.size;

  const activeMinutes = [...fromClasses.keys()].sort((a, b) => a - b);
  const first = activeMinutes[0]!;
  const last = activeMinutes.at(-1)!;

  const buckets: ArrivalBucket[] = [];
  for (let minute = first; minute <= last; minute += BUCKET_MINUTES) {
    const classes = fromClasses.get(minute) ?? 0;
    const baseline = Math.round(baselinePerActiveBucket * 10) / 10;
    buckets.push({ minute, fromClasses: classes, baseline, total: Math.round(classes + baseline) });
  }

  const peak = buckets.reduce((best, b) => (b.total > (best?.total ?? -1) ? b : best), buckets[0]!);
  const quietest = buckets.reduce(
    (worst, b) => (b.total < (worst?.total ?? Infinity) ? b : worst),
    buckets[0]!,
  );

  return {
    day,
    diningBuildings: diningLabels,
    radiusMinutes,
    buckets,
    peak: { minute: peak.minute, total: peak.total },
    quietest: { minute: quietest.minute, total: quietest.total },
  };
}
