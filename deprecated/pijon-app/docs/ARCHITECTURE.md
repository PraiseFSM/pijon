# Pijon — Code Outline & Architecture (context)

Working notes / map of the codebase as it exists **before** the editor-restructure.
Keep this current as the refactor lands.

App entry: [main.py](../main.py) → `QApplication` → `MainWindow(QMainWindow)` with a
`QTabWidget` holding two tabs: **Build Classroom** (`ClassroomBuilderWidget`) and
**Place Students** (`StudentPlacerWidget`). Each tab is a *self-contained* widget with its
own toolbar, its own side panel, and its **own grid**. This is the thing we are restructuring.

---

## Models — `src/models/`

### `furniture.py`
- `FurnitureType(Enum)`: SINGLE_DESK, TABLE, CHAIR, TEACHER_DESK.
- `Furniture` (`@dataclass`): `furniture_id, furniture_type, position:(x,y), width, height, image_path, rotation`.
  - `get_occupied_cells()` → list of grid cells covered.
  - `get_seats()` → `List[Seat]` (base returns `[]`; overridden per subclass).
  - **No occupant field today.** Capacity is implicit in `len(get_seats())`.
- Subclasses: `SingleDesk` (1×1, one seat), `Table` (N seats around perimeter), `TeacherDesk` (no seats).
- `create_furniture(type, id, pos, **kw)` factory.
- ⚠️ Latent bug: `ClassroomGrid.dropEvent` builds a **base `Furniture`** (no seats ⇒ not assignable) instead of using the factory. Loaded classrooms use proper subclasses via `Classroom.from_dict`.

### `seat.py`
- `Seat` (`@dataclass`): `position, seat_id, occupied_by: Optional[Student]=None`. `occupied_by` is currently **unused** — assignment state lives elsewhere (see below).

### `student.py`
- `Student` (`@dataclass`): `id, name, metadata:dict, preferences:List[Preference]`.
- Preference helpers (`add/remove/get_*_preferences`, `get_preference_for`), `to_dict`/`from_dict`.
- Fixtures are represented as `Student` with `metadata['is_fixture']=True`.

### `preference.py`
- `PreferenceTargetType(Enum)`: STUDENT, FURNITURE, LOCATION.
- `Preference` (`@dataclass`): `target_type, target_id, weight` (neg=avoid, pos=prefer, |w|=strength).
- Convenience builders: `avoid_student / prefer_student / avoid_furniture / prefer_furniture / prefer_location`.

### `classroom.py`
- `Classroom`: `name, grid_width, grid_height, furniture: List[Furniture]`.
- `furniture_distance(f1,f2)` (center-to-center euclidean — used for proximity edges).
- `add/remove/clear_furniture`, `to_dict`/`from_dict`, `save_to_file`/`load_from_file`/`list_saved_classrooms` (JSON under `data/classrooms/`).
- **Holds no students/occupants today.** Layout only.

---

## Algorithm — `src/algorithm/`

### `seat_graph.py`
- `PROXIMITY_THRESHOLD = 1.5`.
- `SeatGraph(classroom, proximity_threshold)`: builds proximity graph over **all** furniture.
  - `nodes` (all), `edges` (fid→neighbor fids), `assignable` (furniture with seats),
    `fixtures` (fid→**synthesized** sentinel `Student`), `fixture_id_to_fid`,
    `occupants` (pre-assigned/locked), `locked`.
  - **Fixtures are generated here**, not stored in the model: any furniture with no seats
    gets a sentinel `Student(id=_fixture_id(name), is_fixture=True)`.
  - `assign/lock/unlock`, `available_seat_ids()`, `neighbors()`, `are_neighbors()`.

### `allocator.py`
- `BaseAllocator(ABC).allocate(students, classroom, seat_graph) -> Dict[fid, Student]`.
- `BogoAllocator` (random), `GreedyAllocator` (most-constrained-first, marginal-cost, bidirectional prefs, fixture scoring via `fixture_id_to_fid`).
- Output is keyed by **furniture_id**.

---

## IO — `src/io/`

### `csv_handler.py`
- `fixture_id(name)` — deterministic sha256-based id (matches `seat_graph._fixture_id`).
- `StudentImporter`: auto-detects *simple* (names) vs *full* (`name,fixture,pref_target,pref_type,pref_weight`) CSV. Builds students + preferences; fixtures get deterministic ids.
- `StudentExporter`: writes full-format CSV, preferences portable by name via `id_to_name`.

### `arrangement_io.py`
- `ArrangementIO.save(classroom_name, assignments, fixture_seats)` → `data/arrangements/<name>.json` as `{fid: student.name}` (fixtures excluded, derived on load).
- `ArrangementIO.load(filepath, students)` → `(assignments dict, classroom_name)`, mapping names→students, skipping missing fids.

---

## UI — `src/ui/`

### `classroom_builder.py`  (FURNITURE side)
- `FurniturePaletteItem(QWidget)` — draggable palette entry; encodes `type,w,h,image_path` into drag mime text.
- `FurniturePalette(QWidget)` — scrollable list (only SingleDesk wired up).
- `ClassroomGrid(QWidget)` — **grid #1**. Owns `furniture_list`, `furniture_counter`. Paints grid + furniture; drag-from-palette drop, click-drag move (collision-checked), Delete key removes. **No students.**
- `ClassroomBuilderWidget(QWidget)` — toolbar (Save/Load/Clear classroom) + `FurniturePalette` + `ClassroomGrid` in a splitter.

### `student_placer.py`  (STUDENT side)
- `StudentListWidget(QWidget)` — student roster, CSV import, double-click → `StudentOptionsDialog`.
- `SeatingGrid(QWidget)` — **grid #2**. Owns its own `furniture_list` (copied from a loaded classroom) **plus** assignment/UI state:
  - `assignments: Dict[fid, Student]` ← **the real source of seating truth today** (a dict, not on furniture).
  - `locked_seats`, `fixture_seats`, `current_seat_graph`, marker mode, violation mode, neighbor preview, in-grid student drag (swap/move), context menu (lock/prefs).
  - `set_classroom`, `apply_fixtures`, `apply_assignments`, `clear_assignments`, `get_assignments`.
- `StudentPlacerWidget(QWidget)` — big toolbar (Load classroom, Allocate, Clear, Export, Save/Load arrangement, Violations, Nearness, Weight, Marker) + `StudentListWidget` + `SeatingGrid`.

### `dialogs.py`
- `AlgorithmSelectionDialog` (registry `ALLOCATOR_OPTIONS`), `StudentOptionsDialog` (rename/delete/prefs), `PreferenceEditDialog`, `StudentInfoDialog` (read-only).

### `setup_widget.py`
- `SetupWidget` — older standalone CSV import widget; **not used** by `main.py` (superseded by `StudentListWidget`). Candidate for deletion.

### `theme.py`
- Color constants used across UI.

---

## Key structural facts that drive the restructure

1. **Two grids, two furniture lists, no shared document.** Builder furniture lives only in
   `ClassroomGrid`; placer furniture is re-loaded from disk into `SeatingGrid`. They never share memory.
2. **Seating truth is a dict keyed by furniture_id** on `SeatingGrid`, *not* attached to furniture.
   So a furniture move in the builder cannot carry a student, and switching tabs cannot preserve seating.
3. **Fixtures are synthesized at SeatGraph build time**, then materialized into `assignments`
   via `apply_fixtures`. They do not exist in the persistent model.
4. **Switching tabs swaps the whole widget** (toolbar + side panel + grid). The grid is *not* shared.
5. Tests cover `allocator`, `seat_graph`, `arrangement_io`, `csv_handler` (model/algorithm layer);
   no UI tests. These guard the refactor's lower layers.
