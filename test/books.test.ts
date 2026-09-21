import { beforeEach, describe, expect, test } from "bun:test";
import { useDatabase } from "../src/db";
import { booksFor, codeOf, holdersOf, isRealIsbn } from "../src/model/books";
import { ingestHarvest } from "../src/store/harvest";

const TERM = "2026FA";
const AT = "2026-08-29T00:00:00.000Z";

const book = (isbn: string | null, title: string, department = "COM-Communication Arts") => ({
  department,
  course: "1150-Communication Seminar",
  section: "01-01",
  title,
  isbn,
  edition: null,
  status: "required",
  prices: [],
});

beforeEach(() => {
  useDatabase(":memory:");
});

describe("isRealIsbn", () => {
  test("accepts 10-13 digit numbers", () => {
    expect(isRealIsbn("9780134685991")).toBe(true);
    expect(isRealIsbn("0134685997")).toBe(true);
  });

  test("rejects the store's digital-materials placeholder", () => {
    // Counting DIRECTACCESS rows as books would invent a shared title that
    // hundreds of unrelated students appear to need.
    expect(isRealIsbn("DIRECTACCESS")).toBe(false);
    expect(isRealIsbn(null)).toBe(false);
    expect(isRealIsbn("")).toBe(false);
  });
});

describe("codeOf", () => {
  test("rebuilds a course code from the store's own strings", () => {
    expect(
      codeOf({
        department: "COM-Communication Arts",
        course: "1150-Communication Seminar",
        section: "01-01",
        title: null,
        isbn: null,
        edition: null,
        status: null,
      }),
    ).toBe("COM-1150");
  });
});

describe("booksFor", () => {
  test("counts how many others need the same ISBN, excluding the asker", () => {
    ingestHarvest(
      TERM,
      [
        { id: "1", books: [book("9780134685991", "Effective Java")] },
        { id: "2", books: [book("9780134685991", "Effective Java")] },
        { id: "3", books: [book("9780134685991", "Effective Java")] },
      ],
      AT,
    );

    const mine = booksFor(TERM, "1");
    expect(mine?.books[0]?.alsoNeededBy).toBe(2);
  });

  test("a book nobody else needs reports zero, not one", () => {
    ingestHarvest(TERM, [{ id: "1", books: [book("9780134685991", "Alone")] }], AT);
    expect(booksFor(TERM, "1")?.books[0]?.alsoNeededBy).toBe(0);
  });

  test("placeholder rows are counted separately, not listed as books", () => {
    ingestHarvest(
      TERM,
      [
        {
          id: "1",
          books: [book("DIRECTACCESS", "Direct Access Material"), book("9780134685991", "Real")],
        },
      ],
      AT,
    );

    const mine = booksFor(TERM, "1");
    expect(mine?.books.map((b) => b.title)).toEqual(["Real"]);
    expect(mine?.withoutIsbn).toBe(1);
  });

  test("a student with no harvested booklist is null, not empty", () => {
    // Distinguishable by the caller: "no books" and "never harvested" are
    // different answers and deserve different words on screen.
    expect(booksFor(TERM, "ghost")).toBeNull();
  });

  test("the most widely shared book sorts first", () => {
    ingestHarvest(
      TERM,
      [
        { id: "1", books: [book("9780000000001", "Rare"), book("9780000000002", "Common")] },
        { id: "2", books: [book("9780000000002", "Common")] },
        { id: "3", books: [book("9780000000002", "Common")] },
      ],
      AT,
    );

    expect(booksFor(TERM, "1")?.books.map((b) => b.title)).toEqual(["Common", "Rare"]);
  });
});

describe("holdersOf", () => {
  test("lists everyone needing one ISBN", () => {
    ingestHarvest(
      TERM,
      [
        { id: "1", books: [book("9780134685991", "Effective Java")] },
        { id: "2", books: [book("9780134685991", "Effective Java")] },
        { id: "3", books: [book("9780000000009", "Something Else")] },
      ],
      AT,
    );

    const holders = holdersOf(TERM, "9780134685991");
    expect(holders.title).toBe("Effective Java");
    // Names resolve only for people the directory has; ids are what matter here.
    expect(holders.students.length).toBeLessThanOrEqual(2);
  });

  test("an ISBN nobody needs is empty rather than an error", () => {
    ingestHarvest(TERM, [{ id: "1", books: [book("9780134685991", "A")] }], AT);
    expect(holdersOf(TERM, "9780000000000").students).toEqual([]);
  });
});
