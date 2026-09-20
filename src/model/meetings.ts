/**
 * One section's meeting times, parsed once.
 *
 * Every room-occupancy feature (empty rooms, quietness, utilization, traffic)
 * starts here. `expand()` is the workhorse: it turns a section's payload into
 * flat, one-row-per-day-per-meeting slots with everything a grid needs
 * already resolved — no caller should be reaching into `FormattedMeetingTimes`
 * a second time.
 */

import type { SectionRow } from "../store/catalog";

/** Colleague counts days the way `Date.getDay` does: Sunday is 0. */
export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export interface Meeting {
  /** 0 is Sunday. A lecture on M/W/F is one meeting with three days. */
  days: number[];
  daysDisplay: string | null;
  /** 24-hour, "09:00". Null for an online section that never meets. */
  start: string | null;
  end: string | null;
  minutes: number;
  kind: string | null;
  building: string | null;
  room: string | null;
  online: boolean;
  startDate: string | null;
  endDate: string | null;
}

interface RawMeeting {
  Days?: number[];
  DaysOfWeekDisplay?: string;
  StartTime?: string;
  EndTime?: string;
  InstructionalMethodDisplay?: string;
  BuildingDisplay?: string;
  RoomDisplay?: string;
  IsOnline?: boolean;
  StartDate?: string;
  EndDate?: string;
}

export const clean = (value: string | undefined): string | null => value?.trim() || null;

/** "09:50:00" is three fields of precision for a thing measured in minutes. */
export const clock = (value: string | undefined): string | null => {
  const parts = clean(value)?.split(":");
  return parts && parts.length >= 2 ? `${parts[0]}:${parts[1]}` : null;
};

/** "09:50" -> 590. The unit every occupancy query actually wants to compare in. */
export function minutesOfDay(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h! * 60 + m!;
}

export const minutesBetween = (start: string | null, end: string | null): number => {
  const startMin = minutesOfDay(start);
  const endMin = minutesOfDay(end);
  if (startMin === null || endMin === null) return 0;
  return Math.max(0, endMin - startMin);
};

export function meetingsOf(section: SectionRow): Meeting[] {
  const payload = JSON.parse(section.payload) as { FormattedMeetingTimes?: RawMeeting[] };
  return (payload.FormattedMeetingTimes ?? []).map((raw) => {
    const start = clock(raw.StartTime);
    const end = clock(raw.EndTime);
    return {
      days: (raw.Days ?? []).filter((day) => day >= 0 && day <= 6),
      daysDisplay: clean(raw.DaysOfWeekDisplay),
      start,
      end,
      minutes: minutesBetween(start, end),
      kind: clean(raw.InstructionalMethodDisplay),
      building: clean(raw.BuildingDisplay),
      room: clean(raw.RoomDisplay),
      online: raw.IsOnline === true,
      startDate: clean(raw.StartDate),
      endDate: clean(raw.EndDate),
    };
  });
}

export const creditsOf = (section: SectionRow): number | null => {
  const payload = JSON.parse(section.payload) as { MinimumCredits?: number | null };
  return typeof payload.MinimumCredits === "number" ? payload.MinimumCredits : null;
};

/** `Enrolled` is on the payload, not the indexed columns -- capacity minus available is a guess. */
export const enrolledOf = (section: SectionRow): number | null => {
  const payload = JSON.parse(section.payload) as { Enrolled?: number | null };
  return typeof payload.Enrolled === "number" ? payload.Enrolled : null;
};

/** A section is online when nothing about it has a day and an hour. */
export const meetsInPerson = (meetings: Meeting[]): boolean =>
  meetings.some((meeting) => !meeting.online && meeting.days.length && meeting.start);

/** One meeting, one day: the flat unit every occupancy grid is built from. */
export interface ExpandedMeeting {
  day: number;
  startMin: number;
  endMin: number;
  building: string | null;
  room: string | null;
  kind: string | null;
  enrolled: number | null;
  sectionId: string;
  code: string | null;
  name: string | null;
  title: string | null;
}

/**
 * A section, flattened to one row per day it actually meets in person.
 *
 * Online meetings and meetings with no resolvable start/end are dropped --
 * neither occupies a room. An MWF lecture becomes three rows; that
 * duplication is the point, since the grid asks "is this room busy on
 * Wednesday" independently of Monday.
 */
export function expand(section: SectionRow): ExpandedMeeting[] {
  const enrolled = enrolledOf(section);
  const out: ExpandedMeeting[] = [];
  for (const meeting of meetingsOf(section)) {
    if (meeting.online) continue;
    const startMin = minutesOfDay(meeting.start);
    const endMin = minutesOfDay(meeting.end);
    if (startMin === null || endMin === null) continue;
    for (const day of meeting.days) {
      out.push({
        day,
        startMin,
        endMin,
        building: meeting.building,
        room: meeting.room,
        kind: meeting.kind,
        enrolled,
        sectionId: section.sectionId,
        code: section.code,
        name: section.name,
        title: section.title,
      });
    }
  }
  return out;
}
