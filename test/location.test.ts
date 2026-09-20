import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { locationNow } from "../src/model/schedule";
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

const meeting = (days: number[], start: string, end: string, room: string) => ({
  Days: days,
  DaysOfWeekDisplay: days.join("/"),
  StartTime: `${start}:00`,
  EndTime: `${end}:00`,
  BuildingDisplay: "Engineering and Science Ctr",
  RoomDisplay: room,
  IsOnline: false,
});

const section = (name: string, meetings: unknown[]) => ({
  Id: name,
  CourseId: name.split("-").slice(0, 2).join("-"),
  CourseName: name.split("-").slice(0, 2).join("-"),
  SectionNameDisplay: name,
  Title: "General Botany",
  FacultyDisplay: "Dr. Paris",
  MinimumCredits: 4,
  Available: 1,
  Capacity: 20,
  FormattedMeetingTimes: meetings,
});

beforeEach(() => {
  useDatabase(":memory:");
  upsertPeople([{ Id: "1", FirstName: "Ada", LastName: "Lovelace", DormName: "Printy Hall" }], AT);
  replaceTerm({
    term: "2026FA",
    fetchedAt: AT,
    courses: [],
    sections: [section("BIO-2500-01", [meeting([1, 3, 5], "09:00", "09:50", "210")])],
  });
});

describe("locationNow", () => {
  test("in the middle of a scheduled block reads as in class", () => {
    ingestHarvest("2026FA", [{ id: "1", books: [book("BIO", "2500", "01")] }], AT);

    // Monday (day 1), 09:30 -- inside the 09:00-09:50 block.
    const at = new Date("2026-09-07T09:30:00"); // a Monday
    const location = locationNow("1", at);

    expect(location.status).toBe("in class");
    expect(location.inClass).toMatchObject({
      section: "BIO-2500-01",
      building: "Engineering and Science Ctr",
      room: "210",
      endsAt: "09:50",
    });
  });

  test("outside any block is free, not in class", () => {
    ingestHarvest("2026FA", [{ id: "1", books: [book("BIO", "2500", "01")] }], AT);

    const at = new Date("2026-09-07T14:00:00"); // same Monday, afternoon
    const location = locationNow("1", at);

    expect(location.status).toBe("free");
    expect(location.inClass).toBeNull();
  });

  test("someone with no booklist at all reports no schedule data, not an error", () => {
    upsertPeople([{ Id: "2", FirstName: "Alan", LastName: "Turing" }], AT);
    const location = locationNow("2", new Date("2026-09-07T09:30:00"));
    expect(location.status).toBe("no schedule data");
    expect(location.harvestedAt).toBeNull();
  });

  test("the dorm/office fallback is present whether or not they're in class", () => {
    ingestHarvest("2026FA", [{ id: "1", books: [book("BIO", "2500", "01")] }], AT);
    const inClass = locationNow("1", new Date("2026-09-07T09:30:00"));
    const free = locationNow("1", new Date("2026-09-07T14:00:00"));
    // Neither dorm has campus coordinates in this fixture, so location itself
    // is null either way -- the point is the field exists on both responses.
    expect("location" in inClass).toBe(true);
    expect("location" in free).toBe(true);
  });
});
