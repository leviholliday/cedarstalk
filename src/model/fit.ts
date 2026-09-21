/**
 * Whether a section you are thinking about would actually work.
 *
 * Self-Service will let you register for a 9:50 in Health Sciences and a 10:00
 * in Engineering & Science without a word, because it checks clocks and knows
 * nothing about the ground between two doors. The engine has routed that
 * ground since the geography model was written; it had simply never been
 * pointed at a section someone had not registered for yet.
 *
 * So this builds the hypothetical week -- your current blocks plus the
 * candidate's -- and asks `walkTransitions` the same question the geography
 * route asks about your real one. The answers agree by construction, because
 * it is the same function.
 */

import { searchSections } from "../store/catalog";
import { walkTransitions } from "./geography";
import { type Meeting, minutesOfDay, meetingsOf } from "./meetings";
import { type Block, scheduleFor } from "./schedule";
import type { Transition } from "./geography";

/** How much of a gap a walk may eat before it stops being comfortable. */
const TIGHT_RATIO = 0.7;

export type Verdict = "fits" | "tight" | "impossible" | "clash";

export interface Clash {
  day: number;
  with: string;
  overlap: string;
}

export interface FitOption {
  sectionId: string;
  name: string;
  title: string | null;
  faculty: string | null;
  available: number | null;
  capacity: number | null;
  online: boolean;
  meetings: Meeting[];
  verdict: Verdict;
  /** Why, in the words the UI should show. */
  reason: string;
  clashes: Clash[];
  /** Only the transitions the candidate itself creates, not your existing ones. */
  walks: Transition[];
}

export interface FitResult {
  studentId: string;
  term: string;
  code: string;
  /** False when the person has no harvested timetable to check against. */
  known: boolean;
  options: FitOption[];
}

const clock = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Blocks grouped by the weekday they fall on. */
function byDay(name: string, title: string | null, meetings: Meeting[]): Map<number, Block[]> {
  const out = new Map<number, Block[]>();
  for (const meeting of meetings) {
    if (meeting.online || !meeting.start || !meeting.end) continue;
    for (const day of meeting.days) {
      const block: Block = {
        start: meeting.start,
        end: meeting.end,
        minutes: (minutesOfDay(meeting.end) ?? 0) - (minutesOfDay(meeting.start) ?? 0),
        section: name,
        title,
        kind: meeting.kind ?? null,
        building: meeting.building,
        room: meeting.room,
      };
      out.set(day, [...(out.get(day) ?? []), block]);
    }
  }
  return out;
}

export function fitFor(
  studentId: string,
  code: string,
  options: { term?: string; openOnly?: boolean } = {},
): FitResult {
  const schedule = scheduleFor(studentId, options.term);
  const term = schedule?.term ?? options.term ?? "";

  const candidates = searchSections({
    term,
    code: code.toUpperCase(),
    open: options.openOnly ?? true,
    limit: 100,
  });

  const result: FitResult = {
    studentId,
    term,
    code: code.toUpperCase(),
    known: schedule !== null,
    options: [],
  };

  // Sections the person is already registered for are not options.
  const alreadyTaking = new Set(schedule?.sections.map((s) => s.name) ?? []);

  for (const row of candidates) {
    if (alreadyTaking.has(row.name ?? "")) continue;

    const meetings = meetingsOf(row);
    const name = row.name ?? row.sectionId;
    const candidateDays = byDay(name, row.title, meetings);
    const online = candidateDays.size === 0;

    const clashes: Clash[] = [];
    const walks: Transition[] = [];

    if (schedule) {
      for (const [day, newBlocks] of candidateDays) {
        const existing = schedule.week.find((d) => d.day === day)?.blocks ?? [];

        for (const mine of existing) {
          for (const theirs of newBlocks) {
            const aStart = minutesOfDay(mine.start) ?? 0;
            const aEnd = minutesOfDay(mine.end) ?? 0;
            const bStart = minutesOfDay(theirs.start) ?? 0;
            const bEnd = minutesOfDay(theirs.end) ?? 0;
            if (aStart < bEnd && bStart < aEnd) {
              clashes.push({
                day,
                with: mine.section,
                overlap: `${clock(Math.max(aStart, bStart))}-${clock(Math.min(aEnd, bEnd))}`,
              });
            }
          }
        }

        // Only the walks this candidate introduces are its problem; the ones
        // already in the timetable are not news and would drown the signal.
        const before = new Set(
          walkTransitions(existing, day).map((t) => `${t.fromEnd}>${t.toStart}`),
        );
        for (const transition of walkTransitions([...existing, ...newBlocks], day)) {
          if (!before.has(`${transition.fromEnd}>${transition.toStart}`)) walks.push(transition);
        }
      }
    }

    result.options.push({
      sectionId: row.sectionId,
      name,
      title: row.title,
      faculty: row.faculty,
      available: row.available,
      capacity: row.capacity,
      online,
      meetings,
      ...verdictFor(clashes, walks, online, schedule !== null),
      clashes,
      walks,
    });
  }

  const RANK: Record<Verdict, number> = { fits: 0, tight: 1, impossible: 2, clash: 3 };
  result.options.sort(
    (a, b) => RANK[a.verdict] - RANK[b.verdict] || a.name.localeCompare(b.name),
  );
  return result;
}

function verdictFor(
  clashes: Clash[],
  walks: Transition[],
  online: boolean,
  known: boolean,
): { verdict: Verdict; reason: string } {
  if (clashes.length) {
    const first = clashes[0]!;
    return {
      verdict: "clash",
      reason: `Overlaps ${first.with} (${first.overlap}).`,
    };
  }
  if (!known) {
    return {
      verdict: "fits",
      reason: "No timetable on record to check against, so nothing can be ruled out.",
    };
  }
  if (online) return { verdict: "fits", reason: "Online — nowhere to walk to." };

  const undoable = walks.find((w) => w.possible === false);
  if (undoable) {
    return {
      verdict: "impossible",
      reason:
        `${undoable.from} to ${undoable.to} is a ${undoable.walkMinutes} min walk ` +
        `and you would have ${undoable.gapMinutes}.`,
    };
  }

  const tight = walks.find(
    (w) =>
      w.possible === true &&
      w.walkMinutes !== null &&
      w.gapMinutes > 0 &&
      w.walkMinutes / w.gapMinutes > TIGHT_RATIO,
  );
  if (tight) {
    return {
      verdict: "tight",
      reason:
        `${tight.from} to ${tight.to} takes ${tight.walkMinutes} of your ` +
        `${tight.gapMinutes} min gap.`,
    };
  }

  // A building the campus map has never heard of cannot be routed, and
  // claiming the walk is fine would be a guess dressed as a check.
  const unroutable = walks.find((w) => w.possible === null);
  if (unroutable) {
    return {
      verdict: "fits",
      reason: `No clash. The walk to ${unroutable.to} could not be routed — that building is not on the campus map.`,
    };
  }

  return { verdict: "fits", reason: "No clash, and every walk is comfortable." };
}
