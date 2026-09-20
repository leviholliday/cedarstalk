# cedarengine build plan

## Status

- **Phase 0 (0.1–0.4): done.** `src/model/meetings.ts` (parser export), `src/store/rooms.ts` +
  `src/model/occupancy.ts` (room registry + grid, `rebuildOccupancy(term)` wired into every
  catalog-collect path, plus `bun run engine rebuild [term...]`), and `section_seats` (append-only,
  written on every `replaceTerm`). All covered by tests (`test/meetings.test.ts`,
  `test/occupancy.test.ts`, `test/seats.test.ts`), typechecked, linted clean. Verified against the
  live 2026FA catalog: 153 rooms, 2,898 occupancy slots.
- A macOS launchd agent (`~/Library/LaunchAgents/sh.dunkirk.cedarengine.collect.plist`) runs
  `collect catalog` every 30 minutes so seat snapshots actually accumulate. `launchctl list | grep
  cedarengine` to check it; `launchctl bootout gui/$(id -u)/sh.dunkirk.cedarengine.collect` to stop it.
- **Known data-quality item, not a bug:** a few `BuildingDisplay` values from the catalog are
  cross-registration partners, not campus buildings (`Internatl Center Creativity; Obsolete`,
  `Xenia Partner School; Obsolete`, `Central State Univ`, `Wright State Univ`). These correctly get
  `campusLabel: null` in `roomsFreeAt`/room registry output, since `buildingByLabel()` has nothing
  to resolve them to. **Phase 1 features that use walking distance or the map (1.1, 1.2, 5.2)
  should filter to `campusLabel !== null`** rather than trying to place these on campus.
- **Phase 1.1 + 1.2: done.** `src/routes/rooms.ts` — `GET /v1/rooms/free` (sort=quiet|near|longest),
  `GET /v1/rooms/quiet` (ranked, with a `gem` flag for the bottom-35th-percentile "hidden gem"
  rooms), `GET /v1/buildings/:name/rhythm` (30-min headcount buckets for a chart). Scoring lives in
  `src/model/quiet.ts`: `quiet = 0.5·ambient + 0.3·spill + 0.2·centrality`, all normalized 0-100,
  every component returned alongside the composite so a caller can check the work.
  **`centrality` is not synthetic graph betweenness — it's real measured foot traffic**, reusing
  the term's actual dorm-to-class routing already computed for `/v1/campus/traffic`
  (`nodeTraffic()`, extracted from `model/traffic.ts`'s `edgeLoad()` via a refactor that changed no
  existing behavior — `campusTraffic()` and `chain()` still produce identical output, confirmed by
  the untouched `test/plan.test.ts` suite passing unchanged). Degrades to `centrality: 0` rather
  than erroring when no campus map or booklists exist yet.
  Verified against live 2026FA data: 143 free rooms at a real Wednesday-10am query, quiet scores
  spread 0-95, real walking distances via `near=`, a real 551-person peak on the Engineering and
  Science Ctr rhythm curve.
  Tests: `test/quiet.test.ts` (5 tests, the actual scoring logic — same-instant vs. spill-driven
  quietness, `onCampusOnly` filtering, empty-result handling).
- **Phase 1.3 + 1.4: done.** `GET /v1/rooms/utilization` (`model/occupancy.ts`'s `roomUtilization`)
  and `GET /v1/faculty` + `GET /v1/faculty/:name` (new `src/model/faculty.ts` + `src/routes/faculty.ts`).
  **Two real bugs caught by live-data testing, not by the unit tests** (worth remembering: synthetic
  fixtures didn't have either failure mode built in):
  1. Naively summing each section's booked minutes let overlapping/cross-listed sections in the
     same room push utilization past 100% (a real room, "Internatl Center Creativity," showed
     173%). Fixed by merging overlapping intervals per room per day before summing — see the
     `mergedMinutes` interval-merge in `roomUtilization`. Regression-tested in
     `test/utilization.test.ts` ("two cross-listed sections... count as one hour, not two").
  2. Colleague's `FacultyDisplay` is a single comma-joined string for team-taught sections (a real
     one: seven names on one clinical rotation). Un-fixed, that string was ranking #1 in "who
     teaches the most" as a single fake person. Fixed by splitting on comma and crediting every
     named instructor fully — see `namesOf()` in `model/faculty.ts`. Regression-tested in
     `test/faculty.test.ts`.
  Utilization window is read off the term itself (earliest class start to latest class end,
  times however many distinct days have any class) rather than a hardcoded assumption — live 2026FA
  data: 390–1320 min, Mon–Fri only, giving ~77.5 capacity hours/room/week. Busiest real classroom
  peaks around 46% utilization, which is a believable number.
  Tests: `test/utilization.test.ts` (7), `test/faculty.test.ts` (8). 44 routes total now, 88 tests
  passing, typecheck and lint clean (same two pre-existing HTML warnings as before, untouched).
- **Phase 1.6: done. Phase 1 is now complete.** `GET /v1/buildings/:name/profile`
  (`src/model/buildings.ts`'s `buildingProfile`, composed from `roomUtilization` +
  `room_occupancy` directly, not a fresh catalog scan): peak hour, dominant subject by enrolled
  headcount (not section count — a 100-person lecture outweighs three 5-person seminars, tested),
  weekly/mean-daily footfall, mean room utilization, and a 24-hour rhythm array. **Only the API
  exists** — the plan's "renders as a card on /map when clicked" is Phase 5 presentation work,
  not done here; wiring `map.html`'s click handler to this endpoint is the natural follow-on
  whenever presentation work starts.
  Live 2026FA data on Engineering and Science Ctr: peak hour 12 (2,441 enrolled), dominant subject
  GBIO at 24.8% share, 39 rooms, 16.9% mean utilization -- and a genuine zero at hour 10 between
  two packed hours, which is Cedarville's mid-morning chapel block showing up in the data
  unprompted. A good sign the model is measuring something real.
  Tests: `test/buildings.test.ts` (6). 45 routes, 94 tests, typecheck and lint clean (same two
  pre-existing HTML warnings).

**Phase 1 is fully done (1.1-1.6). Working through the rest of the plan now, in this order: 0.5,
1.5, then Phase 2, then Phase 3, then Phase 5 (Phase 4 stays blocked until spring booklists).**

- **0.5 (roster inversion): done.** `src/store/rosters.ts` (`sectionRosters`, `rosterFor`) plus
  `GET /v1/sections/:id/roster` (also delivers 3.5 for free) in `routes/catalog.ts`. Added
  `sectionById` to `store/catalog.ts` and `peopleByIds` (batch lookup) to `store/people.ts` as
  small supporting pieces both reused later. Live: 671 sections have a partial roster from the
  442 students harvested so far (coverage genuinely low, ~10-15%, reported honestly per-section
  rather than hidden). Tests: `test/rosters.test.ts` (5).
- **1.5 (registration pressure): done.** `src/model/pressure.ts` (`sectionPressure`,
  `pressureLeaderboard`), routes `GET /v1/sections/:id/pressure` and `GET /v1/pressure/leaderboard`.
  Correctness fully tested with synthetic multi-snapshot fixtures since live data only has 2
  snapshots so far (30-min launchd interval) -- `fillPerHour: 0` across the board right now is the
  honest right answer this far from a registration window, not a bug. Tests: `test/pressure.test.ts`
  (7). 106 tests total, typecheck and lint clean.
- Directory sweep has settled (10,428 people seen, 3,651 with a dorm) -- Phase 2 has real data to
  work with. Booklist coverage is still thin (442 of ~5,900 students) -- Phase 3 features will
  report honest low coverage percentages, not wrong answers.

- **Phase 2 (directory-powered): fully done, 2.1-2.3, all live-verified.**
  - **2.1 roommate graph.** Checked the room-number convention against real data before writing
    anything: neither odd pattern needs suffix-stripping. College View's `101-1`/`101-2` and
    Printy/Lawlor's `37A`/`37B`/`37C`/`37D` each already hold exactly 2 people per *exact* string
    -- plain `(dorm_name, dorm_room)` match is correct, no letter-stripping heuristic needed.
    `roommatesOf`, `dormRooms` in `store/people.ts`; `GET /v1/people/:id/roommates`,
    `GET /v1/dorms/:name/rooms`. Tests: `test/roommates.test.ts` (7).
  - **2.2 break carpool matcher.** Geocoded offline against the **US Census Bureau's 2024
    Gazetteer** (public domain, ~32k places, not a proprietary CSV) -- fetched live, place-type
    suffixes ("city"/"town"/"CDP"/etc.) stripped to match free-text directory city names. Shipped
    as `src/collect/assets/us-cities.tsv` (1.1MB). `store/geocode.ts` (cached lookup),
    `model/carpool.ts` (union-find clustering over ~2,600 distinct hometowns, not 10K people --
    checked cardinality first). `GET /v1/carpool/clusters?radius=`,
    `GET /v1/people/:id/carpool?radius=`. **Caught and fixed a real bug during testing**: a raw
    SQL query had one `?` placeholder but was called with two bound values (SQLite threw
    immediately, not a silent wrong-answer bug, but still a bug my own test suite caught before
    live use). Live data: at 40mi, a 6,903-person Dayton-metro commuter cluster plus distinct
    real out-of-state clusters (Florida, the Carolinas, Iowa, Colorado) -- exactly the "where does
    Cedarville draw from" signal the plan predicted. 415 hometowns (1,026 people) don't resolve
    against the Gazetteer and are reported as `unresolvedPlaces`/`unresolvedPeople`, not hidden.
    Tests: `test/carpool.test.ts` (11).
  - **2.3 where is this person right now.** `locationNow()` added to `model/schedule.ts` (reuses
    `scheduleFor` + `store/campus.ts`'s `locate`). `GET /v1/people/:id/location/now`. Reports
    `"in class"` / `"free"` / `"no schedule data"` honestly, always includes the dorm/office
    fallback and a `harvestedAt` freshness marker. Tests: `test/location.test.ts` (4).
  128 tests total, typecheck and lint clean.

- **Phase 3 (roster-powered): fully done, 3.1-3.7, all live-verified against real (thin, ~442-student)
  booklist coverage.**
  - **3.1 schedule geography.** `model/geography.ts`. `GET /v1/people/:id/geography`,
    `GET /v1/geography/leaderboard?by=class|major`. Live validation is the best of the session:
    mean weekly walking distance decreases monotonically FR(2071m) -> SO(1710) -> JR(1476) ->
    SR(1192) -- exactly the real-world pattern (freshmen scattered across gen-eds, seniors
    clustered in their major building), unprompted, directly answering the README's own question.
    Tests: `test/geography.test.ts` (7).
  - **3.2 chokepoint analysis.** Extended `model/traffic.ts` (per the plan's own "extend, don't
    rebuild") with `campusTrafficAt(term, day, minute)`, reusing `scheduleGeography`'s exact
    transition-extraction logic but summed across every booklisted student and scaled by each
    transition's origin-section roster coverage (`1 / coverage`) to estimate true flow from a
    sample. Same route, extended: `GET /v1/campus/traffic?day=&at=HH:MM` (whole-term aggregate
    unchanged when those params are omitted). Live: 09:50 is unambiguously the campus's real
    passing-period peak (80 observed transitions -> 988 estimated after coverage-scaling, vs. 0-1
    at other checked times) -- signal, not noise. Tests: `test/chokepoint.test.ts` (4).
  - **3.3 dining rush predictor.** `model/dining.ts`. **Real finding: nothing collected anywhere
    (OSM, directory, catalog) tags a building's function**, so "which building is dining" can't be
    derived, only configured -- shipped `collect/assets/dining.tsv` **empty by design** (matching
    the existing `dorm-gender.tsv` curated-config precedent) rather than guessing a building name,
    plus a `buildings=` query override for one-off calls. `GET /v1/dining/forecast?day=&radius=`
    returns a 10-minute-bucketed arrival curve built from class end times + real walk time to the
    nearest configured dining building, plus a small residential baseline for nearby dorms. Honest
    404 when unconfigured, confirmed live. Tests: `test/dining.test.ts` (6).
  - **3.4 degree audit estimator.** `model/audit.ts`. `GET /v1/people/:id/audit?program=`. The
    coverage caveat travels in every response body, not just docs, per the plan's explicit
    instruction. Live validation: the same student shows 1/33 coverage against "Nursing" (not
    their major) vs. 6/43 against "Allied Health" (their actual top major guess) -- the model
    correctly discriminates. Tests: `test/audit.test.ts` (5).
  - **3.5 section roster reconstruction: already delivered by 0.5**, nothing further needed.
  - **3.6 course co-enrollment graph.** `model/curriculum.ts`, `GET /v1/courses/graph?minShared=`.
    Course-level (not section-level) pairing by shared students. Live data immediately surfaced
    exactly the "gen-ed core as the hub" shape the plan predicted: BTGE (Bible/theology core),
    COM-1100, PEF-1990, HUM-1400, GSS-1100 dominate both the biggest nodes and strongest edges --
    Cedarville's actual required gen-ed courses. Tests: `test/curriculum.test.ts` (5).
  - **3.7 twin schedules.** `model/twins.ts`, `GET /v1/people/:id/twins?minShared=`. Reuses the 0.5
    roster inversion directly. Live: real cohort clusters (shared allied-health/exercise-science
    sections, shared psych sections) with real names. Tests: `test/twins.test.ts` (6).
  161 tests total, typecheck and lint clean throughout.

**Everything except Phase 4 (blocked on a second booklist term) is now done. Phase 5 is done except
5.3 (the stats-page curiosities), which was deliberately left for last since the plan itself frames
it as optional one-shot cards, not core functionality.**

- **5.1 (one page per feature): done, as an explicit scope call.** Extended `dashboard.html` and
  `map.html` rather than building 6+ standalone pages -- more consistent styling, no duplicated
  chart machinery, and the existing pages already had the right bones (a `load()`/`render()`
  pipeline, reusable `bars()`/`heatmap()`/`lines()` SVG helpers, a shared `api()`/`escape()`
  layer). New dashboard sections, each reusing that existing machinery: empty rooms right now
  (`/v1/rooms/quiet`), who teaches the most (`/v1/faculty`), how far each class walks
  (`/v1/geography/leaderboard?by=class` -- renders the FR>SO>JR>SR finding as a bar chart),
  fastest-filling sections (`/v1/pressure/leaderboard`, with an honest "nothing's moving yet"
  empty state), and a new force-directed course co-enrollment graph (`/v1/courses/graph`) -- a
  hand-rolled Fruchterman-Reingold layout, ~80 lines, settled synchronously in a few hundred
  iterations rather than animated (fast enough at this node count that there's nothing to animate).
  Live-rendered in the browser (screenshot-verified, not just curl'd): BTGE nodes are visibly the
  largest and most central, exactly matching the API-level finding from 3.6.
- **1.6's actual frontend half, finished here:** building hover on `/map` now shows peak hour,
  dominant subject and utilization (`/v1/buildings/:name/profile`), lazily fetched and cached per
  building with a dedup guard so it doesn't refetch on every mousemove pixel. Verified live via
  dispatched pointer events (the browser tool's synthetic hover didn't reliably trigger the page's
  own `pointermove` listener, so verification used `element.dispatchEvent(new PointerEvent(...))`
  directly) -- Engineering and Science Ctr correctly showed "peak 12:00pm · GBIO (25%) · 17%
  booked", matching the direct API call exactly.
- **5.2 (campus time-lapse): done, both halves.** `/map` now plays a whole weekday: buildings shade
  by live class headcount while the traffic bands redraw beneath them, with a day picker, a time
  slider and play/pause.
  - The blocker named in the earlier pass (per-frame fetches would be too chatty) was solved by
    moving the work server-side. `campusTrafficDay(term, day, bucket)` computes every frame in
    **one** pass, and `GET /v1/campus/occupancy/curve` returns a whole day's per-building headcount.
    Two requests when the scrubber engages; scrubbing and playback then never touch the network.
  - That refactor also fixed a **real performance bug in Phase 3.2**: `campusTrafficAt` called
    `rosterFor()` inside its per-transition loop, and `rosterFor` rebuilds the entire roster map on
    every call. Hoisting it (plus caching routes per building pair) took one instant from
    **1832ms to 375ms**, and a whole day now costs **222ms / 12KB** — less than a single instant used
    to. Output is unchanged; the existing tests still pass.
  - Every frame is banded against the *day's* peak rather than its own, so a deserted 2pm corridor
    doesn't render as hot as the 9:50 crush. There's a test for exactly that.
  - Two structural fixes the animation needed: the camera (zoom/pan) is now kept across redraws
    instead of resetting, and a frame repaints only the traffic layer plus building fills rather
    than re-serialising 4,673 path nodes.
  - Live-verified in the browser: 9:00am shows **2,950 seated / 0 walking**, 9:50 flips to **234
    seated / 988 walking**, 11:20 back to 2,699 seated. Campus empties into the corridors and
    refills. Playback also makes the 10am chapel block visible as a campus-wide dimming.
- **5.3 (stats page): done, minus one item that isn't computable.** `model/curiosities.ts` +
  `GET /v1/stats/curiosities` + an "odds and ends" dashboard section: hometown spread by state,
  distance from campus (median 137mi, mean 314mi, furthest **Lihue, HI at 4,515mi**), which subjects
  draw the 8am slots (MIL/ROTC 50%, PHAR 45%, NSG 39% — exactly the departments you'd guess), mean
  class size by subject, the most-assigned books, and the share of assigned books marked optional
  (14%).
  - **Textbook cost by major is not computable and the response says so.** The campus store's
    booklist carries department, course, section, ISBN, edition and status — and no price. Verified
    directly against harvested rows rather than assumed. Doing it would mean teaching the harvester
    to read prices and re-harvesting; the endpoint returns that explanation in `notes` rather than
    estimating.
  - **Found and fixed a real geocoding bug while building this.** Consolidated city-counties never
    matched: the Gazetteer files "Indianapolis city (balance)", "Louisville/Jefferson County metro
    government", "Nashville-Davidson metropolitan government", and a student writes
    "Indianapolis". Indianapolis alone was 81 unmatched people. `store/geocode.ts` now registers
    normalized aliases (punctuation folded, so "Winston Salem" finds "Winston-Salem" and "Land O
    Lakes" finds "Land O' Lakes") plus a derived lead name for government forms, in a second pass
    so a real place always beats a derived alias.
    - My first attempt at this **made it worse** — stripping place-type words eagerly turned "Plain
      City" into "Plain" and broke 100+ people who had been fine. The rule now only strips a
      trailing type from a "(balance)" row. `test/geocode.test.ts` guards that regression by name.
    - Net: unresolved hometowns went **1,026 → 848 people**.
  - Still unresolved and deliberately not chased: Ohio townships and CDPs that live in the Census
    *county subdivisions* file rather than *places* (West Chester 60, Lewis Center 29, Liberty Twp
    17), and abbreviations like "Colorado Spgs" (19). Both are real, both would need another data
    source or an abbreviation table.

**Phase 4 remains the only thing not done, and it is genuinely blocked** — textbook swap and
major-switch drift both need a second term of booklists that does not exist yet. Everything else in
this plan is built, tested and verified against live data. 179 tests, typecheck clean, lint clean
apart from two `escape`-shadowing warnings in the HTML that predate this work.

All frontend changes verified live in the browser pane (not just assumed from reading the code):
logged into the dashboard with the real bearer token, screenshotted every new section, confirmed
real data renders correctly, checked the browser console for errors (none), and exercised the map's
new interactive controls end-to-end via dispatched DOM events with real API cross-checks. 161
backend tests still pass, typecheck and lint clean (same two pre-existing HTML warnings, both
predating this session).


A staged plan for building analysis tools on top of the existing engine. Written to be
executed by someone (or something) that has not seen the conversation that produced it.

Read "What already exists" first. Most of the hard parsing is already done, and the single
most common way to waste effort here is rewriting a parser that is already in the tree.

---

## Ground rules

- **Reuse the existing layers.** `src/store/*.ts` is persistence and SQL. `src/model/*.ts` is
  analysis over that. `src/routes/*.ts` is HTTP. New work goes in the same three places; do
  not invent a fourth.
- **Routes are declarative.** Every route is an object `{ method, path, tag, summary, query[],
  handler }` exported from a `src/routes/*.ts` file. `/openapi.json` is generated from those
  objects, so a correctly-shaped route documents itself. Copy the shape from
  `src/routes/catalog.ts`.
- **One meeting parser.** `meetingsOf()` in `src/model/schedule.ts` already turns a section
  payload into `{ days, start, end, building, room, online, kind }`. It is currently module-private.
  **First task of Phase 0 is exporting it** (or lifting it to `src/model/meetings.ts`). Everything
  downstream uses it. Do not write a second one, and do not parse the `sections.meetings` display
  string — the structured payload is better.
- **Tests exist.** `test/*.test.ts` with `test/setup.ts`. Add a test per feature; follow
  `test/schedule.test.ts` for the fixture style.
- **CLI args.** `src/cli.ts` dispatches subcommands; inside `collect()` the positional array is
  realigned as `args` (`args[1]` is the first argument after the subcommand). New subcommands
  must use `args`, not `positional`, or they will silently read the subcommand name as their
  argument.
- **Effort tags**: S = an hour or two, M = half a day, L = a day or more.

---

## What already exists (do not rebuild)

**Section payload fields** (verified against live 2026FA data, 1,805 sections):

| Field | Notes |
|---|---|
| `Enrolled` | **Populated on 100% of sections.** Authoritative headcount. Do not derive it from `capacity - available`. |
| `FormattedMeetingTimes[]` | Array. One entry per meeting pattern. |
| `.Days[]` | `0` = Sunday, Colleague's numbering. An MWF lecture is ONE meeting with THREE days. |
| `.StartTime` / `.EndTime` | `"09:50:00"`. `clock()` in schedule.ts trims to `HH:MM`. |
| `.BuildingDisplay` / `.RoomDisplay` | e.g. `"Engineering and Science Ctr"` / `"210"`. Present on 354/471 meetings; the rest are online. |
| `.IsOnline` | 70/471 meetings. Always filter these out of room math. |
| `.InstructionalMethodDisplay` | `"Lecture"`, `"Lab"`, etc. |
| `MinimumCredits` | Credits. |

Live data currently holds **14 distinct buildings** and **85+ distinct rooms** (from a 400-section
sample; expect ~150–200 campus-wide).

**Functions already available:**

| Function | File | Does |
|---|---|---|
| `scheduleFor(studentId, term)` | `model/schedule.ts` | A student's full week from their booklist. |
| `meetingsOf(section)` | `model/schedule.ts` | Section payload → structured meetings. **Private — export it.** |
| `campusTraffic(term)` | `model/traffic.ts` | Footpath load, dorms → class buildings. Has no time dimension yet. |
| `timetable(term)` | `store/catalog.ts` | day × hour → `{ sections, seats }`. Campus-wide only, no room breakdown. |
| `subjectLoad(term)` | `store/catalog.ts` | Enrolment vs capacity per subject. |
| `searchSections/searchCourses` | `store/catalog.ts` | Indexed catalog queries. |
| `sectionsByName(term, names)` | `store/catalog.ts` | Bulk section lookup by `ACCT-2110-01` style name. |
| `meetingBuildings(term)` | `store/catalog.ts` | Distinct building names used by classes. |
| `occupancy(by)` | `store/campus.ts` | People per building, by class/type/department. |
| `locate(studentId)` | `store/campus.ts` | A person's dorm/office position. |
| `buildingByLabel(label)` | `store/campus.ts` | Directory shorthand → campus building, fuzzy fallback. |
| `enrolmentOf(studentId, term)` | `store/harvest.ts` | Student → sections, from booklists. |
| `fingerprints()` | `store/harvest.ts` | Per-student course fingerprints for the major model. |

**Data coverage reality check:**

- Catalog + campus: **complete now**, one term (2026FA).
- Directory: sweeping now, ~5,000 people expected.
- Booklists: partial and growing. Student→section coverage will never be 100% — a section with
  no assigned book is invisible.
- **Only one term of booklists exists.** Anything comparing terms is blocked until a spring
  2027 harvest. Those features are quarantined in Phase 4.

---

## Phase 0 — Shared primitives

Everything else depends on these. Build them first, with tests, and do not start Phase 1 until
they are solid.

### 0.1 Export the meeting parser — S
Lift `meetingsOf()` out of `src/model/schedule.ts` into `src/model/meetings.ts` and re-export it
from schedule.ts so nothing breaks. Add helpers:
- `minutesOfDay(hhmm)` → int (`"09:50"` → 590)
- `expand(section)` → flat `{ day, startMin, endMin, building, room, enrolled, sectionId, name, kind }[]`,
  one row per day per meeting, online meetings dropped. This flat shape is the workhorse.

### 0.2 Room registry — S
`src/store/rooms.ts`. Distinct `(building, room)` pairs across all sections in a term, each mapped
to a campus building via `buildingByLabel()`. Persist as a table so rooms with no current class
still exist. Expose `rooms(term)` and `roomsInBuilding(building, term)`.

### 0.3 The occupancy grid — M
`src/model/occupancy.ts`. The spine of Phase 1 and 3.

Materialize `room_occupancy(term, day, start_min, end_min, building, room, section_id, enrolled)`
by running `expand()` over every section. Rebuild whenever a catalog collect finishes (hook into
the same place `replaceTerm()` is called).

Derived reads, all cheap once the table exists:
- `roomBusyAt(term, day, minute)` → occupied rooms
- `roomFreeAt(term, day, minute, minMinutes)` → free rooms **plus how long until the next class
  starts in them** (free-for-2h15m is far more useful than free-now)
- `buildingLoad(term, day, minute)` → summed `enrolled` per building — the ambient-noise proxy
- `buildingCurve(term, day)` → per-building headcount by 10-minute bucket, for charts

### 0.4 Seat snapshots — S — **TIME-SENSITIVE, DO THIS EARLY**
New append-only table `section_seats(term, section_id, observed_at, available, capacity, enrolled)`.
Write a row per section on every catalog collect (today `replaceTerm` overwrites, so history is
being thrown away right now).

This cannot be backfilled. Spring 2027 registration opens roughly Oct–Nov 2026; every hour before
that with no snapshots is data that does not exist. Set up a scheduled collect (launchd on macOS,
or the existing systemd unit if hosted) at 15–30 minute intervals, tightening to ~5 minutes during
the registration window.

### 0.5 Roster inversion — M
`src/store/rosters.ts`. Invert booklists: `section → [studentId]`, plus a per-section coverage
figure (`known / Enrolled`). Coverage matters — every roster-derived number in Phase 3 should be
reported alongside it, and scaled by it where an estimate is wanted.

---

## Phase 1 — Catalog-only features

These need **no directory and no booklist data**. They work against what is already collected, so
they ship first.

### 1.1 Empty room finder — M — *the headline feature*
**Data hook:** occupancy grid (0.3).

A room is free at time *t* if no section meets there over *t*. Return free rooms with:
- how long they stay free
- walking distance/time from a `near=` building via the existing `/v1/campus/route`
- a **quietness score** (below)

`GET /v1/rooms/free?at=<iso|now>&near=<building>&minMinutes=60&sort=quiet|near|longest`

**Dashboard:** `/rooms` — list plus a building-by-hour heatmap of free capacity.

### 1.2 Quietness score + study spots — M
This is the "which place is least busy" question, and it **is** calculable — with one honest caveat
stated in the UI: this measures *scheduled class load*, not people physically present. There is no
turnstile data. Class load is the dominant driver of noise and corridor traffic, so it is a good
proxy, not a measurement.

For a free room at time *t*:

```
quiet = w1 * ambient      // enrolled headcount in the same building during [t, t+horizon]
      + w2 * spill        // headcount in that building in the 15 min before and after
                          // (passing periods are the loud part)
      + w3 * centrality   // walking-graph betweenness of the building's door node —
                          // literally "how many people walk past here"
```

Normalize to 0–100, lower is quieter. Start with `w1=0.5, w2=0.3, w3=0.2` and tune by eye.

**Hidden gems** = free room AND low ambient AND low centrality AND still within a reasonable walk.
That is the "good spot nobody thinks of" query, and it falls straight out of the same three terms.

`GET /v1/rooms/quiet?at=&near=&horizon=180`
`GET /v1/buildings/:name/rhythm` → per-hour quietness curve, for charting

**Raycast command** (small, high daily value): one keystroke → three quiet free rooms near you.

### 1.3 Classroom utilization report — S
Inverse of the above, aimed at the registrar rather than the student: what fraction of teaching
hours is each room actually booked, and which rooms sit empty? Pure grid arithmetic.

`GET /v1/rooms/utilization?term=` → per room: booked hours, idle hours, peak day, mean class size.

### 1.4 Professor load dashboard — S
Group sections by `faculty`: section count, total `Enrolled`, credits, 8am count, distinct rooms
and buildings, back-to-back-across-campus transitions in their own week.

`GET /v1/faculty`, `GET /v1/faculty/:name`

### 1.5 Registration pressure oracle — M — *depends on 0.4 accumulating*
Once snapshots exist, compute per section: fill velocity (seats/hour), time-to-full, and the
headline figure — "historically full within N minutes of registration opening."

`GET /v1/sections/:id/pressure` — the seat curve over time
`GET /v1/pressure/leaderboard?term=` — fastest-filling sections, and which are perennially safe

**Dashboard:** seat-drain curves. Genuinely the prettiest chart in the whole project.

### 1.6 Building personality cards — S
Per building: hourly rhythm, peak hour, dominant subject, mean class size, total daily footfall.
Renders as a card on the existing `/map` when a building is clicked. Cheap, and it makes the map
feel alive.

---

## Phase 2 — Directory-powered

Needs the directory sweep complete. No booklists required.

### 2.1 Roommate graph — S
`dorm_name` + `dorm_room` is a free join. **Check the room-suffix convention against real data
first**: if `37A` and `37B` both exist in the same hall, decide whether they are beds in one room
or separate rooms, and group accordingly (strip the trailing letter for suite-level, exact match
for room-level; support both).

`GET /v1/people/:id/roommates`, `GET /v1/dorms/:name/rooms`

Then the interesting questions, once majors exist: do roommates share a major more often than
chance? When one moves mid-year, does the other? (`/v1/history/events?field=dorm_name` already
records the movement.)

### 2.2 Break carpool matcher — M
`city` / `state` / `country` are in every directory row and nothing currently reads them.

Geocode offline — ship a US city→lat/lon CSV (SimpleMaps "US Cities" basic is free and about
30k rows) in `src/collect/assets/` rather than calling a geocoding API. Cache misses in a table
for manual fixing.

Cluster by great-circle distance; return groups within a radius.

`GET /v1/carpool/clusters?radius=40`, `GET /v1/people/:id/carpool`

**Dashboard:** a US map with hometown density. Also answers "where does Cedarville actually draw
from", which is a good standalone stat.

### 2.3 Where is this person right now — S
`scheduleFor()` + current day/time → in class (building + room, ends at X) or not in class, with
dorm/office as the fallback location. Add a freshness line: this is only as current as the last
harvest.

`GET /v1/people/:id/location/now`

**Front end:** a Raycast command in the existing `cedarstalk-raycast` extension, reusing its
directory search for the person lookup.

---

## Phase 3 — Roster-powered

Needs 0.5 plus booklist coverage. Always surface the coverage percentage alongside results.

### 3.1 Schedule geography score — M
Per student, per day: consecutive sections → route between their buildings via the campus graph →
walking metres and minutes versus the actual gap between classes.

Report: daily metres, worst single transition, and **impossible transitions** (walk time > gap),
which are the genuinely interesting rows.

`GET /v1/people/:id/geography`, `GET /v1/geography/leaderboard?by=major|class`

Also answers the README's own question — how far a freshman actually walks in a day — as a
distribution rather than an anecdote.

### 3.2 Chokepoint analysis — L — *extend, do not rebuild*
`campusTraffic()` in `src/model/traffic.ts` already loads footpaths from dorms to class buildings.
Add a **time dimension**: `campusTraffic(term, { day, minute })`.

Method: from rosters, extract real consecutive-section transitions (building A → building B at
10:50). Scale counts up by roster coverage to estimate true flow. Route each flow over the walking
graph and sum per-edge load.

`GET /v1/campus/traffic?day=1&at=10:50`

**Dashboard:** the existing map with edge thickness by load, plus a time scrubber. See 5.2.

### 3.3 Dining rush predictor — M — *the fun one*
Identify dining buildings from the campus data (do not hardcode names — look them up in
`buildings.tsv` / campus data and make the list configurable).

For each 10-minute bucket: count students whose class ends within a walking radius of dining,
offset each by their actual walk time, and sum into an arrival curve. Add a small residential
baseline for people in nearby dorms with no class.

Output: predicted arrival curve per meal period, with the practical version front and centre —
"go at 11:35 or after 12:40; 12:05 is the wall."

`GET /v1/dining/forecast?day=1`

### 3.4 Degree audit estimator — L
Printed catalog gives 79 programs and their requirements; booklists give courses taken per term.
Match one against the other.

Be honest in the output: booklists only cover harvested terms, so for anyone past their first year
this is "of what we can see, you have covered X of Y" — not a transcript. Show the coverage
caveat in the response body, not just the docs.

`GET /v1/people/:id/audit?program=`

### 3.5 Section roster reconstruction — S
Falls out of 0.5 directly. Expose it, with coverage.

`GET /v1/sections/:id/roster`

### 3.6 Course co-enrollment graph — M
Sections that share students, as a weighted graph. Force-directed layout renders the actual shape
of the curriculum — clusters per college, with the gen-ed core as the hub everything hangs off.
One of the best-looking things available from this data.

`GET /v1/courses/graph?term=&minShared=3`

### 3.7 Twin schedules — S
Pairs of students whose timetables overlap above a threshold — effectively moving through the week
together. Good study-partner signal, and a cheap query once rosters exist.

`GET /v1/people/:id/twins`

---

## Phase 4 — Blocked until a second term of booklists

Build the schema now if convenient; the features cannot be finished or tested until a spring 2027
harvest exists. Do not sink time here before then.

### 4.1 Textbook swap market — M
Person held ISBN in term T; person needs ISBN in term T+1 → match. Requires two terms by
definition.

`GET /v1/books/:isbn/holders`, `GET /v1/people/:id/swaps`

### 4.2 Major switch early warning — M
Store per-term fingerprints and guesses (the model already produces them). Compute cosine drift
between consecutive terms; flag a changed top cluster or a sharp confidence drop.

`GET /v1/majors/drift?from=2026FA&to=2027SP`

Also: `evaluate` already logs accuracy per run, so plot that climb as more terms land.

---

## Phase 5 — Presentation

The data is the point, but making it legible is most of the value. The dashboard already has a
validated colour palette — reuse it rather than picking new colours per page.

### 5.1 One page per feature — M each
`/rooms`, `/faculty`, `/pressure`, `/dining`, `/geography`, `/carpool`. Keep them boring and
consistent: a headline number, one chart, one table.

### 5.2 Campus time-lapse — L — *the showpiece*
Animate the map across a single day: building fill by headcount, footpath thickness by flow,
scrubbing from 8am to 9pm. Everything it needs comes from 0.3 and 3.2; this is purely a rendering
job on top of them.

### 5.3 A stats page — S
The one-shot curiosities that do not deserve their own feature: textbook cost by major, hometown
spread, 8am distribution by college, mean class size by subject, freshman daily walking distance.
Compute on request, render as cards, move on.

---

## Suggested order

1. **0.4 seat snapshots** — first, today. It is the only irreversible one; every hour without it
   loses data permanently.
2. 0.1 → 0.2 → 0.3 (the grid)
3. 1.1 + 1.2 (empty rooms + quietness) — the highest daily-use payoff, and it needs nothing else
4. 1.4, 1.3, 1.6 — cheap wins off the same grid
5. 0.5 rosters, then 3.1 and 3.3 (geography + dining) — the two most interesting roster features
6. 2.x once the directory sweep finishes
7. 1.5 once snapshots have accumulated through a registration window
8. 3.2, 3.6, 5.2 — the heavy visual work
9. Phase 4 after the spring harvest

## Operational notes

- Keep the server bound to loopback (`HOST=127.0.0.1`), as it already is.
- Materialized tables (0.3, 0.5) should rebuild from source on demand — add
  `bun run engine rebuild` so a bad derivation is never load-bearing.
- Every endpoint returning roster-derived numbers should include its coverage figure in the
  response body. A number without its coverage is a number that will be misread later.
- `PLAN.md` is local scratch, not upstream. Delete or gitignore before any PR to the canonical
  repo.
