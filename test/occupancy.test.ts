import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import {
  buildingCurve,
  buildingLoad,
  rebuildOccupancy,
  roomsBusyAt,
  roomsFreeAt,
} from "../src/model/occupancy";
import { replaceTerm } from "../src/store/catalog";
import { roomsForTerm } from "../src/store/rooms";

const meeting = (days: number[], start: string, end: string, room: string) => ({
  Days: days,
  DaysOfWeekDisplay: days.join("/"),
  StartTime: `${start}:00`,
  EndTime: `${end}:00`,
  BuildingDisplay: "Engineering and Science Ctr",
  RoomDisplay: room,
  IsOnline: false,
});

const section = (id: string, meetings: unknown[], enrolled = 20) => ({
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

beforeEach(() => {
  useDatabase(":memory:");
  replaceTerm({
    term: "2026FA",
    fetchedAt: "2026-09-18T00:00:00.000Z",
    courses: [],
    sections: [
      section("01", [meeting([1, 3, 5], "09:00", "09:50", "210")], 30),
      section("02", [meeting([2, 4], "14:00", "15:15", "220")], 12),
      section("Z01", [], 8), // online, no room
    ],
  });
  rebuildOccupancy("2026FA");
});

describe("rebuildOccupancy", () => {
  test("registers one room per distinct (building, room), not per meeting", () => {
    const rooms = roomsForTerm("2026FA");
    expect(rooms.map((r) => r.room).sort()).toEqual(["210", "220"]);
  });

  test("an online section with no meetings contributes no room", () => {
    const rooms = roomsForTerm("2026FA");
    expect(rooms).toHaveLength(2);
  });
});

describe("roomsBusyAt", () => {
  test("a room mid-class shows the section meeting there", () => {
    const busy = roomsBusyAt("2026FA", 1, 9 * 60 + 30); // Monday 9:30am
    expect(busy).toHaveLength(1);
    expect(busy[0]).toMatchObject({
      building: "Engineering and Science Ctr",
      room: "210",
      enrolled: 30,
    });
  });

  test("the same room five minutes after class ends is not busy", () => {
    expect(roomsBusyAt("2026FA", 1, 9 * 60 + 55)).toEqual([]);
  });

  test("a day the section never meets shows nothing", () => {
    expect(roomsBusyAt("2026FA", 2, 9 * 60 + 30)).toEqual([]);
  });
});

describe("roomsFreeAt", () => {
  test("a room with no class right now is free, with time until the next one", () => {
    const free = roomsFreeAt("2026FA", 1, 10 * 60, 0); // Monday 10:00am, room 210 taught 9-9:50
    const room210 = free.find((r) => r.room === "210")!;
    expect(room210).toBeDefined();
    // No further class in 210 on Monday -> free until midnight.
    expect(room210.freeMinutes).toBe(24 * 60 - 10 * 60);
  });

  test("a busy room is excluded entirely", () => {
    const free = roomsFreeAt("2026FA", 1, 9 * 60 + 15, 0);
    expect(free.find((r) => r.room === "210")).toBeUndefined();
  });

  test("minMinutes filters out rooms free for too short a window", () => {
    // Room 220 meets Tue 14:00-15:15; at 13:00 it's free for only 60 minutes.
    const free = roomsFreeAt("2026FA", 2, 13 * 60, 90);
    expect(free.find((r) => r.room === "220")).toBeUndefined();
  });
});

describe("buildingLoad", () => {
  test("sums enrolled headcount across rooms busy at that instant", () => {
    const load = buildingLoad("2026FA", 1, 9 * 60 + 30);
    expect(load).toEqual([{ building: "Engineering and Science Ctr", enrolled: 30, sections: 1 }]);
  });

  test("an instant nothing meets has zero load", () => {
    expect(buildingLoad("2026FA", 1, 12 * 60)).toEqual([]);
  });
});

describe("buildingCurve", () => {
  test("buckets headcount across the day, only where classes meet", () => {
    const curve = buildingCurve("2026FA", 1, 10);
    const nonZero = curve.filter((point) => point.enrolled > 0);
    expect(nonZero.every((point) => point.minute >= 540 && point.minute < 590)).toBe(true);
    expect(nonZero[0]!.enrolled).toBe(30);
  });
});
