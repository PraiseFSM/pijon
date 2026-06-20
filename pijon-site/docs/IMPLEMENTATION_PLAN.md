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

---

## 12. Iteration 2 — human-found bugs & feature requests

> Derived from the "Bugs & feature requests" section of `TODO.md`. Items that touch the
> domain/algorithm core (**12.3 granularity**, **12.5 mutual prefs**, and the core part of **12.2**)
> MUST get a full Vitest suite + an adversarial hole-poke pass — they can silently break the
> allocator. UI-only items (**12.1**, **12.4**) can follow the plain build pattern. Update
> `PROJECT_OUTLINE.md` in lockstep where product behavior changes (already done for 12.4/12.5).

### 12.1 Bug — context menu doesn't close on left-click (Student editor)
- **Cause:** the desk context menu (floating React menu in `StudentSidePanelWithMenu`, shown via the
  module-level `showContextMenuCallback`) only closes on another right-click.
- **Fix:** dismiss on any pointer-down outside the menu. Add a module-level `closeContextMenuCallback`
  (registered like `showContextMenuCallback`); call it from `StudentEditor.onPointerDown`, and while
  the menu is mounted attach a capture-phase `window` `pointerdown` listener that closes it unless the
  target is inside the menu element. Clear in `deactivate`.
- **Files:** `src/ui/editors/StudentEditor.tsx`. UI-only. If 12.4 lands first, implement here as part
  of the merged editor.

### 12.2 Bug — "Show Violations" is stale after preference edits
- **Cause:** violation rendering caches the SeatGraph by `classroom` reference + threshold and reads
  each seated student's prefs from the **occupant copy** on the furniture. `store.addPreference` makes
  a new `Student` in `roster` but doesn't update the occupant copy, and the cache key (classroom)
  doesn't change — so edits are never seen.
- **Fix:** make `roster` the source of truth for prefs and resolve seated students' prefs from
  `roster` by id at compute time; invalidate the violation/SeatGraph cache when `roster` changes too.
  The 12.5 change (occupants reference roster by id) makes this fall out for free.
- **Files:** `src/ui/editors/StudentEditor.tsx` (cache key + lookup), maybe `src/state/store.ts`.
  Add tests for the violation predicate against a live, edited roster.

### 12.3 Feature — adjustable grid (Furniture editor) — CORE, needs tests
- **(a) Resize (add/delete rows & columns):** domain `resizeGrid(classroom, edge, delta)` →
  new Classroom with `gridW/gridH` changed; adding at `top`/`left` offsets all furniture by the delta;
  deleting **blocks with a warning** if the row/col to remove is occupied (safer than clamping/dropping).
  Store `resizeGrid` action (immutable, marks dirty); Furniture toolbar gets +/- per edge.
- **(b) Finer granularity without resizing furniture:** add `cellsPerUnit` (granularity `G`) to
  Classroom. Furniture pos/size are stored in **fine cells**; raising `G` scales existing furniture by
  `G` so physical size is unchanged; new placement snaps at fine-cell resolution.
  - **Nearness must stay correct:** define the proximity threshold in **real units** and convert when
    building the SeatGraph: `thresholdCells = thresholdUnits * G`. `furniture_distance` stays in cell
    space. This keeps neighbor relationships stable as granularity changes — the trap to avoid.
- **Files:** `src/domain/classroom.ts`, `seatGraph.ts`, `io/projectFile.ts` (**schema v2 + migration**,
  bump `version`), `src/ui/editors/FurnitureEditor.tsx`, canvas (`cellSize` becomes px-per-fine-cell;
  `hitTest`/render already work in cells). Full tests + review.

### 12.4 Feature — merge Student + Preference editors into one
- Registry becomes `[FurnitureEditor, StudentEditor]`; **PreferenceEditor absorbed** (move marker mode
  + preference-link overlay into StudentEditor, delete the file).
- **EditorMode interface:** add optional `RightPanel?: React.FC<{ ctx: EditorContext }>`; the shell
  renders it to the right of the canvas when present (mirror the left `SidePanel`). Surgical interface
  + `App.tsx`/`shell` change.
- **StudentEditor:**
  - *Left roster panel:* a manual **add-student text box + Add button**, the student list (click →
    selects, sets `store.selectedStudentId`), and **Import CSV as the bottom-most control**.
  - *Right preferences panel:* the selected student's preferences (add/remove + weight), a **"show
    links" toggle**, and a **top toggle to enable preference-assigner (marker) mode**.
  - *Canvas:* marker mode (gated by the toggle) + link overlay, moved from PreferenceEditor.
- **Store:** add `selectedStudentId` (UI state) so both panels stay in sync.
- **Files:** `StudentEditor.tsx`, remove `PreferenceEditor.tsx`, `registry.ts`, `EditorMode.ts`,
  `App.tsx`/`shell/*`, `store.ts`. UI-heavy; marker/store bits get light tests.

### 12.5 Invariant — preferences are always mutual — CORE, needs tests
- **Enforce symmetry at write time:** `addPreference(A, →B)` also writes `B→A` (same weight,
  student-kind); `removePreference` removes both; weight edits update both. Provide
  `setMutualPreference(a, b, weight)` / `clearMutualPreference(a, b)` and route all UI through them.
- **Single source of truth:** switch runtime occupants for **real students** to reference `roster` by
  **studentId** (fixtures keep their embedded faux student — they're geometry). `selectArrangement`
  resolves `fid → studentId → roster Student`. This matches the on-disk format (arrangement is already
  `fid → studentId`) and removes the duplicated student copies behind 12.2.
- **Files:** `src/domain/furniture.ts`/`classroom.ts`, `src/state/store.ts`,
  `io/projectFile.ts` (likely already compatible), editor read paths. Full tests + adversarial review.

### Suggested execution order
1. **12.1** (tiny UI bug).
2. **12.5** (core: mutual prefs + roster-as-source-of-truth) — unblocks 12.2.
3. **12.2** (violations refresh) — largely falls out of 12.5.
4. **12.4** (merge editors).
5. **12.3** (adjustable grid) — largest core change; do last.

Core work (12.3, 12.5, and 12.2's core part): tests + hole-poke review. UI work (12.1, 12.4): build pattern.

---

## 13. Iteration 3 — round-2 feedback

> From `TODO.md` "Iteration 3". Mostly UI/UX (build pattern); 13.8 (invalid-seating) touches the
> store/validation and gets tests. Keep the suite green; no network (ESLint hard error). Update the
> outline if product behavior shifts (settings menu, violations-on-by-default, drag-from-roster).

### 13.1 Bug — furniture drags live, not as a ghost image
- Furniture should appear to **move in real time** on the grid while dragging, instead of showing the
  browser's default HTML5 drag-image (the furniture PNG ghost).
- For **moving existing furniture** (FurnitureEditor pointer-drag): already pointer-based; ensure the
  `paintOverlay` renders the furniture itself at the live position each move (not just an outline), and
  optionally dim the original. For **palette → grid placement** (HTML5 drag): suppress the default drag
  image (`e.dataTransfer.setDragImage` to a transparent 1px, or switch the palette to a pointer-drag
  that paints a live preview onto the canvas). Pick the approach that gives instant live furniture.
- Files: `src/ui/editors/FurnitureEditor.tsx`, maybe `src/ui/canvas/render.ts`. UI-only.

### 13.2 Feature — single action split-button (algorithm dropdown)
- Replace the separate Allocate / Smart Shuffle / algorithm `<select>` with one **split-button**:
  primary click runs the shuffle with the chosen allocator; a dropdown chooses algorithm
  (Greedy default / Random) and the allocate-vs-shuffle variant. Drive the algorithm list from the
  existing allocator set (no hardcoding beyond what's there). Files: `src/ui/editors/StudentEditor.tsx`.

### 13.3 Feature — Settings menu
- Add a lightweight **settings popover** (gear button) in the Students toolbar (or app shell). Houses
  low-frequency controls. New small component, e.g. `src/ui/shell/SettingsMenu.tsx` or editor-local.
- Settings state that must persist (e.g. violations-on, nearness) should live in the store and be
  serialized as UI/project settings; transient menu open/close is local.

### 13.4 Feature — nearness in Settings
- Move the Nearness (units) control out of the main toolbar into the §13.3 settings menu. Keep it in
  **units** (post-12.3). Files: `src/ui/editors/StudentEditor.tsx`, settings menu.

### 13.5 Feature — violations ON by default, off-switch in Settings
- Default Show-Violations to **on**. Move its toggle into the §13.3 settings menu. Persist the flag in
  the store (so it survives reloads). Ensure the existing live-refresh (12.2) still holds. Files:
  `src/ui/editors/StudentEditor.tsx`, store (a `showViolations` setting), settings menu.

### 13.6 Bug/UX — assigner first-click feedback
- In preference-assigner mode, selecting the first student must give **obvious** feedback: a strong
  highlight ring on the desk (already partial — make it unmistakable) plus a toolbar/hint cue naming
  the selected student ("Linking <name>… click another, ESC to cancel"). Files: `StudentEditor.tsx`
  (`paintOverlay` + the right-panel/toolbar hint).

### 13.7 Feature — drag a student from the roster onto a desk
- Make roster list items draggable (HTML5 drag, set a `studentId` payload). The canvas `onDrop` (in
  StudentEditor) maps the drop cell → furniture and **seats that student** (swap if the desk is
  occupied, move if the student was already seated elsewhere) via the store. Suppress/clean the drag
  image per 13.1's approach. Files: `StudentEditor.tsx` (roster panel + canvas onDrop), store
  (reuse `manualReassign`/assignment actions; may need an `assignStudentToFurniture(sid, fid)` action).

### 13.8 Feature — surface an error on invalid seating
- Define "invalid" precisely: at minimum (a) **more students than assignable seats** (allocate/shuffle
  can't place everyone) and (b) any allocation that leaves students unplaced. Surface a clear,
  non-crashing **error/warning banner** (e.g. "3 students couldn't be seated — 28 seats for 31
  students"). Consider a `validateSeating(classroom, roster)` pure helper returning structured issues,
  shown by the editor. Don't block the workflow — inform. Files: `src/domain/` (a `validateSeating`
  helper + tests), `src/state/store.ts` (expose issues), `StudentEditor.tsx` (banner). Add tests for
  the validation helper.

### Suggested order
13.3 (settings shell) → 13.4 + 13.5 (move controls in, violations-on) → 13.2 (split-button) →
13.6 (assigner feedback) → 13.1 (live furniture drag) → 13.7 (drag from roster) → 13.8 (validation).
13.8 gets tests; the rest follow the build pattern with a light review.
