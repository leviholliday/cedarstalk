import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { fitFor } from "../src/model/fit";
import { replaceCampus } from "../src/store/campus";
import { replaceTerm } from "../src/store/catalog";
import { ingestHarvest } from "../src/store/harvest";

const TERM = "2026FA";
const AT = "2026-08-29T00:00:00.000Z";

const NEAR = "Engineering and Science Ctr";
const FAR = "Health Sciences Center";
const UNMAPPED = "Xenia Partner School; Obsolete";

const meeting = (days: number[], start: string, end: string, building: string, room = "101") => ({
  Days: days,
  DaysOfWeekDisplay: days.join("/"),
  StartTime: `${start}:00`,
  EndTime: `${end}:00`,
  BuildingDisplay: building,
  RoomDisplay: room,
  IsOnline: false,
});

const section = (code: string, suffix: string, meetings: unknown[], available = 5) => ({
  Id: `${code}-${suffix}`,
  CourseId: code,
  CourseName: code,
  SectionNameDisplay: `${code}-${suffix}`,
  Title: `${code} Class`,
  FacultyDisplay: "Dr. Someone",
  MinimumCredits: 3,
  Available: available,
  Capacity: 30,
  Enrolled: 30 - available,
  FormattedMeetingTimes: meetings,
});

const takes = (studentId: string, names: string[]) => ({
  id: studentId,
  books: names.map((name) => {
    const [department, course, sec] = name.split("-");
    return { department, course, section: sec, title: `Book for ${name}` };
  }),
});

/**
 * Two buildings 700 metres apart on a single edge -- about 8.6 minutes at the
 * 1.35 m/s the router assumes, which is what makes the tight and impossible
 * cases below predictable rather than dependent on the real campus.
 */
function placeCampus() {
  replaceCampus({
    origin: { lat: 39.75, lon: -83.81 },
    box: [0, 0, 1000, 1000],
    buildings: [],
    nodes: [
      [0, 0],
      [700, 0],
    ],
    edges: [[0, 1, 700]],
    anchors: {
      [NEAR]: {
        node: 0,
        name: NEAR,
        kind: "academic",
        gender: null,
        source: "osm",
        centre: [0, 0],
        lat: 39.75,
        lon: -83.81,
        ring: [],
      },
      [FAR]: {
        node: 1,
        name: FAR,
        kind: "academic",
        gender: null,
        source: "osm",
        centre: [700, 0],
        lat: 39.751,
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

describe("fitFor", () => {
  test("a section overlapping an existing class is a clash", () => {
    replaceTerm({
      term: TERM,
      fetchedAt: AT,
      courses: [],
      sections: [
        section("AAA-1000", "01", [meeting([1], "08:00", "08:50", NEAR)]),
        section("BBB-2000", "01", [meeting([1], "08:00", "08:50", NEAR)]),
      ],
    });
    ingestHarvest(TERM, [takes("s1", ["AAA-1000-01"])], AT);

    const fit = fitFor("s1", "BBB-2000", { term: TERM });
    expect(fit.options[0]?.verdict).toBe("clash");
    expect(fit.options[0]?.reason).toContain("AAA-1000-01");
  });

  test("an online section always fits", () => {
    replaceTerm({
      term: TERM,
      fetchedAt: AT,
      courses: [],
      sections: [
        section("AAA-1000", "01", [meeting([1], "08:00", "08:50", NEAR)]),
        section("BBB-2000", "01", []),
      ],
    });
    ingestHarvest(TERM, [takes("s1", ["AAA-1000-01"])], AT);

    const fit = fitFor("s1", "BBB-2000", { term: TERM });
    expect(fit.options[0]?.verdict).toBe("fits");
    expect(fit.options[0]?.online).toBe(true);
  });

  test("a walk longer than the gap is impossible", () => {
    placeCampus();
    replaceTerm({
      term: TERM,
      fetchedAt: AT,
      courses: [],
      sections: [
        // Ends 08:50 in ESC; the candidate starts 08:55 across campus.
        section("AAA-1000", "01", [meeting([1], "08:00", "08:50", NEAR)]),
        section("BBB-2000", "01", [meeting([1], "08:55", "09:45", FAR)]),
      ],
    });
    ingestHarvest(TERM, [takes("s1", ["AAA-1000-01"])], AT);

    const fit = fitFor("s1", "BBB-2000", { term: TERM });
    expect(fit.options[0]?.verdict).toBe("impossible");
    expect(fit.options[0]?.reason).toContain("min walk");
  });

  test("a walk eating most of the gap is tight", () => {
    placeCampus();
    replaceTerm({
      term: TERM,
      fetchedAt: AT,
      courses: [],
      sections: [
        // 10 minutes for an ~8.6 minute walk: possible, over the 70% line.
        section("AAA-1000", "01", [meeting([1], "08:00", "08:50", NEAR)]),
        section("BBB-2000", "01", [meeting([1], "09:00", "09:50", FAR)]),
      ],
    });
    ingestHarvest(TERM, [takes("s1", ["AAA-1000-01"])], AT);

    const fit = fitFor("s1", "BBB-2000", { term: TERM });
    expect(fit.options[0]?.verdict).toBe("tight");
  });

  test("a comfortable gap fits", () => {
    placeCampus();
    replaceTerm({
      term: TERM,
      fetchedAt: AT,
      courses: [],
      sections: [
        section("AAA-1000", "01", [meeting([1], "08:00", "08:50", NEAR)]),
        section("BBB-2000", "01", [meeting([1], "11:00", "11:50", FAR)]),
      ],
    });
    ingestHarvest(TERM, [takes("s1", ["AAA-1000-01"])], AT);

    const fit = fitFor("s1", "BBB-2000", { term: TERM });
    expect(fit.options[0]?.verdict).toBe("fits");
  });

  test("an unroutable building is reported, not silently passed", () => {
    placeCampus();
    replaceTerm({
      term: TERM,
      fetchedAt: AT,
      courses: [],
      sections: [
        section("AAA-1000", "01", [meeting([1], "08:00", "08:50", NEAR)]),
        section("BBB-2000", "01", [meeting([1], "09:00", "09:50", UNMAPPED)]),
      ],
    });
    ingestHarvest(TERM, [takes("s1", ["AAA-1000-01"])], AT);

    const fit = fitFor("s1", "BBB-2000", { term: TERM });
    expect(fit.options[0]?.verdict).toBe("fits");
    expect(fit.options[0]?.reason).toContain("not on the campus map");
  });

  test("sections already being taken are not offered back", () => {
    replaceTerm({
      term: TERM,
      fetchedAt: AT,
      courses: [],
      sections: [
        section("AAA-1000", "01", [meeting([1], "08:00", "08:50", NEAR)]),
        section("AAA-1000", "02", [meeting([1], "13:00", "13:50", NEAR)]),
      ],
    });
    ingestHarvest(TERM, [takes("s1", ["AAA-1000-01"])], AT);

    const fit = fitFor("s1", "AAA-1000", { term: TERM });
    expect(fit.options.map((o) => o.name)).toEqual(["AAA-1000-02"]);
  });

  test("someone with no timetable gets options, flagged as unchecked", () => {
    replaceTerm({
      term: TERM,
      fetchedAt: AT,
      courses: [],
      sections: [section("BBB-2000", "01", [meeting([1], "08:00", "08:50", NEAR)])],
    });

    const fit = fitFor("ghost", "BBB-2000", { term: TERM });
    expect(fit.known).toBe(false);
    expect(fit.options[0]?.verdict).toBe("fits");
    expect(fit.options[0]?.reason).toContain("No timetable on record");
  });

  test("better verdicts sort first", () => {
    placeCampus();
    replaceTerm({
      term: TERM,
      fetchedAt: AT,
      courses: [],
      sections: [
        section("AAA-1000", "01", [meeting([1], "08:00", "08:50", NEAR)]),
        section("BBB-2000", "01", [meeting([1], "08:00", "08:50", NEAR)]), // clash
        section("BBB-2000", "02", [meeting([1], "11:00", "11:50", FAR)]), // fits
      ],
    });
    ingestHarvest(TERM, [takes("s1", ["AAA-1000-01"])], AT);

    const fit = fitFor("s1", "BBB-2000", { term: TERM });
    expect(fit.options.map((o) => o.verdict)).toEqual(["fits", "clash"]);
  });
});
