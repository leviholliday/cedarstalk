/** Who's close enough to home to share a ride over break. */

import { badRequest, json, notFound, num } from "../lib/http";
import { carpoolClusters, carpoolFor } from "../model/carpool";
import { peopleByIds } from "../store/people";
import type { RouteDef } from "./types";

export const carpoolRoutes: RouteDef[] = [
  {
    method: "GET",
    path: "/v1/carpool/clusters",
    tag: "carpool",
    summary: "Hometowns grouped by straight-line distance -- who could ride together over break",
    query: [{ name: "radius", description: "Miles. Default 40." }],
    handler: (_request, url) => {
      const radius = num(url, "radius") ?? 40;
      if (radius <= 0) throw badRequest("radius must be positive");
      return json(carpoolClusters(radius));
    },
  },
  {
    method: "GET",
    path: "/v1/people/:id/carpool",
    tag: "carpool",
    summary: "Everyone else within radius miles of this person's own hometown",
    query: [{ name: "radius", description: "Miles. Default 40." }],
    handler: (request, url) => {
      const id = request.params.id ?? "";
      const radius = num(url, "radius") ?? 40;
      if (radius <= 0) throw badRequest("radius must be positive");

      const result = carpoolFor(id, radius);
      if (!result) throw notFound("no such person");

      const people = peopleByIds(result.matches.map((m) => m.id));
      const byId = new Map(people.map((p) => [p.id, p]));

      return json({
        ...result,
        matches: result.matches.map((match) => ({
          ...match,
          name: `${byId.get(match.id)?.nickname ?? byId.get(match.id)?.firstName ?? ""} ${byId.get(match.id)?.lastName ?? ""}`.trim(),
        })),
      });
    },
  },
];
