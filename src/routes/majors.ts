/** The major model: guesses, and how well it is doing. */

import { json, num, q } from "../lib/http";
import { evaluate } from "../model/evaluate";
import { distribution, guessAll } from "../model/guess";
import { model } from "../model/major";
import { harvestTerms, metricHistory } from "../store/harvest";
import { termChurn } from "../store/history";
import { allMajors, schools } from "../store/majors";
import type { RouteDef } from "./types";

export const majorRoutes: RouteDef[] = [
  {
    method: "GET",
    path: "/v1/majors/guesses",
    tag: "majors",
    summary: "Every student with booklist data, ranked against every program",
    query: [
      { name: "top", description: "Guesses per student, default 3" },
      { name: "year", description: "Catalog year to score against" },
      { name: "min", description: "Only students with at least this much signal" },
      { name: "limit", description: "Students to return, default 200" },
    ],
    handler: (_request, url) => {
      const minimum = num(url, "min") ?? 0;
      const limit = Math.min(num(url, "limit") ?? 200, 5000);
      const guesses = guessAll(num(url, "top") ?? 3, q(url, "year"))
        .filter((g) => g.signal >= minimum)
        .slice(0, limit);
      return json({ terms: harvestTerms(), students: guesses.length, guesses });
    },
  },
  {
    method: "GET",
    path: "/v1/majors/distribution",
    tag: "majors",
    summary: "What the population appears to be studying, counted by top guess",
    query: [
      { name: "min", description: "Distinctive courses required to count, default 2" },
      { name: "year", description: "Catalog year" },
    ],
    handler: (_request, url) => json(distribution(num(url, "min") ?? 2, q(url, "year"))),
  },
  {
    method: "GET",
    path: "/v1/majors/model",
    tag: "majors",
    summary: "What the model is built from",
    query: [{ name: "year", description: "Catalog year" }],
    handler: (_request, url) => {
      const engine = model(q(url, "year"));
      return json({
        year: engine.year,
        programs: engine.programCount,
        terms: harvestTerms(),
        metrics: metricHistory(),
      });
    },
  },
  {
    method: "GET",
    path: "/v1/majors/schools",
    tag: "majors",
    summary: "The registrar's taxonomy: every program, its department and its school",
    query: [{ name: "level", description: "major, minor, or leave off for all" }],
    handler: (_request, url) => json({ schools: schools(), programs: allMajors(q(url, "level")) }),
  },
  {
    method: "POST",
    path: "/v1/majors/evaluate",
    tag: "majors",
    summary: "Score the model against known majors and log the result",
    query: [
      { name: "source", description: "Only labels from this file" },
      { name: "year", description: "Catalog year" },
    ],
    handler: (_request, url) => json(evaluate({ source: q(url, "source"), year: q(url, "year") })),
  },
  {
    method: "GET",
    path: "/v1/majors/churn",
    tag: "majors",
    summary: "Courses added and dropped across a term, from booklist deltas",
    query: [{ name: "term", description: "Term code", required: true }],
    handler: (_request, url) => {
      const term = q(url, "term") ?? harvestTerms().at(-1)?.term ?? "";
      return json({ term, ...termChurn(term) });
    },
  },
];
