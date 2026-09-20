import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { pressureLeaderboard, sectionPressure } from "../src/model/pressure";
import { replaceTerm } from "../src/store/catalog";

const section = (id: string, available: number, capacity: number, enrolled: number) => ({
  Id: id,
  CourseId: "BIO-2500",
  CourseName: "BIO-2500",
  SectionNameDisplay: `BIO-2500-${id}`,
  Title: "General Botany",
  FacultyDisplay: "Dr. Paris",
  MinimumCredits: 4,
  Available: available,
  Capacity: capacity,
  Enrolled: enrolled,
  FormattedMeetingTimes: [],
});

beforeEach(() => {
  useDatabase(":memory:");
});

describe("sectionPressure", () => {
  test("one snapshot has a curve but no velocity to report", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T00:00:00.000Z",
      courses: [],
      sections: [section("01", 20, 20, 0)],
    });

    const pressure = sectionPressure("2026FA", "01")!;
    expect(pressure.points).toHaveLength(1);
    expect(pressure.fillPerHour).toBeNull();
    expect(pressure.minutesToFull).toBeNull();
    expect(pressure.full).toBe(false);
  });

  test("fillPerHour is seats lost per hour between first and last snapshot", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T00:00:00.000Z",
      courses: [],
      sections: [section("01", 20, 20, 0)],
    });
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T02:00:00.000Z", // 2 hours later
      courses: [],
      sections: [section("01", 10, 20, 10)], // 10 seats filled in 2 hours
    });

    const pressure = sectionPressure("2026FA", "01")!;
    expect(pressure.fillPerHour).toBe(5);
    expect(pressure.full).toBe(false);
  });

  test("minutesToFull is measured from the first snapshot to the first one seen full", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T00:00:00.000Z",
      courses: [],
      sections: [section("01", 5, 20, 15)],
    });
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T00:30:00.000Z", // 30 minutes later, now full
      courses: [],
      sections: [section("01", 0, 20, 20)],
    });
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T01:00:00.000Z", // still full an hour in -- shouldn't move the number
      courses: [],
      sections: [section("01", 0, 20, 20)],
    });

    const pressure = sectionPressure("2026FA", "01")!;
    expect(pressure.minutesToFull).toBe(30);
    expect(pressure.full).toBe(true);
  });

  test("a section that never fills has a null minutesToFull, not a lie", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T00:00:00.000Z",
      courses: [],
      sections: [section("01", 20, 20, 0)],
    });
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T02:00:00.000Z",
      courses: [],
      sections: [section("01", 19, 20, 1)],
    });

    expect(sectionPressure("2026FA", "01")!.minutesToFull).toBeNull();
  });

  test("no snapshots at all is null, not an empty object", () => {
    expect(sectionPressure("2026FA", "nonexistent")).toBeNull();
  });
});

describe("pressureLeaderboard", () => {
  test("a section with only one snapshot is excluded -- it has no velocity", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T00:00:00.000Z",
      courses: [],
      sections: [section("01", 20, 20, 0), section("02", 10, 10, 0)],
    });
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T01:00:00.000Z",
      courses: [],
      // Only section 01 got a second collect.
      sections: [section("01", 15, 20, 5)],
    });

    const board = pressureLeaderboard("2026FA");
    expect(board.map((s) => s.sectionId)).toEqual(["01"]);
  });

  test("fastest-filling sorts first", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T00:00:00.000Z",
      courses: [],
      sections: [section("SLOW", 20, 20, 0), section("FAST", 20, 20, 0)],
    });
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T01:00:00.000Z",
      courses: [],
      sections: [section("SLOW", 19, 20, 1), section("FAST", 5, 20, 15)],
    });

    const board = pressureLeaderboard("2026FA");
    expect(board.map((s) => s.sectionId)).toEqual(["FAST", "SLOW"]);
  });
});
