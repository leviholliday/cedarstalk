import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { replaceTerm } from "../src/store/catalog";
import { ingestHarvest } from "../src/store/harvest";
import { rosterFor, sectionRosters } from "../src/store/rosters";

const book = (department: string, course: string, section: string) => ({
  department,
  course,
  section,
  title: "Some Textbook",
});

const section = (id: string, enrolled: number) => ({
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
  FormattedMeetingTimes: [],
});

const AT = "2026-08-29T00:00:00.000Z";

beforeEach(() => {
  useDatabase(":memory:");
  replaceTerm({
    term: "2026FA",
    fetchedAt: AT,
    courses: [],
    sections: [section("01", 20), section("02", 5)],
  });
});

describe("sectionRosters", () => {
  test("inverts booklists into who holds each section", () => {
    ingestHarvest(
      "2026FA",
      [
        { id: "1", books: [book("BIO", "2500", "01")] },
        { id: "2", books: [book("BIO", "2500", "01")] },
        { id: "3", books: [book("BIO", "2500", "02")] },
      ],
      AT,
    );

    const rosters = sectionRosters("2026FA");
    const section01 = rosters.find((r) => r.sectionName === "BIO-2500-01")!;
    const section02 = rosters.find((r) => r.sectionName === "BIO-2500-02")!;

    expect(section01.studentIds).toEqual(["1", "2"]);
    expect(section02.studentIds).toEqual(["3"]);
  });

  test("coverage is known students over the catalog's own Enrolled count", () => {
    ingestHarvest(
      "2026FA",
      [
        { id: "1", books: [book("BIO", "2500", "01")] },
        { id: "2", books: [book("BIO", "2500", "01")] },
      ],
      AT,
    );

    // Section 01 has Enrolled: 20, and only 2 of them show up in a booklist.
    const roster = rosterFor("2026FA", "BIO-2500-01")!;
    expect(roster.enrolled).toBe(20);
    expect(roster.coverage).toBe(0.1);
  });

  test("a section the catalog has never heard of still rosters, with null coverage", () => {
    ingestHarvest("2026FA", [{ id: "1", books: [book("BIO", "9999", "01")] }], AT);

    const roster = rosterFor("2026FA", "BIO-9999-01")!;
    expect(roster.sectionId).toBeNull();
    expect(roster.enrolled).toBeNull();
    expect(roster.coverage).toBeNull();
    expect(roster.studentIds).toEqual(["1"]);
  });

  test("no booklists at all is an empty list, not an error", () => {
    expect(sectionRosters("2026FA")).toEqual([]);
  });

  test("a section nobody bought a book for is absent, not a zero-student roster", () => {
    ingestHarvest("2026FA", [{ id: "1", books: [book("BIO", "2500", "01")] }], AT);
    expect(rosterFor("2026FA", "BIO-2500-02")).toBeNull();
  });
});
