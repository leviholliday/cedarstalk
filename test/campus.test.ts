import { describe, expect, test } from "bun:test";
import { bestName, buildMap, labelMap, type OsmElement, pins } from "../src/collect/campus";

/**
 * A toy campus: two traced buildings and a footpath running past both, with a
 * third building that exists in the directory and nowhere else.
 */
const square = (lat: number, lon: number) => [
  { lat, lon },
  { lat: lat + 0.0002, lon },
  { lat: lat + 0.0002, lon: lon + 0.0002 },
  { lat, lon: lon + 0.0002 },
];

const osm: { elements: OsmElement[] } = {
  elements: [
    { tags: { building: "university", name: "Printy Hall" }, geometry: square(39.7452, -83.8123) },
    { tags: { building: "dormitory", name: "Lawlor Hall" }, geometry: square(39.7462, -83.8123) },
    {
      tags: { highway: "footway" },
      nodes: [1, 2, 3],
      geometry: [
        { lat: 39.745, lon: -83.8125 },
        { lat: 39.746, lon: -83.8125 },
        { lat: 39.747, lon: -83.8125 },
      ],
    },
  ],
};

const labels = [
  { label: "Printy Hall", osm: "Printy Hall", kind: "dorm" },
  { label: "Lawlor Hall", osm: "Lawlor Hall", kind: "dorm" },
  { label: "Cedar Park", osm: "Cedar Park", kind: "dorm" },
];

describe("building the campus", () => {
  test("a building nobody draws is missing, and says so", () => {
    const map = buildMap(osm, labels);
    expect(Object.keys(map.anchors).sort()).toEqual(["Lawlor Hall", "Printy Hall"]);
    expect(map.missing).toEqual(["Cedar Park"]);
  });

  test("a pin fills that hole, and lands on the nearest path node", () => {
    const map = buildMap(
      osm,
      labels,
      {},
      {
        "Cedar Park": { label: "Cedar Park", lat: 39.747, lon: -83.8126, note: "fitted" },
      },
    );

    expect(map.missing).toEqual([]);
    const pinned = map.anchors["Cedar Park"]!;
    expect(pinned.source).toBe("pin");
    expect(pinned.lat).toBeCloseTo(39.747, 4);
    // The third node of the footpath is the one it sits beside.
    expect(map.nodes[pinned.node]?.[1]).toBeCloseTo(map.nodes[2]?.[1] ?? 0, 1);
  });

  test("a pin is a position, not a footprint, so nothing new gets drawn", () => {
    const drawn = buildMap(osm, labels).buildings.length;
    const withPin = buildMap(
      osm,
      labels,
      {},
      {
        "Cedar Park": { label: "Cedar Park", lat: 39.747, lon: -83.8126, note: "fitted" },
      },
    ).buildings.length;
    expect(withPin).toBe(drawn);
  });
});

describe("the curated files", () => {
  test("every alias names a building, and Gromacki points at the townhouse", () => {
    const map = new Map(labelMap().map((row) => [row.label, row.osm]));
    expect(map.get("Gromacki Hall")).toBe("Townhouse 2");
    expect(map.get("Ambassador")).toBe("Ambassador Hall");
    expect(map.get("Engineering Project Lab")).toBe("Engineering Projects Laboratory");
  });

  test("pins parse, and sit on campus rather than in the sea", () => {
    const all = pins();
    expect(all.length).toBeGreaterThan(0);
    for (const pin of all) {
      expect(pin.lat).toBeGreaterThan(39.7);
      expect(pin.lat).toBeLessThan(39.8);
      expect(pin.lon).toBeLessThan(-83.7);
      expect(pin.lon).toBeGreaterThan(-83.9);
      expect(pin.note).not.toBe("");
    }
  });

  test("the four College View blocks share one position", () => {
    const blocks = pins().filter((pin) => pin.label.startsWith("College View"));
    expect(blocks).toHaveLength(4);
    expect(new Set(blocks.map((pin) => `${pin.lat},${pin.lon}`)).size).toBe(1);
  });
});

describe("matching a directory name to a drawn building", () => {
  test("the shorthand still finds it", () => {
    const osmNames = ["Engineering and Science Center", "Centennial Library", "Printy Hall"];
    expect(bestName("Engineering and Science Ctr", osmNames)).toBe(
      "Engineering and Science Center",
    );
  });

  test("a building that is not there stays unmatched", () => {
    expect(bestName("OPS B - Grounds Shop", ["Centennial Library", "Printy Hall"])).toBeNull();
  });
});
