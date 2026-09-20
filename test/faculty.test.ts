import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { facultyDetail, facultyLoad } from "../src/model/faculty";
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

const section = (
  id: string,
  faculty: string | null,
  meetings: unknown[],
  enrolled: number,
  credits = 3,
) => ({
  Id: id,
  CourseId: `COURSE-${id}`,
  CourseName: `COURSE-${id}`,
  SectionNameDisplay: `COURSE-${id}-01`,
  Title: "A Class",
  FacultyDisplay: faculty,
  MinimumCredits: credits,
  Available: 0,
  Capacity: enrolled,
  Enrolled: enrolled,
  FormattedMeetingTimes: meetings,
});

beforeEach(() => {
  useDatabase(":memory:");
});

describe("facultyLoad", () => {
  test("sums sections, enrolled and credits per instructor, ignoring blank faculty", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        section("A", "Dr. Paris", [meeting([1], "09:00", "09:50", "Milner", "100")], 20, 4),
        section("B", "Dr. Paris", [meeting([3], "09:00", "09:50", "Milner", "200")], 15, 3),
        section("C", null, [meeting([1], "09:00", "09:50", "Milner", "300")], 10, 3),
      ],
    });

    const load = facultyLoad("2026FA");
    expect(load).toHaveLength(1);
    expect(load[0]).toMatchObject({
      faculty: "Dr. Paris",
      sections: 2,
      enrolled: 35,
      credits: 7,
      distinctBuildings: 1,
      distinctRooms: 2,
    });
  });

  test("an MWF section counts once toward sections but three times toward early meetings", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        section("A", "Dr. Early", [meeting([1, 3, 5], "07:30", "08:20", "Milner", "100")], 20),
      ],
    });

    const load = facultyLoad("2026FA")[0]!;
    expect(load.sections).toBe(1);
    expect(load.earlyMeetings).toBe(3);
  });

  test("a section starting after 8am is not counted as early", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [section("A", "Dr. Late", [meeting([1], "10:00", "10:50", "Milner", "100")], 20)],
    });
    expect(facultyLoad("2026FA")[0]!.earlyMeetings).toBe(0);
  });

  test("a team-taught section credits every named instructor, not the joined string", () => {
    // Real data does this: a clinical rotation's FacultyDisplay is a single
    // comma-joined string naming every supervising instructor.
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        section(
          "A",
          "Dr. Ann Alpha,Dr. Bob Beta",
          [meeting([1], "09:00", "09:50", "Milner", "100")],
          10,
          4,
        ),
      ],
    });

    const load = facultyLoad("2026FA");
    expect(load.map((f) => f.faculty).sort()).toEqual(["Dr. Ann Alpha", "Dr. Bob Beta"]);
    expect(load.find((f) => f.faculty === "Dr. Ann Alpha")).toMatchObject({
      sections: 1,
      enrolled: 10,
      credits: 4,
    });
    expect(load.find((f) => f.faculty === "Dr. Bob Beta")).toMatchObject({
      sections: 1,
      enrolled: 10,
      credits: 4,
    });
    // Nobody is credited with teaching the raw joined string.
    expect(load.find((f) => f.faculty.includes(","))).toBeUndefined();
  });

  test("facultyDetail finds a team-taught instructor by their own name", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        section(
          "A",
          "Dr. Ann Alpha,Dr. Bob Beta",
          [meeting([1], "09:00", "09:50", "Milner", "100")],
          10,
        ),
      ],
    });

    const detail = facultyDetail("2026FA", "Dr. Bob Beta")!;
    expect(detail).not.toBeNull();
    expect(detail.taught).toHaveLength(1);
  });

  test("busiest instructor sorts first", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        section("A", "Dr. One", [meeting([1], "09:00", "09:50", "Milner", "100")], 10),
        section("B", "Dr. Two", [meeting([1], "09:00", "09:50", "Milner", "200")], 10),
        section("C", "Dr. Two", [meeting([3], "09:00", "09:50", "Milner", "200")], 10),
      ],
    });
    expect(facultyLoad("2026FA").map((f) => f.faculty)).toEqual(["Dr. Two", "Dr. One"]);
  });
});

describe("facultyDetail", () => {
  test("lists every section with real meeting times, not flattened day-rows", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [
        section("A", "Dr. Paris", [meeting([1, 3, 5], "09:00", "09:50", "Milner", "100")], 20),
      ],
    });

    const detail = facultyDetail("2026FA", "Dr. Paris")!;
    expect(detail.taught).toHaveLength(1);
    expect(detail.taught[0]).toMatchObject({
      code: "COURSE-A",
      name: "COURSE-A-01",
    });
    // One meeting pattern with three days, not three separate meeting rows.
    expect(detail.taught[0]!.meetings).toHaveLength(1);
    expect(detail.taught[0]!.meetings[0]).toMatchObject({
      days: [1, 3, 5],
      start: "09:00",
      end: "09:50",
      building: "Milner",
      room: "100",
    });
  });

  test("an unknown name gives null rather than an empty detail object", () => {
    replaceTerm({
      term: "2026FA",
      fetchedAt: "2026-09-16T00:00:00.000Z",
      courses: [],
      sections: [section("A", "Dr. Paris", [meeting([1], "09:00", "09:50", "Milner", "100")], 20)],
    });
    expect(facultyDetail("2026FA", "Dr. Nobody")).toBeNull();
  });
});
