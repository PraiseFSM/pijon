/**
 * Pijon Zustand store — Phase 5: Store + persistence.
 *
 * Holds ALL runtime state. Domain helpers are pure; this store is the only
 * place that swaps in new state objects (the "mutable edge" of the immutable
 * domain pattern).
 *
 * LOCAL-FIRST: nothing in here makes a network call. No fetch(), no XHR, no
 * WebSocket. Persistence is routed through persistence.ts (IndexedDB + FSA).
 *
 * State shape
 * -----------
 *   classroom   — the live document (grid + furniture + occupants).
 *   roster      — all students (real + fixture). Source of truth for names/prefs.
 *   locks       — Set of FurnitureIds that allocators must not move.
 *   arrangement — current fid→student view (derived from classroom, exposed for
 *                 convenience — always in sync with classroom.furniture occupants).
 *   history     — bounded arrangement snapshots for undo/redo.
 *   historyPtr  — current position in history (0 = oldest kept snapshot).
 *   saveStatus  — 'saved' | 'saving' | 'dirty' | 'error' (drives the indicator).
 *   activeEditorId — which editor is mounted (held here; editors come in Phase 6+).
 *   fileHandle  — FileSystemFileHandle for one-tap re-save (null when not available).
 *
 * History design
 * --------------
 * Each undo-able action (allocate, smartShuffle, manualReassign) pushes a full
 * Classroom snapshot onto `history`. A bounded ring of MAX_HISTORY entries is
 * kept. undo/redo move `historyPtr`; when ptr < history.length - 1 (i.e. we are
 * in the past) a new push discards future entries (standard linear history model).
 *
 * Locks and roster preferences are NOT part of the reversible snapshots —
 * they belong to the durable project (see ProjectFile design). Only the
 * classroom layout + seating is snapshotted.
 */

import { create } from 'zustand';
import type { FurnitureId, Vec2, StudentId } from '../domain/types.js';
import { furnitureId, studentId } from '../domain/types.js';
import type { Student } from '../domain/student.js';
import {
  makeStudent,
  addPreference as studentAddPreference,
  removePreferencesFor,
} from '../domain/student.js';
import type { Preference } from '../domain/preference.js';
import {
  setMutualPreference as prefSetMutual,
  clearMutualPreference as prefClearMutual,
  pruneOrphanStudentPrefs,
} from '../domain/preference.js';
import type { Furniture } from '../domain/furniture.js';
import { assignOccupant, vacate, capacity, isFixture } from '../domain/furniture.js';
import type { Classroom } from '../domain/classroom.js';
import type { GridEdge } from '../domain/classroom.js';
import {
  makeClassroom,
  addFurniture as domainAddFurniture,
  removeFurniture as domainRemoveFurniture,
  moveFurniture as domainMoveFurniture,
  updateFurniture,
  furnitureById,
  assignments,
  syncRosterToClassroom,
  resizeGrid as domainResizeGrid,
  setGranularity as domainSetGranularity,
  setThreshold as domainSetThreshold,
  setBackgroundImage as domainSetBackgroundImage,
  setGridColor as domainSetGridColor,
} from '../domain/classroom.js';
import { SeatGraph } from '../domain/seatGraph.js';
import type { Allocator } from '../domain/allocators/types.js';
import { importCsv } from '../domain/io/csv.js';
import type { LoadedProject } from '../domain/io/projectFile.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of undo/redo snapshots kept in memory. */
const MAX_HISTORY = 50;

// ---------------------------------------------------------------------------
// SaveStatus
// ---------------------------------------------------------------------------

export type SaveStatus = 'saved' | 'saving' | 'dirty' | 'error';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface PijonState {
  /** The live classroom document. */
  classroom: Classroom;

  /**
   * Full roster (real students + fixture occupants).
   * Authoritative source for student names and preferences.
   * Does NOT reflect who is seated — seating lives in classroom.furniture[].occupants.
   */
  roster: readonly Student[];

  /** FurnitureIds whose occupants must not be moved by the allocator. */
  locks: ReadonlySet<FurnitureId>;

  /**
   * Bounded history of classroom snapshots for undo/redo.
   * Index 0 is the oldest kept entry. The current state is history[historyPtr].
   * When historyPtr < history.length - 1 the user has undone some steps.
   */
  history: readonly Classroom[];

  /**
   * Index into history pointing at the currently displayed arrangement.
   * -1 means history is empty (no arrangement pushed yet).
   */
  historyPtr: number;

  /** Autosave / explicit-save status indicator. */
  saveStatus: SaveStatus;

  /** The active editor id string. Null when no editor mounted. */
  activeEditorId: string | null;

  /**
   * FileSystemFileHandle for the .pijon file the teacher most recently
   * saved to or opened — enables one-tap re-save. Null when unavailable
   * (browser without FSA, or no file chosen yet).
   */
  fileHandle: FileSystemFileHandle | null;

  /**
   * The student currently selected in the StudentEditor left-panel roster.
   * Null when no student is selected. UI state only — not persisted.
   * Drives the right-panel preferences view.
   */
  selectedStudentId: StudentId | null;

  /**
   * When the most recent resizeGrid() call was blocked, this holds the reason
   * string so the UI can surface a warning toast. Null otherwise.
   * Cleared when any subsequent resizeGrid() succeeds or when explicitly dismissed.
   */
  resizeGridWarning: string | null;

  /**
   * Whether to render the violation overlay (red tint on desks where avoid-prefs
   * are violated). Lives in the store so the setting survives editor switches
   * within a session (§13.5). Defaults to true — violations are shown on first
   * load and after eraseAll().
   *
   * This is app-level UI state (NOT per-project and NOT in the .pijon file):
   * the same flag applies regardless of which class is open, matching the
   * teacher UX intent that "show violations" is a display preference, not a
   * classroom setting. It resets to true on every page reload (EMPTY_STATE).
   * If future work needs cross-session persistence, add it to IndexedDB as
   * app-level config — do NOT put it in the project file.
   */
  showViolations: boolean;
}

// ---------------------------------------------------------------------------
// Actions shape
// ---------------------------------------------------------------------------

export interface PijonActions {
  // -- Lifecycle --

  /**
   * Replace all state from a loaded project (startup hydration or file open).
   * Clears history since we are loading a new document.
   */
  hydrate(loaded: LoadedProject): void;

  /**
   * Update classroom metadata (name, grid size).
   * Does NOT clear the arrangement — use with care; resize may orphan furniture.
   */
  setClassroom(classroom: Classroom): void;

  // -- Furniture mutations --

  /** Add a new piece of furniture to the classroom. Marks dirty. */
  addFurniture(f: Furniture): void;

  /**
   * Move existing furniture to a new position.
   * Occupant travels with it (domain invariant).
   */
  moveFurniture(id: FurnitureId, pos: Vec2): void;

  /**
   * Remove a piece of furniture (and its occupant) from the classroom.
   * Does NOT remove the student from the roster.
   */
  removeFurniture(id: FurnitureId): void;

  // -- Roster --

  /**
   * Import students from a CSV text string (SIMPLE or FULL format).
   * Merges with the existing roster (deduplicates by id).
   * Returns any non-fatal warnings for the UI to surface.
   */
  importRosterFromCsv(csvText: string): string[];

  /**
   * Replace the roster with a given list.
   * (Used internally by hydrate; exposed for advanced callers.)
   */
  setRoster(roster: readonly Student[]): void;

  // -- Seating --

  /**
   * Run the given Allocator over the classroom, apply the result,
   * and push the new arrangement onto history.
   *
   * Pre-populates the SeatGraph with:
   *   - All currently occupied seats (so existing occupants stay unless locked)
   *   - Locked seats (allocator must not move those)
   */
  allocate(allocator: Allocator): void;

  /**
   * Shorthand for allocate() called "smart shuffle" in the UI:
   * same mechanics, just a named alias so callers don't need to import Allocator.
   */
  smartShuffle(allocator: Allocator): void;

  /** Remove all student occupants from all furniture. Pushes history. */
  clearArrangement(): void;

  // -- Locks --

  /** Lock the occupant of a seat (pin; allocators won't move them). */
  lockSeat(fid: FurnitureId): void;

  /** Unlock a previously locked seat. */
  unlockSeat(fid: FurnitureId): void;

  // -- Manual moves (drag/drop) --

  /**
   * Move a student from one furniture to another, swapping if the destination
   * is already occupied. Pushes history.
   */
  manualReassign(fromFid: FurnitureId, toFid: FurnitureId): void;

  /**
   * Seat a roster student (by id) at a given furniture (by id).
   * §13.7 — roster-drag → canvas-drop action.
   *
   * Semantics (immutable; pushes history; marks dirty; clears locks on affected desks):
   *   - If the target is a fixture or has capacity 0 → no-op (returns silently).
   *   - If the student is already at the target desk → no-op.
   *   - If the student is seated elsewhere:
   *       • Vacate their old desk.
   *       • If the target desk is occupied by another real student (swap candidate):
   *           – Place the swap candidate on the now-vacated old desk.
   *       • Place the dragged student on the target desk.
   *   - If the student is unseated:
   *       • If the target desk is occupied by another real student:
   *           – Vacate the target desk (displaced student becomes unseated).
   *       • Place the dragged student on the target desk.
   *   - Calls syncRosterToClassroom so occupant copies are fresh after the move.
   *   - Clears locks on the old desk (if any) and the target desk (if any),
   *     consistent with manualReassign.
   *
   * No-ops (returns without changing state):
   *   - studentId not in roster
   *   - furnitureId not in classroom
   *   - target furniture is a fixture (capacity === 0 and has a fixture occupant)
   *     or is a non-assignable kind (capacity === 0)
   *   - student is already at the target desk
   */
  assignStudentToFurniture(sid: StudentId, fid: FurnitureId): void;

  // -- Undo / redo --

  /** Step back one arrangement in history (if possible). */
  undo(): void;

  /** Step forward one arrangement in history (if possible). */
  redo(): void;

  // -- Save status --

  /** Called by persistence.ts to update the indicator. */
  setSaveStatus(status: SaveStatus): void;

  /** Set the FileSystemFileHandle for one-tap re-save. */
  setFileHandle(handle: FileSystemFileHandle | null): void;

  // -- Editor --

  /** Set the active editor by id. */
  setActiveEditorId(id: string | null): void;

  // -- Preferences --

  /**
   * Append a preference to a roster student. Marks dirty so autosave persists.
   * Immutable: replaces the student record in `roster` without mutating it.
   * Does nothing when the studentId is not found in the roster.
   *
   * For student↔student preferences prefer `setMutualPreference` which
   * enforces symmetry. This low-level action is kept for furniture/location
   * preferences that are intentionally one-sided.
   */
  addPreference(studentId: StudentId, pref: Preference): void;

  /**
   * Remove all preferences from a roster student that target `targetId`.
   * Immutable: replaces the student record in `roster` without mutating it.
   * Does nothing when the studentId is not found in the roster.
   *
   * For student↔student preferences prefer `clearMutualPreference` which
   * removes both sides atomically.
   */
  removePreference(studentId: StudentId, targetId: string): void;

  /**
   * Set a symmetric student↔student preference between aId and bId with the
   * given weight. Both students get a 'student'-kind preference targeting the
   * other at the same weight. If a preference between the pair already exists
   * it is replaced (not duplicated). Self-targeting (aId === bId) is a no-op.
   *
   * This is the ONLY correct way to write student↔student preferences —
   * routing through here guarantees the mutual invariant is never violated.
   */
  setMutualPreference(aId: StudentId, bId: StudentId, weight: number): void;

  /**
   * Remove any student-kind preference between aId and bId from BOTH students.
   * Furniture/location prefs are unaffected. Self-targeting is a no-op.
   */
  clearMutualPreference(aId: StudentId, bId: StudentId): void;

  // -- Grid resize and granularity --

  /**
   * Add or remove rows/columns at the given edge.
   * On success, updates the classroom and marks dirty.
   * On failure (furniture in the way), sets `resizeGridWarning` and leaves
   * the classroom unchanged.
   */
  resizeGrid(edge: GridEdge, delta: number): void;

  /**
   * Change the grid granularity (cellsPerUnit) to `newG`.
   * Scales all furniture positions + sizes and gridW/gridH so the physical
   * layout is unchanged. The proximity threshold stays in units.
   * Marks dirty on success.
   * Throws if newG is invalid or if scaling produces non-integer results.
   */
  setGranularity(newG: number): void;

  /**
   * Dismiss the current resizeGridWarning (set it back to null).
   * The UI calls this when the user acknowledges the toast.
   */
  dismissResizeWarning(): void;

  /**
   * Update the classroom's proximity threshold to `units`.
   * Updates classroom.thresholdUnits (single source of truth) and marks dirty.
   * Immutable: produces a new Classroom via the domain setThreshold helper.
   * All SeatGraph construction uses this value so allocate, violations, and
   * neighbor preview stay consistent.
   */
  setThreshold(units: number): void;

  /**
   * Toggle or explicitly set the violation-overlay visibility.
   * This is app-level UI state (not per-project) that defaults to true (§13.5).
   */
  setShowViolations(on: boolean): void;

  /**
   * §14.4 — Set or clear the classroom background image URL.
   * Pass a URL string to enable (e.g. ASSET.background).
   * Pass null to disable (restores plain-color appearance).
   * Marks the project dirty for autosave.
   */
  setBackgroundImage(url: string | null): void;

  /**
   * §14.5 — Set or clear the classroom grid line color.
   * Pass any valid CSS color string to override the theme default.
   * Pass null to restore the theme default (gridLine token from colors.ts).
   * Marks the project dirty for autosave.
   * Same-reference short-circuit: no-ops when color hasn't changed.
   */
  setGridColor(color: string | null): void;

  // -- Erase --

  /**
   * Wipe all class data from the store (for shared/school computers).
   * persistence.ts must also delete the IndexedDB record separately.
   */
  eraseAll(): void;

  // -- UI selection --

  /**
   * Set the selected student id (drives the right-panel preferences view in
   * the StudentEditor). Pass null to deselect.
   */
  setSelectedStudentId(id: StudentId | null): void;

  // -- Manual roster management --

  /**
   * Add a new student by name. Mints a fresh StudentId via crypto.randomUUID(),
   * appends to the roster, marks dirty, and syncs the classroom (seats are still
   * empty — no auto-assign). No-op if name is blank after trimming.
   */
  addStudent(name: string): void;

  /**
   * Remove a student from the roster by id. Pruning steps (§12.5 helpers):
   *   1. Remove the student from the roster.
   *   2. pruneOrphanStudentPrefs removes dangling mutual prefs from other students.
   *   3. syncRosterToClassroom vacates their seat (if occupied) and syncs occupants.
   *   4. Clears selectedStudentId if it was this student.
   * Marks dirty.
   */
  removeStudent(studentId: StudentId): void;
}

export type PijonStore = PijonState & PijonActions;

// ---------------------------------------------------------------------------
// Default / empty state
// ---------------------------------------------------------------------------

const DEFAULT_CLASSROOM: Classroom = makeClassroom(
  crypto.randomUUID(),
  'My Classroom',
  10,
  8,
);

const EMPTY_STATE: PijonState = {
  classroom: DEFAULT_CLASSROOM,
  roster: [],
  locks: new Set<FurnitureId>(),
  history: [],
  historyPtr: -1,
  saveStatus: 'saved',
  activeEditorId: null,
  fileHandle: null,
  selectedStudentId: null,
  resizeGridWarning: null,
  // §13.5: violations are ON by default — teachers see constraint feedback immediately.
  showViolations: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Push a classroom snapshot onto the history stack.
 * Discards any "future" entries when pushed while in the past (after undo).
 * Trims to MAX_HISTORY entries.
 */
function pushHistory(
  state: Pick<PijonState, 'history' | 'historyPtr'>,
  snapshot: Classroom,
): Pick<PijonState, 'history' | 'historyPtr'> {
  // Discard future when branching from a past point
  const base = state.history.slice(0, state.historyPtr + 1);
  const next = [...base, snapshot];
  // Trim to bounded size
  const trimmed = next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
  return { history: trimmed, historyPtr: trimmed.length - 1 };
}

/**
 * Apply a fid→Student arrangement map back into the classroom.
 * Clears all existing real student occupants first, then assigns from the map.
 * Fixture occupants are preserved (they are part of the geometry).
 */
function applyArrangement(
  classroom: Classroom,
  arrangement: Map<FurnitureId, Student>,
): Classroom {
  // Vacate all real occupants (preserve fixtures)
  let updated: Classroom = {
    ...classroom,
    furniture: classroom.furniture.map((f) => {
      const occ = f.occupants[0];
      if (occ !== undefined && !occ.isFixture) {
        return vacate(f);
      }
      return f;
    }),
  };

  // Assign new occupants
  for (const [fid, student] of arrangement) {
    const f = furnitureById(updated, fid);
    if (f === undefined) continue;
    try {
      updated = updateFurniture(updated, fid, assignOccupant(f, student));
    } catch {
      // Skip if assignment fails (e.g. fixture seat)
    }
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const usePijonStore = create<PijonStore>()((set, get) => ({
  ...EMPTY_STATE,

  // ---- Lifecycle -----------------------------------------------------------

  hydrate(loaded: LoadedProject) {
    set({
      classroom: loaded.classroom,
      roster: loaded.roster,
      locks: new Set(loaded.locks),
      // Start with no history on load — the loaded arrangement is the baseline
      history: [loaded.classroom],
      historyPtr: 0,
      saveStatus: 'saved',
      // Preserve fileHandle and activeEditorId across hydrations
    });
  },

  setClassroom(classroom: Classroom) {
    set({ classroom, saveStatus: 'dirty' });
  },

  // ---- Furniture -----------------------------------------------------------

  addFurniture(f: Furniture) {
    set((s) => ({
      classroom: domainAddFurniture(s.classroom, f),
      saveStatus: 'dirty',
    }));
  },

  moveFurniture(id: FurnitureId, pos: Vec2) {
    set((s) => ({
      classroom: domainMoveFurniture(s.classroom, id, pos),
      saveStatus: 'dirty',
    }));
  },

  removeFurniture(id: FurnitureId) {
    // Also remove any lock on this furniture
    set((s) => {
      const newLocks = new Set(s.locks);
      newLocks.delete(id);
      return {
        classroom: domainRemoveFurniture(s.classroom, id),
        locks: newLocks,
        saveStatus: 'dirty',
      };
    });
  },

  // ---- Roster --------------------------------------------------------------

  importRosterFromCsv(csvText: string): string[] {
    const { students, warnings } = importCsv(csvText);

    set((s) => {
      // Merge: keep existing students not duplicated by id
      const existingIds = new Set(s.roster.map((st) => st.id));
      const newStudents = students.filter((st) => !existingIds.has(st.id));
      const newRoster = [...s.roster, ...newStudents];
      return {
        roster: newRoster,
        // Sync classroom so any already-seated students get fresh copies and
        // any students removed from the roster have their seats vacated.
        classroom: syncRosterToClassroom(s.classroom, newRoster),
        saveStatus: 'dirty',
      };
    });

    return [...warnings];
  },

  setRoster(roster: readonly Student[]) {
    set((s) => {
      // Prune student-kind prefs whose target is no longer in the new roster
      // (handles the case where the caller removed one or more students).
      const pruned = pruneOrphanStudentPrefs(roster);
      return {
        roster: pruned,
        // Sync classroom so occupant copies stay in step with the new roster
        // (seats of removed students are vacated by syncRosterToClassroom).
        classroom: syncRosterToClassroom(s.classroom, pruned),
        saveStatus: 'dirty',
      };
    });
  },

  // ---- Seating -------------------------------------------------------------

  allocate(allocator: Allocator) {
    const s = get();
    // §13.4 / §12.3 bug fix: build SeatGraph with the classroom's thresholdUnits
    // so allocate and smartShuffle use the same nearness as the violation overlay
    // and neighbor preview. The DEFAULT was used before (§12.3 residual risk).
    const graph = new SeatGraph(s.classroom, s.classroom.thresholdUnits);

    // Pre-populate with locked occupants
    for (const fid of s.locks) {
      const f = furnitureById(s.classroom, fid);
      const occ = f?.occupants[0];
      if (occ !== undefined && !occ.isFixture) {
        graph.assign(fid, occ);
        graph.lock(fid);
      }
    }

    // Run the allocator
    const result = allocator.allocate(s.roster.filter((st) => !st.isFixture), s.classroom, graph);

    // Apply the new arrangement
    const newClassroom = applyArrangement(s.classroom, result);
    const hist = pushHistory({ history: s.history, historyPtr: s.historyPtr }, newClassroom);

    set({
      classroom: newClassroom,
      ...hist,
      saveStatus: 'dirty',
    });
  },

  smartShuffle(allocator: Allocator) {
    get().allocate(allocator);
  },

  clearArrangement() {
    set((s) => {
      const cleared = {
        ...s.classroom,
        furniture: s.classroom.furniture.map((f) => {
          const occ = f.occupants[0];
          if (occ !== undefined && !occ.isFixture) return vacate(f);
          return f;
        }),
      };
      const hist = pushHistory({ history: s.history, historyPtr: s.historyPtr }, cleared);
      return { classroom: cleared, ...hist, saveStatus: 'dirty' };
    });
  },

  // ---- Locks ---------------------------------------------------------------

  lockSeat(fid: FurnitureId) {
    set((s) => {
      const newLocks = new Set(s.locks);
      newLocks.add(fid);
      return { locks: newLocks, saveStatus: 'dirty' };
    });
  },

  unlockSeat(fid: FurnitureId) {
    set((s) => {
      const newLocks = new Set(s.locks);
      newLocks.delete(fid);
      return { locks: newLocks, saveStatus: 'dirty' };
    });
  },

  // ---- Manual reassign -----------------------------------------------------

  manualReassign(fromFid: FurnitureId, toFid: FurnitureId) {
    set((s) => {
      const classroom = s.classroom;
      const fromF = furnitureById(classroom, fromFid);
      const toF = furnitureById(classroom, toFid);
      if (fromF === undefined || toF === undefined) return {};

      const fromOcc = fromF.occupants[0];
      const toOcc = toF.occupants[0];

      // Skip if source is empty or is a fixture
      if (fromOcc === undefined || fromOcc.isFixture) return {};

      let updated = classroom;

      // Vacate source
      updated = updateFurniture(updated, fromFid, vacate(fromF));

      // If destination has a real student, swap them back to source
      if (toOcc !== undefined && !toOcc.isFixture) {
        const vacatedFrom = furnitureById(updated, fromFid);
        if (vacatedFrom !== undefined) {
          try {
            updated = updateFurniture(updated, fromFid, assignOccupant(vacatedFrom, toOcc));
          } catch {
            // Can't swap back — just move without swap
          }
        }
      }

      // Vacate destination of any occupant (either real student moved, or fixture stays — preserve fixtures)
      const destBeforeAssign = furnitureById(updated, toFid);
      if (destBeforeAssign !== undefined) {
        const destOcc = destBeforeAssign.occupants[0];
        if (destOcc !== undefined && !destOcc.isFixture) {
          updated = updateFurniture(updated, toFid, vacate(destBeforeAssign));
        }
        // Assign fromOcc to destination
        const freshDest = furnitureById(updated, toFid);
        if (freshDest !== undefined) {
          try {
            updated = updateFurniture(updated, toFid, assignOccupant(freshDest, fromOcc));
          } catch {
            // Destination can't accept (e.g. fixture seat) — abort
            return {};
          }
        }
      }

      const hist = pushHistory({ history: s.history, historyPtr: s.historyPtr }, updated);
      return { classroom: updated, ...hist, saveStatus: 'dirty' };
    });
  },

  // ---- §13.7 — Assign student from roster to a furniture (roster-drag drop) ----

  assignStudentToFurniture(sid: StudentId, fid: FurnitureId) {
    set((s) => {
      const classroom = s.classroom;

      // Guard: student must be in roster
      const student = s.roster.find((st) => st.id === sid);
      if (student === undefined) return {};

      // Guard: fixture students (faux room-feature stand-ins) must never be seated
      // at a real desk — they belong to teacher_desk / whiteboard via the fixture
      // mechanism. The UI already prevents dragging them, but defend here too.
      if (student.isFixture) return {};

      // Guard: furniture must exist
      const targetF = furnitureById(classroom, fid);
      if (targetF === undefined) return {};

      // Guard: target must be assignable (capacity > 0 and not a fixture seat)
      if (capacity(targetF) === 0) return {}; // teacher_desk / whiteboard → no-op
      if (isFixture(targetF)) return {}; // has a fixture occupant — no-op

      const targetOcc = targetF.occupants[0];

      // Guard: student is already at target → no-op
      if (targetOcc?.id === sid) return {};

      // Find the student's current desk (if any)
      const oldFid = classroom.furniture.find((f) => f.occupants[0]?.id === sid)?.id ?? null;

      let updated = classroom;

      // Step 1: vacate old desk (if student was seated)
      if (oldFid !== null) {
        const oldF = furnitureById(updated, oldFid);
        if (oldF !== undefined) {
          updated = updateFurniture(updated, oldFid, vacate(oldF));
        }
      }

      // Step 2: if target has a real occupant (swap candidate), move them to old desk
      if (targetOcc !== undefined && !targetOcc.isFixture) {
        if (oldFid !== null) {
          // Swap: displaced student goes to the old desk.
          // The old desk was just vacated in Step 1, so assignOccupant must succeed for a
          // real student on a capacity-1 desk. We still guard with try/catch so that an
          // unexpected throw (e.g. from a future capacity change) aborts cleanly instead of
          // silently swallowing the error and leaving the displaced student in limbo.
          // If this branch throws, we bail out of the whole action — returning {} leaves the
          // classroom unchanged rather than putting a student into an inconsistent state.
          const vacatedOld = furnitureById(updated, oldFid);
          if (vacatedOld === undefined) return {};
          try {
            updated = updateFurniture(updated, oldFid, assignOccupant(vacatedOld, targetOcc));
          } catch {
            // The freshly-vacated old desk refused the swap candidate — cannot complete the
            // swap without losing a student. Abort the whole action (return {} = no change).
            return {};
          }
          // Vacate the target of its current occupant before we assign the dragged student
          const freshTarget = furnitureById(updated, fid);
          if (freshTarget !== undefined) {
            const tOcc = freshTarget.occupants[0];
            if (tOcc !== undefined && !tOcc.isFixture) {
              updated = updateFurniture(updated, fid, vacate(freshTarget));
            }
          }
        } else {
          // Unseated student: just vacate the target (displaced student becomes unseated)
          const freshTarget = furnitureById(updated, fid);
          if (freshTarget !== undefined) {
            updated = updateFurniture(updated, fid, vacate(freshTarget));
          }
        }
      }

      // Step 3: assign the dragged student to the target desk
      const readyTarget = furnitureById(updated, fid);
      if (readyTarget === undefined) return {};
      try {
        updated = updateFurniture(updated, fid, assignOccupant(readyTarget, student));
      } catch {
        // Shouldn't happen for a properly vacated, capacity>0 desk — bail
        return {};
      }

      // Step 4: sync occupant copies so preferences/names are fresh
      updated = syncRosterToClassroom(updated, s.roster);

      // Step 5: clear locks on affected desks (consistent with manualReassign)
      const newLocks = new Set(s.locks);
      newLocks.delete(fid);
      if (oldFid !== null) newLocks.delete(oldFid);

      const hist = pushHistory({ history: s.history, historyPtr: s.historyPtr }, updated);
      return { classroom: updated, locks: newLocks, ...hist, saveStatus: 'dirty' };
    });
  },

  // ---- Undo / redo ---------------------------------------------------------

  undo() {
    set((s) => {
      if (s.historyPtr <= 0) return {};
      const newPtr = s.historyPtr - 1;
      const snapshot = s.history[newPtr];
      if (snapshot === undefined) return {};
      // Sync the restored snapshot with the CURRENT roster so occupant copies
      // reflect the latest names and preferences — the snapshot was taken before
      // any subsequent roster edits, so its embedded copies may be stale.
      return {
        classroom: syncRosterToClassroom(snapshot, s.roster),
        historyPtr: newPtr,
        saveStatus: 'dirty',
      };
    });
  },

  redo() {
    set((s) => {
      if (s.historyPtr >= s.history.length - 1) return {};
      const newPtr = s.historyPtr + 1;
      const snapshot = s.history[newPtr];
      if (snapshot === undefined) return {};
      // Same sync-on-restore pattern as undo — snapshots may be pre-roster-edit.
      return {
        classroom: syncRosterToClassroom(snapshot, s.roster),
        historyPtr: newPtr,
        saveStatus: 'dirty',
      };
    });
  },

  // ---- Save status + file handle -------------------------------------------

  setSaveStatus(status: SaveStatus) {
    set({ saveStatus: status });
  },

  setFileHandle(handle: FileSystemFileHandle | null) {
    set({ fileHandle: handle });
  },

  // ---- Editor --------------------------------------------------------------

  setActiveEditorId(id: string | null) {
    set({ activeEditorId: id });
  },

  // ---- Preferences ---------------------------------------------------------

  addPreference(sid: StudentId, pref: Preference) {
    set((s) => {
      // Guard: student-kind prefs must go through setMutualPreference to enforce
      // the mutual invariant. Also block self-targeting at this level.
      if (pref.kind === 'student' && pref.targetId === sid) return {};
      const idx = s.roster.findIndex((st) => st.id === sid);
      if (idx === -1) return {};
      const existing = s.roster[idx];
      if (existing === undefined) return {};
      const updated = studentAddPreference(existing, pref);
      const newRoster = [...s.roster];
      newRoster[idx] = updated;
      return {
        roster: newRoster,
        classroom: syncRosterToClassroom(s.classroom, newRoster),
        saveStatus: 'dirty',
      };
    });
  },

  removePreference(sid: StudentId, targetId: string) {
    set((s) => {
      const idx = s.roster.findIndex((st) => st.id === sid);
      if (idx === -1) return {};
      const existing = s.roster[idx];
      if (existing === undefined) return {};
      const updated = removePreferencesFor(existing, targetId);
      const newRoster = [...s.roster];
      newRoster[idx] = updated;
      return {
        roster: newRoster,
        classroom: syncRosterToClassroom(s.classroom, newRoster),
        saveStatus: 'dirty',
      };
    });
  },

  setMutualPreference(aId: StudentId, bId: StudentId, weight: number) {
    set((s) => {
      const newRoster = prefSetMutual(s.roster, aId, bId, weight);
      // Short-circuit: if roster didn't change (self-target, neither id in roster),
      // avoid touching classroom or triggering autosave.
      if (newRoster === s.roster) return {};
      return {
        roster: newRoster,
        classroom: syncRosterToClassroom(s.classroom, newRoster),
        saveStatus: 'dirty',
      };
    });
  },

  clearMutualPreference(aId: StudentId, bId: StudentId) {
    set((s) => {
      const newRoster = prefClearMutual(s.roster, aId, bId);
      if (newRoster === s.roster) return {};
      return {
        roster: newRoster,
        classroom: syncRosterToClassroom(s.classroom, newRoster),
        saveStatus: 'dirty',
      };
    });
  },

  // ---- Grid resize and granularity ----------------------------------------

  resizeGrid(edge: GridEdge, delta: number) {
    set((s) => {
      const result = domainResizeGrid(s.classroom, edge, delta);
      if (!result.ok) {
        return { resizeGridWarning: result.reason };
      }
      return {
        classroom: result.classroom,
        resizeGridWarning: null,
        saveStatus: 'dirty' as const,
      };
    });
  },

  setGranularity(newG: number) {
    set((s) => {
      const newClassroom = domainSetGranularity(s.classroom, newG);
      return {
        classroom: newClassroom,
        saveStatus: 'dirty' as const,
      };
    });
  },

  dismissResizeWarning() {
    set({ resizeGridWarning: null });
  },

  // ---- Threshold (§13.4) ---------------------------------------------------

  setThreshold(units: number) {
    // Guard here as well as in the domain helper so that an errant direct
    // caller never throws from inside a Zustand set() callback (uncaught).
    if (!Number.isFinite(units) || units <= 0) return;
    set((s) => ({
      classroom: domainSetThreshold(s.classroom, units),
      saveStatus: 'dirty' as const,
    }));
  },

  // ---- Show violations (§13.5) --------------------------------------------

  setShowViolations(on: boolean) {
    set({ showViolations: on });
  },

  // ---- Background image (§14.4) -------------------------------------------

  setBackgroundImage(url: string | null) {
    set((s) => ({
      classroom: domainSetBackgroundImage(s.classroom, url),
      saveStatus: 'dirty' as const,
    }));
  },

  // ---- Grid color (§14.5) -------------------------------------------------

  setGridColor(color: string | null) {
    set((s) => {
      const newClassroom = domainSetGridColor(s.classroom, color);
      // Same-reference short-circuit: domain helper returns c unchanged when color
      // didn't change, so we avoid a spurious dirty mark + autosave.
      if (newClassroom === s.classroom) return {};
      return {
        classroom: newClassroom,
        saveStatus: 'dirty' as const,
      };
    });
  },

  // ---- Erase ---------------------------------------------------------------

  eraseAll() {
    set({
      ...EMPTY_STATE,
      // Fresh classroom id so any leftover IndexedDB key won't match
      classroom: makeClassroom(crypto.randomUUID(), 'My Classroom', 10, 8),
      saveStatus: 'saved',
      showViolations: true,
    });
  },

  // ---- UI selection --------------------------------------------------------

  setSelectedStudentId(id: StudentId | null) {
    set({ selectedStudentId: id });
  },

  // ---- Manual roster management -------------------------------------------

  addStudent(name: string) {
    const trimmed = name.trim();
    if (trimmed === '') return;
    const newStudent = makeStudent(studentId(crypto.randomUUID()), trimmed);
    set((s) => {
      const newRoster = [...s.roster, newStudent];
      return {
        roster: newRoster,
        classroom: syncRosterToClassroom(s.classroom, newRoster),
        saveStatus: 'dirty',
      };
    });
  },

  removeStudent(sid: StudentId) {
    set((s) => {
      // 1. Remove the student from the roster.
      const withoutStudent = s.roster.filter((st) => st.id !== sid);
      // No-op if student wasn't in the roster.
      if (withoutStudent.length === s.roster.length) return {};

      // 2. Prune orphan student-kind prefs from remaining students (§12.5 helper).
      const pruned = pruneOrphanStudentPrefs(withoutStudent);

      // 3. Sync classroom — vacates the removed student's seat and refreshes
      //    occupant copies for all remaining students.
      const newClassroom = syncRosterToClassroom(s.classroom, pruned);

      // 4. Clear selectedStudentId if it was this student.
      const newSelectedId = s.selectedStudentId === sid ? null : s.selectedStudentId;

      // 5. Clear any lock on the furniture that held the removed student.
      //    After syncRosterToClassroom the seat is empty, but the lock Set still
      //    references the fid — a dangling lock would block allocators from using
      //    that desk even though nobody is pinned there.
      const removedFid = s.classroom.furniture.find(
        (f) => f.occupants[0]?.id === sid,
      )?.id;
      const newLocks =
        removedFid !== undefined && s.locks.has(removedFid)
          ? new Set([...s.locks].filter((id) => id !== removedFid))
          : s.locks;

      return {
        roster: pruned,
        classroom: newClassroom,
        locks: newLocks,
        selectedStudentId: newSelectedId,
        saveStatus: 'dirty',
      };
    });
  },
}));

// ---------------------------------------------------------------------------
// Convenience selector: current fid→student arrangement as a plain Map
// ---------------------------------------------------------------------------

/**
 * Derive the current seating arrangement from the live classroom.
 * Use this as a Zustand selector when editors need the fid→student map.
 */
export function selectArrangement(s: PijonState): Map<FurnitureId, Student> {
  return assignments(s.classroom);
}

// ---------------------------------------------------------------------------
// §13.8 — Seating validation selector
// ---------------------------------------------------------------------------

import { validateSeating } from '../domain/validateSeating.js';
import type { SeatingValidationResult } from '../domain/validateSeating.js';

export type { SeatingValidationResult };
export { validateSeating };

/**
 * Derive the current seating-validation result from store state.
 * Computes `validateSeating(classroom, roster)` on demand — no redundant storage.
 *
 * !! DO NOT use as `usePijonStore(selectSeatingIssues)` in React components !!
 *
 * `SeatingValidationResult` is a freshly-allocated object every call, so
 * Zustand v5's default reference-equality check will never see it as "unchanged"
 * — every store tick triggers a re-render, causing an infinite render loop.
 *
 * Safe React pattern (already used in SeatingIssuesBanner):
 *
 *   // Subscribe to the stable primitives individually, then derive with useMemo.
 *   const classroom = usePijonStore((s) => s.classroom);
 *   const roster    = usePijonStore((s) => s.roster);
 *   const result    = useMemo(() => validateSeating(classroom, roster), [classroom, roster]);
 *
 * Or call the exported `useSeatingIssues()` hook from `state/hooks.ts` which
 * encapsulates this pattern.
 *
 * `selectSeatingIssues` is intentionally kept as a plain-function for tests and
 * non-React callers that operate on a state snapshot directly.
 */
export function selectSeatingIssues(s: PijonState): SeatingValidationResult {
  return validateSeating(s.classroom, s.roster);
}

// ---------------------------------------------------------------------------
// Convenience: can undo / can redo
// ---------------------------------------------------------------------------

export function selectCanUndo(s: PijonState): boolean {
  return s.historyPtr > 0;
}

export function selectCanRedo(s: PijonState): boolean {
  return s.historyPtr < s.history.length - 1;
}

// ---------------------------------------------------------------------------
// Type helpers for Phase 6+ editors
// ---------------------------------------------------------------------------

/**
 * The store type used by EditorMode implementations (Phase 6+).
 * Gives editors access to both state and actions through one handle.
 */
export type Store = PijonStore;

/**
 * FurnitureId mint helper re-exported for callers that only import from state/.
 */
export { furnitureId };
