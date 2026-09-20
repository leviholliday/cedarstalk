import { describe, expect, test } from "bun:test";
import { geocode } from "../src/store/geocode";

/**
 * These run against the shipped Gazetteer asset rather than a fixture --
 * the whole point of the alias rules is how they behave on the real file's
 * naming conventions, which a hand-written fixture would just restate.
 */
describe("geocode", () => {
  test("an ordinary place matches by name", () => {
    expect(geocode("Xenia", "OH")).toMatchObject({ state: "OH" });
    expect(geocode("Cedarville", "OH")?.lat).toBeCloseTo(39.748, 2);
  });

  test("consolidated city-counties answer to the name people actually write", () => {
    // "Indianapolis city (balance)", "Louisville/Jefferson County metro
    // government (balance)", "Nashville-Davidson metropolitan government".
    expect(geocode("Indianapolis", "IN")?.lat).toBeCloseTo(39.77, 1);
    expect(geocode("Nashville", "TN")?.lat).toBeCloseTo(36.17, 1);
    expect(geocode("Lexington", "KY")?.lat).toBeCloseTo(38.04, 1);
    expect(geocode("Butte", "MT")).not.toBeNull();
  });

  test("a real place beats a name derived from a consolidated government", () => {
    // KY carries both "Louisville" and "Louisville/Jefferson County metro
    // government (balance)". The plain row should win -- derived aliases are
    // registered in a second pass precisely so they never shadow a real one.
    expect(geocode("Louisville", "KY")?.city).toBe("Louisville");
  });

  test("a place whose name genuinely ends in City keeps it", () => {
    // The regression this guards: stripping place types eagerly turned
    // "Plain City" into "Plain" and lost 35 people.
    expect(geocode("Plain City", "OH")).not.toBeNull();
    expect(geocode("Grove City", "OH")).not.toBeNull();
    expect(geocode("Tipp City", "OH")).not.toBeNull();
    expect(geocode("White City", "UT")).not.toBeNull();
    expect(geocode("Plain", "OH")).toBeNull();
  });

  test("punctuation and spacing don't have to match", () => {
    expect(geocode("Winston Salem", "NC")).not.toBeNull(); // Winston-Salem
    expect(geocode("Land O Lakes", "FL")).not.toBeNull(); // Land O' Lakes
    expect(geocode("  xenia  ", "oh")).not.toBeNull();
  });

  test("somewhere that isn't a US place is null rather than a guess", () => {
    expect(geocode("Nowhereville Xyz", "OH")).toBeNull();
    expect(geocode("London", "ZZ")).toBeNull();
  });
});
