/**
 * One database, four sources.
 *
 * The directory, the course catalog, the printed book and the harvested
 * booklists arrive from four different places on four different schedules, and
 * every interesting question crosses at least two of them: who is in this
 * dorm, what is that person most likely studying, which sections of the course
 * their program requires still have seats. Kept in four files they can only be
 * joined in application code; kept here they are one query.
 *
 * Payload columns hold the upstream record verbatim. The named columns beside
 * them are the fields worth indexing, extracted on write so a search is an
 * index scan rather than ten thousand JSON parses.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id            TEXT PRIMARY KEY,
  username      TEXT,
  first_name    TEXT,
  last_name     TEXT,
  middle_name   TEXT,
  nickname      TEXT,
  city          TEXT,
  state         TEXT,
  country       TEXT,
  department    TEXT,
  title         TEXT,
  office_code   TEXT,
  office_name   TEXT,
  office_room   TEXT,
  office_phone  TEXT,
  dorm_code     TEXT,
  dorm_name     TEXT,
  dorm_room     TEXT,
  student_type  TEXT,
  student_class TEXT,
  student_worker TEXT,
  emp_inactive  TEXT,
  photo_url     TEXT,
  payload       TEXT NOT NULL,
  -- Whether the last complete sweep still found them. Graduating, transferring
  -- and being hired all look the same from here: a row that stops coming back.
  present       INTEGER NOT NULL DEFAULT 1,
  first_seen    TEXT NOT NULL,
  last_seen     TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS people_last ON people (last_name);
CREATE INDEX IF NOT EXISTS people_first ON people (first_name);
CREATE INDEX IF NOT EXISTS people_dorm ON people (dorm_name);
CREATE INDEX IF NOT EXISTS people_type ON people (student_type, student_class);

CREATE INDEX IF NOT EXISTS people_present ON people (present);

-- Who arrived, who left, and what changed about the ones who stayed.
--
-- The directory is a snapshot API: ask it today and it tells you today. Every
-- interesting question about it is longitudinal — when someone moved dorms,
-- which class actually graduated, whether a booklist shifted mid-semester —
-- and none of that survives an upsert. So every change is written down as it
-- happens, and the current row is just the latest frame.
CREATE TABLE IF NOT EXISTS person_events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL,
  at         TEXT NOT NULL,
  kind       TEXT NOT NULL,  -- appeared | changed | vanished | returned
  field      TEXT,
  was        TEXT,
  now        TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS person_events_student ON person_events (student_id, seq);
CREATE INDEX IF NOT EXISTS person_events_at ON person_events (at);
CREATE INDEX IF NOT EXISTS person_events_kind ON person_events (kind, at);

-- One row per collection run, whoever ran it: the CLI sweep, the browser
-- extension, a manual ingest. "Vanished" is only meaningful against a run that
-- claimed to see everybody, which is what "complete" records.
CREATE TABLE IF NOT EXISTS sweeps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,  -- directory | booklists | catalog | book
  source      TEXT NOT NULL,  -- cli | extension | import
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  complete    INTEGER NOT NULL DEFAULT 0,
  seen        INTEGER NOT NULL DEFAULT 0,
  added       INTEGER NOT NULL DEFAULT 0,
  changed     INTEGER NOT NULL DEFAULT 0,
  vanished    INTEGER NOT NULL DEFAULT 0,
  note        TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS sweeps_kind ON sweeps (kind, started_at);

-- Sweep bookkeeping: which (last, first) prefix pairs have been asked, and how
-- many rows came back. A run that dies mid-sweep resumes from these.
CREATE TABLE IF NOT EXISTS sweep_queries (
  last  TEXT NOT NULL,
  first TEXT NOT NULL,
  count INTEGER NOT NULL,
  at    TEXT NOT NULL,
  PRIMARY KEY (last, first)
) STRICT;

CREATE TABLE IF NOT EXISTS sections (
  term       TEXT NOT NULL,
  section_id TEXT NOT NULL,
  course_id  TEXT NOT NULL,
  code       TEXT,
  name       TEXT,
  title      TEXT,
  faculty    TEXT,
  meetings   TEXT,
  available  INTEGER,
  capacity   INTEGER,
  payload    TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (term, section_id)
) STRICT;

CREATE INDEX IF NOT EXISTS sections_course ON sections (term, course_id);
CREATE INDEX IF NOT EXISTS sections_code ON sections (code);

-- Seats, over time. \`sections\` above is overwritten on every collect, which
-- is right for "what does this section look like now" and wrong for "how
-- fast did it fill" -- that question needs every collect kept, not just the
-- latest. Append-only; one row per section per collect.
CREATE TABLE IF NOT EXISTS section_seats (
  term        TEXT NOT NULL,
  section_id  TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  available   INTEGER,
  capacity    INTEGER,
  enrolled    INTEGER,
  PRIMARY KEY (term, section_id, observed_at)
) STRICT;

CREATE INDEX IF NOT EXISTS section_seats_lookup ON section_seats (term, section_id, observed_at);

-- Every (building, room) a term's catalog actually meets in, kept across
-- terms rather than only the latest -- a room used in the spring and not the
-- fall should not disappear because the fall crawl never saw it.
CREATE TABLE IF NOT EXISTS rooms (
  term         TEXT NOT NULL,
  building     TEXT NOT NULL,
  room         TEXT NOT NULL,
  campus_label TEXT,             -- buildings.label, when the name resolves
  sections     INTEGER NOT NULL DEFAULT 0,
  fetched_at   TEXT NOT NULL,
  PRIMARY KEY (term, building, room)
) STRICT;

CREATE INDEX IF NOT EXISTS rooms_building ON rooms (term, building);

-- The occupancy grid: one row per room per meeting-day, flattened from
-- sections.payload so every free-room/quietness query is an index scan
-- rather than a JSON parse of the whole term. A materialized view, rebuilt
-- wholesale after every catalog collect -- never written to by hand.
CREATE TABLE IF NOT EXISTS room_occupancy (
  term       TEXT NOT NULL,
  building   TEXT NOT NULL,
  room       TEXT NOT NULL,
  day        INTEGER NOT NULL,  -- 0 = Sunday
  start_min  INTEGER NOT NULL,
  end_min    INTEGER NOT NULL,
  section_id TEXT NOT NULL,
  code       TEXT,
  name       TEXT,
  title      TEXT,
  kind       TEXT,
  enrolled   INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS room_occupancy_room ON room_occupancy (term, building, room, day, start_min);
CREATE INDEX IF NOT EXISTS room_occupancy_building ON room_occupancy (term, building, day, start_min);

CREATE TABLE IF NOT EXISTS courses (
  term       TEXT NOT NULL,
  course_id  TEXT NOT NULL,
  code       TEXT,
  subject    TEXT,
  number     TEXT,
  title      TEXT,
  credits    REAL,
  payload    TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (term, course_id)
) STRICT;

CREATE INDEX IF NOT EXISTS courses_code ON courses (code);
CREATE INDEX IF NOT EXISTS courses_subject ON courses (subject);

-- Requirement groups Colleague will not enumerate in an evaluation, resolved
-- once via the course search. The same rule resolves the same way for
-- everyone, so these are keyed by catalog coordinates, never by student.
CREATE TABLE IF NOT EXISTS rule_groups (
  requirement    TEXT NOT NULL,
  subrequirement TEXT NOT NULL,
  grp            TEXT NOT NULL,
  courses        TEXT NOT NULL,
  fetched_at     TEXT NOT NULL,
  PRIMARY KEY (requirement, subrequirement, grp)
) STRICT;

CREATE TABLE IF NOT EXISTS programs (
  year          TEXT NOT NULL,
  page          INTEGER NOT NULL,
  title         TEXT NOT NULL,
  total_credits REAL,
  courses       TEXT NOT NULL,
  payload       TEXT NOT NULL,
  fetched_at    TEXT NOT NULL,
  PRIMARY KEY (year, page)
) STRICT;

CREATE INDEX IF NOT EXISTS programs_title ON programs (title);

-- One student's booklist for one term, plus the course codes it leaks. More
-- terms per student is a richer fingerprint, which is the whole premise of the
-- major model.
CREATE TABLE IF NOT EXISTS booklists (
  term       TEXT NOT NULL,
  student_id TEXT NOT NULL,
  books      TEXT NOT NULL,
  codes      TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (term, student_id)
) STRICT;

CREATE INDEX IF NOT EXISTS booklists_student ON booklists (student_id);

-- A booklist that changes mid-term is a schedule change: a course added, one
-- dropped. That is signal the merged fingerprint throws away, so the delta is
-- kept even though the current list is what gets scored.
CREATE TABLE IF NOT EXISTS booklist_events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL,
  term       TEXT NOT NULL,
  at         TEXT NOT NULL,
  kind       TEXT NOT NULL,  -- first | changed
  added      TEXT NOT NULL,
  removed    TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS booklist_events_student ON booklist_events (student_id, seq);
CREATE INDEX IF NOT EXISTS booklist_events_term ON booklist_events (term, at);

-- The registrar's own taxonomy: every program, the department that teaches it,
-- and the school it belongs to.
--
-- Worth having for its own sake, and worth more than that to the model: eleven
-- schools is a better bucket than eight regexes I wrote by hand, and it is the
-- university's own answer to "how close was that guess" rather than mine.
CREATE TABLE IF NOT EXISTS majors (
  program    TEXT NOT NULL,
  level      TEXT NOT NULL,   -- major | minor | concentration | ...
  department TEXT,
  school     TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (program, level)
) STRICT;

CREATE INDEX IF NOT EXISTS majors_school ON majors (school);

-- Known majors, for scoring the model against reality.
CREATE TABLE IF NOT EXISTS labels (
  student_id TEXT PRIMARY KEY,
  source     TEXT NOT NULL,
  major      TEXT NOT NULL,
  major2     TEXT,
  at         TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS metrics (
  at       TEXT NOT NULL,
  source   TEXT NOT NULL,
  terms    TEXT NOT NULL,
  scored   INTEGER NOT NULL,
  exact    REAL NOT NULL,
  top3     REAL NOT NULL,
  cluster  REAL NOT NULL,
  PRIMARY KEY (at, source)
) STRICT;

-- The campus itself: outlines to draw, and a walking graph to route on.
--
-- Merged in from the assassins project, where the map was built to chase
-- people around. The same graph answers quieter questions here: how far a
-- freshman walks in a day, which dorms feed which building, where a class of
-- people actually is at ten in the morning. Every person already carries a
-- dorm or an office name, so the join needs nothing new from anybody.
CREATE TABLE IF NOT EXISTS campus (
  key        TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  fetched_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS buildings (
  label      TEXT PRIMARY KEY,   -- as the directory and catalog write it
  osm_name   TEXT,
  kind       TEXT,               -- dorm | office | both | unknown
  lat        REAL,
  lon        REAL,
  x          REAL,               -- metres east of the map origin
  y          REAL,               -- metres south of it
  node       INTEGER,            -- nearest walking-graph node, i.e. the door
  gender     TEXT,               -- male | female | mixed, for the halls
  ring       TEXT,               -- outline, in map metres
  source     TEXT NOT NULL,      -- osm | tour
  fetched_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS requests (
  at       TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status   INTEGER NOT NULL,
  ms       REAL NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS requests_at ON requests (at);
`;

let handle: Database | undefined;

/** The one database. Opened on first use so the CLI and server share it. */
export function db(path = config.databasePath): Database {
  if (handle) return handle;
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  handle = new Database(path, { create: true });
  handle.exec("PRAGMA journal_mode = WAL");
  handle.exec("PRAGMA synchronous = NORMAL");
  handle.exec("PRAGMA foreign_keys = ON");
  // WAL lets readers run alongside a writer, but not two writers -- and there
  // are three processes writing now: the server taking synced batches, the
  // catalog collector, and the directory sweep. Without a busy timeout the
  // loser of a collision fails instantly with SQLITE_BUSY, which is how the
  // scheduled catalog collect was dying. Ten seconds is far longer than any
  // of these transactions takes, so a collision becomes a short wait.
  handle.exec("PRAGMA busy_timeout = 10000");
  handle.exec(SCHEMA);
  return handle;
}

/** Point the process at a different file. Tests use ":memory:". */
export function useDatabase(path: string): Database {
  handle?.close();
  handle = undefined;
  return db(path);
}

export function closeDatabase(): void {
  handle?.close();
  handle = undefined;
}
