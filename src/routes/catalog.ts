/** The course catalog: what exists, what is offered, and what it requires. */

import { bool, json, notFound, num, q, required } from "../lib/http";
import {
  ALL_COURSES,
  courseByCode,
  readRule,
  searchCourses,
  searchSections,
  termStats,
} from "../store/catalog";
import { listPrograms, latestYear, programByPage, programYears } from "../store/programs";
import type { RouteDef } from "./types";

const parsed = (payload: string) => JSON.parse(payload);

export const catalogRoutes: RouteDef[] = [
  {
    method: "GET",
    path: "/v1/terms",
    tag: "catalog",
    summary: "Terms held locally, with how much of each",
    handler: () => json({ terms: termStats() }),
  },
  {
    method: "GET",
    path: "/v1/sections",
    tag: "catalog",
    summary: "Sections offered in a term",
    query: [
      { name: "term", description: "Term code, e.g. 2026FA", required: true },
      { name: "code", description: "Course code, e.g. CS-1210" },
      { name: "subject", description: "Subject code, e.g. CS" },
      { name: "open", description: "Only sections with seats left" },
      { name: "q", description: "Match title, instructor or section name" },
      { name: "limit", description: "1-500, default 50" },
      { name: "offset", description: "Rows to skip" },
    ],
    handler: (_request, url) => {
      const rows = searchSections({
        term: required(url, "term"),
        code: q(url, "code"),
        subject: q(url, "subject"),
        open: bool(url, "open"),
        q: q(url, "q"),
        limit: num(url, "limit"),
        offset: num(url, "offset"),
      });
      return json({
        sections: rows.map(({ payload, ...row }) => ({ ...row, section: parsed(payload) })),
      });
    },
  },
  {
    method: "GET",
    path: "/v1/courses",
    tag: "catalog",
    summary: "Courses, defaulting to the whole catalog rather than one term",
    query: [
      { name: "term", description: `Term code, or "${ALL_COURSES}" for everything` },
      { name: "subject", description: "Subject code" },
      { name: "q", description: "Match title or code" },
      { name: "limit", description: "1-500, default 50" },
      { name: "offset", description: "Rows to skip" },
    ],
    handler: (_request, url) => {
      const rows = searchCourses({
        term: q(url, "term"),
        subject: q(url, "subject"),
        q: q(url, "q"),
        limit: num(url, "limit"),
        offset: num(url, "offset"),
      });
      return json({
        courses: rows.map(({ payload, ...row }) => ({ ...row, course: parsed(payload) })),
      });
    },
  },
  {
    method: "GET",
    path: "/v1/courses/:code",
    tag: "catalog",
    summary: "One course by code, falling back to the full catalog when a term is given",
    query: [{ name: "term", description: "Prefer this term's record" }],
    handler: (request, url) => {
      const row = courseByCode(request.params.code ?? "", q(url, "term"));
      if (!row) throw notFound("no such course");
      const { payload, ...rest } = row;
      return json({ ...rest, course: parsed(payload) });
    },
  },
  {
    method: "GET",
    path: "/v1/rules/:requirement/:subrequirement/:group",
    tag: "catalog",
    summary: "Courses that satisfy one requirement group, as Colleague resolved it",
    handler: (request) => {
      const courses = readRule({
        requirement: request.params.requirement ?? "",
        subrequirement: request.params.subrequirement ?? "",
        group: request.params.group ?? "",
      });
      if (!courses) throw notFound("that group has not been resolved yet");
      return json({ courses });
    },
  },
  {
    method: "GET",
    path: "/v1/programs",
    tag: "catalog",
    summary: "Degree programs from the printed catalog",
    query: [
      { name: "year", description: "Catalog year, e.g. 2026-2027. Defaults to the newest held." },
      { name: "q", description: "Match the program title" },
    ],
    handler: (_request, url) => {
      const year = q(url, "year") ?? latestYear();
      if (!year) throw notFound("no catalog collected yet");
      return json({ year, years: programYears(), programs: listPrograms(year, q(url, "q")) });
    },
  },
  {
    method: "GET",
    path: "/v1/programs/:page",
    tag: "catalog",
    summary: "One program by its page in the book",
    query: [{ name: "year", description: "Catalog year. Defaults to the newest held." }],
    handler: (request, url) => {
      const year = q(url, "year") ?? latestYear();
      if (!year) throw notFound("no catalog collected yet");
      const program = programByPage(year, Number(request.params.page));
      if (!program) throw notFound("no program on that page");
      return json(program);
    },
  },
];
