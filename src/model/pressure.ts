/**
 * How fast a section fills, from the seats it had at the last collect to the
 * seats it has now.
 *
 * `section_seats` is append-only -- see `db.ts` -- specifically so this curve
 * could exist. One snapshot says nothing about velocity; this is only as good
 * as how many collects have accumulated, and reports that honestly rather
 * than guessing a rate off a single point.
 */

import {
  type SeatSnapshot,
  seatHistory,
  sectionById,
  sectionsWithSeatHistory,
} from "../store/catalog";

export interface SectionPressure {
  term: string;
  sectionId: string;
  code: string | null;
  name: string | null;
  points: SeatSnapshot[];
  /** Seats filled per hour, averaged from the first snapshot to the last. Null with fewer than two. */
  fillPerHour: number | null;
  /** Minutes from the first snapshot to the first one observed full, or null if never seen full. */
  minutesToFull: number | null;
  /** available <= 0 as of the most recent snapshot. */
  full: boolean;
}

/** One section's seat curve and fill rate, from however many snapshots exist so far. */
export function sectionPressure(term: string, sectionId: string): SectionPressure | null {
  const points = seatHistory(term, sectionId);
  if (!points.length) return null;

  const section = sectionById(sectionId, term);
  const first = points[0]!;
  const last = points.at(-1)!;

  let minutesToFull: number | null = null;
  for (const point of points) {
    if (point.available !== null && point.available <= 0) {
      minutesToFull =
        Math.round(
          ((new Date(point.observedAt).getTime() - new Date(first.observedAt).getTime()) / 60000) *
            10,
        ) / 10;
      break;
    }
  }

  let fillPerHour: number | null = null;
  if (points.length > 1 && first.available !== null && last.available !== null) {
    const elapsedHours =
      (new Date(last.observedAt).getTime() - new Date(first.observedAt).getTime()) / 3_600_000;
    if (elapsedHours > 0) {
      fillPerHour = Math.round(((first.available - last.available) / elapsedHours) * 100) / 100;
    }
  }

  return {
    term,
    sectionId,
    code: section?.code ?? null,
    name: section?.name ?? null,
    points,
    fillPerHour,
    minutesToFull,
    full: (last.available ?? 1) <= 0,
  };
}

export interface PressureSummary {
  sectionId: string;
  code: string | null;
  name: string | null;
  snapshots: number;
  fillPerHour: number | null;
  minutesToFull: number | null;
  full: boolean;
}

/**
 * Every section with snapshot history, fastest-filling first.
 *
 * A section with one snapshot has no velocity to report and is excluded --
 * padding the leaderboard with nulls would just push real signal down the
 * page.
 */
export function pressureLeaderboard(term: string): PressureSummary[] {
  const ids = sectionsWithSeatHistory(term);
  const summaries: PressureSummary[] = [];
  for (const id of ids) {
    const pressure = sectionPressure(term, id);
    if (!pressure || pressure.points.length < 2) continue;
    summaries.push({
      sectionId: pressure.sectionId,
      code: pressure.code,
      name: pressure.name,
      snapshots: pressure.points.length,
      fillPerHour: pressure.fillPerHour,
      minutesToFull: pressure.minutesToFull,
      full: pressure.full,
    });
  }
  return summaries.sort((a, b) => (b.fillPerHour ?? 0) - (a.fillPerHour ?? 0));
}
