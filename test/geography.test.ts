import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { geographyLeaderboard, scheduleGeography } from "../src/model/geography";
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

const section = (name: string, meetings: unknown[]) => ({
  Id: name,
  CourseId: name.split("-").slice(0, 2).join("-"),
  CourseName: name.split("-").slice(0, 2).join("-"),
  SectionNameDisplay: name,
  Title: "A Class",
  FacultyDisplay: "Dr. Someone",
  MinimumCredits: 3,
  Available: 1,
  Capacity: 20,
  FormattedMeetingTimes: meetings,
});

/** Two buildings, 500 metres apart on a single edge -- a predictable walk. */
function placeTwoBuildings() {
  replaceCampus({
    origin: { lat: 39.75, lon: -83.81 },
    box: [0, 0, 1000, 1000],
    buildings: [],
    nodes: [
      [0, 0],
      [500, 0],
    ],
    edges: [[0, 1, 500]],
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
        centre: [500, 0],
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
  upsertPeople([{ Id: "1", FirstName: "Ada", LastName: "Lovelace", StudentClass: "FR" }], AT);
});

describe("scheduleGeography", () => {
  test("consecutive classes in different buildings, with a comfortable gap, are possible", () => {
    placeTwoBuildings();
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [
        section("BIO-1000-01", [meeting([1], "09:00", "09:50", "Building A", "100")]),
        // 500m at 1.35 m/s is ~6.2 minutes; a 30-minute gap comfortably covers it.
        section("CHEM-1000-01", [meeting([1], "10:20", "11:10", "Building B", "200")]),
      ],
    });
    ingestHarvest(
      "2026FA",
      [{ id: "1", books: [book("BIO", "1000", "01"), book("CHEM", "1000", "01")] }],
      AT,
    );

    const geography = scheduleGeography("1")!;
    expect(geography.weeklyMetres).toBe(500);
    expect(geography.impossibleTransitions).toEqual([]);
    expect(geography.worstTransition).toMatchObject({ from: "Building A", to: "Building B" });
  });

  test("too short a gap for the real walking distance is flagged impossible", () => {
    placeTwoBuildings();
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [
        section("BIO-1000-01", [meeting([1], "09:00", "09:50", "Building A", "100")]),
        // Only 5 minutes to cover a ~6.2-minute walk.
        section("CHEM-1000-01", [meeting([1], "09:55", "10:45", "Building B", "200")]),
      ],
    });
    ingestHarvest(
      "2026FA",
      [{ id: "1", books: [book("BIO", "1000", "01"), book("CHEM", "1000", "01")] }],
      AT,
    );

    const geography = scheduleGeography("1")!;
    expect(geography.impossibleTransitions).toHaveLength(1);
    expect(geography.impossibleTransitions[0]).toMatchObject({ possible: false, gapMinutes: 5 });
  });

  test("back-to-back classes in the same building need no walk at all", () => {
    placeTwoBuildings();
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [
        section("BIO-1000-01", [meeting([1], "09:00", "09:50", "Building A", "100")]),
        section("BIO-2000-01", [meeting([1], "09:50", "10:40", "Building A", "101")]),
      ],
    });
    ingestHarvest(
      "2026FA",
      [{ id: "1", books: [book("BIO", "1000", "01"), book("BIO", "2000", "01")] }],
      AT,
    );

    const geography = scheduleGeography("1")!;
    expect(geography.weeklyMetres).toBe(0);
    expect(geography.days.every((d) => d.transitions.length === 0)).toBe(true);
  });

  test("a building with no campus coordinates leaves the transition unroutable, not wrong", () => {
    // No campus data collected at all this time.
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [
        section("BIO-1000-01", [meeting([1], "09:00", "09:50", "Nowhere Hall", "100")]),
        section("CHEM-1000-01", [meeting([1], "10:00", "10:50", "Elsewhere Hall", "200")]),
      ],
    });
    ingestHarvest(
      "2026FA",
      [{ id: "1", books: [book("BIO", "1000", "01"), book("CHEM", "1000", "01")] }],
      AT,
    );

    const geography = scheduleGeography("1")!;
    expect(geography.weeklyMetres).toBe(0);
    const [transition] = geography.days.flatMap((d) => d.transitions);
    expect(transition).toMatchObject({ walkMetres: null, possible: null });
  });

  test("nobody with a booklist has no geography to score", () => {
    expect(scheduleGeography("1")).toBeNull();
  });
});

describe("geographyLeaderboard", () => {
  test("scored counts only students whose schedule actually produced a transition", () => {
    placeTwoBuildings();
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [
        section("BIO-1000-01", [meeting([1], "09:00", "09:50", "Building A", "100")]),
        section("CHEM-1000-01", [meeting([1], "10:20", "11:10", "Building B", "200")]),
      ],
    });
    upsertPeople([{ Id: "2", FirstName: "Alan", LastName: "Turing", StudentClass: "SR" }], AT);
    // Person 1 has two sections in different buildings; person 2's booklist
    // resolves to nothing the catalog recognizes, so they score nothing.
    ingestHarvest(
      "2026FA",
      [
        { id: "1", books: [book("BIO", "1000", "01"), book("CHEM", "1000", "01")] },
        { id: "2", books: [book("ZZZ", "9999", "01")] },
      ],
      AT,
    );

    const board = geographyLeaderboard("class");
    expect(board.scored).toBe(1);
    expect(board.rows[0]!.studentId).toBe("1");
    expect(board.rows[0]!.bucket).toBe("FR");
  });

  test("byBucket averages weekly metres per class", () => {
    placeTwoBuildings();
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

    const board = geographyLeaderboard("class");
    expect(board.byBucket).toEqual([{ bucket: "FR", students: 1, meanWeeklyMetres: 500 }]);
  });
});
