import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import {
  availabilityFor,
  intersect,
  invert,
  mergeIntervals,
} from "../src/model/availability";
import { replaceTerm } from "../src/store/catalog";
import { ingestHarvest } from "../src/store/harvest";

const TERM = "2026FA";
const AT = "2026-08-29T00:00:00.000Z";

const meeting = (days: number[], start: string, end: string) => ({
  Days: days,
  DaysOfWeekDisplay: days.join("/"),
  StartTime: `${start}:00`,
  EndTime: `${end}:00`,
  BuildingDisplay: "Engineering and Science Ctr",
  RoomDisplay: "101",
  IsOnline: false,
});

/** `code` becomes DEPT-NUMBER; the section suffix is always -01 here. */
const section = (code: string, meetings: unknown[]) => ({
  Id: code,
  CourseId: code,
  CourseName: code,
  SectionNameDisplay: `${code}-01`,
  Title: "A Class",
  FacultyDisplay: "Dr. Someone",
  MinimumCredits: 3,
  Available: 0,
  Capacity: 30,
  Enrolled: 30,
  FormattedMeetingTimes: meetings,
});

/** A booklist naming sections, which is how the engine learns who is enrolled. */
const takes = (studentId: string, codes: string[]) => ({
  id: studentId,
  books: codes.map((code) => {
    const [department, course] = code.split("-");
    return { department, course, section: "01", title: `Book for ${code}` };
  }),
});

beforeEach(() => {
  useDatabase(":memory:");
  replaceTerm({
    term: TERM,
    fetchedAt: AT,
    courses: [],
    sections: [
      // Monday only, so a Sunday query is a clean "nothing scheduled" case.
      section("AAA-1000", [meeting([1], "08:00", "08:50")]),
      section("BBB-2000", [meeting([1], "15:00", "15:50")]),
      section("CCC-3000", [meeting([1], "11:00", "11:50")]),
    ],
  });
});

describe("interval maths", () => {
  test("merge collapses overlapping and touching spans", () => {
    expect(
      mergeIntervals([
        { start: 10, end: 20 },
        { start: 15, end: 30 },
      ]),
    ).toEqual([{ start: 10, end: 30 }]);
    expect(
      mergeIntervals([
        { start: 10, end: 20 },
        { start: 20, end: 30 },
      ]),
    ).toEqual([{ start: 10, end: 30 }]);
  });

  test("invert returns the gaps inside the range", () => {
    expect(invert([{ start: 100, end: 200 }], 0, 300)).toEqual([
      { start: 0, end: 100 },
      { start: 200, end: 300 },
    ]);
  });

  test("invert with nothing busy is the whole range", () => {
    expect(invert([], 480, 1320)).toEqual([{ start: 480, end: 1320 }]);
  });

  test("intersect keeps only shared spans", () => {
    expect(intersect([{ start: 0, end: 100 }], [{ start: 50, end: 150 }])).toEqual([
      { start: 50, end: 100 },
    ]);
    expect(intersect([{ start: 0, end: 40 }], [{ start: 60, end: 100 }])).toEqual([]);
  });
});

describe("availabilityFor", () => {
  test("a person with no booklist is unknown, not free", () => {
    ingestHarvest(TERM, [takes("student-a", ["AAA-1000"])], AT);

    const result = availabilityFor(["student-a", "ghost"], 1, "08:00", "22:00", 30, TERM);

    expect(result.known.map((k) => k.id)).toEqual(["student-a"]);
    expect(result.unknown).toEqual(["ghost"]);
  });

  test("an unknown person does not widen anyone else's windows", () => {
    ingestHarvest(TERM, [takes("student-a", ["AAA-1000", "BBB-2000"])], AT);

    const alone = availabilityFor(["student-a"], 1, "08:00", "22:00", 30, TERM);
    const withGhost = availabilityFor(["student-a", "ghost"], 1, "08:00", "22:00", 30, TERM);

    expect(withGhost.windows).toEqual(alone.windows);
  });

  test("two schedules intersect to the gap they share", () => {
    ingestHarvest(
      TERM,
      [takes("student-a", ["AAA-1000", "BBB-2000"]), takes("student-b", ["CCC-3000"])],
      AT,
    );

    const result = availabilityFor(["student-a", "student-b"], 1, "08:00", "22:00", 30, TERM);
    const spans = result.windows.map((w) => `${w.start}-${w.end}`);

    // A is busy 08:00-08:50 and 15:00-15:50; B is busy 11:00-11:50.
    expect(spans).toContain("11:50-15:00");
    expect(spans).toContain("08:50-11:00");
    expect(spans).not.toContain("08:00-08:50");
  });

  test("a window names whose class closes it", () => {
    ingestHarvest(
      TERM,
      [takes("student-a", ["BBB-2000"]), takes("student-b", ["CCC-3000"])],
      AT,
    );

    const result = availabilityFor(["student-a", "student-b"], 1, "08:00", "22:00", 30, TERM);
    const closed = result.windows.find((w) => w.end === "15:00");

    expect(closed?.endsBecause.map((c) => c.section)).toEqual(["BBB-2000-01"]);
  });

  test("minMinutes drops short gaps", () => {
    ingestHarvest(TERM, [takes("student-a", ["AAA-1000", "CCC-3000"])], AT);

    const loose = availabilityFor(["student-a"], 1, "08:00", "22:00", 30, TERM);
    const strict = availabilityFor(["student-a"], 1, "08:00", "22:00", 240, TERM);

    expect(strict.windows.length).toBeLessThan(loose.windows.length);
    expect(strict.windows.every((w) => w.minutes >= 240)).toBe(true);
  });

  test("a day with nothing scheduled is free end to end", () => {
    ingestHarvest(TERM, [takes("student-a", ["AAA-1000"])], AT);

    const sunday = availabilityFor(["student-a"], 0, "08:00", "22:00", 30, TERM);

    expect(sunday.windows).toEqual([
      { start: "08:00", end: "22:00", minutes: 840, endsBecause: [] },
    ]);
  });
});
