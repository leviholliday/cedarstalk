import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { campusTrafficAt, campusTrafficDay } from "../src/model/traffic";
import { replaceCampus } from "../src/store/campus";
import { replaceTerm } from "../src/store/catalog";
import { ingestHarvest } from "../src/store/harvest";
import { upsertPeople } from "../src/store/people";

const AT = "2026-08-29T00:00:00.000Z";

const book = (department: string, course: string, section: string) => ({
  department,
  course,
  section,
  title: "Some Textbook",
});

const meeting = (days: number[], start: string, end: string, building: string, room: string) => ({
  Days: days,
  DaysOfWeekDisplay: days.join("/"),
  StartTime: `${start}:00`,
  EndTime: `${end}:00`,
  BuildingDisplay: building,
  RoomDisplay: room,
  IsOnline: false,
});

const section = (name: string, meetings: unknown[], enrolled = 20) => ({
  Id: name,
  CourseId: name.split("-").slice(0, 2).join("-"),
  CourseName: name.split("-").slice(0, 2).join("-"),
  SectionNameDisplay: name,
  Title: "A Class",
  FacultyDisplay: "Dr. Someone",
  MinimumCredits: 3,
  Available: 1,
  Capacity: enrolled,
  Enrolled: enrolled,
  FormattedMeetingTimes: meetings,
});

/** Two buildings, 405m (~5-minute walk) apart on a single edge. */
function placeCampus() {
  replaceCampus({
    origin: { lat: 39.75, lon: -83.81 },
    box: [0, 0, 1000, 1000],
    buildings: [],
    nodes: [
      [0, 0],
      [405, 0],
    ],
    edges: [[0, 1, 405]],
    anchors: {
      "Building A": {
        node: 0,
        name: "Building A",
        kind: "academic",
        gender: null,
        source: "osm",
        centre: [0, 0],
        lat: 39.75,
        lon: -83.81,
        ring: [],
      },
      "Building B": {
        node: 1,
        name: "Building B",
        kind: "academic",
        gender: null,
        source: "osm",
        centre: [405, 0],
        lat: 39.751,
        lon: -83.81,
        ring: [],
      },
    },
    missing: [],
  });
}

beforeEach(() => {
  useDatabase(":memory:");
  upsertPeople(
    [
      { Id: "1", FirstName: "Ada", LastName: "Lovelace" },
      { Id: "2", FirstName: "Grace", LastName: "Hopper" },
    ],
    AT,
  );
});

describe("campusTrafficAt", () => {
  test("a student mid-walk between two classes counts at that instant", () => {
    placeCampus();
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [
        section("BIO-1000-01", [meeting([1], "09:00", "09:50", "Building A", "100")]),
        section("CHEM-1000-01", [meeting([1], "10:20", "11:10", "Building B", "200")]),
      ],
    });
    ingestHarvest(
      "2026FA",
      [{ id: "1", books: [book("BIO", "1000", "01"), book("CHEM", "1000", "01")] }],
      AT,
    );

    // Class ends 09:50 (590 min); ~5-minute walk means they're on the path until ~595.
    const midWalk = campusTrafficAt("2026FA", 1, 592);
    expect(midWalk.observed).toBe(1);
    expect(midWalk.buckets.length).toBeGreaterThan(0);

    const beforeItStarts = campusTrafficAt("2026FA", 1, 500);
    expect(beforeItStarts.observed).toBe(0);
    expect(beforeItStarts.buckets).toEqual([]);

    const afterItEnds = campusTrafficAt("2026FA", 1, 700);
    expect(afterItEnds.observed).toBe(0);
  });

  test("a section only 50% covered by booklists doubles the estimated flow", () => {
    placeCampus();
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [
        // Enrolled: 20, but only one student's booklist will name it -- 5% coverage,
        // simpler to reason about than 50% with this Enrolled figure. Use Enrolled: 2 for clean 50%.
        section("BIO-1000-01", [meeting([1], "09:00", "09:50", "Building A", "100")], 2),
        section("CHEM-1000-01", [meeting([1], "10:20", "11:10", "Building B", "200")], 2),
      ],
    });
    ingestHarvest(
      "2026FA",
      [{ id: "1", books: [book("BIO", "1000", "01"), book("CHEM", "1000", "01")] }],
      AT,
    );

    // 1 of 2 enrolled known -> 50% coverage -> each observed walk counts as 2.
    const traffic = campusTrafficAt("2026FA", 1, 592);
    expect(traffic.observed).toBe(1);
    expect(traffic.estimated).toBe(2);
  });

  test("a day the schedule never meets shows nothing", () => {
    placeCampus();
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [
        section("BIO-1000-01", [meeting([1], "09:00", "09:50", "Building A", "100")]),
        section("CHEM-1000-01", [meeting([1], "10:20", "11:10", "Building B", "200")]),
      ],
    });
    ingestHarvest(
      "2026FA",
      [{ id: "1", books: [book("BIO", "1000", "01"), book("CHEM", "1000", "01")] }],
      AT,
    );

    expect(campusTrafficAt("2026FA", 3, 592).observed).toBe(0);
  });

  test("no campus map throws, same as the whole-term campusTraffic", () => {
    expect(() => campusTrafficAt("2026FA", 1, 592)).toThrow();
  });
});

describe("campusTrafficDay", () => {
  /** Two students, two different walks, at two different times of day. */
  function twoWalksAtDifferentTimes() {
    placeCampus();
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [
        section("BIO-1000-01", [meeting([1], "09:00", "09:50", "Building A", "100")]),
        section("CHEM-1000-01", [meeting([1], "10:20", "11:10", "Building B", "200")]),
        section("PHYS-1000-01", [meeting([1], "13:00", "13:50", "Building A", "101")]),
        section("MATH-1000-01", [meeting([1], "14:20", "15:10", "Building B", "201")]),
      ],
    });
    ingestHarvest(
      "2026FA",
      [
        { id: "1", books: [book("BIO", "1000", "01"), book("CHEM", "1000", "01")] },
        { id: "2", books: [book("PHYS", "1000", "01"), book("MATH", "1000", "01")] },
      ],
      AT,
    );
  }

  test("a whole day's frames agree with asking each instant separately", () => {
    twoWalksAtDifferentTimes();

    const day = campusTrafficDay("2026FA", 1, 10);
    for (const frame of day.frames) {
      const instant = campusTrafficAt("2026FA", 1, frame.minute);
      expect(frame.observed).toBe(instant.observed);
      expect(frame.estimated).toBe(instant.estimated);
    }
  });

  test("each walk shows up in its own frame, not the other's", () => {
    twoWalksAtDifferentTimes();

    const day = campusTrafficDay("2026FA", 1, 10);
    const morning = day.frames.find((f) => f.minute === 590)!; // 09:50, walk one
    const afternoon = day.frames.find((f) => f.minute === 830)!; // 13:50, walk two

    expect(morning.observed).toBe(1);
    expect(afternoon.observed).toBe(1);
    // Nothing is walking in between.
    const midday = day.frames.find((f) => f.minute === 700);
    expect(midday?.observed ?? 0).toBe(0);
  });

  test("every frame is banded against the day's peak, not its own", () => {
    placeCampus();
    // Enrolled is set to exactly the number of students whose booklist names
    // each section, so coverage is 1.0 throughout and every walk weighs the
    // same -- otherwise the coverage scaling cancels the difference out (one
    // walk from a 5%-covered section estimates the same flow as two from a
    // 10%-covered one, which is the model working, not a bug).
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [
        section("BIO-1000-01", [meeting([1], "09:00", "09:50", "Building A", "100")], 2),
        section("CHEM-1000-01", [meeting([1], "10:20", "11:10", "Building B", "200")], 2),
        section("PHYS-1000-01", [meeting([1], "13:00", "13:50", "Building A", "101")], 1),
        section("MATH-1000-01", [meeting([1], "14:20", "15:10", "Building B", "201")], 1),
      ],
    });
    upsertPeople([{ Id: "3", FirstName: "Third", LastName: "Student" }], AT);
    ingestHarvest(
      "2026FA",
      [
        { id: "1", books: [book("BIO", "1000", "01"), book("CHEM", "1000", "01")] },
        { id: "2", books: [book("BIO", "1000", "01"), book("CHEM", "1000", "01")] },
        { id: "3", books: [book("PHYS", "1000", "01"), book("MATH", "1000", "01")] },
      ],
      AT,
    );

    const day = campusTrafficDay("2026FA", 1, 10);
    const busy = day.frames.find((f) => f.minute === 590)!; // two walkers
    const quiet = day.frames.find((f) => f.minute === 830)!; // one walker

    expect(busy.observed).toBe(2);
    expect(quiet.observed).toBe(1);
    expect(busy.estimated).toBe(2);
    expect(quiet.estimated).toBe(1);
    // Self-normalising would put both in the top band and make the quiet
    // moment look exactly as busy as the crush.
    const topBand = (frame: { buckets: { level: number }[] }) =>
      Math.max(...frame.buckets.map((b) => b.level));
    expect(topBand(busy)).toBeGreaterThan(topBand(quiet));
  });

  test("a day nobody walks is an empty frame list, not an error", () => {
    placeCampus();
    replaceTerm({ term: "2026FA", fetchedAt: AT, courses: [], sections: [] });
    const day = campusTrafficDay("2026FA", 3, 10);
    expect(day.frames).toEqual([]);
    expect(day.peak).toBe(1);
  });
});
