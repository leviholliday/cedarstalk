/**
 * Known majors, loaded from whatever CSV you happen to have.
 *
 * Truth arrives as an honors roster, a club list, a screenshot someone typed
 * up — never in one shape. So the loader is tolerant: it needs a name and a
 * major, and ignores every other column. Names are resolved against the
 * directory, because a label the engine cannot attach to an id cannot score
 * anything.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseCSV } from "../lib/csv";
import { saveLabels } from "../store/harvest";
import { findByName } from "../store/people";

export interface LoadedLabels {
  source: string;
  matched: number;
  unmatched: { name: string; major: string }[];
}

export function loadLabelsFile(file: string, source = basename(file)): LoadedLabels {
  const rows = parseCSV(readFileSync(file, "utf-8"));
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const index = (names: string[]) => head.findIndex((h) => names.includes(h));

  const iFirst = index(["first name", "first"]);
  const iLast = index(["last name", "last"]);
  const iFull = index(["full name", "name"]);
  const iMajor = index(["major", "primary major"]);
  const iSecond = index(["second major", "secondary major"]);

  const matched: Parameters<typeof saveLabels>[0] = [];
  const unmatched: { name: string; major: string }[] = [];

  for (const row of rows.slice(1)) {
    let first: string | undefined;
    let last: string | undefined;
    if (iFirst >= 0 && iLast >= 0) {
      first = row[iFirst]?.trim();
      last = row[iLast]?.trim();
    } else if (iFull >= 0) {
      const parts = (row[iFull] ?? "").trim().split(/\s+/).filter(Boolean);
      first = parts[0];
      last = parts[parts.length - 1];
    }
    const major = (iMajor >= 0 ? (row[iMajor] ?? "") : "").trim();
    if (!first || !last || !major) continue;

    const hits = findByName(first, last);
    // An ambiguous name is worse than a missing one: scoring the wrong student
    // quietly poisons the accuracy number the whole model is judged by.
    if (hits.length !== 1 || !hits[0]) {
      unmatched.push({ name: `${first} ${last}`, major });
      continue;
    }
    matched.push({
      studentId: hits[0].id,
      source,
      major,
      major2: (iSecond >= 0 ? (row[iSecond] ?? "") : "").trim() || null,
    });
  }

  saveLabels(matched);
  return { source, matched: matched.length, unmatched };
}
