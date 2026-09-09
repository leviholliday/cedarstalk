/**
 * Collecting booklists, which is the only public trace of what a student is
 * actually taking.
 *
 * The campus store's per-student course-materials page lists
 * `Department / Course / Section` for every book it wants to sell, and it will
 * render that page for any id. It sits behind an AWS WAF challenge that only a
 * real browser solves, so the sweep runs as a userscript in yours: this builds
 * it, bakes in the id list and the term, and the finished JSON comes back here
 * to be filed.
 *
 * One install per term. The script never runs on its own — you press Start.
 */

import { readFileSync } from "node:fs";
import { ingestHarvest } from "../store/harvest";
import { studentIds } from "../store/people";
// Imported as text so `bun build --compile` carries it into the binary.
import template from "./assets/harvester.js.tmpl" with { type: "text" };

export interface HarvesterOptions {
  term: string;
  /** Defaults to every student type in the directory. */
  ids?: string[];
  types?: string[];
  studentClass?: string;
}

/** The Tampermonkey harvester for one term, as text. */
export function buildHarvester(options: HarvesterOptions): { script: string; ids: string[] } {
  const ids =
    options.ids ??
    studentIds(options.types ?? ["UG", "UGO", "GS", "P4"], options.studentClass);
  const script = template
    .replace("__IDS__", JSON.stringify(ids))
    .replaceAll("__TERM__", options.term);
  return { script, ids };
}

/** "2026FA" out of "~/Downloads/2026FA.json". */
export const termFromFilename = (file: string): string =>
  (file.split("/").pop() ?? file).replace(/\.json$/i, "");

/** File a harvest the script downloaded. Re-ingesting a term refreshes it. */
export function ingestFile(file: string, term = termFromFilename(file)) {
  const rows = JSON.parse(readFileSync(file, "utf-8"));
  if (!Array.isArray(rows)) throw new Error("expected a JSON array of {id, books}");
  return { term, ...ingestHarvest(term, rows) };
}
