/** What the engine holds, and how it is being used. */

import { analytics } from "../lib/analytics";
import { json, num } from "../lib/http";
import { buildings } from "../store/campus";
import { termStats } from "../store/catalog";
import { harvestTerms, metricHistory } from "../store/harvest";
import { populationOverTime, recentSweeps } from "../store/history";
import { peopleStats } from "../store/people";
import { latestYear, programYears } from "../store/programs";
import type { RouteDef } from "./types";

/** One call, because the dashboard wants all of it and a dozen round trips is silly. */
const engineStats = () => ({
  people: peopleStats(),
  catalog: { terms: termStats(), year: latestYear(), programs: programYears() },
  booklists: harvestTerms(),
  campus: { buildings: buildings().length },
  metrics: metricHistory(),
  sweeps: recentSweeps(10),
  population: populationOverTime(),
});

export const statsRoutes: RouteDef[] = [
  {
    method: "GET",
    path: "/v1/stats",
    tag: "engine",
    summary: "Everything the engine holds, counted",
    handler: () => json(engineStats()),
  },
  {
    method: "GET",
    path: "/v1/analytics",
    tag: "engine",
    summary: "Request volume and latency",
    query: [{ name: "hours", description: "Window, default 24" }],
    handler: (_request, url) => json(analytics(num(url, "hours") ?? 24)),
  },
];
