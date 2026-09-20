import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { twinSchedulesFor } from "../src/model/twins";
import { ingestHarvest } from "../src/store/harvest";
import { upsertPeople } from "../src/store/people";

const AT = "2026-08-29T00:00:00.000Z";

const book = (department: string, course: string, section: string) => ({
  department,
  course,
  section,
  title: "Some Textbook",
});

beforeEach(() => {
  useDatabase(":memory:");
  upsertPeople(
    [
      { Id: "1", FirstName: "Ada", LastName: "Lovelace" },
      { Id: "2", FirstName: "Grace", LastName: "Hopper" },
      { Id: "3", FirstName: "Alan", LastName: "Turing" },
    ],
    AT,
  );
});

describe("twinSchedulesFor", () => {
  test("two shared sections clears the default threshold", () => {
    ingestHarvest(
      "2026FA",
      [
        { id: "1", books: [book("BIO", "2500", "01"), book("CHEM", "2210", "01")] },
        { id: "2", books: [book("BIO", "2500", "01"), book("CHEM", "2210", "01")] },
      ],
      AT,
    );

    const twins = twinSchedulesFor("2026FA", "1");
    expect(twins).toHaveLength(1);
    expect(twins[0]).toMatchObject({ studentId: "2", name: "Grace Hopper" });
    expect(twins[0]!.sharedSections).toEqual(["BIO-2500-01", "CHEM-2210-01"]);
  });

  test("one shared section alone doesn't clear the default threshold of 2", () => {
    ingestHarvest(
      "2026FA",
      [
        { id: "1", books: [book("BIO", "2500", "01")] },
        { id: "2", books: [book("BIO", "2500", "01")] },
      ],
      AT,
    );
    expect(twinSchedulesFor("2026FA", "1")).toEqual([]);
  });

  test("minShared is adjustable, lower or higher", () => {
    ingestHarvest(
      "2026FA",
      [
        { id: "1", books: [book("BIO", "2500", "01")] },
        { id: "2", books: [book("BIO", "2500", "01")] },
      ],
      AT,
    );
    expect(twinSchedulesFor("2026FA", "1", 1)).toHaveLength(1);
    expect(twinSchedulesFor("2026FA", "1", 3)).toEqual([]);
  });

  test("most shared sections sorts first", () => {
    ingestHarvest(
      "2026FA",
      [
        {
          id: "1",
          books: [
            book("BIO", "2500", "01"),
            book("CHEM", "2210", "01"),
            book("MATH", "1710", "01"),
          ],
        },
        { id: "2", books: [book("BIO", "2500", "01"), book("CHEM", "2210", "01")] },
        {
          id: "3",
          books: [
            book("BIO", "2500", "01"),
            book("CHEM", "2210", "01"),
            book("MATH", "1710", "01"),
          ],
        },
      ],
      AT,
    );

    const twins = twinSchedulesFor("2026FA", "1");
    expect(twins.map((t) => t.studentId)).toEqual(["3", "2"]);
  });

  test("different sections of the same course don't count as shared", () => {
    ingestHarvest(
      "2026FA",
      [
        { id: "1", books: [book("BIO", "2500", "01"), book("CHEM", "2210", "01")] },
        // Section 02, not 01 -- a different room, a different time.
        { id: "2", books: [book("BIO", "2500", "02"), book("CHEM", "2210", "02")] },
      ],
      AT,
    );
    expect(twinSchedulesFor("2026FA", "1")).toEqual([]);
  });

  test("nobody with a booklist has no twins to find", () => {
    expect(twinSchedulesFor("2026FA", "1")).toEqual([]);
  });
});
