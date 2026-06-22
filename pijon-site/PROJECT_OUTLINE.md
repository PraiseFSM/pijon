# Pijon — Project Outline

> **This document is the source of truth.** It is written for humans, kept readable and
> editable, and describes *what Pijon should be* and *why*. The technical
> [IMPLEMENTATION_PLAN](docs/IMPLEMENTATION_PLAN.md) is derived from this and tells the coding
> agent *how* to move the code toward this ideal. When the two disagree, **this document wins** —
> update the implementation plan to match it.

---

## Design Goals (the north star — always kept in mind)

These are non-negotiable and every decision is checked against them.

1. **Local-first. Data never leaves the device.** No backend, no accounts, no telemetry that
   carries student data. A teacher's roster lives only in their browser / on their disk. This is
   both a legal requirement (FERPA/COPPA/GDPR — teachers are often forbidden from uploading student
   data to servers) and Pijon's core promise.
2. **No install, runs anywhere.** It must work on a locked-down, school-managed device — especially
   Chromebooks — where you cannot install software and security software blocks downloads. Pijon is
   opened from a URL and optionally "installed" as a PWA. Nothing to approve, nothing to sign.
3. **Privacy by design.** No sign-up, no tracking, no third-party data sharing. Any analytics are
   opt-in and free of personally identifiable information.
4. **Effortless for a busy teacher.** Autosaves constantly (never "lose your work"), imports a roster
   in seconds (drag-drop / paste a CSV), and is usable without a manual. One file = one class.
5. **One workspace, many tools.** A single, persistent classroom grid that you view through different
   *editors* (arrange furniture, place students, set preferences, …). Switching tools changes the
   controls around the grid, never the grid itself.
6. **Extensible by design.** New tools (editors), furniture types, and seating algorithms can be
   added without reworking the core. Adding a feature means instantiating an existing **template**
   (see below), not inventing new structure.

---

## What Pijon Is

Pijon helps a teacher build a classroom layout and seat students well — honoring who should sit
near whom (and who shouldn't), and where the fixed features of the room are. The teacher lays out
furniture, imports their roster, sets preferences, and lets Pijon suggest a seating arrangement they
can then fine-tune by hand.

---

## The Teacher's Workflow

This is the path Pijon is designed around — quick to start, then an iterative refine loop:

1. **Build the classroom layout.** Place desks and the room's fixed features (teacher's desk, board,
   door) on the grid.
2. **Import the student list.** Drag in or paste a CSV of names — the roster is ready in seconds.
3. **Allocate students to desks.** One action fills the desks with a first arrangement.
4. **Set preferences as you go.** Mark "sit near", "keep apart", or "near the window" right on the
   seating — no separate setup screen.
5. **Smart shuffle.** Pijon re-seats students using its algorithm and the preferences so far,
   producing a better arrangement.
6. **Lock the ones you like.** Pin students whose seats are right; locked students stay put.
7. **Refine and repeat.** Add more preferences, shuffle again (locked students don't move), lock
   more, shuffle again — converging on an arrangement the teacher is happy with.

The loop — **shuffle → lock → add preferences → shuffle** — is the heart of the app. Locking plus
smart shuffle let the teacher steer the algorithm without losing the parts they've already approved.

### Autosave & data safety (within this workflow)

Two promises sit on top of the workflow, straight from the Design Goals:

- **Never lose work.** Every change — a desk moved, a preference added, a lock, a shuffle — saves
  automatically and instantly. Close the tab or lose power, and the class is exactly as you left it.
- **Nothing leaves the device.** Autosave writes only to local storage on the teacher's own machine.
  It is never uploaded, synced, or sent anywhere — required by privacy law, and Pijon's promise.

Because this workflow is experiment-heavy, autosave is paired with **shuffle history**: each smart
shuffle is a step you can undo, so a shuffle you dislike is never destructive *even though everything
is saved*. The durable project (layout, roster, preferences, locks) is saved continuously; individual
arrangements are reversible snapshots layered on top.

The teacher stays in control of their data:
- A visible "saved locally" indicator, so it's obvious nothing was uploaded.
- One-tap **save to a file the teacher owns** (portable between devices), alongside the continuous
  local autosave used for crash recovery.
- One-tap **erase** to wipe a class from the device — important on shared or school-managed computers.

---

## Core Concepts (in plain language)

- **Classroom** — the workspace: a grid of a chosen size, plus everything placed on it. One
  classroom is one saved project file.
- **Furniture** — anything placed on the grid (a desk, a table, the teacher's desk, a whiteboard).
  Furniture has a size and a position. Furniture is what students attach to.
- **Occupant** — furniture can be *occupied*. A desk holds one **student**. Other furniture can hold
  a **faux occupant** — a stand-in that represents a feature of the room ("Whiteboard", "Door") so
  preferences can refer to it. (For now, furniture holds at most one occupant.)
- **Student** — a person to be seated, with a name and a set of **preferences**.
- **Preference** — a student's like/dislike: "sit near X", "avoid Y", "near the window", with a
  strength. Preferences drive the seating suggestions. Preferences between two students are always
  **mutual**: linking A to B links B to A with the same strength, and editing or removing one side
  updates the other.
- **Editor** — a *tool* for working on the classroom: the **Furniture editor** builds the room (and
  resizes the grid), and the **Students editor** moves students between furniture *and* sets their
  preferences (roster on the left; the selected student's summary and preferences appear beneath that
  student in the same left panel). More editors can be added.

**Expected behavior:** move a desk and its student comes along with it; switch from the student tool
to the furniture tool and your seating is still there.

---

## The Experience

```
 ┌─────────────────────────────────────────────────────────────────┐
 │  [ Furniture ] [ Students ]                    ← pick a tool       │  editor switcher
 ├─────────────────────────────────────────────────────────────────┤
 │  tool-specific toolbar (changes per editor)                       │  TOP BAR (swaps)
 ├───────────────┬─────────────────────────────────────────────────┤
 │ left panel    │                                                   │
 │ (roster /     │            the classroom grid                     │  GRID (shared, never swaps)
 │  palette)     │                                                   │
 └───────────────┴─────────────────────────────────────────────────┘
```

Switching tools swaps the **top bar** and the **left side panel**. The **grid stays put**, with all
furniture and seating intact. Everything autosaves as you go. Pijon uses a **single left panel** — in
the Students editor the roster sits on the left, and selecting a student reveals their summary and
preferences **directly beneath that student** in the same panel (there is no separate right panel).

---

## Building Blocks (the template-based approach)

Pijon is assembled from a small number of repeatable patterns ("templates"). Building a new feature
means filling in one of these templates rather than inventing new structure. The implementation plan
specifies exactly how each template is realized in code.

- **Entity template** — a domain object (Classroom, Furniture, Student, Preference). Plain data +
  pure functions; serializable; validated on load.
- **Editor template** — a tool the user works through. Provides its own top-bar controls, left
  panel, optional right panel, and how it responds to clicks/drags on the shared grid, plus any
  extra it draws on top. *Furniture and Students editors are instances of this template; the
  Students editor has both a left (roster) and right (preferences) panel.*
- **Algorithm template** — a seating allocator. Takes the roster + classroom and returns who sits
  where. New algorithms (greedy, random, annealing, …) plug in without touching the UI.
- **Persistence template** — how state is saved/loaded: transparent autosave plus explicit
  save/open of a project file, all on the teacher's device.
- **Theming/assets template** — visuals are data, not hardcode: images live in `assets/` under fixed
  names (documented in the asset reference doc) and every non-image color comes from one central
  colors file. Re-skinning Pijon means swapping images and editing one colors file — no component
  hunting.

---

## Feature Areas

**Classroom building** — resize the grid (add / delete rows & columns) via **+ / − buttons** drawn in
a ghost ring around the grid; place / move / delete furniture; furniture palette; (later) rotate,
multi-seat tables, custom images. Constraints that keep resizing sane:
- The **minimum placeable area is 3×3 units** (measured in real units, so the floor scales with
  granularity); the grid can never be shrunk below it.
- A **− (remove) button is hidden at any edge where removing would be invalid** — because furniture
  occupies that edge row/column, or because it would breach the 3×3 minimum. This also prevents a desk
  from ever sitting "on top of" a − button (the button simply isn't there when removal is illegal).
- The **+ / − resize buttons keep a constant physical size of one unit (1×1)** regardless of
  granularity — exactly like furniture keeps its real size when the grid densifies.

**Grid granularity** — finer cell density for more precise furniture placement *without* changing
furniture's real size. Granularity is restricted to **1, 2, or 4** (powers of two, so every change is
a clean multiple/divisor and furniture positions always scale to whole cells). Nearness thresholds are
stored in real units, so proximity/violations/neighbors stay correct across granularity changes.

**Roster** — add students manually (type a name) or import from CSV (the manual add box sits just
above the Import-CSV control, which is the last item in the roster panel); edit names; add / remove
students; export. (Later: import from a pasted spreadsheet column.)

**Seating** — the Students editor **top bar** holds, in order: **Allocate**, **Clear**, **Undo /
Redo**, a **weight selector** (−2, −1, +1, +2 — the strength applied to the next preference link),
**Export** and **Import** (the portable **`.pijon` project file**), and **Settings**. Beyond the
toolbar: drag students between desks (swap/move); **drag a student straight from the roster onto a
desk** (same behaviour as dragging between desks — seat them, swapping if occupied); lock a student to
a desk so suggestions won't move them; show constraint violations (on by default, kept live as
preferences change); show a desk's neighbors; an **invalid-seating banner** warns when there are more
students than seats or students left unplaced.

**Settings** (gear button in the Students editor toolbar) — a lightweight popover that houses
low-frequency controls: the **algorithm choice** (Greedy / Random) and the **allocate-vs-smart-shuffle**
variant (keep-locks); the **Nearness** proximity threshold (in real units, stored per classroom so
allocate, violations, and neighbor preview always agree); the **Show Violations** toggle (defaults to
on); and the **Show Links** toggle for preference lines.

**Preferences** (inside the Students editor, single left panel) — set "near / avoid" between students
and toward room features. Preferences are created **without a dedicated "add preference" form**: turn
on **assigner mode** and click two students to link them at the currently-selected weight, or use
drag/seat interactions. The **weight is chosen from four fixed options — −2, −1, +1, +2** (avoid
strong/weak, prefer weak/strong) in the top-bar selector. Selecting a student shows their **summary and
their preference list directly beneath them** in the roster panel, each entry removable. All
student↔student preferences are mutual.

**Look & feel (assets & theming)** — Pijon should be easy to make pretty and easy to re-skin:
- An **`assets/` folder** holds all images, each with a fixed expected filename, documented in an
  **asset reference document** (where it's used, expected size / aspect ratio / format, filename).
  Drop a correctly-named image in and it shows up. Ships with blank/placeholder images.
- **Furniture** can render from an image (per furniture kind) instead of a flat color; a flat color is
  the fallback.
- The **classroom background** can be an image (plain white by default) — an option, not required.
- The **favicon** is an asset-folder image (not hardcoded).
- The **grid color is adjustable**: a button (its icon is an asset) opens a color picker; the grid
  recolors **live** as you drag within the picker.
- A single **colors file** controls every non-image color in the app (buttons, backgrounds, menu
  bars, windows, panels) so the whole UI can be re-themed from one place.

**Saving & sharing** — autosave; save/open a project file the teacher controls; export an
arrangement (and later, print / export to image or PDF).

---

## Non-Goals

- No cloud accounts, sync, or multi-user collaboration (conflicts with local-first / privacy).
- No server-side storage or processing of student data.
- No native desktop installer as the *primary* channel (an optional offline build may come later
  from the same codebase, but the web app is the product).

---

## Development Philosophy (how Pijon is built)

Pijon is built by an **agent-led process** steered by short bursts of human feedback. The shape of
that process is itself a design goal: it must stay legible, testable, and repeatable.

1. **The human gives feedback.** Usually a few sentences — a bug, a feature, a change of direction —
   often dropped into a **feedback form** (e.g. `feedback.txt`).
2. **A conductor agent interprets it with maximum brainpower.** The conductor uses the **smartest
   available model at full effort** to understand the feedback *in context*: the codebase as it
   actually is, the project goals, and how the request aligns with this outline. For *every* piece of
   feedback it deliberately considers **how the feedback connects to the Project Outline** and weighs
   **multiple ways of implementing it** to best achieve the project goals — then it records the
   **best method** in the TODO (and amends this outline when the feedback changes *what Pijon is*).
   This outline is the yardstick: work that drifts from the Design Goals is corrected, not shipped.
   **Feedback-form lifecycle:** a filled-in feedback form is *processed* — translated into outline
   edits and concrete TODO entries — and **once that translation is complete the form file is
   deleted**, so an empty/absent form always means "nothing pending." Only delete it after the
   outline + TODO fully capture the feedback.
3. **The conductor decomposes the work** into manageable, well-scoped chunks and **spins up
   sub-agents** on a model appropriate to each chunk (cheaper/faster where the task allows) to
   implement them.
4. **The TODO is kept up to date.** The conductor maintains [TODO.md](TODO.md) as the live state of
   the work — what's done, what's in flight, what's next — and reconciles it with reality rather than
   letting it drift.
5. **Every task carries a testing sub-task.** No chunk is "done" until it is tested. A separate
   **checker agent** is spun up to *poke holes* in the previous agent's work: it writes tests,
   validates the code against the intent, and fixes any issues it finds. The builder and the checker
   are deliberately different agents so the checker reviews with fresh eyes. The project standard is
   roughly **2:1 test:code**.
6. **Work proceeds in priority order:**
   1. **Bugs that haven't been fixed yet** — a known-broken thing always outranks new work.
   2. **Tests that haven't been written yet** — close coverage gaps on shipped code before extending.
   3. **Features that haven't been added yet** — only once the above are clear.
7. **The conductor runs to completion.** Once given a direction, the conductor keeps dispatching
   build→check passes chunk after chunk **without stopping to be re-prompted between them**. It works
   down the TODO in priority order until the list is clear (or it hits a genuine blocker or a decision
   only the human can make), keeping the TODO updated as it goes. Finishing a chunk is a cue to start
   the next one, not to wait.

---

## How this document is used

1. The **human developer** edits *this* outline — goals, concepts, features.
2. That is translated into the technical [IMPLEMENTATION_PLAN](docs/IMPLEMENTATION_PLAN.md)
   (stack, class outlines, language decisions, phases).
3. The **conductor agent** reads the implementation plan and dispatches **sub-agents** to build each
   piece (see *Development Philosophy* above), checking every change back against the Design Goals,
   and pairing each build with a checker agent that tests it.

Prior art that informed these goals lives in the original PyQt prototype:
`../pijon-app/docs/ARCHITECTURE.md` and `../pijon-app/docs/RESTRUCTURE_PLAN.md`.
