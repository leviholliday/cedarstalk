import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { rebuildOccupancy } from "../src/model/occupancy";
import { presenceAt } from "../src/model/presence";
import { replaceTerm } from "../src/store/catalog";
import { ingestHarvest } from "../src/store/harvest";

const TERM = "2026FA";
const AT = "2026-08-29T00:00:00.000Z";

const meeting = (days: number[], start: string, end: string, building: string, room: string) => ({
  Days: days,
  DaysOfWeekDisplay: days.join("/"),
  StartTime: `${start}:00`,
  EndTime: `${end}:00`,
  BuildingDisplay: building,
  RoomDisplay: room,
  IsOnline: false,
});

const section = (code: string, meetings: unknown[], enrolled: number) => ({
  Id: code,
  CourseId: code,
  CourseName: code,
  SectionNameDisplay: `${code}-01`,
  Title: `${code} Class`,
  FacultyDisplay: "Dr. Someone",
  MinimumCredits: 3,
  Available: 0,
  Capacity: enrolled,
  Enrolled: enrolled,
  FormattedMeetingTimes: meetings,
});

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
      // Monday 11:00-11:50 in Dixon 101 -- the one meeting at the query minute.
      section("AAA-1000", [meeting([1], "11:00", "11:50", "Dixon", "101")], 20),
      // Same building, but later in the day.
      section("BBB-2000", [meeting([1], "15:00", "15:50", "Dixon", "102")], 10),
      // Same minute, different building entirely.
      section("CCC-3000", [meeting([1], "11:00", "11:50", "Milner", "200")], 5),
    ],
  });
  rebuildOccupancy(TERM);
});

describe("presenceAt", () => {
  test("lists only what is meeting in that building at that minute", () => {
    const at = presenceAt(TERM, "Dixon", 1, 11 * 60 + 20);

    expect(at.sections.map((s) => s.name)).toEqual(["AAA-1000-01"]);
    expect(at.sections[0]?.room).toBe("101");
    expect(at.sections[0]?.start).toBe("11:00");
    expect(at.sections[0]?.end).toBe("11:50");
  });

  test("a building with nothing scheduled is empty rather than an error", () => {
    const at = presenceAt(TERM, "Dixon", 1, 3 * 60);

    expect(at.sections).toEqual([]);
    expect(at.people).toBe(0);
    expect(at.enrolled).toBe(0);
  });

  test("names the students the booklists put in the room", () => {
    ingestHarvest(
      TERM,
      [takes("1", ["AAA-1000"]), takes("2", ["AAA-1000"]), takes("3", ["CCC-3000"])],
      AT,
    );

    const at = presenceAt(TERM, "Dixon", 1, 11 * 60 + 20);

    expect(at.sections[0]?.students.map((s) => s.id).sort()).toEqual(["1", "2"]);
    expect(at.people).toBe(2);
  });

  test("somebody in two sections in the same room-hour counts once", () => {
    // A student whose booklist names both sections meeting at 11:00. Only one
    // of them is in Dixon, but the count must not double up if both were.
    replaceTerm({
      term: TERM,
      fetchedAt: AT,
      courses: [],
      sections: [
        section("AAA-1000", [meeting([1], "11:00", "11:50", "Dixon", "101")], 20),
        section("DDD-4000", [meeting([1], "11:00", "11:50", "Dixon", "105")], 20),
      ],
    });
    rebuildOccupancy(TERM);
    ingestHarvest(TERM, [takes("1", ["AAA-1000", "DDD-4000"])], AT);

    const at = presenceAt(TERM, "Dixon", 1, 11 * 60 + 20);

    expect(at.sections.length).toBe(2);
    expect(at.people).toBe(1);
  });

  test("a section with no harvested roster still appears, with its real headcount", () => {
    const at = presenceAt(TERM, "Dixon", 1, 11 * 60 + 20);

    expect(at.sections[0]?.students).toEqual([]);
    expect(at.sections[0]?.enrolled).toBe(20);
    // Dropping it would quietly understate how busy the building is.
    expect(at.enrolled).toBe(20);
  });

  test("the end minute is exclusive, so a class that just finished is gone", () => {
    expect(presenceAt(TERM, "Dixon", 1, 11 * 60 + 49).sections.length).toBe(1);
    expect(presenceAt(TERM, "Dixon", 1, 11 * 60 + 50).sections.length).toBe(0);
  });
});
