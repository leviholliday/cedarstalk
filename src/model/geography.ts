/**
 * How far a schedule actually makes someone walk.
 *
 * A booklist gives the section, the section gives the room, and the campus
 * graph already knows how to route between two doors -- so the gap between
 * `scheduleFor`'s consecutive blocks and a real walking time was always
 * answerable, just never asked. The genuinely interesting rows are the
 * impossible ones: a ten-minute passing period between two buildings eleven
 * minutes apart on foot.
 */

import { adjacencyOf, shortestPath } from "../lib/route";
import { buildingByLabel, campusMap } from "../store/campus";
import { fingerprints } from "../store/harvest";
import { personById } from "../store/people";
import { guessAll } from "./guess";
import { minutesOfDay } from "./meetings";
import { scheduleFor } from "./schedule";

/** Matches the walking speed `routes/campus.ts` already assumes for /v1/campus/route. */
const WALK_METRES_PER_SECOND = 1.35;

export interface Transition {
  day: number;
  from: string;
  to: string;
  /** "HH:MM" the first class lets out, and the second one starts. */
  fromEnd: string;
  toStart: string;
  gapMinutes: number;
  /** Null when either building has no campus coordinates to route from/to. */
  walkMetres: number | null;
  walkMinutes: number | null;
  /** Null when unroutable; otherwise whether the gap covers the walk. */
  possible: boolean | null;
}

export interface DayGeography {
  day: number;
  label: string;
  /** Summed walk distance for the day, routed transitions only. */
  metres: number;
  transitions: Transition[];
}

export interface ScheduleGeography {
  studentId: string;
  term: string;
  weeklyMetres: number;
  worstTransition: Transition | null;
  impossibleTransitions: Transition[];
  days: DayGeography[];
}

/** One student's week, scored for how far the schedule itself makes them walk. */
export function scheduleGeography(studentId: string, term?: string): ScheduleGeography | null {
  const schedule = scheduleFor(studentId, term);
  if (!schedule) return null;

  const map = campusMap();
  const adjacency = map ? adjacencyOf(map) : null;

  const days: DayGeography[] = [];
  let weeklyMetres = 0;
  let worst: Transition | null = null;
  const impossible: Transition[] = [];

  for (const day of schedule.week) {
    const blocks = [...day.blocks].sort((a, b) => a.start.localeCompare(b.start));
    const transitions: Transition[] = [];
    let dayMetres = 0;

    for (let i = 1; i < blocks.length; i++) {
      const prev = blocks[i - 1]!;
      const next = blocks[i]!;
      // Same building, or one leg has no room on record: nothing to route.
      if (!prev.building || !next.building || prev.building === next.building) continue;

      const gapMinutes = (minutesOfDay(next.start) ?? 0) - (minutesOfDay(prev.end) ?? 0);
      let walkMetres: number | null = null;
      let walkMinutes: number | null = null;
      let possible: boolean | null = null;

      if (map && adjacency) {
        const from = buildingByLabel(prev.building);
        const to = buildingByLabel(next.building);
        if (from?.node != null && to?.node != null) {
          const path = shortestPath(map, from.node, to.node, adjacency);
          if (path) {
            walkMetres = path.metres;
            walkMinutes = Math.round((path.metres / WALK_METRES_PER_SECOND / 60) * 10) / 10;
            possible = walkMinutes <= gapMinutes;
          }
        }
      }

      const transition: Transition = {
        day: day.day,
        from: prev.building,
        to: next.building,
        fromEnd: prev.end,
        toStart: next.start,
        gapMinutes,
        walkMetres,
        walkMinutes,
        possible,
      };
      transitions.push(transition);
      if (walkMetres !== null) dayMetres += walkMetres;
      if (possible === false) impossible.push(transition);
      if (walkMinutes !== null && (worst === null || walkMinutes > (worst.walkMinutes ?? -1))) {
        worst = transition;
      }
    }

    weeklyMetres += dayMetres;
    days.push({ day: day.day, label: day.label, metres: Math.round(dayMetres), transitions });
  }

  return {
    studentId,
    term: schedule.term,
    weeklyMetres: Math.round(weeklyMetres),
    worstTransition: worst,
    impossibleTransitions: impossible,
    days,
  };
}

export interface GeographyLeaderboardRow {
  studentId: string;
  name: string | null;
  bucket: string;
  weeklyMetres: number;
  impossibleTransitions: number;
}

export interface GeographyLeaderboard {
  by: "class" | "major";
  /** Coverage: how many present students actually have a routable schedule. */
  scored: number;
  rows: GeographyLeaderboardRow[];
  /** Weekly metres, averaged per bucket -- the distribution the README's own question asks about. */
  byBucket: { bucket: string; students: number; meanWeeklyMetres: number }[];
}

/**
 * Every scoreable student's weekly walk, worst-schedule-geography first.
 *
 * "Scoreable" means they have a booklist *and* their sections route on the
 * campus graph -- both are real coverage limits, not a bug, and `scored`
 * reports the count honestly rather than implying this is everyone. Only
 * booklisted students are worth iterating at all -- a full population scan
 * would mostly just discard people `scheduleGeography` can't score anyway.
 */
export function geographyLeaderboard(by: "class" | "major" = "class"): GeographyLeaderboard {
  const majorOf =
    by === "major"
      ? new Map(guessAll(1).map((g) => [g.studentId, g.guesses[0]?.title ?? "unclassified"]))
      : null;

  const rows: GeographyLeaderboardRow[] = [];
  for (const studentId of fingerprints().keys()) {
    const geography = scheduleGeography(studentId);
    if (!geography || !geography.days.some((d) => d.transitions.length)) continue;

    const person = personById(studentId);
    const bucket =
      by === "major"
        ? (majorOf?.get(studentId) ?? "unclassified")
        : (person?.studentClass ?? "unknown");

    rows.push({
      studentId,
      name: person
        ? `${person.nickname ?? person.firstName ?? ""} ${person.lastName ?? ""}`.trim()
        : null,
      bucket,
      weeklyMetres: geography.weeklyMetres,
      impossibleTransitions: geography.impossibleTransitions.length,
    });
  }

  const byBucketMap = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const entry = byBucketMap.get(row.bucket) ?? { total: 0, count: 0 };
    entry.total += row.weeklyMetres;
    entry.count++;
    byBucketMap.set(row.bucket, entry);
  }

  return {
    by,
    scored: rows.length,
    rows: rows.sort((a, b) => b.weeklyMetres - a.weeklyMetres),
    byBucket: [...byBucketMap.entries()]
      .map(([bucket, { total, count }]) => ({
        bucket,
        students: count,
        meanWeeklyMetres: Math.round(total / count),
      }))
      .sort((a, b) => b.meanWeeklyMetres - a.meanWeeklyMetres),
  };
}
