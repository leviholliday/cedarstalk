/**
 * When several people are all free at once.
 *
 * The whole value of this is in one distinction: a person whose timetable we
 * cannot see is **not** a person who is free. Treating an absence of data as an
 * absence of classes would silently invent availability, and the answer would
 * be confidently wrong in exactly the situation where someone is relying on it
 * — arranging a meeting. So anyone without a schedule is reported separately
 * and left out of the intersection entirely.
 *
 * Every window also names whose class ends it, because "free 11:50 to 15:00"
 * is a fact and "until Norah's 3pm in BTS" is something you can act on.
 */

import { type Schedule, scheduleFor } from "./schedule";

export interface Interval {
  start: number;
  end: number;
}

export interface WindowCloser {
  id: string;
  name: string | null;
  section: string;
  at: string;
}

export interface FreeWindow {
  start: string;
  end: string;
  minutes: number;
  /** Whose class closes it. Empty when the window runs to the end of the search range. */
  endsBecause: WindowCloser[];
}

export interface Availability {
  day: number;
  from: string;
  to: string;
  minMinutes: number;
  /** People whose schedule was actually used. */
  known: { id: string; name: string | null }[];
  /** People with no harvested timetable, excluded from the intersection. */
  unknown: string[];
  windows: FreeWindow[];
}

export const clockMinutes = (hhmm: string): number => {
  const parts = hhmm.split(":");
  const h = Number.parseInt(parts[0] ?? "", 10);
  const m = Number.parseInt(parts[1] ?? "", 10);
  return (Number.isNaN(h) ? 0 : h) * 60 + (Number.isNaN(m) ? 0 : m);
};

const clock = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Overlapping or touching intervals collapsed into one. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/** The gaps left inside [from, to] once the busy intervals are removed. */
export function invert(busy: Interval[], from: number, to: number): Interval[] {
  const free: Interval[] = [];
  let cursor = from;
  for (const span of mergeIntervals(busy)) {
    if (span.end <= from || span.start >= to) continue;
    if (span.start > cursor) free.push({ start: cursor, end: Math.min(span.start, to) });
    cursor = Math.max(cursor, span.end);
    if (cursor >= to) break;
  }
  if (cursor < to) free.push({ start: cursor, end: to });
  return free;
}

/** The spans present in both lists. */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const left = a[i];
    const right = b[j];
    if (!left || !right) break;
    const start = Math.max(left.start, right.start);
    const end = Math.min(left.end, right.end);
    if (start < end) out.push({ start, end });
    if (left.end < right.end) i++;
    else j++;
  }
  return out;
}

export function availabilityFor(
  ids: string[],
  day: number,
  fromClock: string,
  toClock: string,
  minMinutes: number,
  term?: string,
): Availability {
  const from = clockMinutes(fromClock);
  const to = clockMinutes(toClock);

  const known: { id: string; name: string | null }[] = [];
  const unknown: string[] = [];
  const schedules = new Map<string, Schedule>();

  for (const id of [...new Set(ids)]) {
    const schedule = scheduleFor(id, term);
    if (!schedule) {
      unknown.push(id);
      continue;
    }
    schedules.set(id, schedule);
    known.push({ id, name: schedule.name });
  }

  if (!known.length) {
    return { day, from: fromClock, to: toClock, minMinutes, known, unknown, windows: [] };
  }

  let common: Interval[] = [{ start: from, end: to }];
  for (const { id } of known) {
    const blocks = schedules.get(id)?.week.find((d) => d.day === day)?.blocks ?? [];
    const busy = blocks.map((b) => ({
      start: clockMinutes(b.start),
      end: clockMinutes(b.end),
    }));
    common = intersect(common, invert(busy, from, to));
    if (!common.length) break;
  }

  const windows: FreeWindow[] = common
    .filter((span) => span.end - span.start >= minMinutes)
    .map((span) => {
      // Whose class starts exactly when the window closes -- that is the
      // reason it closes, and the only part of this anyone can act on.
      const endsBecause: WindowCloser[] = [];
      if (span.end < to) {
        for (const { id, name } of known) {
          const blocks = schedules.get(id)?.week.find((d) => d.day === day)?.blocks ?? [];
          for (const block of blocks) {
            if (clockMinutes(block.start) === span.end) {
              endsBecause.push({ id, name, section: block.section, at: block.start });
            }
          }
        }
      }
      return {
        start: clock(span.start),
        end: clock(span.end),
        minutes: span.end - span.start,
        endsBecause,
      };
    });

  return { day, from: fromClock, to: toClock, minMinutes, known, unknown, windows };
}
