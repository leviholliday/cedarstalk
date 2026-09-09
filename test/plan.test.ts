import { beforeEach, describe, expect, test } from "bun:test";
import { planBooklists, planDirectory } from "../src/collect/plan";
import { db, useDatabase } from "../src/db";
import { adjacencyOf, shortestPath } from "../src/lib/route";
import { ingestHarvest } from "../src/store/harvest";
import { upsertPeople } from "../src/store/people";

const note = (last: string, first: string, count: number) =>
  db()
    .query("INSERT OR REPLACE INTO sweep_queries (last, first, count, at) VALUES (?, ?, ?, ?)")
    .run(last, first, count, new Date().toISOString());

beforeEach(() => {
  useDatabase(":memory:");
});

describe("planning the directory sweep", () => {
  test("a fresh database asks the alphabet", () => {
    const plan = planDirectory(100);
    expect(plan.queries).toHaveLength(26);
    expect(plan.queries[0]).toEqual({ last: "a", first: "" });
  });

  test("a query pegged at the cap gets split; a short one is finished", () => {
    // Two branches truncated at the same ceiling: that tie is what a cap looks
    // like from outside. The rest came back short and are done.
    const counts: Record<string, number> = { s: 50, m: 50 };
    let n = 1;
    for (const letter of "abcdefghijklmnopqrstuvwxyz") note(letter, "", counts[letter] ?? n++);

    const plan = planDirectory(100);
    expect(plan.cap).toBe(50);
    // Only the pegged branch is worth asking again, and only one letter deep.
    expect(plan.queries).toHaveLength(52);
    expect(plan.queries.every((query) => /^[ms]/.test(query.last))).toBe(true);
  });

  test("once the last name bottoms out it starts pinning the first name", () => {
    note("smit", "", 50);
    note("jone", "", 50); // the tie that makes 50 a cap rather than a maximum
    const plan = planDirectory(200, 4);
    // The unasked seeds still come first; what matters is how "smit" expanded.
    expect(plan.queries).toContainEqual({ last: "smit", first: "a" });
    expect(plan.queries).not.toContainEqual({ last: "smita", first: "" });
  });

  test("settled means nothing left to ask", () => {
    let n = 1;
    for (const letter of "abcdefghijklmnopqrstuvwxyz") note(letter, "", n++);
    expect(planDirectory(100).pending).toBe(0);
  });

  test("one big answer is not a cap", () => {
    // Nothing tied, so nothing was truncated: the biggest branch is just big.
    let n = 1;
    for (const letter of "abcdefghijklmnopqrstuvwxyz") note(letter, "", n++);
    note("s", "", 400);
    expect(planDirectory(100)).toMatchObject({ cap: 0, pending: 0 });
  });
});

describe("planning the booklist harvest", () => {
  test("only students still missing a booklist for the term", () => {
    upsertPeople([
      { Id: "1", LastName: "A", StudentType: "UG" },
      { Id: "2", LastName: "B", StudentType: "UG" },
      { Id: "3", LastName: "C", Title: "Professor" }, // staff, not swept
    ]);
    ingestHarvest("2027SP", [{ id: "1", books: [{ department: "CS", course: "1210" }] }]);

    const plan = planBooklists("2027SP");
    expect(plan.ids).toEqual(["2"]);
    // A different term is a different question, so both are outstanding there.
    expect(planBooklists("2027FA").ids).toEqual(["1", "2"]);
  });
});

describe("walking the campus", () => {
  // A square with a long way round: 0-1-2 is 20 metres, 0-3-2 is 200.
  const graph = {
    nodes: [
      [0, 0],
      [10, 0],
      [10, 10],
      [-100, 5],
    ] as [number, number][],
    edges: [
      [0, 1, 10],
      [1, 2, 10],
      [0, 3, 100],
      [3, 2, 100],
    ] as [number, number, number][],
  };

  test("takes the short way", () => {
    const path = shortestPath(graph, 0, 2, adjacencyOf(graph));
    expect(path?.nodes).toEqual([0, 1, 2]);
    expect(path?.cost).toBe(20);
  });

  test("reports real metres, not weighted cost", () => {
    const weighted = {
      nodes: graph.nodes,
      // Same geometry, but the path is stairs and costs more to walk.
      edges: [
        [0, 1, 14],
        [1, 2, 14],
      ] as [number, number, number][],
    };
    const path = shortestPath(weighted, 0, 2);
    expect(path?.cost).toBe(28);
    expect(path?.metres).toBe(20);
  });

  test("an unreachable corner is null rather than an empty route", () => {
    const split = { nodes: graph.nodes, edges: [[0, 1, 10]] as [number, number, number][] };
    expect(shortestPath(split, 0, 2)).toBeNull();
  });
});
