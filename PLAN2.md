# cedarengine — plan 2

## Status — 2026-09-20/21

**Done:** A1 (`/v1/buildings/:name/who`), A2 (`/v1/people/free`), F1 course fit
(`/v1/people/:id/fit`), F2 textbooks (`/v1/people/:id/books`,
`/v1/books/:isbn/students`), B1 My Day, B2 Free Together, B3 Who's in This
Building, C1 Faculty, C2 Dorms, G1 (both repos private on GitHub under
leviholliday, `upstream` renamed off Kieran's, license and README credit
intact, verified via fresh clone), G2 (`scripts/auth-session.ts`, cross-platform
but not yet the default -- `AUTH=playwright` opts in), G4 (`/mobile`, verified
at 375x812 in a real browser, README documents the Tailscale-only path).
214 engine tests pass; both extension and engine typecheck clean.

**A real bug the plan's own §0.6 caught:** the directory agent's bun-path
fallback guessed `~/.bun/bin/bun`, which does not exist on this machine (bun
is a Homebrew install). First unattended run exited 127. Fixed in
`scripts/headless-directory.sh` (`resolve_bun()`, checks Homebrew's two
prefixes before the curl-installer default) and verified with a real
`launchctl kickstart` -- exit 0.

**Not done:** C3 (paths crossing -- the plan said do it last; still true),
G3 (systemd timers -- Levi is on macOS, build when actually needed), Phase D
(still gated: `booklist_events` holds only `kind=first` as of this session --
check again after a second real harvest), Phase E, the dining forecast in §7.

**Worth checking before doing more:** the booklists agent (`sh.dunkirk.
cedarengine.booklists`, 03:30) has not had a real unattended run yet --
`runs = 0` as of this session. Confirm it completes before trusting it.

Everything in `PLAN.md` is built. This is the next round, written to be executed
by someone who has not been part of the previous sessions.

Two repos are involved:

- **engine** — `~/Coding Projects/2026/cedarengine` (Bun, SQLite, TypeScript)
- **extension** — `~/cedarstalk-raycast` (Raycast, React, TypeScript), installed
  as `cedarville-people-search`

---

## 0. Ground rules — read before writing any code

These are all things that have already cost real time. None are theoretical.

### 0.1 `ray build` does not install anything

`npx ray build` prints `built extension successfully` and installs **nothing**.
Raycast keeps running the previously installed bundle, so your change appears to
do nothing and you will debug the wrong thing for an hour.

Use `npx ray develop`, wait for `built extension successfully`, then **confirm
the timestamp** of the affected file under
`~/.config/raycast/extensions/cedarville-people-search/`. It runs in watch mode;
kill it with `pkill -f 'ray develop'` when done.

### 0.2 A command's file name must match its `name` in `package.json`

A command named `class-roster` needs `src/class-roster.tsx`. If it does not
match, the build fails with `could not find an entry point`, **the previously
installed files stay in place**, and a careless reading looks like success.

### 0.3 Raycast `Detail` markdown will not render `data:` URIs

Use `file://` with each path segment encoded:

```ts
const encoded = photoPath.split("/").map(encodeURIComponent).join("/");
setPhotoDataUrl(`file://${encoded}`);
```

This cost several rounds of wrong theorising about expired sessions. It is not
a permissions problem.

### 0.4 Do not say "not yet harvested"

It was true in the project's first hours and is wrong now. See §1. Saying it
sends the user looking for a fix that does not exist.

### 0.5 Verify against live data before believing a feature works

Two features in the last round looked finished and were not: the dining forecast
(returns an error), and the degree audit (returns plausible numbers that are
badly misleading). Unit tests passed for both. **Curl the endpoint and read the
output before building UI on it.**

The engine runs at `http://127.0.0.1:3000`; every route except `/health` needs
`Authorization: Bearer $(grep BEARER_TOKEN .env | cut -d= -f2)`.

### 0.6 Smoke-test before you touch anything

If any of these is wrong, fix it before writing code — otherwise you will spend
the day debugging your own work against a broken system.

```bash
curl -s localhost:3000/health                  # {"ok":true,"people":~10450,...}
launchctl list | grep cedarengine              # 4 agents; 2nd column 0, not 1
sqlite3 data/cedarengine.db "SELECT term, COUNT(*) FROM booklists GROUP BY term;"
sqlite3 data/cedarengine.db "SELECT kind, COUNT(*) FROM booklist_events GROUP BY kind;"
tail -20 ~/Library/Logs/cedarengine/booklists.log     # last nightly harvest
tail -20 ~/Library/Logs/cedarengine-directory.log     # last directory sweep
bun test                                              # 179 pass, 0 fail
```

Healthy looks like: `people` above 10,400; at least one term in `booklists` with
~5,900 students; and both logs ending in a completed run rather than an error.

**`launchctl list` is not enough to tell whether an agent works.** Its status
column shows `0` both for "last run succeeded" and for "has never run at all".
To tell them apart:

```bash
launchctl print gui/$(id -u)/sh.dunkirk.cedarengine.directory | grep -E 'runs|last exit'
```

`runs = 0` means it has never fired. The directory agent runs every 6 hours and
the booklist harvester at 03:30, so shortly after installing either one, `runs =
0` is expected rather than wrong — but it also means **nothing has proven the
agent works unattended**; only the underlying script has been run by hand.
Confirm with a real run before relying on either.

`booklists.log` ending in **exit 4** means the campus store is rate-limiting
this IP — wait it out, do not retry (§1.3). An agent showing status **1** has
been failing; read its log before assuming your changes caused it.

To force a run rather than waiting:

```bash
launchctl kickstart -k gui/$(id -u)/sh.dunkirk.cedarengine.directory
```

### 0.7 Tests never touch the real database

`test/setup.ts` is preloaded through `bunfig.toml` and forces
`DATABASE_PATH=":memory:"`, because the real file holds ten thousand real
people. Test files also call `useDatabase(":memory:")` in `beforeEach`.

**Keep both.** A test that reaches the live database can corrupt a dataset that
took days of rate-limited collection to build and cannot be quickly rebuilt.
Build fixtures the way `test/quiet.test.ts` does — small `section()` and
`meeting()` helpers feeding `replaceTerm()`.

### 0.8 Scope — what not to do

- **Do not refactor working code** to make room for new code. The collectors,
  the routing graph and the occupancy grid are load-bearing and well tested.
- **Do not upgrade dependencies.** `playwright-core` in particular is pinned to
  what the installed Chrome supports.
- **Do not touch the four launchd agents or the collection scripts** unless the
  task says to. They are the only reason the data stays fresh, and a broken
  collector is invisible until days of data are missing.
- **Do not add retries against `store.cedarville.edu`.** See §1.3.
- If a task turns out to need one of these, stop and say so rather than doing
  it quietly.

### 0.9 Conventions

- `src/store/*.ts` — SQL and persistence. `src/model/*.ts` — analysis.
  `src/routes/*.ts` — HTTP. Keep the layering.
- Routes are self-documenting (`{ method, path, tag, summary, query[], handler }`
  in `src/routes/types.ts`) and generate `/openapi.json`. A route that exists is
  documented automatically; do not hand-write spec.
- Assets imported as text (`import x from "./f.tsv" with { type: "text" }`) so
  `bun build --compile` embeds them. Never `readFileSync` a relative path.
- `bun test` must stay green (179 tests, 25 files).
- Extension preferences `engineUrl` / `engineToken` are **extension-level**, so
  every command shares them. Read them structurally in `src/engine.ts`, not via
  a generated per-command type.

---

## 1. What the data actually is — verified 2026-09-20

Get this wrong and every caveat you write will be wrong.

### 1.1 Booklist coverage is complete, except dual-enrolment

| class / type | people | with booklists |
|---|---|---|
| **HS / DE** | 3,811 | **0%** |
| SR, FR, SO, JR / UG | 4,403 | 100.0% |
| GS, MG / GS | 738 | 100.0% |
| GR, ND / UG, UGO | 543 | 100.0% |

"5,901 of 9,713 students" is a misleading fraction: 3,811 of that denominator
are dual-enrolment high schoolers taking Cedarville courses **from their own high
schools**. They never buy from the campus store, so they can never have a
booklist. Everyone else is at 100%.

### 1.2 So a short roster has exactly two structural causes

1. **The section is online** — full of dual-enrolment and distance students.
   Verified: the worst-covered sections sampled (`GSS-1100-13` at 14%,
   `GBIO-1000-18` at 19%) are both `(Online)`.
2. **No books were assigned to the section** — which hides *every* student in
   it, however many are enrolled. Verified: `EDSP-3100-01`, an in-person
   practicum, reconstructs 1 of 21.

Neither is "the harvest has not got there yet". Word all UI accordingly.

### 1.3 Collection runs itself now

| agent | schedule | needs a browser? |
|---|---|---|
| `sh.dunkirk.cedarengine.server` | always up | — |
| `sh.dunkirk.cedarengine.collect` | catalog, every 30 min | no |
| `sh.dunkirk.cedarengine.directory` | every 6 h, `scripts/headless-directory.sh` | no |
| `sh.dunkirk.cedarengine.booklists` | nightly 03:30, `scripts/harvest-booklists.ts` | no (drives headless Chrome itself) |

The store **rate-limits by IP**: after a heavy sweep it stops serving the JS
challenge and returns a flat `403`, with `AwsWafIntegration` absent. That is a
block to wait out, not a challenge to retry. `harvest-booklists.ts` exits 4 on
it. Do not add retry loops against the store.

### 1.4 Known-good endpoints (all curled and confirmed)

| endpoint | notes |
|---|---|
| `/v1/sections?term=&q=&limit=` | `term` **required**. `q` matches name, title, instructor |
| `/v1/sections/:id/roster` | `{ sectionName, enrolled, coverage, students[] }` |
| `/v1/people/:id/schedule` | `{ sections[{ name, title, meetings[{days[],start,end,building,room,online}] }] }` |
| `/v1/people/:id/location/now` | `{ status, inClass, location{label,lat,lon,room} }` |
| `/v1/people/:id/geography` | per-day `transitions[]` with `from/to/fromEnd/toStart/gapMinutes/walkMinutes/possible` |
| `/v1/people/:id/twins` | shared-section classmates |
| `/v1/people/:id/roommates`, `/carpool?radius=`, `/major` | all working |
| `/v1/campus/occupancy?by=class\|type\|department` | 34 buildings, `people/residents/workers/breakdown` |
| `/v1/campus/buildings` | 35 buildings with `lat`/`lon` |
| `/v1/faculty?limit=` | ranked by load |
| `/v1/faculty/:name` | **exact full name required** — `Dr. Misti M. Grimson`, not `Grimson` |
| `/v1/dorms`, `/v1/dorms/:name/rooms` | hall populations, full room-by-room occupants |
| `/v1/timetable?term=` | `term` required. day/hour cells with `sections`, `seats` |
| `/v1/majors/distribution`, `/v1/courses/graph`, `/v1/stats/curiosities` | working |

### 1.5 Endpoints that are **not** ready — do not build on these

- **`/v1/dining/forecast`** — errors with `no dining buildings configured`.
  See §7; the blocker is not what it looks like.
- **`/v1/people/:id/audit`** — needs `?program=`, then returns plausible-looking
  numbers computed from **one term** of booklists. Run it on a senior and it
  says they have done 4 of 40 courses. It is not a degree audit until several
  terms accumulate. Do not surface it.
- **`/v1/campus/traffic`** — works, but returns **raw graph node ids**
  (`[1200,1199,1198,...]`), not building names. It is map-shaped, not
  list-shaped. It already drives `src/map.html`. **Do not build a Raycast
  command for it** — a list of node ids is useless.
- **`/v1/history/churn`** — currently all zeroes: there has only ever been one
  booklist harvest, so there is nothing to diff. Unblocks by itself after the
  second nightly run. See §5.1.

---

## 2. Phase A — engine work (do this first)

Two new routes. The Raycast work in Phase B depends on both. Follow
`src/routes/rooms.ts` for style; add tests beside the existing ones.

### A1. Who is in a building right now

**`GET /v1/buildings/:name/who`**

Query: `at` (ISO or `now`, default now), `term` (defaults to current).

```jsonc
{
  "building": "Dixon Ministry Center",
  "at": "2026-09-22T14:05:00.000Z",
  "day": 1, "minute": 845,
  "people": 212,
  "sections": [
    { "name": "BTGE-1725-10", "title": "Bible & the Gospel", "room": "201",
      "start": "15:00", "end": "15:50", "faculty": "Dr. Daniel J. Estes",
      "enrolled": 54, "coverage": 1,
      "students": [{ "id": "2749385", "name": "Norah Bray", "studentClass": "FR" }] }
  ]
}
```

Implementation — all the pieces exist:

1. Sections meeting in that building at that minute: reuse the meeting
   expansion in `src/model/meetings.ts` / the occupancy grid in
   `src/model/occupancy.ts`. Match on building label.
2. Students per section: `rosterFor(term, sectionName)` from
   `src/store/rosters.ts`.
3. Names: `peopleByIds()` from `src/store/people.ts`.
4. `people` is the count of **distinct** student ids across sections — a
   student cross-listed into two sections must not be counted twice.

New file `src/model/presence.ts` for the logic; route goes in the existing
`src/routes/rooms.ts` (it is already the buildings/rooms tag).

**Acceptance:** during a weekday class hour, `Dixon Ministry Center` returns
several sections with non-empty rosters; at 3am it returns
`sections: [], people: 0` rather than erroring. A section with no roster
coverage still appears, with `students: []` and its real `enrolled`.

**Test:** `test/presence.test.ts` — a fixture with two sections in one building,
one overlapping the query minute and one not; a student in both sections counted
once.

### A2. When several people are all free

**`GET /v1/people/free`**

Query: `ids` (comma-separated, 2–10, required), `day` (0–6, default today),
`from` (default `08:00`), `to` (default `22:00`), `minMinutes` (default 30),
`term`.

```jsonc
{
  "day": 1, "from": "08:00", "to": "22:00", "minMinutes": 30,
  "known": ["2749385", "2748345"],
  "unknown": ["2751755"],
  "windows": [
    { "start": "11:50", "end": "15:00", "minutes": 190,
      "endsBecause": [{ "id": "2749385", "section": "BTGE-1725-10", "at": "15:00" }] }
  ]
}
```

Implementation:

1. For each id, `scheduleFor(id, term)` from `src/model/schedule.ts` → busy
   intervals for `day`.
2. An id with **no schedule** goes in `unknown` and is **excluded from the
   intersection** — treating "we cannot see their classes" as "they are free"
   would silently invent availability. This distinction is the whole point of
   the route; do not collapse it.
3. Merge each person's intervals, invert within `[from, to]`, intersect across
   everyone in `known`, drop windows shorter than `minMinutes`.
4. `endsBecause` names whose class closes the window — it is what makes the
   answer actionable rather than a bare time range.

New file `src/model/availability.ts`; route in `src/routes/people.ts`.

**Acceptance:** two students with a shared 11:50–15:00 gap return exactly that
window. A person with no booklist lands in `unknown` and does not widen anyone
else's window. Passing 1 id returns 400; passing 11 returns 400.

**Test:** `test/availability.test.ts` — overlapping and non-overlapping
schedules, the `unknown` path, and a `minMinutes` filter that removes a short
gap.

---

## 3. Phase B — the three commands that full coverage unlocks

Extension work. Copy the structure of `src/class-roster.tsx`: a default-export
`Command()`, push views for detail, `DossierById` as the primary action on any
person row so names are always followable.

Add every new client function to `src/engine.ts`, following the existing
pattern — `engineGet<T>` for things where an absence is fine, a thrown
`EngineUnavailable` for a command whose whole screen is that one call.

### B1. My Day — `src/my-day.tsx`, command `my-day`

The one screen to open every morning. Needs a new **extension-level**
preference `myPersonId` (textfield, optional, description: "Your directory id —
find it with Copy ID in the directory search").

**Do not hardcode an id anywhere.** Ask the owner for theirs and have them set
the preference; the value belongs in Raycast's settings, not in a file that
ends up on GitHub. Their record is in the directory and has a full schedule, so
both this and F1 can be tested against real data immediately once it is set.

Sections:

1. **Now** — in class (room, ends in N) / walking (from → to, dead reckoning) /
   free. Reuse `statusNow()` from `src/now.ts` and `transitBetween()` from
   `src/engine.ts`; both are already written and tested by use.
2. **Next** — next class, where, minutes away, walk time from where you are now
   (`/v1/campus/route?from=&to=`).
3. **In this gap** — if the gap is ≥ 30 min, the top 3 quiet rooms near the
   *next* class's building (`quietRooms({ horizonMinutes, near })`, already in
   `src/engine.ts`). This is the bit that makes the command worth opening.
4. **Rest of today** — remaining classes.

If `myPersonId` is unset, show a `List.EmptyView` explaining where to get it,
with an action opening extension preferences. Do not guess the id.

**Acceptance:** with a real id set, the command shows the correct current state
and at least one quiet room during a real gap. With no id set, it explains
itself rather than showing an empty list.

### B2. Free Together — `src/free-together.tsx`, command `free-together`

Pick people, see when they are all free. Uses **A2**.

- Person selection: a `List` with `onSearchTextChange` querying
  `/v1/people?q=`, and a selected set held in `useState` plus `LocalStorage`
  (key `free-together:last`) so the last group survives reopening.
- Toggle selection with `Action` (⌘Enter), show the count in the navigation
  title, and a "Find common free time" action (⌘Return) pushing the results.
- Results: windows for today, with a day dropdown (Mon–Fri) in
  `searchBarAccessory`.
- **Show `unknown` people explicitly** in their own section — "not counted:
  no booklist (dual-enrolment or no books assigned)". A window computed from 3
  of 5 people is a different claim from one computed from 5.

**Acceptance:** selecting two students with a known shared gap returns it;
adding a dual-enrolment student moves them to `unknown` and leaves the windows
unchanged.

### B3. Who's in This Building — push view from `campus-now.tsx`

Uses **A1**. Add an `Action.Push` titled "Who's in There Now" on each building
row in the existing `src/campus-now.tsx`.

The view lists sections meeting now, each expandable to its students, with
`DossierById` on every person. Show the same coverage honesty as
`class-roster.tsx` — reuse its `coverageTag()` by exporting it rather than
copying the thresholds.

**Acceptance:** during a class hour, opening a busy academic building lists real
sections and real names; at 3am it says nothing is scheduled rather than
appearing broken.

---

## 4. Phase C — solid additions

### C1. Faculty — `src/faculty.tsx`, command `faculty`

`/v1/faculty?limit=200` for the list (ranked by load), `/v1/faculty/:name` for
one.

**`:name` needs the exact full name** (`Dr. Misti M. Grimson`). So: list first,
select second. Never build the name from free text.

Detail shows sections taught, total enrolled, credits, distinct rooms and
buildings, `earlyMeetings`, and their full timetable. Cross-reference
`/v1/people?q=<surname>` to offer their office and a dossier link where the
directory has them.

Practical use: where a professor is likely to be right now, for office hours.

### C2. Dorms — `src/dorms.tsx`, command `dorms`

`/v1/dorms` for halls by population; `/v1/dorms/:name/rooms` for the room-by-room
occupant list. Group by floor where the room number allows it (`101` → floor 1),
`DossierById` on every occupant.

### C3. Paths Crossing — push view from the dossier

Given two people, when do their routes coincide? Both schedules plus
`/v1/people/:id/geography` give each person's walks with times; a crossing is
two transitions whose time windows overlap **and** whose routed paths share a
node (`/v1/campus/route?from=&to=&path=1` returns `points[]`).

Genuinely novel and the most interesting thing left on this list, but the
fiddliest. Do it last, and only after B1–B3 are working.

State the assumption on screen: this is where two timetables say they *should*
coincide, at a constant 1.35 m/s, not where anyone was.

---

## 5. Phase D — time-gated, do not start early

### 5.1 Schedule changes — available after the second nightly harvest

`/v1/history/churn` and `booklist_events` currently hold only `first` events
(4,841 of them), so every churn number is 0. Once two harvests exist, `added`
and `dropped` become real, and `/v1/people/:id/history` will say what someone
added or dropped and when.

Check with:

```bash
sqlite3 data/cedarengine.db "SELECT kind, COUNT(*) FROM booklist_events GROUP BY kind;"
```

Build only when a kind other than `first` appears. Then: a "Schedule Changes"
command, and a "recently changed" line in the dossier.

### 5.2 Campus changelog — weeks away

`/v1/history/events` works but the directory was first swept 2026-09-18, so
every event is `appeared`. It needs calendar time, not code. Revisit when
`kind` includes `vanished` or field changes. It will also need a name-resolution
step, since events carry only `studentId`.

---

## 6. Phase E — lower value, only if the above is done

- **Curiosities** — `/v1/stats/curiosities` (hometown states: OH 4,765, IN 665,
  PA 557…), `/v1/majors/distribution`, `/v1/timetable?term=`. A single
  read-only "Campus Facts" command.
- **Course explorer** — `/v1/courses`, `/v1/courses/:code`, `/v1/programs`,
  `/v1/courses/graph`. Browsing the catalogue; overlaps `class-roster` and is
  mostly redundant with Self-Service.
- **Registration watch** — a Raycast `mode: "no-view"` command with an
  `interval`, polling `/v1/sections/:id/pressure` for watched sections and
  sending a notification when seats drop. Only worth it in the weeks around
  registration opening. The seat data is already accumulating (69+ snapshots
  per section).

---

## 7. The dining forecast — a correction, and what it would really take

Previously described as "one config file away". That was wrong.

`collect/assets/dining.tsv` holds **building labels, one per line** — not
coordinates. `src/model/dining.ts` resolves each label through
`buildingByLabel()`, which only knows the **35 buildings in the campus map**.

Stevens Student Center — where the dining actually is — **is not one of them**.
So the real task is getting it into the campus map, in `src/collect/campus.ts` /
`src/collect/tour.ts`, either by working out why the OSM pass missed it or by
adding a deliberate manual entry with sourced coordinates.

Do not invent coordinates. If the OSM route fails, look the building up and
record where the number came from, the way the geocoding assets do.

Only then does adding `Stevens Student Center` to `dining.tsv` light up
`/v1/dining/forecast`, which is otherwise already built and would answer "when
is the line shortest" from class end times and walk distances.

This is a real piece of work and the riskiest item here. It is optional; the
forecast is a nice-to-have, not a gap in anything.

---

## 8. Phase F — the two features worth building next

Both were checked against live data before being written down.

### F1. Course fit — "what can I actually add?"

**The highest-value thing left.** Self-Service will happily let you register for a
9:50 in Health Sciences and a 10:00 in Engineering & Science and never mention
they are a six-minute walk apart. The engine already computes exactly that, in
`impossibleTransitions` — it has simply never been pointed at *prospective*
sections.

**`GET /v1/people/:id/fit`**

Query: `code` (course code, required, e.g. `GBIO-1000`), `term`, `openOnly`
(default true).

```jsonc
{
  "person": "2749385", "code": "GBIO-1000", "term": "2026FA",
  "options": [
    { "name": "GBIO-1000-01", "available": 4, "capacity": 24,
      "meetings": [{ "days": [1,3,5], "start": "08:00", "end": "08:50",
                     "building": "Engineering and Science Ctr", "room": "245" }],
      "verdict": "fits",
      "clashes": [],
      "walks": [{ "day": 1, "from": "Engineering and Science Ctr",
                  "to": "Health Sciences Center", "gapMinutes": 10,
                  "walkMinutes": 6.2, "possible": true }] }
  ]
}
```

`verdict` is one of:

- `clash` — a meeting overlaps an existing class. Disqualifying.
- `impossible` — no overlap, but a back-to-back transition needs more walking
  time than the gap allows. **This is the verdict nothing else on campus gives
  you**, and it is the reason to build this.
- `tight` — the walk uses more than 70% of the gap. Doable, unpleasant.
- `fits` — no overlap, every transition comfortable.

Implementation, all from existing pieces:

1. `scheduleFor(id, term)` — `src/model/schedule.ts` — for their current week.
2. `/v1/sections` filtering by `code` and `open` — already supported and
   verified (18 open sections of `GBIO-1000`).
3. For each candidate, merge its meetings into the existing week and re-run the
   transition walk check from `src/model/geography.ts`. **Reuse that function
   rather than reimplementing the walk maths** — it already handles routing,
   `possible`, and buildings that are not on the campus map.
4. Sections whose building has no map entry cannot be walk-checked; mark the
   walk `possible: null` and say so rather than assuming it is fine.

New file `src/model/fit.ts`; route in `src/routes/people.ts`.

**Acceptance:** for a student with a known 8am class, an 8am section of another
course returns `clash`. Two in-person classes ten minutes and a six-minute walk
apart return `tight`; five minutes apart with a six-minute walk return
`impossible`. An online section always returns `fits`.

**Test:** `test/fit.test.ts` — one case per verdict, plus the unmapped-building
case.

**Raycast:** `src/course-fit.tsx`, command `course-fit`. Type a course code, get
its sections sorted `fits` → `tight` → `impossible` → `clash`, each showing the
reason in plain words ("6 min walk from ESC, you have 5"). Needs `myPersonId`
(see §3 B1). Most useful in the two weeks around registration, and genuinely
unavailable anywhere else.

### F2. Textbooks

Never used, and sitting in the data already:

```
book rows with a real ISBN:   31,467
distinct ISBNs:                  877
students holding >=1 ISBN:     4,799
median books per student:          6
ISBNs shared by >=5 students:    792   (90% of all titles)
```

**`GET /v1/people/:id/books?term=`** — that student's books: `title`, `isbn`,
`edition`, `status` (`required`/`optional`), `course`, `section`, and
`alsoNeededBy` (count of other students with the same ISBN).

**`GET /v1/books/:isbn/students?term=`** — who else needs it. 90% of titles are
shared by five or more people, so this has real liquidity: split a copy, borrow
one, and once a second term of booklists exists, find the people who took the
course last term and no longer need theirs.

New file `src/model/books.ts` (parse the `books` JSON column of `booklists`),
route `src/routes/books.ts`.

**Raycast:** `src/textbooks.tsx`, command `textbooks`. Your books with the ISBN
one keystroke away, plus `Action.OpenInBrowser` searches by ISBN on AbeBooks,
Amazon and eBay — the point is to make not buying from the campus store the easy
path. "N others need this" pushes to the student list.

**Two honest notes.**

Skip rows whose `isbn` is `DIRECTACCESS` — those are digital-access placeholders,
not books.

**Prices are missing entirely.** The parser has a `prices` field and captured
**zero** across all 37,841 rows, so either the store's markup changed or those
selectors never matched. Do not build price comparison until this is fixed;
investigate the parser in `src/collect/assets/harvester.js.tmpl` and
`scripts/harvest-booklists.ts` (they share a parser deliberately — fix both or
neither) against a live page **once the store's 403 has lifted**.

---

## 9. Phase G — repos, portability, and the phone

### G1. Own the repos (do this first — it is small and it protects everything)

The working tree is a heavily modified clone of someone else's project:

```
engine origin:  github.com/taciturnaxolotl/cedarengine
extension:      tangled.org/dunkirk.sh/cedarstalk-raycast
all commits by: Kieran Klukas
licence:        MIT, (c) 2026 Kieran Klukas
local work:     19 files changed, +1,406 lines, 44 new files
```

MIT permits a private fork and any modification. What it requires, and what
plain decency adds:

0. **Commit the existing work first**, before writing anything new. There are
   19 modified files and 44 untracked ones sitting in the tree — all of it the
   owner's work from previous sessions. Landing it in its own commits keeps it
   separable from whatever you do next; mixing the two makes both impossible to
   review or revert.
1. **Keep `LICENSE.md` and the copyright notice unchanged.** Do not relicense.
2. Add a line to the README: a fork of Kieran Klukas's cedarengine, with a link.
3. **Do not push to `origin`.** Rename it:
   `git remote rename origin upstream`, then add your own private repo as
   `origin`. The same for the extension.

**Before the first push, prove no student data is staged:**

```bash
git status --porcelain | grep -E 'data/|\.env$|\.db$|harvests/|chrome-profile/'   # expect nothing
git ls-files | grep -iE '\.env$|\.db$|cookie|harvest.*\.json'                    # expect nothing but .env.example
```

`data/` is already ignored in the engine (verified — the database is 59MB of
real names, dorm rooms and inferred timetables). **Add `.env` to the
extension's `.gitignore`** as well; there is none there today, but that is
where a token would land.

A private GitHub repo is still a copy of everything on someone else's servers.
Nothing under `data/` should ever be in a commit, private or not.

### G2. One cross-platform auth path

Today the engine's directory sweep borrows the Raycast extension's **Swift
WKWebView helper** (`src/auth.ts` → `xcrun swiftc` → `open -n -W`). It works
well, and it is macOS-only. It also couples the engine to a Raycast support
directory, which is a strange dependency regardless of platform.

**We already built the replacement without meaning to.**
`scripts/harvest-booklists.ts` drives a real browser through `playwright-core`
with a persistent profile. The same approach mints a Self-Service cookie on any
platform.

Build `scripts/auth-session.ts`:

- persistent profile at `data/sso-profile`. `data/` is already ignored
  wholesale, so this is covered — but it holds a **live Self-Service session**,
  so treat it like a credential: never copy it out of `data/`, never into a
  commit, and delete it if you are handing the machine on
- navigate to Self-Service; if the session is alive, read the cookies and write
  the cookie file, mode `0600`
- if it is not, exit **2**, the same contract
  `scripts/headless-directory.sh` already expects, with a message saying to run
  it once headed (`HEADED=1`) to sign in through SSO and MFA
- then point `headless-directory.sh` at this instead of the Swift app

**Scope it to the engine.** Leave the extension's Swift helper alone: it is good
on macOS, it is what you use interactively, and replacing it buys nothing today.

**Acceptance:** `headless-directory.sh` completes a sweep with the Swift helper
uninstalled. Exit 2 still means "sign in once", not "broken".

This is what makes Windows and Linux collection possible at all.

### G3. Linux

With G2 done the engine is portable already — Bun and SQLite, no macOS
dependencies of its own. What is left:

- launchd agents become **systemd user timers**: the four in §1.3, same commands
  and schedules.
- `channel: "chrome"` in `harvest-booklists.ts` needs a Chrome on the box, or
  swap to a downloaded Chromium (`playwright install chromium`, ~150MB).
- **There is no Raycast on Linux.** The engine's own web dashboard (`/`) and map
  (`/map`) are the interface, which is the real argument for G4.

### G4. The web surface, and the phone

This answers Linux and mobile together, and it is where the neglect is: every
good feature of the last few sessions went into Raycast while `src/dashboard.html`
stood still.

1. **Make `dashboard.html` and `map.html` work at phone width.** Single column
   under ~700px, tap targets, no horizontal scroll.
2. **Add the three things actually worth having on a phone**, reusing endpoints
   that already exist: quiet rooms near a building (`/v1/rooms/quiet?near=`),
   a person lookup with where-they-are-now (`/v1/people?q=`,
   `/v1/people/:id/location/now`), and who is in a building (§2 A1).
3. **Reach it over Tailscale.** Already installed here
   (`/Applications/Tailscale.app`). The server honours `HOST`
   (`src/index.ts`: `hostname: config.hostname`, default `127.0.0.1`), so set
   `HOST` to **the machine's own tailnet address** — not `0.0.0.0`. That binds
   the engine to the private tailnet and nowhere else, which is a meaningfully
   stronger position than a firewall rule.
4. **iOS Shortcuts** make good one-shot buttons over the same tailnet: a Home
   Screen or Action Button shortcut doing `GET /v1/people/:id/location/now` with
   the bearer token in the header.

**Never expose this publicly.** No ngrok, no port forwarding, no Tailscale
Funnel. It is a searchable database of students' dorm rooms and daily movements.
`.env.example` already says "keep it on loopback unless you mean it" — the
tailnet address is the only "mean it" that applies.

### G5. Not doing: Raycast Teams

A private org store would make the extension a normal installed extension rather
than a development one. **Decided against** — it is a paid tier and not worth it
here.

So dev-install stays the way it runs, which is fine: `npx ray develop` writes
real files to `~/.config/raycast/extensions/cedarville-people-search/` and they
keep working after it exits. The "Development" grouping is cosmetic, not a
degraded mode. The only consequence is §0.1 — **always confirm installed file
timestamps**, because nothing else will tell you the install did not happen.

---

## 10. Suggested order

1. **G1 own the repos** — small, and until it is done every other commit is
   aimed at someone else's project.
2. **A1 + A2** — engine routes with tests. Phase B depends on both.
3. **F1 course fit** — the best feature left, and the only one that answers a
   question nothing else on campus can.
4. **B1 My Day** — highest daily value, entirely from existing pieces.
5. **B3 Who's in This Building** — small, once A1 exists.
6. **F2 textbooks** — real money; skip prices until the parser is fixed.
7. **B2 Free Together** — the most new UI.
8. **G2 cross-platform auth** — do before any Windows or Linux work; also
   removes the engine's odd dependency on a Raycast directory.
9. **C1 Faculty**, **C2 Dorms** — straightforward.
10. **G4 web and phone** — the payoff for Linux and mobile at once.
11. Stop. Check `booklist_events` for §5.1, and only then weigh C3, §6, §7, G3.

After each piece: `bun test`, `npx tsc --noEmit`, `npx ray lint`, then
`npx ray develop` **and check the installed file's timestamp**.
