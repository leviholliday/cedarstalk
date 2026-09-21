import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { crossingsFor } from "../src/model/crossings";
import { replaceCampus } from "../src/store/campus";
import { replaceTerm } from "../src/store/catalog";
import { ingestHarvest } from "../src/store/harvest";

const TERM = "2026FA";
const AT = "2026-08-29T00:00:00.000Z";

const A = "Building A";
const B = "Building B";
const C = "Building C";
const D = "Building D";
const E = "Building E";
const G = "Building G";
const UNMAPPED = "Xenia Partner School; Obsolete";

const meeting = (days: number[], start: string, end: string, building: string, room = "101") => ({
  Days: days,
  DaysOfWeekDisplay: days.join("/"),
  StartTime: `${start}:00`,
  EndTime: `${end}:00`,
  BuildingDisplay: building,
  RoomDisplay: room,
  IsOnline: false,
});

const section = (code: string, suffix: string, meetings: unknown[]) => ({
  Id: `${code}-${suffix}`,
  CourseId: code,
  CourseName: code,
  SectionNameDisplay: `${code}-${suffix}`,
  Title: `${code} Class`,
  FacultyDisplay: "Dr. Someone",
  MinimumCredits: 3,
  Available: 5,
  Capacity: 30,
  Enrolled: 25,
  FormattedMeetingTimes: meetings,
});

const takes = (studentId: string, names: string[]) => ({
  id: studentId,
  books: names.map((name) => {
    const [department, course, sec] = name.split("-");
    return { department, course, section: sec, title: `Book for ${name}` };
  }),
});

/**
 * A junction shape: A and B sit on opposite ends of node 1 from each other,
 * and so do C and D -- so A->B and C->D route through the exact same node
 * without being the same walk at all. A building is placed at node 1 itself,
 * so `near` has something real to resolve to. E and G sit past B on a branch
 * of their own -- walking E->G never touches node 1 or node 2, which is what
 * makes it a genuine "no shared node" case rather than one that merely
 * shares an endpoint with A->B.
 *
 *      A(0) --- 1(Junction Hall) --- B(2) --- E(5) --- G(6)
 *                |         |
 *               C(3)      D(4)
 */
function placeCampus() {
  replaceCampus({
    origin: { lat: 39.75, lon: -83.81 },
    box: [0, 0, 2000, 2000],
    buildings: [],
    nodes: [
      [0, 0], // 0 A
      [300, 0], // 1 Junction Hall
      [600, 0], // 2 B
      [300, 300], // 3 C
      [300, -300], // 4 D
      [900, 0], // 5
      [1200, 0], // 6 G
    ],
    edges: [
      [0, 1, 300],
      [1, 2, 300],
      [1, 3, 300],
      [1, 4, 300],
      [2, 5, 300],
      [5, 6, 300],
    ],
    anchors: {
      [A]: anchor(A, 0, [0, 0]),
      "Junction Hall": anchor("Junction Hall", 1, [300, 0]),
      [B]: anchor(B, 2, [600, 0]),
      [C]: anchor(C, 3, [300, 300]),
      [D]: anchor(D, 4, [300, -300]),
      [E]: anchor(E, 5, [900, 0]),
      [G]: anchor(G, 6, [1200, 0]),
    },
    missing: [],
  });
}

function anchor(name: string, node: number, centre: [number, number]) {
  return {
    node,
    name,
    kind: "academic",
    gender: null,
    source: "osm" as const,
    centre,
    lat: 39.75,
    lon: -83.81,
    ring: [],
  };
}

beforeEach(() => {
  useDatabase(":memory:");
});

describe("crossingsFor", () => {
  test("overlapping walks through the same node are a crossing", () => {
    placeCampus();
    replaceTerm({
      term: TERM,
      fetchedAt: AT,
      courses: [],
      sections: [
        section("AAA-1000", "01", [meeting([1], "08:00", "08:50", A)]),
        section("BBB-2000", "01", [meeting([1], "09:10", "10:00", B)]),
        section("CCC-3000", "01", [meeting([1], "08:00", "08:55", C)]),
        section("DDD-4000", "01", [meeting([1], "09:15", "10:00", D)]),
      ],
    });
    ingestHarvest(
      TERM,
      [
        takes("s1", ["AAA-1000-01", "BBB-2000-01"]), // walks A -> B, 08:50-09:10
        takes("s2", ["CCC-3000-01", "DDD-4000-01"]), // walks C -> D, 08:55-09:15
      ],
      AT,
    );

    const result = crossingsFor("s1", "s2", TERM);
    expect(result.known).toBe(true);
    expect(result.crossings.length).toBe(1);

    const crossing = result.crossings[0]!;
    expect(crossing.day).toBe(1);
    expect(crossing.overlapStart).toBe("08:55");
    expect(crossing.overlapEnd).toBe("09:10");
    expect(crossing.overlapMinutes).toBe(15);
    expect(crossing.a).toEqual({ from: A, to: B, windowStart: "08:50", windowEnd: "09:10" });
    expect(crossing.b).toEqual({ from: C, to: D, windowStart: "08:55", windowEnd: "09:15" });
    expect(crossing.near).toBe("Junction Hall");
    expect(crossing.sharedNodes).toBe(1);
  });

  test("routes that share no node are not a crossing, even at the exact same time", () => {
    placeCampus();
    replaceTerm({
      term: TERM,
      fetchedAt: AT,
      courses: [],
      sections: [
        section("AAA-1000", "01", [meeting([1], "08:00", "08:50", A)]),
        section("BBB-2000", "01", [meeting([1], "09:10", "10:00", B)]),
        // E -> G is [5, 6] -- past B on the graph, but never through it.
        section("EEE-5000", "01", [meeting([1], "08:00", "08:50", E)]),
        section("GGG-6000", "01", [meeting([1], "09:10", "10:00", G)]),
      ],
    });
    ingestHarvest(
      TERM,
      [
        takes("s1", ["AAA-1000-01", "BBB-2000-01"]), // A -> B, [0,1,2]
        takes("s2", ["EEE-5000-01", "GGG-6000-01"]), // E -> G, [5,6] -- identical window, no shared node
      ],
      AT,
    );

    const result = crossingsFor("s1", "s2", TERM);
    expect(result.crossings).toEqual([]);
  });

  test("the same route at non-overlapping times is not a crossing", () => {
    placeCampus();
    replaceTerm({
      term: TERM,
      fetchedAt: AT,
      courses: [],
      sections: [
        section("AAA-1000", "01", [meeting([1], "08:00", "08:50", A)]),
        section("BBB-2000", "01", [meeting([1], "09:10", "10:00", B)]),
        section("CCC-3000", "01", [meeting([1], "13:00", "13:50", C)]),
        section("DDD-4000", "01", [meeting([1], "14:10", "15:00", D)]),
      ],
    });
    ingestHarvest(
      TERM,
      [
        takes("s1", ["AAA-1000-01", "BBB-2000-01"]), // 08:50-09:10
        takes("s2", ["CCC-3000-01", "DDD-4000-01"]), // 13:50-14:10 -- same shape, different clock
      ],
      AT,
    );

    const result = crossingsFor("s1", "s2", TERM);
    expect(result.crossings).toEqual([]);
  });

  test("an unroutable building is skipped, not guessed at", () => {
    placeCampus();
    replaceTerm({
      term: TERM,
      fetchedAt: AT,
      courses: [],
      sections: [
        section("AAA-1000", "01", [meeting([1], "08:00", "08:50", A)]),
        section("BBB-2000", "01", [meeting([1], "09:10", "10:00", B)]),
        section("CCC-3000", "01", [meeting([1], "08:00", "08:55", UNMAPPED)]),
        section("DDD-4000", "01", [meeting([1], "09:15", "10:00", D)]),
      ],
    });
    ingestHarvest(
      TERM,
      [
        takes("s1", ["AAA-1000-01", "BBB-2000-01"]),
        takes("s2", ["CCC-3000-01", "DDD-4000-01"]), // one leg cannot be routed
      ],
      AT,
    );

    const result = crossingsFor("s1", "s2", TERM);
    expect(result.crossings).toEqual([]);
  });

  test("someone with no harvested booklist is unknown, not zero crossings", () => {
    placeCampus();
    replaceTerm({
      term: TERM,
      fetchedAt: AT,
      courses: [],
      sections: [section("AAA-1000", "01", [meeting([1], "08:00", "08:50", A)])],
    });
    ingestHarvest(TERM, [takes("s1", ["AAA-1000-01"])], AT);

    const result = crossingsFor("s1", "ghost", TERM);
    expect(result.known).toBe(false);
    expect(result.crossings).toEqual([]);
  });

  test("crossings on different days are both reported, in order", () => {
    placeCampus();
    replaceTerm({
      term: TERM,
      fetchedAt: AT,
      courses: [],
      sections: [
        section("AAA-1000", "01", [meeting([1, 3], "08:00", "08:50", A)]),
        section("BBB-2000", "01", [meeting([1, 3], "09:10", "10:00", B)]),
        section("CCC-3000", "01", [meeting([1, 3], "08:00", "08:55", C)]),
        section("DDD-4000", "01", [meeting([1, 3], "09:15", "10:00", D)]),
      ],
    });
    ingestHarvest(
      TERM,
      [
        takes("s1", ["AAA-1000-01", "BBB-2000-01"]),
        takes("s2", ["CCC-3000-01", "DDD-4000-01"]),
      ],
      AT,
    );

    const result = crossingsFor("s1", "s2", TERM);
    expect(result.crossings.map((c) => c.day)).toEqual([1, 3]);
  });
});
