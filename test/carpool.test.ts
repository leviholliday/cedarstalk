import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { carpoolClusters, carpoolFor } from "../src/model/carpool";
import { upsertPeople } from "../src/store/people";

const AT = "2026-08-29T00:00:00.000Z";

const person = (id: string, city: string | null, state: string | null) => ({
  Id: id,
  FirstName: "Test",
  LastName: id,
  AddressCity: city,
  AddressState: state,
});

// Real cities from the shipped Gazetteer asset, chosen for known real distances:
// Columbus and Dayton, OH are ~70 miles apart; Xenia is ~5 miles from Cedarville
// (though Cedarville itself isn't a hometown anyone would list). Cleveland, OH
// is ~200 miles from Columbus. "Nowhere" never resolves.

beforeEach(() => {
  useDatabase(":memory:");
});

describe("carpoolFor", () => {
  test("two people in the same city are well within any reasonable radius", () => {
    upsertPeople([person("1", "Columbus", "OH"), person("2", "Columbus", "OH")], AT);
    const result = carpoolFor("1", 10)!;
    expect(result.geocoded).toBe(true);
    expect(result.matches.map((m) => m.id)).toEqual(["2"]);
    expect(result.matches[0]!.distanceMiles).toBe(0);
  });

  test("a nearby city is included; a distant one is not, at a modest radius", () => {
    upsertPeople(
      [person("1", "Columbus", "OH"), person("2", "Dayton", "OH"), person("3", "Cleveland", "OH")],
      AT,
    );
    const result = carpoolFor("1", 80)!;
    expect(result.matches.map((m) => m.id)).toEqual(["2"]);
  });

  test("widening the radius picks up the distant city too", () => {
    upsertPeople([person("1", "Columbus", "OH"), person("2", "Cleveland", "OH")], AT);
    expect(carpoolFor("1", 50)!.matches).toEqual([]);
    expect(carpoolFor("1", 250)!.matches.map((m) => m.id)).toEqual(["2"]);
  });

  test("a hometown the Gazetteer doesn't know reports unresolved rather than crashing", () => {
    upsertPeople([person("1", "Nowhereville Xyz", "OH")], AT);
    const result = carpoolFor("1", 40)!;
    expect(result.geocoded).toBe(false);
    expect(result.matches).toEqual([]);
  });

  test("nobody with a hometown on file is honest, not an error", () => {
    upsertPeople([person("1", null, null)], AT);
    const result = carpoolFor("1", 40)!;
    expect(result.home).toBeNull();
    expect(result.geocoded).toBe(false);
  });

  test("an unknown person is null", () => {
    expect(carpoolFor("nonexistent", 40)).toBeNull();
  });

  test("results sort nearest first", () => {
    upsertPeople(
      [person("1", "Columbus", "OH"), person("2", "Cleveland", "OH"), person("3", "Dayton", "OH")],
      AT,
    );
    const result = carpoolFor("1", 300)!;
    expect(result.matches.map((m) => m.id)).toEqual(["3", "2"]);
  });
});

describe("carpoolClusters", () => {
  test("a lone person in a lone city forms no cluster", () => {
    upsertPeople([person("1", "Columbus", "OH")], AT);
    expect(carpoolClusters(40).clusters).toEqual([]);
  });

  test("two nearby cities merge into one cluster", () => {
    upsertPeople([person("1", "Columbus", "OH"), person("2", "Dayton", "OH")], AT);
    const { clusters } = carpoolClusters(80);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.people).toBe(2);
    expect(clusters[0]!.cities.map((c) => c.city).sort()).toEqual(["Columbus", "Dayton"]);
  });

  test("a distant city stays its own cluster, or none if it's alone", () => {
    upsertPeople(
      [person("1", "Columbus", "OH"), person("2", "Dayton", "OH"), person("3", "Cleveland", "OH")],
      AT,
    );
    const { clusters } = carpoolClusters(80);
    // Cleveland is alone at this radius -- one person, no cluster for it.
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.people).toBe(2);
  });

  test("unresolved hometowns are counted, not silently dropped", () => {
    upsertPeople([person("1", "Columbus", "OH"), person("2", "Nowhereville Xyz", "OH")], AT);
    const result = carpoolClusters(40);
    expect(result.unresolvedPlaces).toBe(1);
    expect(result.unresolvedPeople).toBe(1);
  });
});
