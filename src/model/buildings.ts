/**
 * One building, summarized: when it's busiest, what it's mostly used for, and
 * how hard its rooms actually work. Composed from the pieces `occupancy.ts`
 * already computes rather than re-querying the catalog -- a "personality
 * card" is a different shape of the same facts, not a new source of them.
 */

import { db } from "../db";
import { buildingByLabel } from "../store/campus";
import { roomUtilization } from "./occupancy";

export interface BuildingProfile {
  building: string;
  /** buildings.label, when the map can place this building -- null for a partner school, etc. */
  campusLabel: string | null;
  /** 0-23. The hour with the most people scheduled somewhere in the building, across the week. */
  peakHour: number | null;
  peakEnrolled: number;
  /** The course subject (e.g. "BIO") with the most enrolled headcount in this building. */
  dominantSubject: string | null;
  /** That subject's share of the building's total enrolled headcount, 0-1. */
  subjectShare: number | null;
  /** Mean enrolled headcount across the building's meeting-day slots. */
  meanClassSize: number | null;
  /** Enrolled headcount summed across every meeting-day this week -- a contact-instance proxy, not a unique headcount. */
  weeklyFootfall: number;
  /** weeklyFootfall spread over the days the building actually holds class. */
  meanDailyFootfall: number;
  rooms: number;
  /** Mean of this building's own rooms' utilization (see `roomUtilization`), 0-1. */
  meanUtilization: number | null;
  /** 24 hourly buckets, enrolled headcount summed across every day of the week. */
  rhythm: { hour: number; enrolled: number }[];
}

/** One building's personality: composed from the occupancy grid, not a fresh catalog scan. */
export function buildingProfile(term: string, building: string): BuildingProfile | null {
  const resolved = buildingByLabel(building);
  const label = resolved?.label ?? building;

  const rows = db()
    .query<
      {
        day: number;
        startMin: number;
        endMin: number;
        code: string | null;
        enrolled: number | null;
      },
      [string, string]
    >(
      "SELECT day, start_min AS startMin, end_min AS endMin, code, enrolled FROM room_occupancy WHERE term = ? AND building = ?",
    )
    .all(term, label);

  if (!rows.length) return null;

  const hourly = new Array(24).fill(0) as number[];
  const subjectEnrolled = new Map<string, number>();
  const days = new Set<number>();
  let weeklyFootfall = 0;
  let enrolledSum = 0;
  let slots = 0;

  for (const row of rows) {
    const enrolled = row.enrolled ?? 0;
    weeklyFootfall += enrolled;
    enrolledSum += enrolled;
    slots++;
    days.add(row.day);

    // A meeting counts toward every hour it spans, not just the one it starts in.
    const startHour = Math.floor(row.startMin / 60);
    const endHour = Math.ceil(row.endMin / 60);
    for (let hour = Math.max(0, startHour); hour < Math.min(24, endHour); hour++) {
      hourly[hour]! += enrolled;
    }

    const subject = row.code?.split("-")[0];
    if (subject) subjectEnrolled.set(subject, (subjectEnrolled.get(subject) ?? 0) + enrolled);
  }

  let peakHour: number | null = null;
  let peakEnrolled = 0;
  hourly.forEach((value, hour) => {
    if (value > peakEnrolled) {
      peakEnrolled = value;
      peakHour = hour;
    }
  });

  let dominantSubject: string | null = null;
  let dominantEnrolled = 0;
  let totalSubjectEnrolled = 0;
  for (const [subject, enrolled] of subjectEnrolled) {
    totalSubjectEnrolled += enrolled;
    if (enrolled > dominantEnrolled) {
      dominantEnrolled = enrolled;
      dominantSubject = subject;
    }
  }

  const rooms = roomUtilization(term).filter((room) => room.building === label);
  const meanUtilization = rooms.length
    ? Math.round((rooms.reduce((sum, room) => sum + room.utilization, 0) / rooms.length) * 1000) /
      1000
    : null;

  return {
    building: label,
    campusLabel: resolved?.label ?? null,
    peakHour,
    peakEnrolled,
    dominantSubject,
    subjectShare:
      dominantSubject && totalSubjectEnrolled > 0
        ? Math.round((dominantEnrolled / totalSubjectEnrolled) * 1000) / 1000
        : null,
    meanClassSize: slots ? Math.round((enrolledSum / slots) * 10) / 10 : null,
    weeklyFootfall,
    meanDailyFootfall: days.size ? Math.round((weeklyFootfall / days.size) * 10) / 10 : 0,
    rooms: rooms.length,
    meanUtilization,
    rhythm: hourly.map((enrolled, hour) => ({ hour, enrolled })),
  };
}
