/** The record of what changed, and of every run that looked. */

import { json, num, q } from "../lib/http";
import { harvestTerms } from "../store/harvest";
import { personEvents, populationOverTime, recentSweeps, termChurn } from "../store/history";
import type { RouteDef } from "./types";

export const historyRoutes: RouteDef[] = [
  {
    method: "GET",
    path: "/v1/history/events",
    tag: "history",
    summary: "Directory changes, newest first",
    query: [
      { name: "kind", description: "appeared, changed, vanished or returned" },
      { name: "field", description: "Only changes to this field, e.g. dorm_name" },
      { name: "since", description: "ISO timestamp" },
      { name: "limit", description: "1-1000, default 100" },
    ],
    handler: (_request, url) =>
      json({
        events: personEvents({
          kind: q(url, "kind"),
          field: q(url, "field"),
          since: q(url, "since"),
          limit: num(url, "limit"),
        }),
      }),
  },
  {
    method: "GET",
    path: "/v1/history/population",
    tag: "history",
    summary: "Arrivals and departures by month",
    handler: () => json({ months: populationOverTime() }),
  },
  {
    method: "GET",
    path: "/v1/history/sweeps",
    tag: "history",
    summary: "Every collection run, whoever ran it",
    query: [{ name: "limit", description: "Default 20" }],
    handler: (_request, url) => json({ sweeps: recentSweeps(num(url, "limit") ?? 20) }),
  },
  {
    method: "GET",
    path: "/v1/history/churn",
    tag: "history",
    summary: "Booklist churn per term: courses added and dropped after the first look",
    handler: () =>
      json({
        terms: harvestTerms().map((term) => {
          const churn = termChurn(term.term);
          return {
            ...term,
            // `students` means two things here — how many booklists we hold, and
            // how many of them moved — so the churning ones get their own name.
            changed: churn.students,
            coursesAdded: churn.added,
            coursesDropped: churn.removed,
            revisions: churn.changes,
          };
        }),
      }),
  },
];
