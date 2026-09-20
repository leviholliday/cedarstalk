import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { degreeAudit } from "../src/model/audit";
import { ingestHarvest } from "../src/store/harvest";
import { listPrograms, replaceYear } from "../src/store/programs";

const AT = "2026-08-29T00:00:00.000Z";

const book = (department: string, course: string, section: string) => ({
  department,
  course,
  section,
  title: "Some Textbook",
});

const page = (title: string, courses: string[], totalCredits = 120) => ({
  page: 1,
  title,
  courses,
  summary: [{ label: "Total Semester Hours", min: totalCredits, max: totalCredits }],
  doubleCounts: [],
  sequence: [],
});

beforeEach(() => {
  useDatabase(":memory:");
  replaceYear(
    "2026-2027",
    [page("Biology, B.S.", ["BIO-1000", "BIO-2500", "CHEM-2210", "MATH-1710"], 120)],
    AT,
  );
});

const biologyProgram = () => listPrograms("2026-2027", "Biology")[0]!;

describe("degreeAudit", () => {
  test("courses named in a booklist are marked covered; the rest are not", () => {
    ingestHarvest(
      "2026FA",
      [{ id: "1", books: [book("BIO", "1000", "01"), book("BIO", "2500", "01")] }],
      AT,
    );

    const audit = degreeAudit("1", biologyProgram())!;
    expect(audit.totalCourses).toBe(4);
    expect(audit.coveredCourses).toBe(2);
    expect(audit.courses).toEqual([
      { code: "BIO-1000", covered: true },
      { code: "BIO-2500", covered: true },
      { code: "CHEM-2210", covered: false },
      { code: "MATH-1710", covered: false },
    ]);
  });

  test("coverage merges across every harvested term, not just one", () => {
    ingestHarvest("2026FA", [{ id: "1", books: [book("BIO", "1000", "01")] }], AT);
    ingestHarvest(
      "2027SP",
      [{ id: "1", books: [book("BIO", "2500", "01")] }],
      "2027-01-15T00:00:00.000Z",
    );

    const audit = degreeAudit("1", biologyProgram())!;
    expect(audit.coveredCourses).toBe(2);
    expect(audit.termsSeen).toEqual(["2026FA", "2027SP"]);
  });

  test("totalCredits comes off the program, not computed from what's covered", () => {
    ingestHarvest("2026FA", [{ id: "1", books: [book("BIO", "1000", "01")] }], AT);
    expect(degreeAudit("1", biologyProgram())!.totalCredits).toBe(120);
  });

  test("the coverage caveat travels with every response, not just the docs", () => {
    ingestHarvest("2026FA", [{ id: "1", books: [book("BIO", "1000", "01")] }], AT);
    const audit = degreeAudit("1", biologyProgram())!;
    expect(audit.caveat.length).toBeGreaterThan(0);
    expect(audit.caveat).toContain("not a real transcript");
  });

  test("nobody with a booklist has nothing to audit against", () => {
    expect(degreeAudit("1", biologyProgram())).toBeNull();
  });
});
