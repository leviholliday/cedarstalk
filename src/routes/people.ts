/** Who is here, where they live, what they are probably studying. */

import { badRequest, bool, json, notFound, num, q, required } from "../lib/http";
import { currentTerm } from "../lib/terms";
import { degreeAudit } from "../model/audit";
import { geographyLeaderboard, scheduleGeography } from "../model/geography";
import { guessFor } from "../model/guess";
import { locationNow, scheduleFor } from "../model/schedule";
import { twinSchedulesFor } from "../model/twins";
import { locate } from "../store/campus";
import { booklistTimeline, personTimeline } from "../store/history";
import { dormRooms, peopleStats, personById, roommatesOf, searchPeople } from "../store/people";
import { latestYear, listPrograms } from "../store/programs";
import type { RouteDef } from "./types";

export const peopleRoutes: RouteDef[] = [
  {
    method: "GET",
    path: "/v1/people",
    tag: "people",
    summary: "Search the directory by name, dorm, department or population",
    query: [
      { name: "q", description: "Name. Two words are read as first then last." },
      { name: "dorm", description: "Dorm name, exact" },
      { name: "department", description: "Department description, exact" },
      { name: "type", description: "Student type: UG, UGO, GS, P4" },
      { name: "class", description: "Class: FR, SO, JR, SR" },
      { name: "gone", description: "Include people the directory has stopped listing" },
      { name: "limit", description: "1-500, default 25" },
      { name: "offset", description: "Rows to skip" },
    ],
    handler: (_request, url) =>
      json({
        people: searchPeople({
          q: q(url, "q"),
          dorm: q(url, "dorm"),
          department: q(url, "department"),
          type: q(url, "type"),
          class: q(url, "class"),
          includeGone: bool(url, "gone"),
          limit: num(url, "limit"),
          offset: num(url, "offset"),
        }),
      }),
  },
  {
    method: "GET",
    path: "/v1/people/:id",
    tag: "people",
    summary: "One person by directory id",
    handler: (request) => {
      const person = personById(request.params.id ?? "");
      if (!person) throw notFound("no such person");
      return json(person);
    },
  },
  {
    method: "GET",
    path: "/v1/people/:id/major",
    tag: "people",
    summary: "Best guesses at a student's major, from their booklists",
    query: [
      { name: "top", description: "How many guesses, default 3" },
      { name: "year", description: "Catalog year to score against" },
    ],
    handler: (request, url) => {
      const guess = guessFor(request.params.id ?? "", num(url, "top") ?? 3, q(url, "year"));
      if (!guess) throw notFound("no booklist data for that person");
      return json(guess);
    },
  },
  {
    method: "GET",
    path: "/v1/people/:id/schedule",
    tag: "people",
    summary: "A student's week: the sections their booklist names, with times and rooms",
    query: [
      {
        name: "term",
        description: "Term code. Defaults to the current one, then the newest held.",
      },
    ],
    handler: (request, url) => {
      const schedule = scheduleFor(request.params.id ?? "", q(url, "term"));
      if (!schedule) throw notFound("no booklist data for that person");
      return json(schedule);
    },
  },
  {
    method: "GET",
    path: "/v1/people/:id/history",
    tag: "people",
    summary: "Everything that has changed about a person since we first saw them",
    query: [{ name: "limit", description: "Events to return, default 200" }],
    handler: (request, url) => {
      const id = request.params.id ?? "";
      if (!personById(id)) throw notFound("no such person");
      return json({
        directory: personTimeline(id, num(url, "limit")),
        booklists: booklistTimeline(id),
      });
    },
  },
  {
    method: "GET",
    path: "/v1/people/:id/location",
    tag: "people",
    summary: "The building a person is listed against, with coordinates",
    handler: (request) => {
      const where = locate(request.params.id ?? "");
      if (!where) throw notFound("no mapped building for that person");
      return json(where);
    },
  },
  {
    method: "GET",
    path: "/v1/people/:id/location/now",
    tag: "people",
    summary:
      "In class right now, or their dorm/office as the fallback -- as current as the last harvest",
    query: [
      {
        name: "at",
        description: 'ISO datetime, or "now" (default) -- for checking a specific moment',
      },
    ],
    handler: (request, url) => {
      const id = request.params.id ?? "";
      if (!personById(id)) throw notFound("no such person");
      const raw = q(url, "at");
      const at = raw && raw.toLowerCase() !== "now" ? new Date(raw) : new Date();
      if (Number.isNaN(at.getTime())) throw badRequest('"at" must be an ISO datetime or "now"');
      return json(locationNow(id, at));
    },
  },
  {
    method: "GET",
    path: "/v1/people/:id/roommates",
    tag: "people",
    summary: "Everyone else listed against the exact same dorm room",
    handler: (request) => {
      const id = request.params.id ?? "";
      const person = personById(id);
      if (!person) throw notFound("no such person");
      return json({
        dormName: person.dormName,
        dormRoom: person.dormRoom,
        roommates: roommatesOf(id),
      });
    },
  },
  {
    method: "GET",
    path: "/v1/people/:id/geography",
    tag: "people",
    summary:
      "How far a student's own schedule makes them walk -- routed metres, and any impossible transitions",
    query: [
      {
        name: "term",
        description: "Term code. Defaults to the current one, then the newest held.",
      },
    ],
    handler: (request, url) => {
      const geography = scheduleGeography(request.params.id ?? "", q(url, "term"));
      if (!geography) throw notFound("no booklist data for that person");
      return json(geography);
    },
  },
  {
    method: "GET",
    path: "/v1/geography/leaderboard",
    tag: "people",
    summary: "Every scoreable student's weekly walking distance, worst first",
    query: [{ name: "by", description: "class (default) or major" }],
    handler: (_request, url) => {
      const by = (q(url, "by") ?? "class") as "class" | "major";
      if (!["class", "major"].includes(by)) throw badRequest("by must be class or major");
      return json(geographyLeaderboard(by));
    },
  },
  {
    method: "GET",
    path: "/v1/people/:id/twins",
    tag: "people",
    summary: "Who else shares this student's own sections, most shared first",
    query: [
      { name: "term", description: "Term code. Defaults to the current one." },
      { name: "minShared", description: "Minimum shared sections to count. Default 2." },
    ],
    handler: (request, url) => {
      const id = request.params.id ?? "";
      if (!personById(id)) throw notFound("no such person");
      const term = q(url, "term") ?? currentTerm();
      const minShared = num(url, "minShared") ?? 2;
      return json({ term, minShared, twins: twinSchedulesFor(term, id, minShared) });
    },
  },
  {
    method: "GET",
    path: "/v1/people/:id/audit",
    tag: "people",
    summary:
      "Which of one program's courses a student's harvested booklists have seen -- not a transcript",
    query: [
      {
        name: "program",
        description: "Program title, or enough of it to match one",
        required: true,
      },
      { name: "year", description: "Catalog year. Defaults to the newest held." },
    ],
    handler: (request, url) => {
      const id = request.params.id ?? "";
      if (!personById(id)) throw notFound("no such person");

      const year = q(url, "year") ?? latestYear();
      if (!year) throw notFound("no catalog collected yet");

      const query = required(url, "program");
      const matches = listPrograms(year, query);
      const program =
        matches.find((p) => p.title.toLowerCase() === query.toLowerCase()) ??
        (matches.length === 1 ? matches[0] : null);
      if (!program) {
        if (matches.length > 1) {
          throw badRequest(
            `${matches.length} programs match "${query}": ${matches.map((p) => p.title).join(", ")}`,
          );
        }
        throw notFound(`no program matching "${query}"`);
      }

      const audit = degreeAudit(id, program);
      if (!audit) throw notFound("no booklist data for that person");
      return json({ year, ...audit });
    },
  },
  {
    method: "GET",
    path: "/v1/dorms",
    tag: "people",
    summary: "Population by dorm",
    handler: () => json({ dorms: peopleStats().byDorm }),
  },
  {
    method: "GET",
    path: "/v1/dorms/:name/rooms",
    tag: "people",
    summary: "Every occupied room in a hall, grouped -- the roommate graph for a whole building",
    handler: (request) => {
      const name = decodeURIComponent(request.params.name ?? "");
      const rooms = dormRooms(name);
      if (!rooms.length) throw notFound("no occupied rooms for that dorm name");
      return json({ dormName: name, rooms });
    },
  },
];
