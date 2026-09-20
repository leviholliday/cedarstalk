/**
 * The map, and the questions it answers about a population rather than a
 * person: who lives where, and how far apart any two people are on foot.
 */

import { CLASS_LABELS, TYPE_LABELS } from "../lib/classes";
import { badRequest, json, notFound, num, q } from "../lib/http";
import { adjacencyOf, shortestPath } from "../lib/route";
import { currentTerm } from "../lib/terms";
import { diningForecast } from "../model/dining";
import { buildingCurve } from "../model/occupancy";
import { campusTraffic, campusTrafficAt, campusTrafficDay } from "../model/traffic";
import { buildingByLabel, buildings, campusMap, locate, occupancy } from "../store/campus";
import type { RouteDef } from "./types";

const requireMap = () => {
  const map = campusMap();
  if (!map) throw notFound("no campus collected yet — run `engine collect campus`");
  return map;
};

/** Anything that names a place: a building label, or a person's id. */
export function anchorOf(token: string): { node: number; label: string } {
  const building = buildingByLabel(token);
  if (building?.node !== null && building?.node !== undefined) {
    return { node: building.node, label: building.label };
  }
  const person = locate(token);
  if (person) return { node: person.node, label: person.label };
  throw badRequest(`"${token}" is neither a mapped building nor a person with one`);
}

export const campusRoutes: RouteDef[] = [
  {
    method: "GET",
    path: "/v1/campus/map",
    tag: "campus",
    summary: "Outlines and the walking graph, in metres from the map origin",
    query: [{ name: "graph", description: "Include nodes and edges. Off by default." }],
    handler: (_request, url) => {
      const map = requireMap();
      const withGraph = ["1", "true", "yes"].includes((q(url, "graph") ?? "").toLowerCase());
      const { nodes, edges, ...rest } = map;
      return json(withGraph ? map : { ...rest, nodes: nodes.length, edges: edges.length });
    },
  },
  {
    method: "GET",
    path: "/v1/campus/buildings",
    tag: "campus",
    summary: "Every building the engine has coordinates for",
    query: [{ name: "kind", description: "dorm, office or both" }],
    handler: (_request, url) =>
      json({
        buildings: buildings(q(url, "kind")).map(({ ring, ...rest }) => ({
          ...rest,
          ring: JSON.parse(ring) as [number, number][],
        })),
        unmapped: requireMap().missing,
      }),
  },
  {
    method: "GET",
    path: "/v1/campus/occupancy",
    tag: "campus",
    summary: "The whole population placed on the map, bucketed",
    query: [{ name: "by", description: "class (default), type or department" }],
    handler: (_request, url) => {
      const by = (q(url, "by") ?? "class") as "class" | "type" | "department";
      if (!["class", "type", "department"].includes(by)) {
        throw badRequest("by must be class, type or department");
      }
      return json({ by, buildings: occupancy(by) });
    },
  },
  {
    method: "GET",
    path: "/v1/campus/traffic",
    tag: "campus",
    summary:
      "How many people walk each footpath. A whole term averaged together by default, or one instant with day + at",
    query: [
      { name: "term", description: "Term code. Defaults to the current one." },
      {
        name: "day",
        description: "0 (Sunday) - 6. With `at`, switches to one moment instead of the whole term.",
      },
      { name: "at", description: '"HH:MM". Needs `day` alongside it.' },
    ],
    handler: (_request, url) => {
      requireMap();
      const term = q(url, "term") ?? currentTerm();
      const day = q(url, "day");
      const at = q(url, "at");

      if (day === undefined && at === undefined) return json(campusTraffic(term));
      if (day === undefined || at === undefined) {
        throw badRequest("day and at must be given together");
      }
      const dayNum = Number(day);
      if (!Number.isInteger(dayNum) || dayNum < 0 || dayNum > 6)
        throw badRequest("day must be 0-6");
      const match = /^(\d{1,2}):(\d{2})$/.exec(at);
      if (!match) throw badRequest('at must be "HH:MM"');
      const minute = Number(match[1]) * 60 + Number(match[2]);

      return json(campusTrafficAt(term, dayNum, minute));
    },
  },
  {
    method: "GET",
    path: "/v1/campus/traffic/day",
    tag: "campus",
    summary:
      "A whole weekday of chokepoints, frame by frame -- one request, for scrubbing and time-lapse",
    query: [
      { name: "term", description: "Term code. Defaults to the current one." },
      { name: "day", description: "0 (Sunday) - 6. Defaults to today." },
      { name: "bucket", description: "Frame width in minutes. Default 10." },
    ],
    handler: (_request, url) => {
      requireMap();
      const term = q(url, "term") ?? currentTerm();
      const day = num(url, "day") ?? new Date().getDay();
      if (day < 0 || day > 6) throw badRequest("day must be 0-6");
      const bucket = num(url, "bucket") ?? 10;
      if (bucket < 1 || bucket > 120) throw badRequest("bucket must be 1-120 minutes");
      return json(campusTrafficDay(term, day, bucket));
    },
  },
  {
    method: "GET",
    path: "/v1/campus/occupancy/curve",
    tag: "campus",
    summary:
      "Scheduled headcount per building across a whole day, bucketed -- the other half of a time-lapse",
    query: [
      { name: "term", description: "Term code. Defaults to the current one." },
      { name: "day", description: "0 (Sunday) - 6. Defaults to today." },
      { name: "bucket", description: "Bucket width in minutes. Default 10." },
    ],
    handler: (_request, url) => {
      const term = q(url, "term") ?? currentTerm();
      const day = num(url, "day") ?? new Date().getDay();
      if (day < 0 || day > 6) throw badRequest("day must be 0-6");
      const bucket = num(url, "bucket") ?? 10;
      if (bucket < 1 || bucket > 120) throw badRequest("bucket must be 1-120 minutes");
      return json({ term, day, bucketMinutes: bucket, points: buildingCurve(term, day, bucket) });
    },
  },
  {
    method: "GET",
    path: "/v1/glossary",
    tag: "campus",
    summary: "What the directory's class and population codes mean",
    handler: () => json({ classes: CLASS_LABELS, types: TYPE_LABELS }),
  },
  {
    method: "GET",
    path: "/v1/campus/route",
    tag: "campus",
    summary: "Walking route between two buildings, or two people",
    query: [
      { name: "from", description: "Building label or person id", required: true },
      { name: "to", description: "Building label or person id", required: true },
      { name: "path", description: "Include the node path" },
    ],
    handler: (_request, url) => {
      const map = requireMap();
      const from = anchorOf(q(url, "from") ?? "");
      const to = anchorOf(q(url, "to") ?? "");
      const path = shortestPath(map, from.node, to.node, adjacencyOf(map));
      if (!path) throw notFound("no walkable route between those");

      const wantPath = ["1", "true", "yes"].includes((q(url, "path") ?? "").toLowerCase());
      return json({
        from: from.label,
        to: to.label,
        metres: path.metres,
        cost: path.cost,
        minutes: Math.round((path.metres / 1.35 / 60) * 10) / 10, // 1.35 m/s, a walk
        ...(wantPath ? { nodes: path.nodes, points: path.nodes.map((n) => map.nodes[n]) } : {}),
      });
    },
  },
  {
    method: "GET",
    path: "/v1/dining/forecast",
    tag: "campus",
    summary:
      "Predicted dining arrivals from class end times and walk distance -- a forecast, not a headcount",
    query: [
      { name: "term", description: "Term code. Defaults to the current one." },
      { name: "day", description: "0 (Sunday) - 6. Defaults to today." },
      { name: "radius", description: 'Max walk minutes counted as "near dining." Default 15.' },
      {
        name: "buildings",
        description: "Comma-separated building labels, overriding dining.tsv for this call",
      },
    ],
    handler: (_request, url) => {
      const term = q(url, "term") ?? currentTerm();
      const day = num(url, "day") ?? new Date().getDay();
      if (day < 0 || day > 6) throw badRequest("day must be 0-6");
      const radiusMinutes = num(url, "radius") ?? 15;
      const buildingsParam = q(url, "buildings");
      const forecast = diningForecast(term, day, {
        radiusMinutes,
        buildings: buildingsParam ? buildingsParam.split(",").map((b) => b.trim()) : undefined,
      });
      if (!forecast) {
        throw notFound(
          "no dining buildings configured -- add them to collect/assets/dining.tsv, or pass buildings=",
        );
      }
      return json(forecast);
    },
  },
];
