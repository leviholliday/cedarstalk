import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { fingerprintOf, ingestHarvest } from "../src/store/harvest";
import { booklistTimeline, personTimeline, termChurn } from "../src/store/history";
import { retireUnseen, searchPeople, upsertPeople } from "../src/store/people";

const person = (id: string, over: Record<string, unknown> = {}) => ({
  Id: id,
  FirstName: "Ada",
  LastName: "Lovelace",
  DormName: "Printy Hall",
  DormRoom: "P101",
  StudentType: "UG",
  StudentClass: "FR",
  ...over,
});

beforeEach(() => {
  useDatabase(":memory:");
});

describe("the directory over time", () => {
  test("a new person appears once, not on every sweep", () => {
    upsertPeople([person("1")], "2026-01-01T00:00:00.000Z");
    upsertPeople([person("1")], "2026-01-02T00:00:00.000Z");

    const events = personTimeline("1");
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("appeared");
  });

  test("a dorm move is recorded with both sides of it", () => {
    upsertPeople([person("1")], "2026-01-01T00:00:00.000Z");
    const tally = upsertPeople(
      [person("1", { DormName: "Lawlor Hall", DormRoom: "L204" })],
      "2026-08-01T00:00:00.000Z",
    );

    expect(tally.changed).toBe(1);
    const moves = personTimeline("1").filter((event) => event.field === "dorm_name");
    expect(moves[0]).toMatchObject({ kind: "changed", was: "Printy Hall", now: "Lawlor Hall" });
  });

  test("fields that churn for no reason stay quiet", () => {
    upsertPeople([person("1", { PhotoUrl: "a.jpg" })], "2026-01-01T00:00:00.000Z");
    upsertPeople([person("1", { PhotoUrl: "b.jpg" })], "2026-01-02T00:00:00.000Z");
    expect(personTimeline("1").filter((event) => event.kind === "changed")).toHaveLength(0);
  });

  test("someone a complete sweep missed is retired, and comes back if they return", () => {
    upsertPeople([person("1"), person("2")], "2026-01-01T00:00:00.000Z");

    // A sweep that started later saw only the first of them.
    upsertPeople([person("1")], "2026-06-01T00:00:00.000Z");
    expect(retireUnseen("2026-05-01T00:00:00.000Z")).toBe(1);

    expect(searchPeople({}).map((p) => p.id)).toEqual(["1"]);
    expect(searchPeople({ includeGone: true })).toHaveLength(2);
    expect(personTimeline("2")[0]?.kind).toBe("vanished");

    upsertPeople([person("2")], "2026-09-01T00:00:00.000Z");
    expect(personTimeline("2")[0]?.kind).toBe("returned");
    expect(searchPeople({})).toHaveLength(2);
  });
});

describe("booklists over time", () => {
  const books = (...codes: string[]) =>
    codes.map((code) => ({ department: code.split("-")[0], course: code.split("-")[1] }));

  test("the first harvest of a term is a first, not a change", () => {
    ingestHarvest("2027SP", [{ id: "1", books: books("CS-1210", "MATH-1715") }]);
    const events = booklistTimeline("1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "first", added: ["CS-1210", "MATH-1715"] });
  });

  test("a schedule change shows up as a delta, and the fingerprint keeps both terms", () => {
    ingestHarvest("2027SP", [{ id: "1", books: books("CS-1210", "MATH-1715") }]);
    ingestHarvest("2027SP", [{ id: "1", books: books("CS-1210", "PHYS-2110") }]);

    const [latest] = booklistTimeline("1");
    expect(latest).toMatchObject({ kind: "changed", added: ["PHYS-2110"], removed: ["MATH-1715"] });
    expect(termChurn("2027SP")).toMatchObject({ added: 1, removed: 1, students: 1 });

    ingestHarvest("2027FA", [{ id: "1", books: books("CS-2210") }]);
    const merged = fingerprintOf("1");
    expect(merged?.terms).toEqual(["2027FA", "2027SP"]);
    expect(merged?.courses).toEqual(["CS-1210", "CS-2210", "PHYS-2110"]);
  });
});
