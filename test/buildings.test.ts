import { beforeEach, describe, expect, test } from "bun:test";
import { db, useDatabase } from "../src/db";
import { buildingProfile } from "../src/model/buildings";
import { rebuildOccupancy } from "../src/model/occupancy";
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

const section = (id: string, code: string, meetings: unknown[], enrolled: number) => ({
  Id: id,
  CourseId: code,
  CourseName: code,
  SectionNameDisplay: `${code}-01`,
  Title: "A Class",
  FacultyDisplay: "Dr. Someone",
  MinimumCredits: 3,
  Available: 0,
  Capacity: enrolled,
  Enrolled: enrolled,
  FormattedMeetingTimes: meetings,
});

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

describe("buildingProfile", () => {
  test("no classes in a building at all is null, not a zeroed profile", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [],
    });
    rebuildOccupancy("2026FA");
    expect(buildingProfile("2026FA", "Nowhere Hall")).toBeNull();
  });

  test("the busiest hour, weighted by enrolled headcount, is the peak", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        section("A", "BIO-1000", [meeting([1], "09:00", "09:50", "Milner", "100")], 20),
        // Two sections overlap 10-11am -- more total headcount than the 9am slot.
        section("B", "BIO-2000", [meeting([1], "10:00", "11:00", "Milner", "200")], 60),
        section("C", "BIO-3000", [meeting([1], "10:00", "11:00", "Milner", "201")], 45),
      ],
    });
    rebuildOccupancy("2026FA");

    const profile = buildingProfile("2026FA", "Milner")!;
    expect(profile.peakHour).toBe(10);
    expect(profile.peakEnrolled).toBe(105);
  });

  test("dominant subject is the one with the most enrolled headcount, not the most sections", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        // Three small BIO sections...
        section("A", "BIO-1000", [meeting([1], "09:00", "09:50", "Milner", "100")], 5),
        section("B", "BIO-2000", [meeting([2], "09:00", "09:50", "Milner", "101")], 5),
        section("C", "BIO-3000", [meeting([3], "09:00", "09:50", "Milner", "102")], 5),
        // ...vs. one big CHEM lecture that outweighs all three combined.
        section("D", "CHEM-1000", [meeting([1], "10:00", "10:50", "Milner", "200")], 100),
      ],
    });
    rebuildOccupancy("2026FA");

    const profile = buildingProfile("2026FA", "Milner")!;
    expect(profile.dominantSubject).toBe("CHEM");
    expect(profile.subjectShare).toBeCloseTo(100 / 115, 2);
  });

  test("weeklyFootfall sums every meeting-day; meanDailyFootfall spreads it over days with class", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        section("A", "BIO-1000", [meeting([1, 3], "09:00", "09:50", "Milner", "100")], 20),
      ],
    });
    rebuildOccupancy("2026FA");

    const profile = buildingProfile("2026FA", "Milner")!;
    expect(profile.weeklyFootfall).toBe(40); // 20 on Monday + 20 on Wednesday
    expect(profile.meanDailyFootfall).toBe(20); // spread over the 2 days it actually meets
  });

  test("an unmapped building (a partner school, say) still profiles, with campusLabel null", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        section("A", "IDES-1000", [meeting([1], "09:00", "09:50", "Partner School", "1")], 20),
      ],
    });
    rebuildOccupancy("2026FA");

    const profile = buildingProfile("2026FA", "Partner School")!;
    expect(profile.campusLabel).toBeNull();
    expect(profile.building).toBe("Partner School");
  });

  test("meanUtilization reflects the building's own rooms, from roomUtilization", () => {
    placeBuilding("Mapped Hall", 1);
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      // The only meeting all week -- so this room, and the building, are 100% utilized.
      sections: [
        section("A", "BIO-1000", [meeting([1], "09:00", "10:00", "Mapped Hall", "100")], 20),
      ],
    });
    rebuildOccupancy("2026FA");

    const profile = buildingProfile("2026FA", "Mapped Hall")!;
    expect(profile.rooms).toBe(1);
    expect(profile.meanUtilization).toBe(1);
  });
});
