# Pijon — Design Document

> Last updated: 2026-06-12  
> Status: Living document — update when features change or decisions are reversed.

---

## 1. What Pijon Is

Pijon is a desktop application for teachers to build classroom seating charts. A teacher describes their room (which desks exist, where they are, what fixtures like a teacher's desk or whiteboard are present), describes their students (names, social preferences — who should sit near whom, who should avoid whom), and asks Pijon to produce a seating arrangement. They can then manually fine-tune it, save it, and load it for a future class.

The primary user is a non-technical teacher who has no interest in software internals. The workflow should feel like using a word processor: obvious, undoable, and forgiving of mistakes.

---

## 2. Design Goals

These goals are ordered by priority. When a decision forces a trade-off, prefer goals listed higher.

### G1 — Resilient to user mistakes
The app must not lose data from a misclick. Destructive operations (clear assignments, delete student, overwrite a saved arrangement) must ask for confirmation. The most common edit operations must be undoable. File operations must not silently overwrite without warning.

A teacher who accidentally clears the seating chart they spent 10 minutes adjusting, with no way to recover it, will stop using the app. This is the highest-priority goal.

### G2 — Idiot-proof for non-technical users
Every control must label itself in plain language a teacher would use, not developer terminology. If a feature requires understanding a number (weights, thresholds), it must be replaced by a description ("Avoids" / "Prefers", "Nearby" / "Across the room") unless the numeric value adds genuine value for the user. Error messages must say what to do, not just what went wrong. Empty states must say what step to take next. Features that require prior steps (e.g., "Show Violations" requires a classroom loaded) must be visually disabled until the prerequisites are met.

### G3 — No data loss from file operations
Saved classrooms, arrangements, and student lists must be stable across sessions. A classroom saved today must still load correctly after a version upgrade. File formats (JSON, CSV) must remain human-readable so a teacher can recover from corruption with a text editor if needed.

### G4 — Minimal dependencies
Runtime dependencies: PyQt6 only (plus Python stdlib). No database, no network access, no heavy ML or scientific computing libraries. This makes the app installable on any school computer without IT involvement, easy to audit, and maintainable without dependency churn.

### G5 — Maintainable codebase
Each layer (models, algorithm, I/O, UI) must be independent. Business logic (allocator, seat graph) must be testable without a running Qt application. UI files must stay under ~400 lines each. Dead code must be removed promptly. Naming must be consistent across layers.

### G6 — Correct constraint satisfaction
When a teacher says "Alice should not sit near Bob," the algorithm must honour that. When violations are displayed, they must be accurate. The preference system must be bidirectional: if Alice avoids Bob, Bob's desk should also show a violation when Alice is adjacent, even if Bob has no explicit preference.

---

## 3. Feature Inventory

### 3.1 Classroom Builder (`src/ui/classroom_builder.py`)
- **Furniture palette**: scrollable list of draggable furniture types (Single Desk, Table, Teacher's Desk)
- **Grid canvas**: drop target for furniture; shows grid lines; furniture renders with image or fallback colour
- **Drag-to-place**: drag from palette → drops on grid at cursor position
- **Collision detection**: prevents overlapping furniture placements
- **Move existing furniture**: drag an already-placed piece to a new location
- **Delete furniture**: select + Delete key removes a piece
- **Save classroom**: writes JSON to `data/classrooms/<name>.json`; guards against empty room; confirms overwrite
- **Load classroom**: reads saved JSON and reconstructs furniture layout; shows error on failure
- **Clear**: removes all furniture after confirmation
- **Cell size spinbox**: adjust pixel size per grid cell (10–80 px); controls zoom level
- **Theme integration**: toolbar and palette styled via `theme.toolbar_stylesheet()`

### 3.2 Student Placer (`src/ui/student_placer.py` + `seating_grid.py` + `student_list.py`)
- **Student list panel** (`src/ui/student_list.py`): shows imported students with preference count; double-click to edit; manages all preference mirroring on add/edit/remove
- **Import students (CSV)**: auto-detects simple (name-only) or full (with preferences) format; shows warnings for non-fatal issues; preferences bidirectionally enforced after import
- **Export students (CSV)**: writes full format including preferences (round-trip safe)
- **Load classroom**: selects a saved classroom; displays it in the seating grid; shows error on failure
- **Allocate students**: runs chosen algorithm (Greedy or Random) to fill seats; reports how many were placed
- **Clear assignments**: removes all student placements after confirmation (fixtures preserved)
- **Save/Load arrangement**: persists seat assignments as JSON; confirms overwrite; loads by student name matching
- **Export Session**: bundles all saved classrooms + arrangements + current students into a `.pijon` ZIP file
- **Import Session**: loads a `.pijon` bundle; saves bundled classrooms to disk; replaces current student list
- **Drag-to-swap**: drag a seated student to another desk to swap or move them
- **Lock seat**: right-click → lock student to desk (allocator will not move them)
- **Red Marker Mode**: click two students to create an avoid/prefer preference between them with configurable weight; mirrors the preference on both students automatically
- **Violation highlight**: colour-codes desks green/red based on whether any avoid-preferences are violated; works correctly because preferences are stored bidirectionally
- **Neighbor preview**: right-click any desk to highlight which desks are considered "near" it (blue=source, amber=neighbor, grey=non-neighbor); shows neighbor count in context menu
- **Cell size spinbox**: adjust pixel size per grid cell (10–80 px)
- **Nearness spinbox**: adjust proximity threshold; auto-scales with cell size: `threshold = 1.5 × (40 / cell_size)`
- **Show Preferences dialog**: read-only view of a student's preference list (via right-click → "Show Preferences")
- **Algorithm selection dialog**: choose Greedy (recommended) or Random; shows description of each

### 3.3 Data Models (`src/models/`)
- **Student**: name, opaque ID, preferences list; methods for managing preferences; JSON serialisation
- **Preference**: weight-based (negative = avoid, positive = prefer); target types: STUDENT, FURNITURE
- **Furniture** (base + subclasses): position, size, occupied cells; `seat_count() -> int`
  - `SingleDesk`: 1×1, 1 seat
  - `Table`: configurable size and seat count
  - `TeacherDesk`: fixture (0 student seats)
- **Classroom**: furniture list on a grid; distance calculation between furniture centres; JSON save/load

### 3.4 Algorithm (`src/algorithm/`)
- **SeatGraph**: proximity graph over furniture; edges between all nodes within threshold; fixture sentinel creation; lock/assign tracking; custom proximity threshold
- **GreedyAllocator**: most-constrained-first; marginal cost placement; random tie-breaking; each student's own preference list is sufficient (bidirectionality enforced at storage time)
- **BogoAllocator**: fully random baseline; respects locked seats

### 3.5 I/O (`src/io/`)
- **StudentImporter**: format detection; name-salted IDs for students; deterministic IDs for fixtures; warning collection; `enforce_bidirectional` called after full-format import
- **StudentExporter**: full-format CSV write; resolves target IDs back to names for portability
- **ArrangementIO**: JSON save/load; name-based student matching on load; fixture exclusion from persistence
- **SessionIO** (`src/io/session_io.py`): `.pijon` ZIP bundle containing classrooms JSON, arrangements JSON, students CSV; `save()` and `load()` static methods

### 3.6 Shared Utilities (`src/utils/__init__.py`)
- `fixture_id(name)` — deterministic SHA-256-based ID for fixture sentinels; used by both csv_handler and seat_graph
- `mirror_student_preference(source, target, weight)` — ensures target has a STUDENT preference back at source; creates or updates in-place
- `remove_mirror_preference(source, target_id, all_students)` — removes source's mirror from the target's preference list
- `enforce_bidirectional(students)` — after bulk import, ensures every STUDENT preference has a mirror on the other side

### 3.7 Tests (`tests/`)
- 88 tests across 6 files; zero Qt dependencies in the test suite
- Coverage: SeatGraph (18 tests), allocators (18 tests), CSV handler (16 tests), ArrangementIO (11 tests), bidirectional preferences (17 tests), session I/O (10 tests)
- conftest.py provides compact helper functions for building test fixtures

---

## 4. Design Choices

### 4.1 Name-salted student IDs
Student IDs are `sha256(name + salt)[:12]` where `salt` is generated once per `StudentImporter` instance. The salt prevents two imports from different class lists colliding if they happen to share student names.

**Trade-off**: IDs are not stable across re-import sessions. Preferences stored in memory survive only as long as the student objects do. Round-trip through CSV is safe (target IDs are resolved to names on export, re-resolved on import). This is currently acceptable because preferences are not persisted independently.

### 4.2 Deterministic fixture IDs
Fixture IDs are `sha256("FIXTURE:" + display_name)[:12]` with no salt. This means the same physical fixture (e.g., "Teacher Desk") always gets the same sentinel ID whether it came from a CSV import or a classroom load. A student preference targeting "Teacher Desk" will therefore resolve correctly across sessions.

**Implementation**: `src/utils.fixture_id()` is the single authoritative implementation — both `csv_handler.py` and `seat_graph.py` import from there.

**Trade-off**: Two different classrooms with identically-named fixtures will produce the same fixture ID. If a student has a preference for "Teacher Desk" and the classroom changes, the preference still resolves — which may or may not be what the teacher intended.

### 4.3 Fixture sentinel students
Non-seat furniture (teacher's desk, whiteboard) is represented in the seat graph as a phantom `Student` with a fixed ID. This lets the preference system express "Alex should sit near the whiteboard" using the same weight mechanism as student-to-student preferences, without special-casing fixture targets in the allocator.

### 4.4 Bidirectional preference storage
Preferences are stored at both ends at write time. When a student A acquires a STUDENT-type preference targeting B:
- `mirror_student_preference(A, B, weight)` is called immediately
- B gains a preference targeting A with the same weight (or the weight is updated if B already has one)
- When the preference is removed, `remove_mirror_preference(A, B_id, all_students)` removes the mirror

This means the allocator's `_marginal_cost` needs only to check each student's own preference list — there is no runtime reverse lookup. Similarly, `SeatingGrid._has_violation` only checks the placed student's own preferences. This eliminates double-counting and simplifies both hotpaths.

After a CSV import, `enforce_bidirectional(students)` adds any missing mirrors (in case the CSV was hand-written with only one side declared).

### 4.5 Proximity threshold and cell size scaling
"Neighbors" are furniture pieces whose centres are within `threshold` grid units. The default `BASE_PROXIMITY_THRESHOLD = 1.5` captures direct and diagonal adjacency for single-cell desks.

The threshold auto-scales with the cell size spinbox: `threshold = BASE_PROXIMITY_THRESHOLD × (BASE_CELL_SIZE / cell_size)`. This keeps the physical neighborhood consistent as the zoom level changes — zooming out (smaller cell_size) increases the threshold proportionally so the same desks remain neighbors.

### 4.6 Session bundle format
A `.pijon` file is a ZIP archive containing:
- `classrooms/<name>.json` — one JSON per classroom
- `arrangements/<name>.json` — zero or more arrangement files (if they exist on disk)
- `students.csv` — full-format student list with all preferences

This reuses existing I/O infrastructure. The format is inspectable with any ZIP tool. A partial load (malformed classroom, missing students) fails with an actionable error message.

### 4.7 Data stored as JSON and CSV
No database. Classrooms are JSON; arrangements are JSON; student lists are CSV. All formats are human-readable and recoverable with a text editor. No schema migration needed for minor changes. Files live in `data/classrooms/` and `data/arrangements/` relative to the working directory.

### 4.8 Tests are Qt-free
All tests exercise models, algorithms, and I/O. No `QApplication` is needed to run the suite. This makes CI fast and CI-friendly and avoids the complexity of headless Qt testing.

---

## 5. Duplicated Code

| # | Location A | Location B | What's duplicated | Status |
|---|---|---|---|---|
| D1 | `csv_handler.fixture_id()` | `seat_graph._fixture_id()` | Identical `sha256("FIXTURE:"+name)[:12]` implementation | **RESOLVED** — unified into `src/utils.fixture_id()` |
| D2 | `GreedyAllocator._marginal_cost` bidirectional loop | `SeatingGrid._has_violation` bidirectional loop | Both iterated placed students' preferences to check reverse avoids | **RESOLVED** — loops removed; preferences are stored bidirectionally |
| D3 | `student_placer._toolbar_stylesheet()` | `classroom_builder` toolbar setup | Near-identical dark toolbar stylesheet | **RESOLVED** — unified into `theme.toolbar_stylesheet()` |
| D4 | `SetupWidget.import_students()` | `StudentListWidget.import_students()` | CSV import flow | **RESOLVED** — `SetupWidget` deleted |
| D5 | `furniture_rect` construction | `ClassroomGrid.paintEvent` and `SeatingGrid._draw_furniture` | Same inset-by-2-pixels rect from grid coordinates | Open — acceptable; both are short |

---

## 6. Dead Code

All previously identified dead code has been removed:

| File | Resolution |
|---|---|
| `src/models/seat.py` | Deleted. `get_seats()` replaced with `seat_count() -> int` on all Furniture subclasses. |
| `src/ui/setup_widget.py` | Deleted. Dead import removed from `main.py`. |
| `PreferenceTargetType.LOCATION` | Removed from enum, `preference.py` convenience function, `student.py` helper method, and `dialogs.py` option. |

---

## 7. Gap Analysis: Code vs. Design Goals

### G1 — Resilient to user mistakes
| Area | Status | Notes |
|---|---|---|
| Clear assignments | ✅ Confirmation dialog | Added: "Remove all student assignments?" |
| Overwrite arrangement | ✅ Confirmation dialog | Added: "An arrangement already exists. Overwrite?" |
| Overwrite classroom | ✅ Confirmation dialog | Added in classroom builder |
| Clear classroom | ✅ Confirmation dialog | Added: "Remove all furniture?" |
| Delete student | ✅ Confirmation dialog | Pre-existing |
| File corruption | ✅ try/except everywhere | All file I/O in UI layer wrapped |
| Undo/Redo | Not implemented | **Fails G1** — still no `QUndoStack`; see §8.12 |

### G2 — Idiot-proof for non-technical users
| Area | Status | Gap |
|---|---|---|
| "Red Marker Mode" | **Fails G2** | Label is developer jargon; see §8.8 |
| "Bogo (Random)" | **Fails G2** | See §8.8 |
| Weight spinbox | **Fails G2** | Negative = avoid not labelled; see §8.8 |
| LOCATION preference | ✅ Removed | No longer presents non-working option |
| Empty state guidance | Not implemented | See §8.9 |
| Disabled prerequisites | Partial | "Show Violations" guards itself; others still always enabled |
| Nearness auto-scales | ✅ Implemented | Cell size change auto-updates nearness |

### G3 — No data loss from file operations
| Area | Status | Notes |
|---|---|---|
| Session export/import | ✅ Implemented | `.pijon` bundle format |
| Arrangement names | One per classroom name | **Risk** — still no multiple arrangements per classroom; see §8.11 |
| Preferences in session | ✅ Bundled | Session export includes full student list with preferences |
| In-memory preferences survival | Partial | Still lost on app close unless user exports students or session |

### G4 — Minimal dependencies
Fully met. Only PyQt6 is required; all other imports are Python stdlib.

### G5 — Maintainable codebase
| Area | Status |
|---|---|
| File sizes | ✅ `student_placer.py` split into 3 files (< 400 lines each) |
| Dead code | ✅ All dead files deleted |
| `fixture_id` duplication | ✅ Unified into `src/utils` |
| LOCATION dead feature | ✅ Removed |
| Toolbar stylesheet | ✅ Unified into `theme.toolbar_stylesheet()` |
| Bidirectional runtime loops | ✅ Removed from allocator and violation check |

### G6 — Correct constraint satisfaction
| Area | Status |
|---|---|
| Greedy allocator bidirectionality | ✅ Correct — preferences stored at both ends; no double-counting |
| Violation display bidirectionality | ✅ Correct — stored preferences ensure both students show violations |
| LOCATION preferences in allocator | ✅ No longer exist |
| Marker Mode preference mirroring | ✅ Mirrors created immediately on click |
| Dialog preference mirroring | ✅ Add/edit/remove all mirror correctly |
| CSV import mirroring | ✅ `enforce_bidirectional` called after import |

---

## 8. Proposed Architectural Changes

Completed items are marked ✅. Open items remain as proposals.

---

### 8.1 ✅ Delete dead files (G5)
**Completed.** `src/models/seat.py` deleted; `get_seats()` replaced with `seat_count() -> int`. `src/ui/setup_widget.py` deleted; dead import removed from `main.py`.

---

### 8.2 ✅ Unify `fixture_id` into a shared utility (G5, G3)
**Completed.** `src/utils/__init__.py` exposes `fixture_id()`, `mirror_student_preference()`, `remove_mirror_preference()`, and `enforce_bidirectional()`. Both `csv_handler.py` and `seat_graph.py` import from there.

---

### 8.3 ✅ Remove `PreferenceTargetType.LOCATION` (G2, G5)
**Completed.** Enum value, convenience function, dialog option, and student helper method all removed.

---

### 8.4 ✅ Split `student_placer.py` into focused files (G5)
**Completed.** Split into:
- `src/ui/student_list.py` — `StudentListWidget` (~100 lines)
- `src/ui/seating_grid.py` — `SeatingGrid` (~330 lines)
- `src/ui/student_placer.py` — `StudentPlacerWidget` (~390 lines, imports from the above)

---

### 8.5 ✅ Consolidate toolbar stylesheet into `theme.py` (G5, D3)
**Completed.** `theme.toolbar_stylesheet()` is the single authoritative stylesheet function used by both `classroom_builder.py` and `student_placer.py`.

---

### 8.6 ✅ Add confirmation dialogs for destructive operations (G1)
**Completed.** Confirmation guards added before: Clear Assignments, Clear Classroom, overwrite arrangement save, overwrite classroom save.

---

### 8.7 ✅ Wrap file I/O in try/except with user-facing error messages (G1, G3)
**Completed.** All file I/O in UI layer (load/save classroom, load/save arrangement, CSV import/export, session import/export) wrapped with `try/except Exception` showing `QMessageBox.critical`.

---

### 8.8 Rename developer-jargon controls (G2)
**Open.** Still needed:

| Current label | Proposed label |
|---|---|
| "Red Marker Mode" | "Add Preference" |
| "Bogo (Random)" | "Random" |
| "Nearness:" | "Neighbor distance:" |
| Weight spinbox (-1000 to 1000) | "Avoid" / "Prefer" toggle |

---

### 8.9 Add empty-state guidance and disable prerequisites (G2)
**Open.** Seating grid should show guidance text when no classroom is loaded. Toolbar buttons with prerequisites should be greyed out until met.

---

### 8.10 ✅ Persist preferences via session export (G3)
**Partially completed.** Session export (§8.13) bundles students + preferences into a `.pijon` file. A teacher must explicitly export the session to persist in-session preference changes. The simpler dedicated "Save Student List" button is still open.

---

### 8.11 Support multiple arrangements per classroom (G3)
**Open.** Currently one arrangement per classroom name. Add a naming prompt so teachers can maintain "exam seating", "project groups" etc.

---

### 8.12 Add Undo for common destructive operations (G1)
**Open.** Implement `QUndoStack` for drag-to-swap, preference creation via Marker Mode, lock/unlock. High value, moderate cost.

---

### 8.13 ✅ Session export/import (.pijon bundle) (G3)
**Completed.** `src/io/session_io.py` implements `SessionIO.save()` and `SessionIO.load()`. UI buttons "Export Session" and "Import Session" added to the student placer toolbar. Format: ZIP archive with `classrooms/*.json`, `arrangements/*.json`, `students.csv`.

---

### 8.14 ✅ Cell size spinbox with nearness auto-scaling (G2, G6)
**Completed.** Both classroom builder and student placer toolbars have a cell size spinbox (10–80 px, default 40). In the student placer, changing cell size auto-scales the nearness threshold: `threshold = 1.5 × (40 / cell_size)`.

---

### 8.15 ✅ Bidirectional preferences stored at both ends (G6)
**Completed.** Preferences are now stored bidirectionally at write time:
- `mirror_student_preference` called by: Marker Mode, StudentOptionsDialog add/edit, (remove calls `remove_mirror_preference`)
- `enforce_bidirectional` called after CSV import
- Runtime reverse loops removed from `GreedyAllocator._marginal_cost` and `SeatingGrid._has_violation`

---

## 9. Impact Summary: Changes vs. Functionality

| Change | Functional impact | UX impact | Breaking? | Status |
|---|---|---|---|---|
| 8.1 Delete dead files | None | None | No | ✅ Done |
| 8.2 Unify fixture_id | None | None | No | ✅ Done |
| 8.3 Remove LOCATION | Removes non-working feature | Cleaner dialog | No | ✅ Done |
| 8.4 Split student_placer.py | None | None | No | ✅ Done |
| 8.5 Consolidate stylesheet | None | Visual consistency | No | ✅ Done |
| 8.6 Confirmation dialogs | Prevents accidental destroy | One extra click | No | ✅ Done |
| 8.7 Wrap I/O in try/except | Prevents crashes | Clear error messages | No | ✅ Done |
| 8.8 Rename controls | None (labels only) | Immediately clearer | No | Open |
| 8.9 Empty state + disable buttons | None | Guides new users | No | Open |
| 8.10 Persist preferences | Session export reuses infrastructure | Preferences survive restart | No | ✅ Partial |
| 8.11 Multiple arrangements | New naming prompt | Multiple charts per room | Yes | Open |
| 8.12 Undo stack | New Ctrl+Z | Recoverable mistakes | No | Open |
| 8.13 Session export/import | .pijon bundle | Full backup/restore | No | ✅ Done |
| 8.14 Cell size spinbox | Visual zoom | Better readability | No | ✅ Done |
| 8.15 Bidirectional storage | Correct constraint satisfaction | Violations work accurately | No | ✅ Done |

---

## 10. Numbered Summary of Proposed Changes

Items marked ✅ are complete. Remaining items are open proposals.

1. ✅ **Delete `src/models/seat.py`** — replace `get_seats()` with `seat_count() -> int` on Furniture subclasses
2. ✅ **Delete `src/ui/setup_widget.py`** — remove the dead file and its unused import in `main.py`
3. ✅ **Create `src/utils/__init__.py`** with `fixture_id()`, `mirror_student_preference()`, `remove_mirror_preference()`, `enforce_bidirectional()`; update callers
4. ✅ **Remove `PreferenceTargetType.LOCATION`** from enum, dialog, preference.py, student.py
5. ✅ **Split `student_placer.py`** into `student_list.py`, `seating_grid.py`, `student_placer.py`
6. ✅ **Move `_toolbar_stylesheet()` to `theme.py`** as `toolbar_stylesheet()`; update both widgets
7. ✅ **Add confirmation dialog before "Clear Assignments"**
8. ✅ **Add confirmation dialog before overwriting saved arrangement or classroom**
9. ✅ **Wrap all file I/O in try/except** with `QMessageBox.critical` on failure
10. ✅ **Remove `print()` from `classroom.py` and `classroom_builder.py`**
11. **Rename "Red Marker Mode" → "Add Preference"** in button label and hint text
12. **Rename "Bogo (Random)" → "Random"** in the algorithm selection dialog
13. **Rename "Nearness:" → "Neighbor distance:"** in toolbar spinbox label
14. **Replace weight spinbox in Marker Mode** with "Avoid" / "Prefer" toggle; retain numeric weight in StudentOptionsDialog only
15. **Add an empty-state label** to SeatingGrid: shown when no classroom is loaded
16. **Disable toolbar buttons** with unmet prerequisites ("Allocate", "Show Violations", "Save/Load Arrangement" without a classroom; "Export" without students)
17. **Add "Save Student List" button** to explicitly export current in-memory students with preferences
18. **Add arrangement naming** — prompt on save; save as `<classroom>_<name>.json`
19. ✅ **Implement session export/import** — `.pijon` bundle via `SessionIO`
20. ✅ **Add cell size spinbox** to both panels; nearness auto-scales as `1.5 × (40 / cell_size)`
21. ✅ **Bidirectional preference storage** — stored at both ends; runtime reverse loops removed from allocator and violation check; mirrors maintained by dialog and marker mode
