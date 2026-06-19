# Restructure Plan — Unified Grid + Pluggable Editors

## Context / why

Today each tab ("Build Classroom", "Place Students") is a self-contained widget with its **own
grid**. Switching tabs swaps the top toolbar, the left panel, **and** the grid — they operate on
two disconnected copies of the classroom. Worse, seating truth lives in a `SeatingGrid.assignments`
dict keyed by `furniture_id`, *separate* from the furniture, so moving a desk can't carry its
student and switching tabs can't preserve seating.

**Goal:** switching editors swaps only the **top bar** and **left bar**; the **grid is shared and
persistent**. A student assigned to a desk stays on that desk when you switch to the furniture
editor and move the desk (the student rides along). Editors become pluggable — start with
**Furniture** and **Student** editors, designed so a **Preference** editor (and more) drop in later.

The enabling model change: **objects in the grid are `Furniture` with an `occupants` list** (0 or 1
for now). A real student or a *faux* student (fixture / arbitrary classroom feature) occupies
furniture. Students are tied to furniture, not to the grid.

---

## Target architecture

```
MainWindow
 ├─ document: Classroom (single source of truth: furniture + occupants)
 ├─ roster:   List[Student] (shared across editors)
 ├─ EditorSwitcher (QTabBar/QStackedWidget — picks the active EditorMode)
 ├─ TOP BAR area      → QStackedWidget of per-editor toolbars   (SWAPPED)
 └─ QSplitter
     ├─ LEFT BAR area → QStackedWidget of per-editor side panels (SWAPPED)
     └─ ClassroomCanvas  ← ONE shared grid widget               (NOT swapped)
```

- **`ClassroomCanvas`** (new, in `src/ui/canvas.py`): the single grid widget. Renders grid lines +
  furniture (image) + occupant name from the shared `Classroom`. Delegates all input
  (mouse/key/dragdrop/contextmenu) and an overlay paint pass to the **active `EditorMode`**.
  Reads grid dims/cell size from the document; never owns furniture or assignments.
- **`EditorMode`** (new abstract base, `src/ui/editors/base.py`): a strategy object per editor.
  ```python
  class EditorMode:
      name: str
      def toolbar(self) -> QWidget: ...        # page for the top-bar stack
      def side_panel(self) -> QWidget: ...     # page for the left-bar stack
      def activate(self, canvas, doc, roster): ...
      def deactivate(self): ...                # cancel transient state (drag, marker, previews)
      # input hooks (operate on shared doc + canvas):
      def mouse_press/move/release(self, e, canvas): ...
      def key_press(self, e, canvas): ...
      def drag_enter/drop(self, e, canvas): ...
      def context_menu(self, e, canvas): ...
      def paint_overlay(self, painter, canvas): ...   # mode-specific decorations
  ```
- Concrete editors: `FurnitureEditor`, `StudentEditor`, (future) `PreferenceEditor` under
  `src/ui/editors/`.

### Data model changes (`src/models/`)

- **`Furniture.occupants: List[Student] = field(default_factory=list)`** (0/1 enforced for now).
  Add helpers: `capacity()` (= `len(self.get_seats())`), `occupant` property (first or `None`),
  `assign(student)`, `vacate()`, `is_fixture()` (occupant exists and `metadata['is_fixture']`).
  Because occupants ride on the furniture object, **moving furniture carries the student for free**.
- **`Classroom`** becomes the document: keep `furniture`, add convenience views:
  `furniture_by_id`, `assignments()` → `{fid: f.occupant for f in furniture if f.occupant and not f.is_fixture()}`,
  `fixtures()` → faux occupants. The old `SeatingGrid.assignments` dict is **replaced by this derived view.**
- **Fixtures move into the model**: a fixture is `Furniture` (capacity 0, e.g. TeacherDesk) carrying a
  faux `Student(metadata['is_fixture']=True)` in `occupants`, using the existing deterministic
  `fixture_id(name)`. `SeatGraph` **reads** fixtures from furniture occupants instead of synthesizing them.

### Algorithm / IO adjustments

- `SeatGraph._build`: derive `fixtures`/`fixture_id_to_fid` from furniture occupants (faux students)
  rather than generating sentinels. `assignable` unchanged (capacity > 0). Edge logic unchanged.
- Allocators still return `Dict[fid, Student]`; a small adapter writes that back into
  `furniture.occupants` on the document (canvas repaints). Allocator/marginal-cost code untouched.
- Serialization split (keeps layouts roster-independent, backward compatible):
  - **Classroom JSON**: furniture geometry **+ faux/fixture occupants only** (a `fixture` block per
    furniture). No real students. Files like `data/classrooms/9.json` (no occupant keys) load fine.
  - **Arrangement JSON** (`arrangement_io`): unchanged `{fid: student_name}` for real students;
    on load, names→students are placed into `furniture.occupants`.

### Editor responsibilities (where current code goes)

| Editor | Top bar | Left bar | Canvas interaction (ported from) |
|---|---|---|---|
| **FurnitureEditor** | New / Save / Load / Clear classroom | `FurniturePalette` | place (palette drop), move, delete furniture — from `ClassroomGrid`. Occupant rides along on move. **Fix:** use `create_furniture()` so placed desks have a seat. |
| **StudentEditor** | Allocate, Clear, Export, Save/Load arrangement, Violations, Nearness | `StudentListWidget` | drag student between furniture (swap/move), lock/unlock, neighbor preview, violations — from `SeatingGrid`, refactored to read/write `furniture.occupants`. |
| **PreferenceEditor** (future) | Weight field, marker controls | per-student preference list | marker mode (click two occupants → `Preference`); future constraint lines — extracted from `SeatingGrid` marker code. |

The shared roster is owned by `MainWindow`; `StudentListWidget` and preference panels read/write it.

---

## Challenges & how the plan handles them

1. **Two grids → one shared source of truth.** MainWindow owns one `Classroom` + roster; the single
   `ClassroomCanvas` renders it; editors mutate it. Per-grid `furniture_list`/`assignments` ownership removed.
2. **Seating stored off-furniture (dict keyed by fid).** Move occupants onto `Furniture.occupants`;
   replace the dict with a derived `Classroom.assignments()` view. Moving furniture now carries the student inherently.
3. **Fixtures synthesized in SeatGraph won't survive editor switches / aren't visible in furniture editor.**
   Make fixtures real furniture-with-faux-occupant in the model; SeatGraph reads them. Keeps deterministic ids.
4. **Same mouse/key events mean different things per editor.** `EditorMode` strategy owns event
   handling; `ClassroomCanvas` delegates. Avoids a god-widget of mode flags and makes new editors additive.
5. **Mode-specific painting** (violation tint, neighbor highlight, lock badge, drag preview, palette ghost).
   Canvas does the base render; the active mode contributes a `paint_overlay()` pass.
6. **Grid dimensions / cell size ownership.** Canvas reads dims from the document; New/Load classroom
   updates the document and the canvas resizes. Cell size is a canvas setting shared by all modes (future zoom).
7. **Deleting/moving furniture that has an occupant.** Define behavior: move is safe (occupant rides along);
   delete vacates — a real student returns to the unassigned roster, a faux student is destroyed (confirm if occupied).
8. **Switching editors mid-interaction leaks state** (active marker, in-flight drag, neighbor preview, violation toggle).
   `EditorMode.deactivate()` cancels transient state and `activate()` resets cursor; canvas calls them on switch.
9. **Roster shared across editors.** Owned by MainWindow/document; panels bind to it instead of each holding a copy.
10. **Serialization split (layout vs arrangement vs roster).** Classroom file = geometry + fixtures;
    arrangement file = fid→real-student-name; load composes both onto occupants. Backward compatible with existing files.
11. **Latent subclass bug** (`ClassroomGrid.dropEvent` builds base `Furniture`, capacity 0). Fix by using
    `create_furniture()` so placed desks are assignable — important now that capacity drives assignable/fixture.
12. **Big-bang refactor risk.** Phase it (below); the model/algorithm tests guard each step.

---

## Implementation phases

1. **Model**: add `occupants` + helpers to `Furniture`; add `assignments()/fixtures()/furniture_by_id`
   to `Classroom`; extend `to_dict/from_dict` with the fixture block. Update tests.
2. **Algorithm/IO**: `SeatGraph` reads fixtures from occupants; add the allocator→occupants writeback
   adapter; adjust `arrangement_io` load to populate occupants. Keep tests green.
3. **Canvas + EditorMode scaffolding**: build `ClassroomCanvas` (base render + delegation) and the
   `EditorMode` base, wired to a throwaway no-op mode.
4. **FurnitureEditor**: port `ClassroomGrid`/`FurniturePalette` logic into a mode; fix the factory bug.
5. **StudentEditor**: port `SeatingGrid`/`StudentPlacerWidget` logic into a mode, reading/writing occupants.
6. **MainWindow wiring**: replace the two full-tab widgets with the EditorSwitcher + stacked toolbars +
   stacked side panels + the one shared canvas. Delete `setup_widget.py` (unused).
7. **PreferenceEditor (optional, last)**: extract marker mode into its own editor to prove extensibility.

Old files `classroom_builder.py` / `student_placer.py` are decomposed into `src/ui/canvas.py` +
`src/ui/editors/*`; remove them once ported.

---

## Verification

- `pytest` after phases 1–2 (model/algorithm/IO regressions: `test_allocator`, `test_seat_graph`,
  `test_arrangement_io`, `test_csv_handler`).
- Backward-compat: load `data/classrooms/9.json` (no occupant keys) — must load with empty occupants.
- Manual end-to-end (run `pijon-app/run.sh`):
  1. Furniture editor: place desks + a teacher-desk fixture; Save classroom.
  2. Student editor: import CSV, Allocate; confirm names on desks and the fixture shows as faux.
  3. Switch to Furniture editor, drag an occupied desk — **the student moves with it**; switch back, seating intact.
  4. Lock a seat, re-allocate — locked student stays. Save/Load arrangement round-trips.
  5. Toggle Violations / neighbor preview in the student editor; confirm overlays render on the shared grid.
