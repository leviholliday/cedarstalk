import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { replaceTerm, seatHistory } from "../src/store/catalog";

const section = (id: string, available: number, capacity: number, enrolled: number) => ({
  Id: id,
  CourseId: "BIO-2500",
  CourseName: "BIO-2500",
  SectionNameDisplay: `BIO-2500-${id}`,
  Title: "General Botany",
  FacultyDisplay: "Dr. Robert L. Paris",
  MeetingsDisplay: "",
  MinimumCredits: 4,
  Available: available,
  Capacity: capacity,
  Enrolled: enrolled,
  FormattedMeetingTimes: [],
});

beforeEach(() => {
  useDatabase(":memory:");
});

describe("seat snapshots", () => {
  test("a section replaced twice leaves two snapshots, not one", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T00:00:00.000Z",
      courses: [],
      sections: [section("01", 20, 20, 0)],
    });
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T01:00:00.000Z",
      courses: [],
      sections: [section("01", 12, 20, 8)],
    });

    const history = seatHistory("2026FA", "01");
    expect(history).toHaveLength(2);
    expect(history.map((s) => s.enrolled)).toEqual([0, 8]);
    expect(history.map((s) => s.available)).toEqual([20, 12]);
  });

  test("the live row still reflects only the latest collect", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T00:00:00.000Z",
      courses: [],
      sections: [section("01", 20, 20, 0)],
    });
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T01:00:00.000Z",
      courses: [],
      sections: [section("01", 12, 20, 8)],
    });

    // Two snapshots accumulated, but `sections` itself still upserts in place.
    expect(seatHistory("2026FA", "01")).toHaveLength(2);
  });

  test("a section that vanishes from the catalog keeps its seat history", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T00:00:00.000Z",
      courses: [],
      sections: [section("01", 20, 20, 0)],
    });
    // A real crawl that no longer lists section 01 (cancelled).
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-08-29T01:00:00.000Z",
      courses: [],
      sections: [section("02", 5, 5, 0)],
    });

    expect(seatHistory("2026FA", "01")).toHaveLength(1);
  });
});
