/**
 * Textbooks by ISBN, which is the number that lets someone buy a book
 * somewhere other than the campus store.
 */

import { badRequest, json, notFound, q } from "../lib/http";
import { currentTerm } from "../lib/terms";
import { booksFor, holdersOf } from "../model/books";
import { personById } from "../store/people";
import type { RouteDef } from "./types";

export const bookRoutes: RouteDef[] = [
  {
    method: "GET",
    path: "/v1/people/:id/books",
    tag: "books",
    summary: "One student's textbooks, with ISBNs and how many others need each",
    query: [{ name: "term", description: "Term code. Defaults to the current one." }],
    handler: (request, url) => {
      const id = request.params.id ?? "";
      if (!personById(id)) throw notFound("no such person");
      const term = q(url, "term") ?? currentTerm();
      const books = booksFor(term, id);
      if (!books) throw notFound("no booklist harvested for them this term");
      return json(books);
    },
  },
  {
    method: "GET",
    path: "/v1/books/:isbn/students",
    tag: "books",
    summary: "Everyone needing one book this term -- who to split, borrow or buy from",
    query: [{ name: "term", description: "Term code. Defaults to the current one." }],
    handler: (request, url) => {
      const isbn = (request.params.isbn ?? "").trim();
      if (!/^\d{10,13}$/.test(isbn)) throw badRequest("isbn must be 10-13 digits");
      const term = q(url, "term") ?? currentTerm();
      return json(holdersOf(term, isbn));
    },
  },
];
