import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { diningForecast } from "../src/model/dining";
import { rebuildOccupancy } from "../src/model/occupancy";
import { replaceCampus } from "../src/store/campus";
import { replaceTerm } from "../src/store/catalog";
import { upsertPeople } from "../src/store/people";

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

const section = (id: string, meetings: unknown[], enrolled: number) => ({
  Id: id,
  CourseId: "BIO-2500",
  CourseName: "BIO-2500",
  SectionNameDisplay: `BIO-2500-${id}`,
  Title: "General Botany",
  FacultyDisplay: "Dr. Paris",
  MinimumCredits: 4,
  Available: 0,
  Capacity: enrolled,
  Enrolled: enrolled,
  FormattedMeetingTimes: meetings,
});

/** Classroom, 405m (~5-minute walk) from the dining hall; a dorm, 135m (~1.7-minute walk) away. */
function placeCampus() {
  replaceCampus({
    origin: { lat: 39.75, lon: -83.81 },
    box: [0, 0, 1000, 1000],
    buildings: [],
    nodes: [
      [0, 0], // Classroom
      [405, 0], // Dining Hall
      [270, 0], // Dorm (partway between)
    ],
    edges: [
      [0, 1, 405],
      [2, 1, 135],
    ],
    anchors: {
      Classroom: {
        node: 0,
        name: "Classroom",
        kind: "academic",
        gender: null,
        source: "osm",
        centre: [0, 0],
        lat: 39.75,
        lon: -83.81,
        ring: [],
      },
      "Dining Hall": {
        node: 1,
        name: "Dining Hall",
        kind: "academic",
        gender: null,
        source: "osm",
        centre: [405, 0],
        lat: 39.7505,
        lon: -83.81,
        ring: [],
      },
      Dorm: {
        node: 2,
        name: "Dorm",
        kind: "dorm",
        gender: "mixed",
        source: "osm",
        centre: [270, 0],
        lat: 39.7503,
        lon: -83.81,
        ring: [],
      },
    },
    missing: [],
  });
}

beforeEach(() => {
  useDatabase(":memory:");
});

describe("diningForecast", () => {
  test("no dining buildings configured is null, not an error", () => {
    placeCampus();
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [section("01", [meeting([1], "09:00", "09:50", "Classroom", "100")], 20)],
    });
    rebuildOccupancy("2026FA");
    expect(diningForecast("2026FA", 1)).toBeNull();
  });

  test("no campus map at all is null", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [section("01", [meeting([1], "09:00", "09:50", "Classroom", "100")], 20)],
    });
    rebuildOccupancy("2026FA");
    expect(diningForecast("2026FA", 1, { buildings: ["Dining Hall"] })).toBeNull();
  });

  test("a class ending near dining shows up in the arrival curve, offset by the real walk time", () => {
    placeCampus();
    // 20 students in a class ending 09:50 in a building ~5 minutes from dining.
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [section("01", [meeting([1], "09:00", "09:50", "Classroom", "100")], 20)],
    });
    rebuildOccupancy("2026FA");

    const forecast = diningForecast("2026FA", 1, {
      buildings: ["Dining Hall"],
      radiusMinutes: 15,
    })!;
    expect(forecast).not.toBeNull();
    // 405m at 1.35 m/s is ~5 minutes; arrival ~09:55, in the 09:50 bucket (10-min buckets).
    const arrivalBucket = forecast.buckets.find((b) => b.fromClasses > 0)!;
    expect(arrivalBucket.minute).toBe(590); // 09:50 in minutes-of-day
    expect(arrivalBucket.fromClasses).toBe(20);
  });

  test("a class too far to walk within the radius doesn't count", () => {
    placeCampus();
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [section("01", [meeting([1], "09:00", "09:50", "Classroom", "100")], 20)],
    });
    rebuildOccupancy("2026FA");

    // 405m is ~5 minutes; a 2-minute radius excludes it entirely.
    const forecast = diningForecast("2026FA", 1, { buildings: ["Dining Hall"], radiusMinutes: 2 });
    expect(forecast!.buckets).toEqual([]);
    expect(forecast!.peak).toBeNull();
  });

  test("nearby residents contribute a baseline, scaled by the configured participation rate", () => {
    placeCampus();
    upsertPeople(
      Array.from({ length: 20 }, (_, i) => ({
        Id: `dorm-${i}`,
        FirstName: "Res",
        LastName: `${i}`,
        DormName: "Dorm",
        DormRoom: `${i}`,
      })),
      AT,
    );
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [section("01", [meeting([1], "09:00", "09:50", "Classroom", "100")], 20)],
    });
    rebuildOccupancy("2026FA");

    const forecast = diningForecast("2026FA", 1, { buildings: ["Dining Hall"] })!;
    const arrivalBucket = forecast.buckets.find((b) => b.fromClasses > 0)!;
    // 20 residents * 0.1 participation / 1 active bucket = 2.
    expect(arrivalBucket.baseline).toBe(2);
    expect(arrivalBucket.total).toBe(22);
  });

  test("peak and quietest identify the busiest and calmest buckets in the active window", () => {
    placeCampus();
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [
        section("01", [meeting([1], "09:00", "09:50", "Classroom", "100")], 5),
        section("02", [meeting([1], "11:00", "11:50", "Classroom", "100")], 50),
      ],
    });
    rebuildOccupancy("2026FA");

    const forecast = diningForecast("2026FA", 1, { buildings: ["Dining Hall"] })!;
    expect(forecast.peak!.total).toBe(50);
    expect(forecast.quietest!.total).toBeLessThanOrEqual(forecast.peak!.total);
  });
});
