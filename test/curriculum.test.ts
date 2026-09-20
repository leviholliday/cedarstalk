import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { courseGraph } from "../src/model/curriculum";
import { ingestHarvest } from "../src/store/harvest";

const AT = "2026-08-29T00:00:00.000Z";

const book = (department: string, course: string, section: string) => ({
  department,
  course,
  section,
  title: "Some Textbook",
});

beforeEach(() => {
  useDatabase(":memory:");
});

describe("courseGraph", () => {
  test("two courses shared by enough students form an edge", () => {
    ingestHarvest(
      "2026FA",
      [
        { id: "1", books: [book("BIO", "2500", "01"), book("CHEM", "2210", "01")] },
        { id: "2", books: [book("BIO", "2500", "01"), book("CHEM", "2210", "02")] },
        { id: "3", books: [book("BIO", "2500", "01"), book("CHEM", "2210", "01")] },
      ],
      AT,
    );

    const graph = courseGraph("2026FA", 3);
    expect(graph.edges).toEqual([{ a: "BIO-2500", b: "CHEM-2210", shared: 3 }]);
    // Note: edge counts by course, section is dropped -- CHEM-2210-01 and -02
    // both collapse to CHEM-2210, so all three students count toward the edge.
  });

  test("a pair below minShared produces no edge, and its courses are excluded as isolated", () => {
    ingestHarvest(
      "2026FA",
      [
        { id: "1", books: [book("BIO", "2500", "01"), book("CHEM", "2210", "01")] },
        { id: "2", books: [book("BIO", "2500", "01"), book("CHEM", "2210", "01")] },
      ],
      AT,
    );

    const graph = courseGraph("2026FA", 3);
    expect(graph.edges).toEqual([]);
    expect(graph.nodes).toEqual([]);
  });

  test("node student counts are per-course, independent of which edges survive", () => {
    ingestHarvest(
      "2026FA",
      [
        { id: "1", books: [book("BIO", "2500", "01"), book("CHEM", "2210", "01")] },
        { id: "2", books: [book("BIO", "2500", "01"), book("CHEM", "2210", "01")] },
        { id: "3", books: [book("BIO", "2500", "01"), book("CHEM", "2210", "01")] },
        // A fourth student takes only BIO-2500, raising its count without adding to the edge weight.
        { id: "4", books: [book("BIO", "2500", "01")] },
      ],
      AT,
    );

    const graph = courseGraph("2026FA", 3);
    const bio = graph.nodes.find((n) => n.code === "BIO-2500")!;
    const chem = graph.nodes.find((n) => n.code === "CHEM-2210")!;
    expect(bio.students).toBe(4);
    expect(chem.students).toBe(3);
    expect(graph.edges[0]!.shared).toBe(3);
  });

  test("a lone course nobody shares with anyone is isolated, so absent from the graph", () => {
    ingestHarvest("2026FA", [{ id: "1", books: [book("ART", "1000", "01")] }], AT);
    expect(courseGraph("2026FA", 3).nodes).toEqual([]);
  });

  test("no booklists at all is an empty graph, not an error", () => {
    expect(courseGraph("2026FA", 3)).toEqual({
      term: "2026FA",
      minShared: 3,
      nodes: [],
      edges: [],
    });
  });
});
