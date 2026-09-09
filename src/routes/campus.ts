/**
 * The map, and the questions it answers about a population rather than a
 * person: who lives where, and how far apart any two people are on foot.
 */

import { badRequest, json, notFound, q } from "../lib/http";
import { adjacencyOf, shortestPath } from "../lib/route";
import { buildingByLabel, buildings, campusMap, locate, occupancy } from "../store/campus";
import type { RouteDef } from "./types";

const requireMap = () => {
  const map = campusMap();
  if (!map) throw notFound("no campus collected yet — run `engine collect campus`");
  return map;
};

/** Anything that names a place: a building label, or a person's id. */
function anchorOf(token: string): { node: number; label: string } {
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
];
