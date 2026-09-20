/**
 * Empty rooms, which of them are actually quiet, how hard each one works, and
 * a building's own personality card.
 *
 * All of these read the same materialized grid (`model/occupancy.ts`), so
 * none of them parses a section payload at request time.
 */

import { badRequest, json, notFound, num, q } from "../lib/http";
import { adjacencyOf, shortestPath } from "../lib/route";
import { currentTerm } from "../lib/terms";
import { buildingProfile } from "../model/buildings";
import { roomUtilization } from "../model/occupancy";
import { buildingRhythm, type QuietRoom, quietRoomsAt } from "../model/quiet";
import { buildingByLabel, campusMap } from "../store/campus";
import { anchorOf } from "./campus";
import type { RouteDef } from "./types";

/** "now", an ISO datetime, or nothing -- always resolved in the server's own local time. */
function parseAt(raw: string | undefined): { day: number; minute: number; at: string } {
  const date = raw && raw.toLowerCase() !== "now" ? new Date(raw) : new Date();
  if (Number.isNaN(date.getTime())) throw badRequest('"at" must be an ISO datetime or "now"');
  return {
    day: date.getDay(),
    minute: date.getHours() * 60 + date.getMinutes(),
    at: date.toISOString(),
  };
}

interface WithDistance {
  metres: number | null;
  minutes: number | null;
}

type RoomWithDistance = QuietRoom & Partial<WithDistance>;

/** Walking distance from one anchor to a set of campus-placed rooms, one Dijkstra run per distinct building. */
function distancesFrom(
  near: string,
  rooms: { campusLabel: string | null }[],
): Map<string, WithDistance> {
  const map = campusMap();
  const out = new Map<string, WithDistance>();
  if (!map) return out;

  const anchor = anchorOf(near);
  const adjacency = adjacencyOf(map);
  const seen = new Map<string, WithDistance>();

  for (const room of rooms) {
    if (!room.campusLabel || seen.has(room.campusLabel)) continue;
    const building = buildingByLabel(room.campusLabel);
    if (building?.node === null || building?.node === undefined) continue;
    const path = shortestPath(map, anchor.node, building.node, adjacency);
    seen.set(
      room.campusLabel,
      path
        ? { metres: path.metres, minutes: Math.round((path.metres / 1.35 / 60) * 10) / 10 }
        : { metres: null, minutes: null },
    );
  }
  for (const room of rooms) {
    if (room.campusLabel && seen.has(room.campusLabel))
      out.set(room.campusLabel, seen.get(room.campusLabel)!);
  }
  return out;
}

const SORTS = ["quiet", "near", "longest"] as const;
type Sort = (typeof SORTS)[number];

export const roomRoutes: RouteDef[] = [
  {
    method: "GET",
    path: "/v1/rooms/free",
    tag: "rooms",
    summary: "Rooms with nothing meeting in them right now, and how long that lasts",
    query: [
      { name: "term", description: "Term code. Defaults to the current one." },
      { name: "at", description: 'ISO datetime, or "now" (default)' },
      {
        name: "near",
        description: "Building label or person id -- adds walking distance and enables sort=near",
      },
      {
        name: "minMinutes",
        description: "Only rooms free for at least this many minutes. Default 0.",
      },
      { name: "sort", description: "quiet | near | longest (default)" },
    ],
    handler: (_request, url) => {
      const term = q(url, "term") ?? currentTerm();
      const { day, minute, at } = parseAt(q(url, "at"));
      const minMinutes = num(url, "minMinutes") ?? 0;
      const near = q(url, "near");
      const sort = (q(url, "sort") ?? "longest") as Sort;
      if (!SORTS.includes(sort)) throw badRequest(`sort must be one of ${SORTS.join(", ")}`);
      if (sort === "near" && !near) throw badRequest("sort=near needs a near= building or person");

      // quietRoomsAt is a superset of roomsFreeAt -- same rows, plus a score
      // this route doesn't have to compute a second time if the caller wants it.
      const rooms: QuietRoom[] = quietRoomsAt(term, day, minute, { minMinutes });
      const distances = near ? distancesFrom(near, rooms) : new Map<string, WithDistance>();

      const withDistance: RoomWithDistance[] = rooms.map((room) => ({
        ...room,
        ...(near ? (distances.get(room.campusLabel ?? "") ?? { metres: null, minutes: null }) : {}),
      }));

      const sorted =
        sort === "quiet"
          ? withDistance // already ascending quiet
          : sort === "near"
            ? [...withDistance].sort((a, b) => (a.metres ?? Infinity) - (b.metres ?? Infinity))
            : [...withDistance].sort((a, b) => b.freeMinutes - a.freeMinutes);

      return json({ term, at, day, minute, rooms: sorted });
    },
  },
  {
    method: "GET",
    path: "/v1/rooms/quiet",
    tag: "rooms",
    summary:
      "Free rooms ranked quietest first -- a proxy from scheduled class load, not a headcount",
    query: [
      { name: "term", description: "Term code. Defaults to the current one." },
      { name: "at", description: 'ISO datetime, or "now" (default)' },
      { name: "near", description: "Building label or person id -- adds walking distance" },
      {
        name: "horizon",
        description: "Only rooms free for at least this many minutes. Default 60.",
      },
    ],
    handler: (_request, url) => {
      const term = q(url, "term") ?? currentTerm();
      const { day, minute, at } = parseAt(q(url, "at"));
      const horizon = num(url, "horizon") ?? 60;
      const near = q(url, "near");

      const rooms = quietRoomsAt(term, day, minute, { minMinutes: horizon, onCampusOnly: true });
      const cutoff = rooms.length
        ? rooms[Math.max(0, Math.floor(rooms.length * 0.35) - 1)]!.quiet
        : 0;
      const distances = near ? distancesFrom(near, rooms) : new Map<string, WithDistance>();

      return json({
        term,
        at,
        day,
        minute,
        rooms: rooms.map((room) => ({
          ...room,
          gem: room.quiet <= cutoff,
          ...(near
            ? (distances.get(room.campusLabel ?? "") ?? { metres: null, minutes: null })
            : {}),
        })),
      });
    },
  },
  {
    method: "GET",
    path: "/v1/buildings/:name/rhythm",
    tag: "rooms",
    summary: "One building's scheduled headcount across a day, in 30-minute buckets",
    query: [
      { name: "term", description: "Term code. Defaults to the current one." },
      { name: "day", description: "0 (Sunday) - 6. Defaults to today." },
    ],
    handler: (request, url) => {
      const term = q(url, "term") ?? currentTerm();
      const day = num(url, "day") ?? new Date().getDay();
      if (day < 0 || day > 6) throw badRequest("day must be 0-6");
      const building = decodeURIComponent(request.params.name ?? "");
      return json({ term, building, day, points: buildingRhythm(term, building, day) });
    },
  },
  {
    method: "GET",
    path: "/v1/rooms/utilization",
    tag: "rooms",
    summary: "Booked vs. idle hours per room, against the term's own class-day window",
    query: [{ name: "term", description: "Term code. Defaults to the current one." }],
    handler: (_request, url) => {
      const term = q(url, "term") ?? currentTerm();
      return json({ term, rooms: roomUtilization(term) });
    },
  },
  {
    method: "GET",
    path: "/v1/buildings/:name/profile",
    tag: "rooms",
    summary: "One building's personality: peak hour, dominant subject, utilization, weekly rhythm",
    query: [{ name: "term", description: "Term code. Defaults to the current one." }],
    handler: (request, url) => {
      const term = q(url, "term") ?? currentTerm();
      const building = decodeURIComponent(request.params.name ?? "");
      const profile = buildingProfile(term, building);
      if (!profile) throw notFound("no classes scheduled in that building this term");
      return json({ term, ...profile });
    },
  },
];
