Classroom Seating App - Development Todo List

Legend: [x] done  [ ] not started  [~] partial / stub exists

---

Phase 1: Foundation & Core Data Models

Project Setup
[x] Set up Python project structure
[x] Create virtual environment
[x] Install dependencies (PyQt6)
[x] Set up version control (Git)

Core Data Models
[x] Student class (name, ID, metadata, preferences)
[x] Desk/Seat class (position, coordinates, distance calc)
[x] Classroom class (grid system, furniture list)
[x] Distance calculation between furniture pieces (furniture_distance)
[x] Constraint/preference system (Preference model - avoid/prefer with weight)
[x] Fixture nodes (teacher's desk, board etc. as locked graph nodes)

Import/Export System
[x] CSV student list import (simple: names only)
[x] CSV student list import (full: names + preferences + fixtures, auto-detected)
[x] CSV student list export (full format, preferences portable across sessions)
[x] Save/load classroom layouts (JSON)
[x] Save/load seating arrangements (JSON, keyed by furniture ID)

---

Phase 2: Classroom Builder UI

Grid System
[x] Adjustable grid canvas
[~] Zoom in/out (set_cell_size wired but no UI control yet)
[x] Grid snapping
[x] Visual grid lines

Furniture Management
[x] Furniture palette (single desk)
[x] Drag-and-drop furniture placement from palette
[x] Drag existing furniture to reposition
[x] Delete placed furniture (Delete key)
[ ] Rotate furniture pieces
[ ] Multi-seat furniture in palette (tables) - model exists, not in palette UI
[ ] Import custom furniture image + size

Classroom Management
[x] Create / name classroom
[x] Save classroom layout
[x] Load existing classroom
[x] Classroom selector (dropdown on load)

---

Phase 3: Seating Assignment Algorithm

Seat Graph
[x] SeatGraph: proximity-linked node map (assignable seats + fixture nodes)
[x] Configurable proximity threshold (set_proximity_threshold)
[x] Fixture nodes connected to nearby seats for preference scoring
[x] fixture_id_to_fid reverse map for algorithm lookups
[x] Pre-population support (locked seats preserved across re-allocations)

Assignment Algorithms
[x] BogoAllocator - random baseline (shuffles both students and seats)
[x] GreedyAllocator - cost-based, most-constrained-first
    [x] Priority by sum of |weights|
    [x] Marginal cost: own preferences + reverse preferences from placed students
    [x] Fixture preference scoring via fixture_id_to_fid
    [x] Random tie-breaking
[ ] Iterative improvement (simulated annealing or genetic)
    - swap two students, accept if cost improves (or with small probability if not)
    - run for N iterations or until no improvement

Edge Cases
[ ] Show unassigned students when more students than seats
[ ] Warn when classroom has no assignable seats

---

Phase 4: Student Placement UI

Student Assignment View
[x] Display classroom with student names on seats
[x] Fixture nodes displayed with grey/neutral style
[x] Shuffle button (re-runs selected algorithm)
[x] Algorithm selection dialog (Greedy recommended, Bogo as baseline)
[x] Manual drag-and-drop between desks (swap or move to empty)
[ ] Visual loading indicator during allocation
[ ] Show unassigned students panel

Locking
[x] Lock student to desk (right-click menu, amber highlight)
[x] Unlock student (right-click menu)
[x] Locked seats preserved across re-allocations

Constraint Marker System
[x] Marker mode (click two students to create preference)
[x] Configurable weight field (negative = avoid, positive = prefer)
[x] ESC to exit marker mode
[ ] Visual lines between students with constraints on the grid
[ ] Constraint violation highlighting (red tint when avoid-pairs are neighbors)

Student List
[x] Import students from CSV (auto-detects simple vs full format)
[x] Export students to CSV (full format with preferences + fixtures)
[x] Double-click student to edit name / manage preferences
[x] Add / edit / remove preferences via dialog
[x] Delete student
[x] Fixture students filtered from allocation (not assigned to desks)

Interaction
[x] Save seating arrangement
[x] Load seating arrangement (maps students by name, skips missing desks)
[ ] Hover over seated student to see their preferences
[ ] Undo/redo

---

Phase 5: Polish & Testing

UI Polish
[ ] Consistent color scheme and styling
[ ] Tooltips and help text
[ ] Keyboard shortcuts
[ ] Responsive layout
[ ] Error messages and validation

Testing
[ ] Unit tests for GreedyAllocator cost function
[ ] Unit tests for SeatGraph (neighbor detection, fixture resolution)
[ ] Unit tests for CSV import/export round-trip
[ ] Integration tests for UI workflows
[ ] Edge case testing (empty classroom, 1 student, more students than seats)

Documentation
[ ] User guide / README
[ ] Sample data files (classroom + student CSV with preferences)

---

Phase 6: Optional Enhancements (Future)

[ ] Simulated annealing / genetic algorithm allocator
[ ] Constraint violation score display (how good is the current arrangement)
[ ] Seating history (rotate students over time)
[ ] Export to PDF/image for printing
[ ] Templates for common classroom layouts
[ ] Multi-class support (switch between periods/classes)
[ ] Statistics dashboard (constraint violation trends)
[ ] Zoom in/out UI control
[ ] Furniture rotation
[ ] Table furniture in palette (multi-seat)


Human found bugs:
after entering the right click menu in students mode, left clicking anywhere on the grid should close the menu, it does not - only right clicking closes the menu

the student editor and preference editor should be merged

furniture editor features:
    make the grid bigger or smaller (add&delete rows&columns)
    adjustable grid size:
        does not change size of furniture
        lets you set furniture with more granularity
        careful during implementation to integrate well with student nearness
        goal is to allow more customization of classroom

add students manually

show violations should refresh on updates, right now if i update preferences and go back to show violtions, it doesnt show them 

student preferences should always be mutual, build it in to the system such that this is always maintained, every time a preference is updated, that syncs between students

