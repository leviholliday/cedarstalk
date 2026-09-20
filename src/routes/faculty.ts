/** Who teaches what, how much of it, and how early. */

import { json, notFound, q } from "../lib/http";
import { currentTerm } from "../lib/terms";
import { facultyDetail, facultyLoad } from "../model/faculty";
import type { RouteDef } from "./types";

export const facultyRoutes: RouteDef[] = [
  {
    method: "GET",
    path: "/v1/faculty",
    tag: "faculty",
    summary: "Every instructor of record for a term, busiest first",
    query: [{ name: "term", description: "Term code. Defaults to the current one." }],
    handler: (_request, url) => {
      const term = q(url, "term") ?? currentTerm();
      return json({ term, faculty: facultyLoad(term) });
    },
  },
  {
    method: "GET",
    path: "/v1/faculty/:name",
    tag: "faculty",
    summary: "One instructor's full load: sections, credits, rooms, early meetings",
    query: [{ name: "term", description: "Term code. Defaults to the current one." }],
    handler: (request, url) => {
      const term = q(url, "term") ?? currentTerm();
      const name = decodeURIComponent(request.params.name ?? "");
      const detail = facultyDetail(term, name);
      if (!detail) throw notFound("no sections for that name this term");
      return json({ term, ...detail });
    },
  },
];
