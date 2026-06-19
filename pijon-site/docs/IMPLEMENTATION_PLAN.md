# Pijon Web — Implementation Plan

> Technical companion to [PROJECT_OUTLINE.md](../PROJECT_OUTLINE.md). The outline is the source of
> truth for *what/why*; this plan is *how*. The coding agent reads this and dispatches subagents
> per task (see **Build Phases**). If this plan and the outline conflict, the outline wins — fix
> this file.
>
> **Every task must be checked against the outline's Design Goals**, especially: no backend, no
> data leaves the device, runs on a locked-down Chromebook with no install.

---

## 1. Tech stack & rationale

| Choice | Pick | Why (maps to design goal) |
|---|---|---|
| Language | **TypeScript** (strict) | Type-safe domain + algorithm; small enough to own outright. |
| Build/dev | **Vite** | Fast, zero-config static output → hostable on any static CDN (no backend → goal 1/2). |
| UI framework | **React 18** + function components | Ubiquitous, subagent-friendly, good ecosystem. *Svelte is a viable leaner alternative; React chosen for familiarity. This is the one swappable decision — confirm before phase 3.* |
| State | **Zustand** | Tiny, store-based, easy autosave subscriptions; no boilerplate. |
| Grid rendering | **Canvas 2D** | Mirrors the proven PyQt painter model; performant; the "editor draws an overlay" pattern ports directly. |
| Local storage | **IndexedDB** via `idb` | Transparent autosave, large capacity, fully client-side (goal 1). |
| File save/open | **File System Access API** w/ download/upload fallback | "One file = one class"; FSA on Chromebooks/Edge, graceful fallback on Firefox/Safari (goal 4). |
| Validation | **Zod** | Parse/validate imported CSV + project files defensively. |
| Offline/install | **vite-plugin-pwa** (Workbox) | Installable, works offline, no app store (goal 2). |
| Tests | **Vitest** | Unit-test the domain/algorithm (the part that must stay correct). |

No network calls at runtime. No analytics in v1 (if ever added: opt-in, PII-free).

---

## 2. Project structure

```
pijon-site/
  PROJECT_OUTLINE.md           # source of truth (human)
  docs/IMPLEMENTATION_PLAN.md  # this file
  index.html
  vite.config.ts
  src/
    domain/        # pure, framework-free, fully tested
      types.ts            # ids, Vec2, unions
      furniture.ts        # Furniture data + seats()/capacity()/occupant helpers
      student.ts
      preference.ts
      classroom.ts        # the document; assignments()/fixtures() views
      seatGraph.ts        # proximity graph (port of SeatGraph)
      allocators/
        types.ts          # Allocator interface
        bogo.ts
        greedy.ts
      io/
        csv.ts            # import/export (port of csv_handler)
        projectFile.ts    # serialize/deserialize the .pijon project
    state/         # Zustand store + autosave wiring
      store.ts
      persistence.ts      # IndexedDB autosave + File System Access
    ui/
      App.tsx
      canvas/
        ClassroomCanvas.tsx # the one shared grid (Canvas 2D)
        render.ts           # base render (grid + furniture + occupant)
        hitTest.ts          # cell <-> furniture lookups
      editors/
        EditorMode.ts       # the Editor template (interface)
        registry.ts         # list of available editors
        FurnitureEditor.tsx
        StudentEditor.tsx
        PreferenceEditor.tsx
      shell/
        EditorSwitcher.tsx  # tabs that pick the active editor
        TopBar.tsx          # hosts active editor's toolbar
        SidePanel.tsx       # hosts active editor's panel
      dialogs/              # algorithm select, student options, preference edit
    main.tsx
```

---

## 3. Domain layer (TypeScript)

**Language decision: data + pure functions over class inheritance.** The PyQt prototype used
subclassing (`SingleDesk extends Furniture`). In TS we model furniture as a single type with a
discriminated `kind` and derive capacity from data — easier to serialize, diff for undo/redo, and
keep in a store. Use `readonly`, branded id types, and discriminated unions throughout.

```ts
// types.ts
export type FurnitureId = string & { readonly _t: 'FurnitureId' };
export type StudentId   = string & { readonly _t: 'StudentId' };
export interface Vec2 { readonly x: number; readonly y: number; }
export type FurnitureKind = 'single_desk' | 'table' | 'teacher_desk' | 'whiteboard';

// furniture.ts
export interface Furniture {
  readonly id: FurnitureId;
  readonly kind: FurnitureKind;
  readonly pos: Vec2;        // top-left cell
  readonly w: number; readonly h: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly imagePath?: string;
  readonly occupants: readonly Student[];   // 0 or 1 for now
}
export const capacity = (f: Furniture): number => /* by kind: desk=1, table=N, teacher_desk/whiteboard=0 */;
export const seatCells = (f: Furniture): Vec2[] => /* port of get_seats() positions */;
export const occupiedCells = (f: Furniture): Vec2[] => /* port of get_occupied_cells() */;
export const occupant = (f: Furniture): Student | undefined => f.occupants[0];
export const isFixture = (f: Furniture): boolean => !!occupant(f)?.isFixture;

// student.ts
export interface Student {
  readonly id: StudentId;
  readonly name: string;
  readonly isFixture?: boolean;            // faux occupant / room feature
  readonly preferences: readonly Preference[];
  readonly metadata?: Record<string, unknown>;
}

// preference.ts — discriminated union on target
export type Preference =
  | { kind: 'student';   targetId: StudentId;  weight: number }
  | { kind: 'furniture'; targetId: string;     weight: number }   // toward a feature
  | { kind: 'location';  target: string;       weight: number };  // 'front' | 'window' | ...

// classroom.ts — the document (single source of truth at runtime)
export interface Classroom {
  readonly name: string;
  readonly gridW: number; readonly gridH: number;
  readonly furniture: readonly Furniture[];
}
export const assignments = (c: Classroom): Map<FurnitureId, Student> => /* real occupants */;
export const fixtures    = (c: Classroom): Map<FurnitureId, Student> => /* faux occupants */;
export const furnitureById = (c: Classroom, id: FurnitureId) => /* ... */;
```

**Design decision — occupants attach to furniture, not the grid.** Putting `occupants` on
`Furniture` (rather than a separate seat-position→student map) is what makes the outline's expected
behavior fall out for free: moving a desk carries its student, and switching editors can't lose
seating because seating *is* part of the furniture. It also keeps the document a single serializable
tree. This is an implementation choice in service of the workflow, not a product concept.

**Fixtures live in the model** (a `teacher_desk`/`whiteboard` carrying a faux student), not
synthesized at graph-build time as in the prototype. Deterministic fixture ids via a `fixtureId(name)`
hash helper (port of `csv_handler.fixture_id`).

**SeatGraph** (`seatGraph.ts`): port of `algorithm/seat_graph.py`. Build proximity edges over all
furniture (center distance ≤ threshold); `assignable` = capacity > 0; read fixtures from occupants;
expose `neighbors()`, `areNeighbors()`, `availableSeatIds()`, plus `assign/lock` for pre-population.

**Allocators** (`allocators/`): `Allocator` interface
`allocate(students, classroom, graph): Map<FurnitureId, Student>`; port `BogoAllocator` and
`GreedyAllocator` (most-constrained-first, marginal cost, bidirectional prefs, fixture scoring). A
thin adapter writes the result back into `furniture.occupants` in the store.

**IO**: `csv.ts` ports the simple/full auto-detecting importer + full-format exporter (Zod-validated).
`projectFile.ts` defines the single `.pijon` JSON: `{ version, classroom (geometry + fixtures),
roster, arrangement (fid→studentId), preferences }`. Backward-compat note: the prototype's
`data/classrooms/*.json` can be read by an optional importer.

---

## 4. Persistence layer

Designed around the teacher workflow's **shuffle → lock → add preferences → shuffle** loop, where
autosave must be constant *and* a bad shuffle must stay reversible — all strictly on-device.

**Split durable project from arrangement history.** The project document (layout, roster,
preferences, locks) is the durable thing; an arrangement (who sits where after a shuffle/drag) is a
snapshot layered on top.

- **Transparent autosave:** the Zustand store subscribes → **debounced** (~300–500ms) write of the
  durable project to **IndexedDB** under a stable per-class key. Hydrate from IndexedDB on load.
  Teacher never loses work; UI shows a "saved locally" indicator.
- **Shuffle history / undo:** keep a **bounded arrangement history stack** (e.g. last N arrangements)
  persisted alongside the project. Each *smart shuffle* and each *manual move* pushes a snapshot;
  undo/redo steps through them. So autosave is non-destructive across the iterative loop — a disliked
  shuffle is one undo away even though state was saved. Locks/preferences are part of the durable
  project, not the reversible snapshots.
- **Explicit save/open:** **File System Access API** to write/read a `.pijon` file the teacher owns;
  remember the handle for one-tap re-save. **Fallback** (Firefox/Safari): Blob download + file-input
  open. Detect support at runtime. This is the portable copy; IndexedDB is for crash recovery.
- **Multiple classes:** each project = one IndexedDB record (+ optional file); a simple "projects"
  list in the store. "One file = one class" (goal 4).

**Privacy controls (goals 1 & 3 — autosave persists PII, so handle it deliberately):**
- All writes are local only — **no network, no sync** by construction (verified by an empty Network tab).
- **One-tap erase** that deletes the IndexedDB record(s) — for shared / school-managed devices where
  another user could otherwise open the browser and see a roster.
- Store **only what's needed** (names, preferences, layout); no hidden metadata, no content analytics.
- *Optional, later:* a "shared computer" mode (session-only, skip IndexedDB) and/or passphrase
  **encryption-at-rest** of the IndexedDB record via the Web Crypto API.

---

## 5. UI layer

**ClassroomCanvas** — the single shared grid. Owns a `<canvas>`, reads the classroom from the store,
runs `render.ts` for the base pass (grid lines + furniture image + occupant name), then calls the
**active editor's** `paintOverlay(ctx, view)`. Forwards pointer/keyboard/drop/contextmenu events to
the active editor. Reads grid dims from the document; cell size is a canvas setting (enables zoom).

**EditorMode (the Editor template)** — `ui/editors/EditorMode.ts`:

```ts
export interface EditorContext { store: Store; canvas: CanvasView; }
export interface EditorMode {
  readonly id: string;
  readonly label: string;
  Toolbar: React.FC<{ ctx: EditorContext }>;     // rendered into TopBar
  SidePanel: React.FC<{ ctx: EditorContext }>;   // rendered into SidePanel
  activate(ctx: EditorContext): void;
  deactivate(ctx: EditorContext): void;          // cancel transient state (drag/marker/preview)
  onPointerDown/Move/Up(e, ctx): void;
  onKeyDown(e, ctx): void;
  onDrop(e, ctx): void;
  onContextMenu(e, ctx): void;
  paintOverlay(ctx2d: CanvasRenderingContext2D, view: CanvasView): void;
}
```

Concrete editors (each an instance of the template):
- **FurnitureEditor** — palette (side panel); place/move/delete furniture; collision check; New/Save/
  Load/Clear in toolbar. Moving furniture carries its occupant for free (occupant is on the furniture).
- **StudentEditor** — roster (side panel, CSV import/edit); drag students between furniture (swap/move);
  lock/unlock; neighbor preview; violations; Allocate/Clear/Export/Save-Load-arrangement in toolbar.
- **PreferenceEditor** — marker mode (click two occupants → preference), weight control; per-student
  preference list in the side panel.

Switching editors calls `deactivate`/`activate` so transient state never leaks; the grid + document
stay untouched.

**Shell** — `EditorSwitcher` (tabs) selects the active editor from `registry.ts`; `TopBar`/`SidePanel`
render the active editor's `Toolbar`/`SidePanel`. Adding an editor = add one entry to the registry.

**Dialogs** — algorithm selection (driven by an allocator registry), student options (rename/delete/
prefs), preference edit, read-only student info. Ports of `ui/dialogs.py`.

---

## 6. PWA / deployment

- `vite-plugin-pwa` with `registerType: 'autoUpdate'`, precache the app shell → full offline use.
- Web manifest (name, icons, standalone) so it installs to a Chromebook shelf / desktop.
- Output is static (`vite build`) → deploy to any static host (GitHub Pages, Netlify, Cloudflare
  Pages). **No server, no runtime network.** Optional later: a Tauri wrapper from the same `src/` for
  an offline desktop artifact (secondary channel only).

---

## 7. Language-specific design decisions (TS)

- `strict: true`; no `any`. Branded id types prevent mixing student/furniture ids.
- Domain is **immutable data + pure functions**; mutations happen only via store actions that produce
  new state (enables clean autosave + future undo/redo).
- Discriminated unions for `FurnitureKind` and `Preference` (replaces Python subclass dispatch).
- Zod schemas are the single definition of on-disk formats; parse at every boundary (CSV, project file).
- Domain layer imports nothing from React/DOM — keeps it unit-testable and reusable (e.g., future Tauri/CLI).

---

## 8. Build phases (subagent task breakdown)

Each phase is a dispatchable unit; phases 1–2 are independently testable with no UI.

1. **Scaffold** — Vite + React + TS strict + Vitest + ESLint/Prettier; empty app shell renders.
2. **Domain core** — `types/furniture/student/preference/classroom` + unit tests (capacity, cells,
   assignments/fixtures views).
3. **Graph + allocators** — `seatGraph` + `bogo`/`greedy` + tests ported from the prototype's
   `test_seat_graph`/`test_allocator`.
4. **IO** — `csv` import/export + `projectFile` (Zod) + tests; optional legacy-classroom importer.
5. **Store + persistence** — Zustand store, IndexedDB autosave, File System Access save/open + fallback.
6. **Canvas** — `ClassroomCanvas` base render + hit-testing + event delegation to a no-op editor.
7. **FurnitureEditor** — palette, place/move/delete, collision.
8. **StudentEditor** — roster panel, allocate, drag-between-desks, lock, violations, arrangement IO.
9. **Shell wiring** — EditorSwitcher + TopBar + SidePanel stacks around the shared canvas.
10. **PreferenceEditor** — marker mode + preference list (proves the Editor template extends cleanly).
11. **PWA + deploy** — manifest, service worker, static deploy.

---

## 9. Verification

- `vitest` green for domain/graph/allocators/IO after phases 2–4 (these mirror the prototype's tests).
- Backward-compat: importing a prototype `data/classrooms/*.json` yields a valid classroom.
- Manual, on a Chromebook / Chrome with no install:
  1. Open the URL; import a roster CSV by drag-drop.
  2. Furniture editor: place desks + a teacher-desk fixture; reload page → **work is still there** (autosave).
  3. Student editor: Allocate; drag a student; lock one; re-allocate → locked stays.
  4. Switch to Furniture editor, move an occupied desk → **student moves with it**; switch back → intact.
  5. Save to a `.pijon` file, clear, re-open the file → identical state.
  6. Go offline → app still loads and works (PWA).
- Confirm **zero** outbound network requests at runtime (DevTools Network tab).
