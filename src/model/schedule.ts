/**
 * One student's week.
 *
 * The join is short but it only works because of a detail the major model
 * discards: the campus store's booklist names the *section* a book was bought
 * for, not just the course. `BIO-2500-01` is one row in the catalog, and that
 * row carries the days, the hour and the room. So a list of books somebody
 * never meant to publish as a timetable is a timetable.
 *
 * Two honest limits. A booklist is only as current as the last harvest, so a
 * course dropped in week three sits here until the next sweep sees it gone —
 * `/v1/people/:id/history` is where that movement is recorded. And a section
 * with no assigned book never appears at all: this is the schedule the
 * bookstore knows about, which is most of it and not all of it.
 */

import { currentTerm } from "../lib/terms";
import { type Located, locate } from "../store/campus";
import { sectionsByName } from "../store/catalog";
import { enrolmentOf } from "../store/harvest";
import { personById } from "../store/people";
import { creditsOf, DAY_NAMES, type Meeting, meetingsOf, meetsInPerson } from "./meetings";

export type { Meeting };

export interface ScheduledSection {
  name: string;
  code: string | null;
  title: string | null;
  faculty: string | null;
  sectionId: string;
  credits: number | null;
  meetings: Meeting[];
}

/** One section meeting on one day, which is what a timetable cell holds. */
export interface Block {
  start: string;
  end: string;
  minutes: number;
  section: string;
  title: string | null;
  kind: string | null;
  building: string | null;
  room: string | null;
}

export interface Day {
  day: number;
  label: string;
  minutes: number;
  blocks: Block[];
}

export interface Schedule {
  studentId: string;
  name: string | null;
  term: string;
  /** Every term a booklist has been harvested for, whichever one was asked for. */
  terms: string[];
  dorm: string | null;
  credits: number;
  /** Contact minutes in a full week, online sections excluded. */
  minutes: number;
  sections: ScheduledSection[];
  week: Day[];
  online: ScheduledSection[];
  /** Sections the booklist named and the catalog has never heard of. */
  unmatched: string[];
  harvestedAt: string | null;
}

export function scheduleFor(studentId: string, term?: string): Schedule | null {
  const harvested = enrolmentOf(studentId);
  if (!harvested.length) return null;

  const wanted =
    term ?? harvested.find((row) => row.term === currentTerm())?.term ?? harvested.at(-1)!.term;
  const held = harvested.find((row) => row.term === wanted);
  const person = personById(studentId);

  const rows = held ? sectionsByName(wanted, held.sections) : [];
  const found = new Set(rows.map((row) => (row.name ?? "").toUpperCase()));

  const scheduled: ScheduledSection[] = rows.map((row) => ({
    name: row.name ?? "",
    code: row.code,
    title: row.title,
    faculty: row.faculty,
    sectionId: row.sectionId,
    credits: creditsOf(row),
    meetings: meetingsOf(row),
  }));

  const week: Day[] = DAY_NAMES.map((label, day) => ({ day, label, minutes: 0, blocks: [] }));
  for (const section of scheduled) {
    for (const meeting of section.meetings) {
      if (!meeting.start || !meeting.end || meeting.online) continue;
      for (const day of meeting.days) {
        week[day]!.blocks.push({
          start: meeting.start,
          end: meeting.end,
          minutes: meeting.minutes,
          section: section.name,
          title: section.title,
          kind: meeting.kind,
          building: meeting.building,
          room: meeting.room,
        });
        week[day]!.minutes += meeting.minutes;
      }
    }
  }
  for (const day of week) day.blocks.sort((a, b) => a.start.localeCompare(b.start));

  return {
    studentId,
    name: person
      ? `${person.nickname ?? person.firstName ?? ""} ${person.lastName ?? ""}`.trim()
      : null,
    term: wanted,
    terms: harvested.map((row) => row.term),
    dorm: person?.dormName ?? null,
    credits: scheduled.reduce((total, section) => total + (section.credits ?? 0), 0),
    minutes: week.reduce((total, day) => total + day.minutes, 0),
    sections: scheduled.filter((section) => meetsInPerson(section.meetings)),
    week: week.filter((day) => day.blocks.length),
    online: scheduled.filter((section) => !meetsInPerson(section.meetings)),
    unmatched: (held?.sections ?? []).filter((name) => !found.has(name.toUpperCase())),
    harvestedAt: held?.fetchedAt ?? null,
  };
}

export interface LocationNow {
  studentId: string;
  at: string;
  /** "in class" when a scheduled block covers this instant, else "free" if there's a schedule to check against at all. */
  status: "in class" | "free" | "no schedule data";
  inClass: {
    section: string;
    title: string | null;
    building: string | null;
    room: string | null;
    /** "HH:MM", when this block lets out. */
    endsAt: string;
  } | null;
  /** Dorm or office -- always attempted, in class or not, as the fallback answer. */
  location: Located | null;
  /** How current the schedule this is based on is. Null with no booklist at all. */
  harvestedAt: string | null;
}

const clockMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

/**
 * "Where is this person right now" -- honestly. In class if the moment falls
 * inside a scheduled block, their dorm or office as the fallback either way,
 * and `harvestedAt` so a caller can see how stale the booklist this is built
 * from might be. A section a booklist never named, or one dropped since the
 * last harvest, simply will not show up here.
 */
export function locationNow(studentId: string, at: Date = new Date()): LocationNow {
  const schedule = scheduleFor(studentId);
  const day = at.getDay();
  const nowMinutes = at.getHours() * 60 + at.getMinutes();

  let inClass: LocationNow["inClass"] = null;
  const today = schedule?.week.find((d) => d.day === day);
  const block = today?.blocks.find(
    (b) => clockMinutes(b.start) <= nowMinutes && nowMinutes < clockMinutes(b.end),
  );
  if (block) {
    inClass = {
      section: block.section,
      title: block.title,
      building: block.building,
      room: block.room,
      endsAt: block.end,
    };
  }

  return {
    studentId,
    at: at.toISOString(),
    status: inClass ? "in class" : schedule ? "free" : "no schedule data",
    inClass,
    location: locate(studentId),
    harvestedAt: schedule?.harvestedAt ?? null,
  };
}
