import { describe, expect, test } from "bun:test";
import { enrolledOf, expand, minutesOfDay } from "../src/model/meetings";
import type { SectionRow } from "../src/store/catalog";

const row = (payload: Record<string, unknown>): SectionRow => ({
  term: "2026FA",
  sectionId: "158001",
  courseId: "5163",
  code: "ACCT-2110",
  name: "ACCT-2110-01",
  title: "Financial Accounting",
  faculty: "Mrs. Howell",
  meetings: null,
  available: 0,
  capacity: 36,
  payload: JSON.stringify(payload),
  fetchedAt: "2026-09-18T00:00:00.000Z",
});

describe("minutesOfDay", () => {
  test("parses HH:MM into minutes since midnight", () => {
    expect(minutesOfDay("09:50")).toBe(590);
    expect(minutesOfDay("00:00")).toBe(0);
    expect(minutesOfDay("23:59")).toBe(1439);
  });

  test("null in, null out", () => {
    expect(minutesOfDay(null)).toBeNull();
  });
});

describe("enrolledOf", () => {
  test("reads Enrolled off the payload, not capacity minus available", () => {
    expect(enrolledOf(row({ Enrolled: 44, Capacity: 36 }))).toBe(44);
  });

  test("missing Enrolled is null, not zero", () => {
    expect(enrolledOf(row({}))).toBeNull();
  });
});

describe("expand", () => {
  test("an MWF lecture becomes three day-rows from one meeting", () => {
    const section = row({
      Enrolled: 20,
      FormattedMeetingTimes: [
        {
          Days: [1, 3, 5],
          StartTime: "09:00:00",
          EndTime: "09:50:00",
          BuildingDisplay: "Engineering and Science Ctr",
          RoomDisplay: "210",
          IsOnline: false,
        },
      ],
    });
    const rows = expand(section);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.day)).toEqual([1, 3, 5]);
    expect(rows[0]).toMatchObject({
      startMin: 540,
      endMin: 590,
      building: "Engineering and Science Ctr",
      room: "210",
      enrolled: 20,
      sectionId: "158001",
    });
  });

  test("an online meeting occupies no room and is dropped", () => {
    const section = row({
      FormattedMeetingTimes: [
        { Days: [1], StartTime: "09:00:00", EndTime: "09:50:00", IsOnline: true },
      ],
    });
    expect(expand(section)).toEqual([]);
  });

  test("a meeting with no start time is dropped rather than guessed", () => {
    const section = row({
      FormattedMeetingTimes: [{ Days: [1], BuildingDisplay: "Milner", RoomDisplay: "100" }],
    });
    expect(expand(section)).toEqual([]);
  });
});
