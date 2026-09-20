import { beforeEach, describe, expect, test } from "bun:test";
import { db, useDatabase } from "../src/db";
import { rebuildOccupancy } from "../src/model/occupancy";
import { buildingRhythm, quietRoomsAt } from "../src/model/quiet";
import { replaceTerm } from "../src/store/catalog";

const meeting = (days: number[], start: string, end: string, building: string, room: string) => ({
  Days: days,
  DaysOfWeekDisplay: days.join("/"),
  StartTime: `${start}:00`,
  EndTime: `${end}:00`,
  BuildingDisplay: building,
  RoomDisplay: room,
  IsOnline: false,
});

const section = (id: string, meetings: unknown[], enrolled: number) => ({
  Id: id,
  CourseId: `COURSE-${id}`,
  CourseName: `COURSE-${id}`,
  SectionNameDisplay: `COURSE-${id}-01`,
  Title: "A Class",
  FacultyDisplay: "Dr. Someone",
  MinimumCredits: 3,
  Available: 0,
  Capacity: enrolled,
  Enrolled: enrolled,
  FormattedMeetingTimes: meetings,
});

/** A minimal buildings row, inserted directly -- replaceCampus needs a whole traced map for one row. */
function placeBuilding(label: string, node: number) {
  db()
    .query(
      `INSERT INTO buildings (label, kind, lat, lon, x, y, node, source, fetched_at)
       VALUES (?, 'academic', 39.75, -83.81, 0, 0, ?, 'osm', ?)`,
    )
    .run(label, node, new Date().toISOString());
}

beforeEach(() => {
  useDatabase(":memory:");
});

describe("quietRoomsAt", () => {
  test("a room in a building with no other class right now is quieter than one that's busy elsewhere", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        // Quiet building: nothing else meeting there at 10am.
        section("A", [meeting([3], "08:00", "08:50", "Quiet Hall", "100")], 20),
        // Loud building: room 210 is free at 10am, but room 200 in the same
        // building is packed with 300 people right then.
        section("B", [meeting([3], "09:00", "09:50", "Loud Hall", "210")], 15),
        section("C", [meeting([3], "10:00", "10:50", "Loud Hall", "200")], 300),
      ],
    });
    rebuildOccupancy("2026FA");

    const rooms = quietRoomsAt("2026FA", 3, 10 * 60, { minMinutes: 0 });
    const quiet = rooms.find((r) => r.building === "Quiet Hall")!;
    const loud = rooms.find((r) => r.building === "Loud Hall")!;

    expect(quiet).toBeDefined();
    expect(loud).toBeDefined();
    expect(quiet.ambient).toBe(0);
    expect(loud.ambient).toBe(300);
    expect(quiet.quiet).toBeLessThan(loud.quiet);
  });

  test("spill counts the class about to start, not just the one happening now", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        section("A", [meeting([3], "08:00", "08:50", "Calm Hall", "100")], 10),
        // A big lecture starts in 10 minutes in the same building as the free room.
        section("B", [meeting([3], "10:10", "11:00", "About To Fill", "210")], 200),
        section("C", [meeting([3], "08:00", "08:50", "About To Fill", "100")], 5),
      ],
    });
    rebuildOccupancy("2026FA");

    // 10:00, 10 minutes before the 200-person lecture starts at 10:10.
    const rooms = quietRoomsAt("2026FA", 3, 10 * 60, { minMinutes: 0 });
    const calm = rooms.find((r) => r.building === "Calm Hall")!;
    const filling = rooms.find((r) => r.building === "About To Fill" && r.room === "210")!;

    expect(filling.spill).toBeGreaterThan(calm.spill);
    expect(filling.quiet).toBeGreaterThan(calm.quiet);
  });

  test("onCampusOnly drops rooms in buildings the map can't place", () => {
    // The building has to exist before the rebuild -- campusLabel resolves
    // at rebuild time, not read live on every query.
    placeBuilding("Mapped Hall", 1);
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        section("A", [meeting([3], "08:00", "08:50", "Mapped Hall", "100")], 10),
        section("B", [meeting([3], "08:00", "08:50", "Partner School", "1")], 5),
      ],
    });
    rebuildOccupancy("2026FA");

    const all = quietRoomsAt("2026FA", 3, 10 * 60);
    const onCampus = quietRoomsAt("2026FA", 3, 10 * 60, { onCampusOnly: true });

    expect(all.map((r) => r.building).sort()).toEqual(["Mapped Hall", "Partner School"]);
    expect(onCampus.map((r) => r.building)).toEqual(["Mapped Hall"]);
  });

  test("no rooms free at all is an empty list, not an error", () => {
    expect(quietRoomsAt("2026FA", 3, 10 * 60)).toEqual([]);
  });
});

describe("buildingRhythm", () => {
  test("a building's day shows zero outside class hours and enrolled headcount during them", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [section("A", [meeting([3], "09:00", "09:50", "Milner", "100")], 42)],
    });
    rebuildOccupancy("2026FA");

    const points = buildingRhythm("2026FA", "Milner", 3);
    const atClass = points.find((p) => p.minute === 9 * 60)!;
    const atMidnight = points.find((p) => p.minute === 0)!;

    expect(atClass.ambient).toBe(42);
    expect(atMidnight.ambient).toBe(0);
  });
});
