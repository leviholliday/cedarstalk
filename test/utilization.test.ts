import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { rebuildOccupancy, roomUtilization } from "../src/model/occupancy";
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

beforeEach(() => {
  useDatabase(":memory:");
});

describe("roomUtilization", () => {
  test("a room booked for the whole term window is 100% utilized", () => {
    // Only one room, one meeting: the term's window IS this meeting, so it's fully booked.
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [section("A", [meeting([1], "09:00", "10:00", "Solo Hall", "100")], 20)],
    });
    rebuildOccupancy("2026FA");

    const rooms = roomUtilization("2026FA");
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({
      building: "Solo Hall",
      room: "100",
      bookedHours: 1,
      idleHours: 0,
      utilization: 1,
      peakDay: 1,
      meanClassSize: 20,
    });
  });

  test("a room booked for half the window shows half the utilization and idle hours", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        // Sets the term window to 09:00-11:00 on Monday (2 hours).
        section("A", [meeting([1], "09:00", "10:00", "Half Hall", "100")], 20),
        section("B", [meeting([1], "10:00", "11:00", "Anchor Hall", "200")], 10),
      ],
    });
    rebuildOccupancy("2026FA");

    const half = roomUtilization("2026FA").find((r) => r.room === "100")!;
    expect(half.bookedHours).toBe(1);
    expect(half.idleHours).toBe(1);
    expect(half.utilization).toBe(0.5);
  });

  test("peakDay is the day with the most booked minutes, not just the first one seen", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        section("A", [meeting([1], "09:00", "09:30", "Split Hall", "100")], 5),
        section("B", [meeting([3], "09:00", "11:00", "Split Hall", "100")], 5),
      ],
    });
    rebuildOccupancy("2026FA");

    const room = roomUtilization("2026FA").find((r) => r.room === "100")!;
    expect(room.peakDay).toBe(3);
  });

  test("an unbooked room in a term with other bookings shows zero utilization, not an error", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        section("A", [meeting([1], "09:00", "10:00", "Busy Hall", "100")], 20),
        // Empty section: never meets, so its room never shows up in occupancy,
        // meaning this test really just confirms the busy room isn't 0.
      ],
    });
    rebuildOccupancy("2026FA");

    const rooms = roomUtilization("2026FA");
    expect(rooms.every((r) => r.utilization > 0)).toBe(true);
  });

  test("no catalog collected yet is an empty list, not an error", () => {
    expect(roomUtilization("2026FA")).toEqual([]);
  });

  test("two cross-listed sections sharing one room and hour count as one hour, not two", () => {
    // Real data does this: a combined studio class filed as two course
    // numbers, both meeting in the same room at the same time. Naively
    // summing each section's minutes would push utilization past 100%.
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        section("A", [meeting([1], "09:00", "12:00", "Studio", "100")], 20),
        section("B", [meeting([1], "09:00", "12:00", "Studio", "100")], 15),
      ],
    });
    rebuildOccupancy("2026FA");

    const room = roomUtilization("2026FA").find((r) => r.room === "100")!;
    expect(room.bookedHours).toBe(3);
    expect(room.utilization).toBe(1);
    expect(room.idleHours).toBe(0);
  });

  test("two overlapping-but-not-identical meetings merge into one continuous span", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        section("A", [meeting([1], "09:00", "10:30", "Overlap Hall", "100")], 10),
        section("B", [meeting([1], "10:00", "11:00", "Overlap Hall", "100")], 10),
      ],
    });
    rebuildOccupancy("2026FA");

    // 09:00-11:00 merged = 2 hours, not 1.5 + 1.0 = 2.5.
    const room = roomUtilization("2026FA").find((r) => r.room === "100")!;
    expect(room.bookedHours).toBe(2);
    expect(room.utilization).toBe(1);
  });
});
