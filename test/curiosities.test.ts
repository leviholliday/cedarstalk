import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { curiosities } from "../src/model/curiosities";
import { rebuildOccupancy } from "../src/model/occupancy";
import { replaceTerm } from "../src/store/catalog";
import { ingestHarvest } from "../src/store/harvest";
import { upsertPeople } from "../src/store/people";

const AT = "2026-08-29T00:00:00.000Z";

const meeting = (days: number[], start: string, end: string, room: string) => ({
  Days: days,
  DaysOfWeekDisplay: days.join("/"),
  StartTime: `${start}:00`,
  EndTime: `${end}:00`,
  BuildingDisplay: "Milner",
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
  Available: 0,
  Capacity: enrolled,
  Enrolled: enrolled,
  FormattedMeetingTimes: meetings,
});

beforeEach(() => {
  useDatabase(":memory:");
});

describe("hometowns", () => {
  test("counts people by state and measures distance from Cedarville", () => {
    upsertPeople(
      [
        { Id: "1", FirstName: "A", LastName: "One", AddressCity: "Xenia", AddressState: "OH" },
        { Id: "2", FirstName: "B", LastName: "Two", AddressCity: "Xenia", AddressState: "OH" },
        {
          Id: "3",
          FirstName: "C",
          LastName: "Three",
          AddressCity: "Indianapolis",
          AddressState: "IN",
        },
      ],
      AT,
    );

    const { hometownStates, distance } = curiosities("2026FA");
    expect(hometownStates).toEqual([
      { state: "OH", people: 2 },
      { state: "IN", people: 1 },
    ]);
    expect(distance.geocoded).toBe(3);
    // Xenia is a few miles from Cedarville; Indianapolis is not.
    expect(distance.furthest?.state).toBe("IN");
    expect(distance.furthest!.miles).toBeGreaterThan(80);
  });

  test("a hometown the Gazetteer doesn't know still counts for its state, just not for distance", () => {
    upsertPeople(
      [
        {
          Id: "1",
          FirstName: "A",
          LastName: "One",
          AddressCity: "Nowhereville Xyz",
          AddressState: "OH",
        },
      ],
      AT,
    );
    const { hometownStates, distance } = curiosities("2026FA");
    expect(hometownStates).toEqual([{ state: "OH", people: 1 }]);
    expect(distance.geocoded).toBe(0);
    expect(distance.ofPeople).toBe(1);
    expect(distance.medianMiles).toBeNull();
  });
});

describe("earlyBirds", () => {
  test("reports early meetings as a share of a subject's own meetings", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [
        // MIL meets once, at 6am: 100% early.
        section("MIL-1000-01", [meeting([1], "06:00", "07:00", "100")]),
        // BIO meets twice, once early: 50%.
        section("BIO-1000-01", [meeting([1], "07:30", "08:20", "101")]),
        section("BIO-2000-01", [meeting([1], "14:00", "14:50", "102")]),
      ],
    });
    rebuildOccupancy("2026FA");

    const { earlyBirds } = curiosities("2026FA");
    expect(earlyBirds[0]).toMatchObject({ subject: "MIL", early: 1, meetings: 1, share: 1 });
    expect(earlyBirds.find((e) => e.subject === "BIO")).toMatchObject({
      early: 1,
      meetings: 2,
      share: 0.5,
    });
  });

  test("a subject that never meets early is left out entirely", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: AT,
      courses: [],
      sections: [section("ART-1000-01", [meeting([1], "14:00", "14:50", "100")])],
    });
    rebuildOccupancy("2026FA");
    expect(curiosities("2026FA").earlyBirds).toEqual([]);
  });
});

describe("books", () => {
  test("counts each student once per ISBN, even when the store lists it twice", () => {
    const duplicated = {
      isbn: "9781111111111",
      title: "Repeated Book",
      status: "required",
      department: "BIO-Biology",
      course: "1000-Intro",
      section: "01-01",
    };
    ingestHarvest(
      "2026FA",
      [
        { id: "1", books: [duplicated, { ...duplicated }] },
        { id: "2", books: [duplicated] },
      ],
      AT,
    );

    const { commonBooks } = curiosities("2026FA");
    expect(commonBooks[0]).toMatchObject({ isbn: "9781111111111", students: 2 });
  });

  test("optional share counts every assignment, not distinct books", () => {
    ingestHarvest(
      "2026FA",
      [
        {
          id: "1",
          books: [
            { isbn: "1", title: "Required One", status: "required" },
            { isbn: "2", title: "Optional One", status: "optional" },
            { isbn: "3", title: "Required Two", status: "required" },
          ],
        },
      ],
      AT,
    );

    expect(curiosities("2026FA").optionalShare).toEqual({
      optional: 1,
      required: 2,
      share: 0.333,
    });
  });

  test("no booklists at all leaves the book stats empty rather than zeroed", () => {
    const { commonBooks, optionalShare } = curiosities("2026FA");
    expect(commonBooks).toEqual([]);
    expect(optionalShare).toBeNull();
  });
});

describe("notes", () => {
  test("the response says out loud why textbook cost isn't in it", () => {
    const { notes } = curiosities("2026FA");
    expect(notes.join(" ")).toContain("no price");
  });
});
