/**
 * Who lives near whom, back home.
 *
 * Every directory row already carries a hometown city and state, and nothing
 * else in this engine reads them. Geocoded offline (see `store/geocode.ts`)
 * and clustered by straight-line distance, that field alone answers "who's
 * within 40 miles of me over break" for the whole population at once.
 */

import { db } from "../db";
import { geocode } from "../store/geocode";

const EARTH_RADIUS_MILES = 3958.8;

interface Point {
  lat: number;
  lon: number;
}

export function haversineMiles(a: Point, b: Point): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(s));
}

interface CityGroup {
  city: string;
  state: string;
  lat: number;
  lon: number;
  studentIds: string[];
}

interface Geocoded {
  groups: CityGroup[];
  /** Distinct (city, state) pairs the Gazetteer had no match for. */
  unresolvedPlaces: number;
  /** People whose city didn't resolve, and so are absent from every cluster. */
  unresolvedPeople: number;
}

/** Every present person with a hometown, collapsed to distinct geocoded cities -- clustering 2,600 cities, not 10,000 people. */
function geocodedPopulation(): Geocoded {
  const rows = db()
    .query<{ id: string; city: string; state: string }, []>(
      "SELECT id, city, state FROM people WHERE present = 1 AND city IS NOT NULL AND state IS NOT NULL",
    )
    .all();

  const byKey = new Map<string, CityGroup>();
  const unresolvedKeys = new Set<string>();
  let unresolvedPeople = 0;

  for (const row of rows) {
    const loc = geocode(row.city, row.state);
    if (!loc) {
      unresolvedKeys.add(`${row.state}|${row.city}`);
      unresolvedPeople++;
      continue;
    }
    const key = `${loc.state}|${loc.city}`;
    const group = byKey.get(key) ?? {
      city: loc.city,
      state: loc.state,
      lat: loc.lat,
      lon: loc.lon,
      studentIds: [],
    };
    group.studentIds.push(row.id);
    byKey.set(key, group);
  }

  return {
    groups: [...byKey.values()],
    unresolvedPlaces: unresolvedKeys.size,
    unresolvedPeople,
  };
}

export interface CarpoolCluster {
  id: number;
  people: number;
  cities: { city: string; state: string; people: number }[];
  centroid: Point;
}

export interface CarpoolClusters {
  radiusMiles: number;
  clusters: CarpoolCluster[];
  unresolvedPlaces: number;
  unresolvedPeople: number;
}

/**
 * Cities within `radiusMiles` of at least one other city in the same group,
 * chained transitively (city A near B near C clusters all three, even if A
 * and C themselves are far apart) -- union-find over a few thousand points,
 * not tens of millions of person-to-person comparisons.
 */
export function carpoolClusters(radiusMiles = 40): CarpoolClusters {
  const { groups, unresolvedPlaces, unresolvedPeople } = geocodedPopulation();

  const parent = groups.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (haversineMiles(groups[i]!, groups[j]!) <= radiusMiles) union(i, j);
    }
  }

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < groups.length; i++) {
    const root = find(i);
    const indices = byRoot.get(root) ?? [];
    indices.push(i);
    byRoot.set(root, indices);
  }

  const clusters: CarpoolCluster[] = [];
  let id = 0;
  for (const indices of byRoot.values()) {
    const members = indices.map((i) => groups[i]!);
    const people = members.reduce((sum, g) => sum + g.studentIds.length, 0);
    // A "cluster" of one person in one city is nobody to carpool with.
    if (people < 2) continue;
    clusters.push({
      id: id++,
      people,
      cities: members
        .map((g) => ({ city: g.city, state: g.state, people: g.studentIds.length }))
        .sort((a, b) => b.people - a.people),
      centroid: {
        lat: members.reduce((sum, g) => sum + g.lat, 0) / members.length,
        lon: members.reduce((sum, g) => sum + g.lon, 0) / members.length,
      },
    });
  }

  return {
    radiusMiles,
    clusters: clusters.sort((a, b) => b.people - a.people),
    unresolvedPlaces,
    unresolvedPeople,
  };
}

export interface CarpoolMatch {
  id: string;
  city: string;
  state: string;
  distanceMiles: number;
}

export interface CarpoolResult {
  home: { city: string; state: string } | null;
  geocoded: boolean;
  radiusMiles: number;
  matches: CarpoolMatch[];
}

/** One person's own radius search, rather than a transitively-chained cluster they might barely belong to. */
export function carpoolFor(studentId: string, radiusMiles = 40): CarpoolResult | null {
  const person = db()
    .query<{ city: string | null; state: string | null }, [string]>(
      "SELECT city, state FROM people WHERE id = ?",
    )
    .get(studentId);
  if (!person) return null;

  if (!person.city || !person.state) {
    return { home: null, geocoded: false, radiusMiles, matches: [] };
  }
  const home = geocode(person.city, person.state);
  if (!home) {
    return {
      home: { city: person.city, state: person.state },
      geocoded: false,
      radiusMiles,
      matches: [],
    };
  }

  const rows = db()
    .query<{ id: string; city: string; state: string }, [string]>(
      "SELECT id, city, state FROM people WHERE present = 1 AND id != ? AND city IS NOT NULL AND state IS NOT NULL",
    )
    .all(studentId);

  const matches: CarpoolMatch[] = [];
  for (const row of rows) {
    const loc = geocode(row.city, row.state);
    if (!loc) continue;
    const distanceMiles = Math.round(haversineMiles(home, loc) * 10) / 10;
    if (distanceMiles <= radiusMiles) {
      matches.push({ id: row.id, city: loc.city, state: loc.state, distanceMiles });
    }
  }

  return {
    home: { city: home.city, state: home.state },
    geocoded: true,
    radiusMiles,
    matches: matches.sort((a, b) => a.distanceMiles - b.distanceMiles),
  };
}
