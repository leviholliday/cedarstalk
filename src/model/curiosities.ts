/**
 * The one-shot questions that don't deserve an endpoint each.
 *
 * Where the student body comes from, which departments get stuck with the
 * 8am slots, which book the most people were told to buy. None of it needs
 * new collection -- it is all sitting in data gathered for something else.
 *
 * One question that was asked for and is *not* here: textbook cost by major.
 * The campus store's booklist leaks department, course, section, ISBN,
 * edition and status, and no price at all -- see `extension/background.js`'s
 * `harvestInPage`, which parses every field the page offers. Costing a major
 * would mean either teaching the harvester to read prices (a collector
 * change, and a re-harvest) or pricing 4,000 ISBNs against something
 * external. Neither is a thing this file can do honestly, so it says so
 * instead of estimating.
 */

import { db } from "../db";
import { geocode } from "../store/geocode";
import { haversineMiles } from "./carpool";

/** Meetings starting at or before this count as early. 8am, the traditional complaint. */
const EARLY_CUTOFF_MIN = 8 * 60;

export interface Curiosities {
  term: string;
  hometownStates: { state: string; people: number }[];
  distance: {
    geocoded: number;
    ofPeople: number;
    medianMiles: number | null;
    meanMiles: number | null;
    furthest: { city: string; state: string; miles: number } | null;
  };
  earlyBirds: { subject: string; early: number; meetings: number; share: number }[];
  classSize: { subject: string; sections: number; meanClassSize: number }[];
  commonBooks: { isbn: string; title: string | null; students: number }[];
  optionalShare: { optional: number; required: number; share: number } | null;
  notes: string[];
}

function hometowns(): Pick<Curiosities, "hometownStates" | "distance"> {
  const rows = db()
    .query<{ city: string; state: string }, []>(
      "SELECT city, state FROM people WHERE present = 1 AND city IS NOT NULL AND state IS NOT NULL",
    )
    .all();

  const byState = new Map<string, number>();
  const campus = geocode("Cedarville", "OH");
  const miles: number[] = [];
  let furthest: Curiosities["distance"]["furthest"] = null;

  for (const row of rows) {
    byState.set(row.state, (byState.get(row.state) ?? 0) + 1);
    const home = campus && geocode(row.city, row.state);
    if (!home || !campus) continue;
    const distance = Math.round(haversineMiles(campus, home) * 10) / 10;
    miles.push(distance);
    if (!furthest || distance > furthest.miles) {
      furthest = { city: home.city, state: home.state, miles: distance };
    }
  }

  miles.sort((a, b) => a - b);
  const median = miles.length ? miles[Math.floor(miles.length / 2)]! : null;
  const mean = miles.length
    ? Math.round((miles.reduce((sum, m) => sum + m, 0) / miles.length) * 10) / 10
    : null;

  return {
    hometownStates: [...byState.entries()]
      .map(([state, people]) => ({ state, people }))
      .sort((a, b) => b.people - a.people),
    distance: {
      geocoded: miles.length,
      ofPeople: rows.length,
      medianMiles: median,
      meanMiles: mean,
      furthest,
    },
  };
}

/** Which subjects teach before 8am, as a share of their own meetings rather than a raw count. */
function earlyBirds(term: string): Curiosities["earlyBirds"] {
  const rows = db()
    .query<{ code: string | null; startMin: number }, [string]>(
      "SELECT code, start_min AS startMin FROM room_occupancy WHERE term = ?",
    )
    .all(term);

  const tally = new Map<string, { early: number; meetings: number }>();
  for (const row of rows) {
    const subject = row.code?.split("-")[0];
    if (!subject) continue;
    const entry = tally.get(subject) ?? { early: 0, meetings: 0 };
    entry.meetings++;
    if (row.startMin <= EARLY_CUTOFF_MIN) entry.early++;
    tally.set(subject, entry);
  }

  return [...tally.entries()]
    .filter(([, t]) => t.early > 0)
    .map(([subject, t]) => ({
      subject,
      early: t.early,
      meetings: t.meetings,
      share: Math.round((t.early / t.meetings) * 1000) / 1000,
    }))
    .sort((a, b) => b.share - a.share || b.early - a.early);
}

function classSize(term: string): Curiosities["classSize"] {
  return db()
    .query<{ subject: string; sections: number; meanClassSize: number }, [string]>(
      `SELECT substr(code, 1, instr(code, '-') - 1) AS subject,
              COUNT(*) AS sections,
              ROUND(AVG(COALESCE(capacity, 0) - COALESCE(available, 0)), 1) AS meanClassSize
       FROM sections
       WHERE term = ? AND code IS NOT NULL AND instr(code, '-') > 1
       GROUP BY subject HAVING sections >= 3
       ORDER BY meanClassSize DESC`,
    )
    .all(term);
}

/** The books the most students were told to buy, and how many of them are optional. */
function books(term: string): Pick<Curiosities, "commonBooks" | "optionalShare"> {
  const rows = db()
    .query<{ books: string }, [string]>("SELECT books FROM booklists WHERE term = ?")
    .all(term);

  const byIsbn = new Map<string, { title: string | null; students: number }>();
  let optional = 0;
  let required = 0;

  for (const row of rows) {
    const parsed = JSON.parse(row.books) as {
      isbn?: string | null;
      title?: string | null;
      status?: string | null;
    }[];
    // One student counts once per ISBN even if the store lists it twice.
    const seen = new Set<string>();
    for (const book of parsed) {
      if (book.status?.toLowerCase() === "optional") optional++;
      else required++;
      const isbn = book.isbn?.trim();
      if (!isbn || seen.has(isbn)) continue;
      seen.add(isbn);
      const entry = byIsbn.get(isbn) ?? { title: book.title ?? null, students: 0 };
      entry.students++;
      byIsbn.set(isbn, entry);
    }
  }

  const total = optional + required;
  return {
    commonBooks: [...byIsbn.entries()]
      .map(([isbn, entry]) => ({ isbn, title: entry.title, students: entry.students }))
      .sort((a, b) => b.students - a.students)
      .slice(0, 15),
    optionalShare: total
      ? { optional, required, share: Math.round((optional / total) * 1000) / 1000 }
      : null,
  };
}

export function curiosities(term: string): Curiosities {
  return {
    term,
    ...hometowns(),
    earlyBirds: earlyBirds(term),
    classSize: classSize(term),
    ...books(term),
    notes: [
      "Textbook cost by major is not here: the campus store's booklist carries department, course, section, ISBN, edition and status, and no price. Costing a major would need the harvester taught to read prices, and a re-harvest.",
      "Hometown distance is straight-line from Cedarville, OH, for the hometowns the Census Gazetteer recognises -- see the geocoded count against ofPeople.",
    ],
  };
}
