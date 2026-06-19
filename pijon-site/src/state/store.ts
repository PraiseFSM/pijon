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
import { furnitureId } from '../domain/types.js';
import type { Student } from '../domain/student.js';
import {
  addPreference as studentAddPreference,
  removePreferencesFor,
} from '../domain/student.js';
import type { Preference } from '../domain/preference.js';
import type { Furniture } from '../domain/furniture.js';
import { assignOccupant, vacate } from '../domain/furniture.js';
import type { Classroom } from '../domain/classroom.js';
import {
  makeClassroom,
  addFurniture as domainAddFurniture,
  removeFurniture as domainRemoveFurniture,
  moveFurniture as domainMoveFurniture,
  updateFurniture,
  furnitureById,
  assignments,
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
   */
  addPreference(studentId: StudentId, pref: Preference): void;

  /**
   * Remove all preferences from a roster student that target `targetId`.
   * Immutable: replaces the student record in `roster` without mutating it.
   * Does nothing when the studentId is not found in the roster.
   * Uses `removePreferencesFor` from student.ts (pure helper).
   */
  removePreference(studentId: StudentId, targetId: string): void;

  // -- Erase --

  /**
   * Wipe all class data from the store (for shared/school computers).
   * persistence.ts must also delete the IndexedDB record separately.
   */
  eraseAll(): void;
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
      return {
        roster: [...s.roster, ...newStudents],
        saveStatus: 'dirty',
      };
    });

    return [...warnings];
  },

  setRoster(roster: readonly Student[]) {
    set({ roster, saveStatus: 'dirty' });
  },

  // ---- Seating -------------------------------------------------------------

  allocate(allocator: Allocator) {
    const s = get();
    const graph = new SeatGraph(s.classroom);

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

  // ---- Undo / redo ---------------------------------------------------------

  undo() {
    set((s) => {
      if (s.historyPtr <= 0) return {};
      const newPtr = s.historyPtr - 1;
      const snapshot = s.history[newPtr];
      if (snapshot === undefined) return {};
      return { classroom: snapshot, historyPtr: newPtr, saveStatus: 'dirty' };
    });
  },

  redo() {
    set((s) => {
      if (s.historyPtr >= s.history.length - 1) return {};
      const newPtr = s.historyPtr + 1;
      const snapshot = s.history[newPtr];
      if (snapshot === undefined) return {};
      return { classroom: snapshot, historyPtr: newPtr, saveStatus: 'dirty' };
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

  addPreference(studentId: StudentId, pref: Preference) {
    set((s) => {
      const idx = s.roster.findIndex((st) => st.id === studentId);
      if (idx === -1) return {};
      const existing = s.roster[idx];
      if (existing === undefined) return {};
      const updated = studentAddPreference(existing, pref);
      const newRoster = [...s.roster];
      newRoster[idx] = updated;
      return { roster: newRoster, saveStatus: 'dirty' };
    });
  },

  removePreference(studentId: StudentId, targetId: string) {
    set((s) => {
      const idx = s.roster.findIndex((st) => st.id === studentId);
      if (idx === -1) return {};
      const existing = s.roster[idx];
      if (existing === undefined) return {};
      const updated = removePreferencesFor(existing, targetId);
      const newRoster = [...s.roster];
      newRoster[idx] = updated;
      return { roster: newRoster, saveStatus: 'dirty' };
    });
  },

  // ---- Erase ---------------------------------------------------------------

  eraseAll() {
    set({
      ...EMPTY_STATE,
      // Fresh classroom id so any leftover IndexedDB key won't match
      classroom: makeClassroom(crypto.randomUUID(), 'My Classroom', 10, 8),
      saveStatus: 'saved',
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
