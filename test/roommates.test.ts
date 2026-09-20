import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { dormRooms, retireUnseen, roommatesOf, upsertPeople } from "../src/store/people";

const AT = "2026-08-29T00:00:00.000Z";

const person = (
  id: string,
  first: string,
  last: string,
  dorm: string | null,
  room: string | null,
) => ({
  Id: id,
  FirstName: first,
  LastName: last,
  DormName: dorm,
  DormRoom: room,
});

beforeEach(() => {
  useDatabase(":memory:");
});

describe("roommatesOf", () => {
  test("finds everyone else in the exact same room", () => {
    upsertPeople(
      [
        person("1", "Ada", "Lovelace", "Printy Hall", "37A"),
        person("2", "Grace", "Hopper", "Printy Hall", "37A"),
        person("3", "Alan", "Turing", "Printy Hall", "37B"),
      ],
      AT,
    );

    const roommates = roommatesOf("1");
    expect(roommates.map((p) => p.id)).toEqual(["2"]);
  });

  test("a different letter-suffix room is not a roommate, even in the same hall", () => {
    upsertPeople(
      [
        person("1", "Ada", "Lovelace", "Printy Hall", "37A"),
        person("2", "Alan", "Turing", "Printy Hall", "37B"),
      ],
      AT,
    );
    expect(roommatesOf("1")).toEqual([]);
  });

  test("a College View bedroom slot only matches its own exact slot, not the whole apartment", () => {
    upsertPeople(
      [
        person("1", "A", "One", "College View Apartment A", "101-1"),
        person("2", "B", "Two", "College View Apartment A", "101-1"),
        person("3", "C", "Three", "College View Apartment A", "101-2"),
      ],
      AT,
    );
    expect(roommatesOf("1").map((p) => p.id)).toEqual(["2"]);
  });

  test("someone with no dorm has no roommates, not an error", () => {
    upsertPeople([person("1", "Ada", "Lovelace", null, null)], AT);
    expect(roommatesOf("1")).toEqual([]);
  });

  test("a departed roommate no longer counts", () => {
    upsertPeople(
      [
        person("1", "Ada", "Lovelace", "Printy Hall", "37A"),
        person("2", "Grace", "Hopper", "Printy Hall", "37A"),
      ],
      AT,
    );
    // A complete sweep that only re-saw person 1 retires person 2.
    const secondSweep = "2026-09-01T00:00:00.000Z";
    upsertPeople([person("1", "Ada", "Lovelace", "Printy Hall", "37A")], secondSweep);
    retireUnseen(secondSweep);

    expect(roommatesOf("1")).toEqual([]);
  });
});

describe("dormRooms", () => {
  test("groups a whole hall's occupants by room", () => {
    upsertPeople(
      [
        person("1", "Ada", "Lovelace", "Printy Hall", "37A"),
        person("2", "Grace", "Hopper", "Printy Hall", "37A"),
        person("3", "Alan", "Turing", "Printy Hall", "37B"),
      ],
      AT,
    );

    const rooms = dormRooms("Printy Hall");
    expect(rooms).toHaveLength(2);
    expect(rooms.find((r) => r.room === "37A")?.occupants.map((p) => p.id)).toEqual(["2", "1"]);
    expect(rooms.find((r) => r.room === "37B")?.occupants.map((p) => p.id)).toEqual(["3"]);
  });

  test("a dorm with nobody in it is an empty list", () => {
    expect(dormRooms("Nowhere Hall")).toEqual([]);
  });
});
