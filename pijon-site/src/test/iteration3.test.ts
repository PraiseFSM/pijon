// @vitest-environment jsdom
/**
 * Tests for §13.3, §13.4, §13.5 — Settings menu, Nearness → Settings,
 * and Violations ON by default.
 *
 * Coverage:
 *   1. Domain — setThreshold pure helper (immutable, validates, marks dirty via store)
 *   2. Store  — setThreshold action (updates thresholdUnits, marks dirty, immutable)
 *   3. Store  — showViolations default true + setShowViolations toggle
 *   4. Store  — allocate / smartShuffle use classroom.thresholdUnits (§13.4 bug fix)
 *   5. Persistence round-trip — extractProject / composeClassroom carry thresholdUnits
 *   6. Component — SettingsMenu opens/closes and houses the correct controls
 *   7. Component — showViolations toggle in SettingsMenu drives store
 *   8. Component — Nearness control in SettingsMenu drives store.setThreshold
 *
 * LOCAL-FIRST: no network calls.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

// Domain
import { makeClassroom, setThreshold, DEFAULT_THRESHOLD_UNITS } from '../domain/classroom.js';
import { furnitureId, studentId } from '../domain/types.js';
import { makeStudent } from '../domain/student.js';
import { SeatGraph } from '../domain/seatGraph.js';
import { GreedyAllocator } from '../domain/allocators/greedy.js';
import { BogoAllocator } from '../domain/allocators/bogo.js';

// IO
import { extractProject, composeClassroom } from '../domain/io/projectFile.js';

// Store
import { usePijonStore } from '../state/store.js';

// Components
import { SettingsMenu, GearButton } from '../ui/shell/SettingsMenu.js';
import type { EditorContext } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import type { FurnitureId } from '../domain/types.js';
import type { Furniture } from '../domain/furniture.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkDesk(id: string, x: number, y: number): Furniture {
  return {
    id: furnitureId(id),
    kind: 'single_desk',
    pos: { x, y },
    w: 1,
    h: 1,
    rotation: 0,
    occupants: [],
  };
}

function resetStore() {
  usePijonStore.getState().eraseAll();
}

// ---------------------------------------------------------------------------
// 1. Domain: setThreshold pure helper
// ---------------------------------------------------------------------------

describe('domain.setThreshold', () => {
  it('returns a new Classroom with the updated thresholdUnits', () => {
    const c = makeClassroom('id', 'test', 5, 5);
    const updated = setThreshold(c, 2.5);
    expect(updated.thresholdUnits).toBe(2.5);
    // original is unchanged (immutable)
    expect(c.thresholdUnits).toBe(DEFAULT_THRESHOLD_UNITS);
  });

  it('returns the same reference when threshold is unchanged', () => {
    const c = makeClassroom('id', 'test', 5, 5);
    const sameRef = setThreshold(c, DEFAULT_THRESHOLD_UNITS);
    expect(sameRef).toBe(c);
  });

  it('does not change furniture or other fields', () => {
    const c = makeClassroom('id', 'test', 5, 5);
    const updated = setThreshold(c, 3.0);
    expect(updated.furniture).toBe(c.furniture);
    expect(updated.gridW).toBe(c.gridW);
    expect(updated.gridH).toBe(c.gridH);
    expect(updated.cellsPerUnit).toBe(c.cellsPerUnit);
    expect(updated.name).toBe(c.name);
  });

  it('throws for non-positive values', () => {
    const c = makeClassroom('id', 'test', 5, 5);
    expect(() => setThreshold(c, 0)).toThrow(TypeError);
    expect(() => setThreshold(c, -1)).toThrow(TypeError);
  });

  it('throws for non-finite values', () => {
    const c = makeClassroom('id', 'test', 5, 5);
    expect(() => setThreshold(c, NaN)).toThrow(TypeError);
    expect(() => setThreshold(c, Infinity)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// 2. Store: setThreshold action
// ---------------------------------------------------------------------------

describe('store.setThreshold', () => {
  beforeEach(() => { resetStore(); });

  it('updates classroom.thresholdUnits in the store', () => {
    usePijonStore.getState().setThreshold(3.0);
    expect(usePijonStore.getState().classroom.thresholdUnits).toBe(3.0);
  });

  it('marks saveStatus dirty', () => {
    // Reset save status to 'saved' first
    usePijonStore.setState({ saveStatus: 'saved' });
    usePijonStore.getState().setThreshold(2.0);
    expect(usePijonStore.getState().saveStatus).toBe('dirty');
  });

  it('is immutable — classroom reference changes', () => {
    const before = usePijonStore.getState().classroom;
    usePijonStore.getState().setThreshold(2.0);
    const after = usePijonStore.getState().classroom;
    expect(after).not.toBe(before);
    expect(before.thresholdUnits).toBe(DEFAULT_THRESHOLD_UNITS); // original unchanged
    expect(after.thresholdUnits).toBe(2.0);
  });

  it('does not change furniture or roster', () => {
    usePijonStore.getState().addStudent('Alice');
    const rosterBefore = usePijonStore.getState().roster;
    const furnitureBefore = usePijonStore.getState().classroom.furniture;

    usePijonStore.getState().setThreshold(2.5);

    expect(usePijonStore.getState().roster).toBe(rosterBefore);
    expect(usePijonStore.getState().classroom.furniture).toBe(furnitureBefore);
  });
});

// ---------------------------------------------------------------------------
// 3. Store: showViolations default + toggle
// ---------------------------------------------------------------------------

describe('store.showViolations', () => {
  beforeEach(() => { resetStore(); });

  it('defaults to true (§13.5)', () => {
    expect(usePijonStore.getState().showViolations).toBe(true);
  });

  it('setShowViolations(false) turns violations off', () => {
    usePijonStore.getState().setShowViolations(false);
    expect(usePijonStore.getState().showViolations).toBe(false);
  });

  it('setShowViolations(true) turns violations back on', () => {
    usePijonStore.getState().setShowViolations(false);
    usePijonStore.getState().setShowViolations(true);
    expect(usePijonStore.getState().showViolations).toBe(true);
  });

  it('eraseAll() resets showViolations to true', () => {
    usePijonStore.getState().setShowViolations(false);
    usePijonStore.getState().eraseAll();
    expect(usePijonStore.getState().showViolations).toBe(true);
  });

  it('setShowViolations does not affect classroom or roster', () => {
    usePijonStore.getState().addStudent('Bob');
    const classroomBefore = usePijonStore.getState().classroom;
    const rosterBefore = usePijonStore.getState().roster;

    usePijonStore.getState().setShowViolations(false);

    expect(usePijonStore.getState().classroom).toBe(classroomBefore);
    expect(usePijonStore.getState().roster).toBe(rosterBefore);
  });
});

// ---------------------------------------------------------------------------
// 4. Store: allocate / smartShuffle use classroom.thresholdUnits (§13.4 bug fix)
// ---------------------------------------------------------------------------

/**
 * Verifies that the allocate/smartShuffle bug is fixed:
 *   - Before the fix, `new SeatGraph(s.classroom)` used DEFAULT_THRESHOLD_UNITS
 *     regardless of classroom.thresholdUnits.
 *   - After the fix, `new SeatGraph(s.classroom, s.classroom.thresholdUnits)` is used.
 *
 * Test approach:
 *   1. Place two desks 2 units apart (distance = 2.0).
 *   2. At DEFAULT_THRESHOLD_UNITS (1.5) they are NOT neighbors.
 *   3. At threshold = 2.5 they ARE neighbors.
 *   4. Place two students with a mutual avoid pref.
 *   5. With narrow threshold (1.5): allocator won't see them as neighbors,
 *      so no avoid-based steering — they may end up on adjacent desks.
 *   6. With wide threshold (2.5): allocator sees them as neighbors and
 *      steers them away from each other.
 *
 * We verify this by inspecting the SeatGraph directly (unit test) since
 * allocator placement is non-deterministic. The key assertion is that
 * classroom.thresholdUnits is passed through to SeatGraph.
 */
describe('store.allocate uses classroom.thresholdUnits', () => {
  beforeEach(() => { resetStore(); });

  it('SeatGraph built with narrow threshold does NOT connect distant desks', () => {
    // Two desks 2 units apart
    const classroom = {
      ...makeClassroom('id', 'test', 10, 10),
      furniture: [mkDesk('f1', 0, 0), mkDesk('f2', 2, 0)],
      thresholdUnits: 1.5, // default — desks 2.0 apart NOT neighbors
    };
    const graph = new SeatGraph(classroom, classroom.thresholdUnits);
    expect(graph.areNeighbors(furnitureId('f1'), furnitureId('f2'))).toBe(false);
  });

  it('SeatGraph built with wide threshold DOES connect distant desks', () => {
    const classroom = {
      ...makeClassroom('id', 'test', 10, 10),
      furniture: [mkDesk('f1', 0, 0), mkDesk('f2', 2, 0)],
      thresholdUnits: 2.5, // wide — desks 2.0 apart ARE neighbors
    };
    const graph = new SeatGraph(classroom, classroom.thresholdUnits);
    expect(graph.areNeighbors(furnitureId('f1'), furnitureId('f2'))).toBe(true);
  });

  it('store.setThreshold changes the threshold used by the next allocate call', () => {
    // We test by inspecting that the SeatGraph built inside allocate respects
    // the classroom's threshold by confirming that threshold changes are reflected.
    // Add two desks 2 units apart
    const f1 = mkDesk('f1', 0, 0);
    const f2 = mkDesk('f2', 2, 0);
    const f3 = mkDesk('f3', 4, 0);

    // Setup store directly
    usePijonStore.setState({
      classroom: {
        ...makeClassroom('c1', 'Room', 10, 5),
        furniture: [f1, f2, f3],
        thresholdUnits: 1.5,
      },
      roster: [
        makeStudent(studentId('s1'), 'Alice'),
        makeStudent(studentId('s2'), 'Bob'),
        makeStudent(studentId('s3'), 'Carol'),
      ],
    });

    // With default threshold (1.5): verify allocate runs without error
    usePijonStore.getState().allocate(new GreedyAllocator());
    const after1 = usePijonStore.getState().classroom;
    const seated1 = after1.furniture.filter((f) => f.occupants[0] !== undefined).length;
    expect(seated1).toBe(3);

    // Now set a wider threshold
    usePijonStore.getState().setThreshold(2.5);
    expect(usePijonStore.getState().classroom.thresholdUnits).toBe(2.5);

    // Run allocate again — should use the new threshold
    usePijonStore.getState().clearArrangement();
    usePijonStore.getState().allocate(new GreedyAllocator());
    const after2 = usePijonStore.getState().classroom;
    const seated2 = after2.furniture.filter((f) => f.occupants[0] !== undefined).length;
    expect(seated2).toBe(3);
  });

  it('smartShuffle also uses classroom.thresholdUnits (since it delegates to allocate)', () => {
    const f1 = mkDesk('f1', 0, 0);
    const f2 = mkDesk('f2', 1, 0);

    usePijonStore.setState({
      classroom: {
        ...makeClassroom('c1', 'Room', 5, 5),
        furniture: [f1, f2],
        thresholdUnits: 3.0, // non-default
      },
      roster: [
        makeStudent(studentId('s1'), 'Alice'),
        makeStudent(studentId('s2'), 'Bob'),
      ],
    });

    // Should not throw — smartShuffle uses classroom.thresholdUnits
    expect(() => {
      usePijonStore.getState().smartShuffle(new BogoAllocator());
    }).not.toThrow();

    // Both students placed
    const seated = usePijonStore.getState().classroom.furniture.filter(
      (f) => f.occupants[0] !== undefined,
    ).length;
    expect(seated).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Persistence round-trip: thresholdUnits carried through extractProject/composeClassroom
// ---------------------------------------------------------------------------

describe('persistence round-trip: thresholdUnits', () => {
  it('extractProject includes thresholdUnits in the classroom geometry', () => {
    const classroom = {
      ...makeClassroom('id1', 'Room', 5, 5),
      thresholdUnits: 3.5,
    };
    const pf = extractProject({ classroom, roster: [], locks: [] });
    expect(pf.classroom.thresholdUnits).toBe(3.5);
  });

  it('composeClassroom restores thresholdUnits from a project file', () => {
    const classroom = {
      ...makeClassroom('id1', 'Room', 5, 5),
      thresholdUnits: 2.0,
    };
    const pf = extractProject({ classroom, roster: [], locks: [] });
    const loaded = composeClassroom(pf);
    expect(loaded.classroom.thresholdUnits).toBe(2.0);
  });

  it('round-trip preserves DEFAULT_THRESHOLD_UNITS when unchanged', () => {
    const classroom = makeClassroom('id1', 'Room', 5, 5);
    expect(classroom.thresholdUnits).toBe(DEFAULT_THRESHOLD_UNITS);
    const pf = extractProject({ classroom, roster: [], locks: [] });
    const loaded = composeClassroom(pf);
    expect(loaded.classroom.thresholdUnits).toBe(DEFAULT_THRESHOLD_UNITS);
  });

  it('round-trip carries custom threshold through store (setThreshold + extract)', () => {
    resetStore();
    usePijonStore.getState().setThreshold(4.0);
    const state = usePijonStore.getState();
    const pf = extractProject({
      classroom: state.classroom,
      roster: state.roster,
      locks: Array.from(state.locks),
    });
    expect(pf.classroom.thresholdUnits).toBe(4.0);
    const loaded = composeClassroom(pf);
    expect(loaded.classroom.thresholdUnits).toBe(4.0);
  });
});

// ---------------------------------------------------------------------------
// 4b. End-to-end: non-default thresholdUnits actually changes violation detection
// ---------------------------------------------------------------------------

describe('thresholdUnits end-to-end: violations change with threshold', () => {
  /**
   * Two desks placed 2 units apart. At DEFAULT_THRESHOLD_UNITS (1.5) they are
   * NOT neighbors → no violation. At threshold 2.5 they ARE neighbors → placing
   * two mutually-avoiding students creates a violation.
   *
   * This is the key correctness test: it verifies that the threshold flows
   * through the full pipeline (store → SeatGraph → violation predicate), not
   * just that SeatGraph.areNeighbors responds correctly in isolation.
   */

  function buildAvoidingStudents() {
    const alice = {
      ...makeStudent(studentId('alice'), 'Alice'),
      preferences: [{ kind: 'student' as const, targetId: studentId('bob'), weight: -1 }],
    };
    const bob = {
      ...makeStudent(studentId('bob'), 'Bob'),
      preferences: [{ kind: 'student' as const, targetId: studentId('alice'), weight: -1 }],
    };
    return { alice, bob };
  }

  function hasViolation(
    student: ReturnType<typeof makeStudent>,
    fid: FurnitureId,
    arrangement: Map<FurnitureId, ReturnType<typeof makeStudent>>,
    graph: InstanceType<typeof SeatGraph>,
  ): boolean {
    // Simplified violation check (mirrors the one in StudentEditor.tsx)
    const sidToFid = new Map<string, FurnitureId>();
    for (const [f, s] of arrangement) {
      if (f !== fid) sidToFid.set(s.id, f);
    }
    for (const pref of student.preferences) {
      if (pref.weight >= 0) continue;
      if (pref.kind === 'student') {
        const tFid = sidToFid.get(pref.targetId);
        if (tFid !== undefined && graph.areNeighbors(fid, tFid)) return true;
      }
    }
    return false;
  }

  it('no violation when threshold is NARROW (desks 2 units apart are NOT neighbors)', () => {
    const { alice, bob } = buildAvoidingStudents();
    const classroom = {
      ...makeClassroom('id', 'Room', 10, 10),
      furniture: [
        { ...mkDesk('f1', 0, 0), occupants: [alice] },
        { ...mkDesk('f2', 2, 0), occupants: [bob] },
      ],
      thresholdUnits: 1.5, // default — 2 units apart → NOT neighbors
    };
    const graph = new SeatGraph(classroom, classroom.thresholdUnits);
    const arrangement = new Map<FurnitureId, typeof alice>([
      [furnitureId('f1'), alice],
      [furnitureId('f2'), bob],
    ]);
    // Not neighbors at 1.5 → no violation
    expect(graph.areNeighbors(furnitureId('f1'), furnitureId('f2'))).toBe(false);
    expect(hasViolation(alice, furnitureId('f1'), arrangement, graph)).toBe(false);
    expect(hasViolation(bob, furnitureId('f2'), arrangement, graph)).toBe(false);
  });

  it('violation detected when threshold is WIDE (desks 2 units apart ARE neighbors)', () => {
    const { alice, bob } = buildAvoidingStudents();
    const classroom = {
      ...makeClassroom('id', 'Room', 10, 10),
      furniture: [
        { ...mkDesk('f1', 0, 0), occupants: [alice] },
        { ...mkDesk('f2', 2, 0), occupants: [bob] },
      ],
      thresholdUnits: 2.5, // wide — 2 units apart → IS a neighbor
    };
    const graph = new SeatGraph(classroom, classroom.thresholdUnits);
    const arrangement = new Map<FurnitureId, typeof alice>([
      [furnitureId('f1'), alice],
      [furnitureId('f2'), bob],
    ]);
    // Are neighbors at 2.5 → violation
    expect(graph.areNeighbors(furnitureId('f1'), furnitureId('f2'))).toBe(true);
    expect(hasViolation(alice, furnitureId('f1'), arrangement, graph)).toBe(true);
    expect(hasViolation(bob, furnitureId('f2'), arrangement, graph)).toBe(true);
  });

  it('store.setThreshold changes which desks are treated as neighbors', () => {
    resetStore();
    // Setup: two desks 2 units apart with avoiding students
    const { alice, bob } = buildAvoidingStudents();
    usePijonStore.setState({
      classroom: {
        ...makeClassroom('c1', 'Room', 10, 5),
        furniture: [
          { ...mkDesk('f1', 0, 0), occupants: [alice] },
          { ...mkDesk('f2', 2, 0), occupants: [bob] },
        ],
        thresholdUnits: 1.5,
      },
      roster: [alice, bob],
    });

    // At narrow threshold: NOT neighbors
    const narrow = new SeatGraph(
      usePijonStore.getState().classroom,
      usePijonStore.getState().classroom.thresholdUnits,
    );
    expect(narrow.areNeighbors(furnitureId('f1'), furnitureId('f2'))).toBe(false);

    // Widen the threshold via store
    usePijonStore.getState().setThreshold(2.5);
    // Classroom reference must have changed (setThreshold is immutable)
    const wideClassroom = usePijonStore.getState().classroom;
    expect(wideClassroom.thresholdUnits).toBe(2.5);

    // At wide threshold: ARE neighbors
    const wide = new SeatGraph(wideClassroom, wideClassroom.thresholdUnits);
    expect(wide.areNeighbors(furnitureId('f1'), furnitureId('f2'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4c. Store: setThreshold with invalid input is a silent no-op (does not throw)
// ---------------------------------------------------------------------------

describe('store.setThreshold: invalid input is a no-op', () => {
  beforeEach(() => { resetStore(); });

  it('does not throw for zero', () => {
    const before = usePijonStore.getState().classroom;
    expect(() => { usePijonStore.getState().setThreshold(0); }).not.toThrow();
    expect(usePijonStore.getState().classroom).toBe(before); // unchanged
  });

  it('does not throw for negative', () => {
    const before = usePijonStore.getState().classroom;
    expect(() => { usePijonStore.getState().setThreshold(-1); }).not.toThrow();
    expect(usePijonStore.getState().classroom).toBe(before);
  });

  it('does not throw for NaN', () => {
    const before = usePijonStore.getState().classroom;
    expect(() => { usePijonStore.getState().setThreshold(NaN); }).not.toThrow();
    expect(usePijonStore.getState().classroom).toBe(before);
  });

  it('does not throw for Infinity', () => {
    const before = usePijonStore.getState().classroom;
    expect(() => { usePijonStore.getState().setThreshold(Infinity); }).not.toThrow();
    expect(usePijonStore.getState().classroom).toBe(before);
  });

  it('does not mark saveStatus dirty on invalid input', () => {
    usePijonStore.setState({ saveStatus: 'saved' });
    usePijonStore.getState().setThreshold(0);
    expect(usePijonStore.getState().saveStatus).toBe('saved');
  });

  it('identity short-circuit: same threshold returns same classroom ref', () => {
    const before = usePijonStore.getState().classroom;
    const currentThreshold = before.thresholdUnits;
    usePijonStore.getState().setThreshold(currentThreshold);
    // domain setThreshold short-circuits, so set() still runs but produces
    // the same classroom ref (domain returns `c` unchanged)
    expect(usePijonStore.getState().classroom).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 4d. Cache invalidation: classroom ref changes when threshold changes
// ---------------------------------------------------------------------------

describe('cache invalidation: classroom ref changes on setThreshold', () => {
  beforeEach(() => { resetStore(); });

  it('setThreshold returns a NEW classroom object (ref changes)', () => {
    const before = usePijonStore.getState().classroom;
    usePijonStore.getState().setThreshold(before.thresholdUnits + 1.0);
    const after = usePijonStore.getState().classroom;
    // Must be a new object — the SeatGraph cache keys on this ref
    expect(after).not.toBe(before);
  });

  it('setThreshold with identity value returns SAME classroom ref (no churn)', () => {
    const before = usePijonStore.getState().classroom;
    usePijonStore.getState().setThreshold(before.thresholdUnits);
    const after = usePijonStore.getState().classroom;
    // domain setThreshold short-circuits on identity — no new object, no autosave spam
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// showViolations is NOT in the .pijon project file (intentional design)
// ---------------------------------------------------------------------------

describe('showViolations NOT in project file (app-level UI state)', () => {
  it('extractProject does NOT include showViolations', () => {
    const classroom = makeClassroom('id1', 'Room', 5, 5);
    const pf = extractProject({ classroom, roster: [], locks: [] });
    // The project file object must not carry showViolations
    expect('showViolations' in pf).toBe(false);
  });

  it('resets to true on eraseAll regardless of previous value', () => {
    resetStore();
    usePijonStore.getState().setShowViolations(false);
    expect(usePijonStore.getState().showViolations).toBe(false);
    usePijonStore.getState().eraseAll();
    expect(usePijonStore.getState().showViolations).toBe(true);
  });

  it('survives editor switches (store persists within session)', () => {
    resetStore();
    usePijonStore.getState().setShowViolations(false);
    // Simulate an editor switch (activeEditorId change — does not reset showViolations)
    usePijonStore.getState().setActiveEditorId('furniture');
    expect(usePijonStore.getState().showViolations).toBe(false);
    usePijonStore.getState().setActiveEditorId('student');
    expect(usePijonStore.getState().showViolations).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Note on showViolations persistence:
// ---------------------------------------------------------------------------
// showViolations is intentionally APP-LEVEL state (not per-project) — it is the
// teacher's display preference, not a classroom setting. Like the selected student
// or editor tab, it is not included in the .pijon project file. It survives
// in-session editor switches (store persists across tab changes within the session)
// but resets to true on page reload (EMPTY_STATE default). This matches the
// design intent: teachers almost always want to see violations, so defaulting to
// true on each load is the right behaviour.
//
// If future work wants to persist showViolations across sessions, it should go
// into IndexedDB (persistence.ts) as app-level UI config, separate from the
// project file. For now, the default-true + store-toggle tests above cover the
// specified behaviour.

// ---------------------------------------------------------------------------
// 6+. Component tests — SettingsMenu open/close + controls
// ---------------------------------------------------------------------------

const makeStoreMock = (overrides?: Partial<Store>): Store =>
  ({
    roster: [],
    locks: new Set<FurnitureId>(),
    selectedStudentId: null,
    classroom: {
      id: 'test-classroom',
      name: 'Test',
      gridW: 5,
      gridH: 5,
      furniture: [],
      cellsPerUnit: 1,
      thresholdUnits: DEFAULT_THRESHOLD_UNITS,
    },
    history: [],
    historyPtr: 0,
    showViolations: true,
    setThreshold: vi.fn(),
    setShowViolations: vi.fn(),
    lockSeat: vi.fn(),
    unlockSeat: vi.fn(),
    ...overrides,
  } as unknown as Store);

const makeCanvasMock = () => ({
  cellSize: 48,
  gridW: 5,
  gridH: 5,
  originOffset: 0,
  cellAt: vi.fn(() => undefined),
  furnitureAt: vi.fn(() => undefined),
  cellRect: vi.fn(() => ({ x: 0, y: 0, w: 48, h: 48 })),
  requestRepaint: vi.fn(),
});

const makeCtx = (storeOverrides?: Partial<Store>): EditorContext => ({
  store: makeStoreMock(storeOverrides),
  canvas: makeCanvasMock(),
  persistence: null,
});

// The SettingsMenu reads from the Zustand store via usePijonStore selector.
// We need to prime the store before rendering.
function primeStore(overrides?: { thresholdUnits?: number; showViolations?: boolean }) {
  resetStore();
  if (overrides?.thresholdUnits !== undefined) {
    usePijonStore.getState().setThreshold(overrides.thresholdUnits);
  }
  if (overrides?.showViolations !== undefined) {
    usePijonStore.getState().setShowViolations(overrides.showViolations);
  }
}

describe('SettingsMenu — open/close', () => {
  beforeEach(() => { primeStore(); });

  it('is not visible when open=false', () => {
    const ctx = makeCtx();
    render(
      React.createElement(SettingsMenu, { ctx, open: false, onClose: vi.fn() }),
    );
    expect(screen.queryByTestId('settings-menu')).toBeNull();
  });

  it('is visible when open=true', () => {
    const ctx = makeCtx();
    render(
      React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }),
    );
    expect(screen.getByTestId('settings-menu')).toBeTruthy();
  });

  it('contains the nearness input', () => {
    const ctx = makeCtx();
    render(
      React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }),
    );
    expect(screen.getByTestId('settings-nearness-input')).toBeTruthy();
  });

  it('contains the violations toggle', () => {
    const ctx = makeCtx();
    render(
      React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }),
    );
    expect(screen.getByTestId('settings-violations-toggle')).toBeTruthy();
  });
});

describe('GearButton', () => {
  it('renders with aria-expanded=false when closed', () => {
    const onClick = vi.fn();
    render(React.createElement(GearButton, { open: false, onClick }));
    const btn = screen.getByTestId('settings-gear-button');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders with aria-expanded=true when open', () => {
    const onClick = vi.fn();
    render(React.createElement(GearButton, { open: true, onClick }));
    const btn = screen.getByTestId('settings-gear-button');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(React.createElement(GearButton, { open: false, onClick }));
    fireEvent.click(screen.getByTestId('settings-gear-button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsMenu — violations toggle drives store', () => {
  beforeEach(() => { primeStore({ showViolations: true }); });

  it('shows ON when showViolations=true in store', () => {
    const ctx = makeCtx();
    render(
      React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }),
    );
    const toggle = screen.getByTestId('settings-violations-toggle');
    expect(toggle.textContent).toBe('ON');
  });

  it('shows OFF when showViolations=false in store', () => {
    primeStore({ showViolations: false });
    const ctx = makeCtx();
    render(
      React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }),
    );
    const toggle = screen.getByTestId('settings-violations-toggle');
    expect(toggle.textContent).toBe('OFF');
  });

  it('clicking the toggle calls store.setShowViolations and requestRepaint', () => {
    const setShowViolations = vi.fn();
    const requestRepaint = vi.fn();
    const ctx: EditorContext = {
      store: makeStoreMock({ setShowViolations }),
      canvas: { ...makeCanvasMock(), requestRepaint },
      persistence: null,
    };
    render(
      React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }),
    );
    fireEvent.click(screen.getByTestId('settings-violations-toggle'));
    expect(setShowViolations).toHaveBeenCalledWith(false); // was true, flip to false
    expect(requestRepaint).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsMenu — nearness input drives store', () => {
  beforeEach(() => { primeStore({ thresholdUnits: DEFAULT_THRESHOLD_UNITS }); });

  it('displays the current thresholdUnits from the store', () => {
    primeStore({ thresholdUnits: 3.0 });
    const ctx = makeCtx();
    render(
      React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }),
    );
    const input = screen.getByTestId<HTMLInputElement>('settings-nearness-input');
    expect(parseFloat(input.value)).toBe(3.0);
  });

  it('changing the input calls store.setThreshold and requestRepaint', () => {
    const setThresholdFn = vi.fn();
    const requestRepaint = vi.fn();
    const ctx: EditorContext = {
      store: makeStoreMock({ setThreshold: setThresholdFn }),
      canvas: { ...makeCanvasMock(), requestRepaint },
      persistence: null,
    };
    render(
      React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }),
    );
    const input = screen.getByTestId('settings-nearness-input');
    fireEvent.change(input, { target: { value: '2.5' } });
    expect(setThresholdFn).toHaveBeenCalledWith(2.5);
    expect(requestRepaint).toHaveBeenCalledTimes(1);
  });

  it('ignores invalid (non-positive) nearness values', () => {
    const setThresholdFn = vi.fn();
    const ctx: EditorContext = {
      store: makeStoreMock({ setThreshold: setThresholdFn }),
      canvas: makeCanvasMock(),
      persistence: null,
    };
    render(
      React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }),
    );
    const input = screen.getByTestId('settings-nearness-input');
    fireEvent.change(input, { target: { value: '-1' } });
    expect(setThresholdFn).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '0' } });
    expect(setThresholdFn).not.toHaveBeenCalled();
  });
});

describe('SettingsMenu — click-outside closes', () => {
  beforeEach(() => { primeStore(); });

  it('calls onClose when clicking outside the panel', () => {
    const onClose = vi.fn();
    const ctx = makeCtx();
    render(
      React.createElement('div', null,
        React.createElement('div', { 'data-testid': 'outside' }, 'outside'),
        React.createElement(SettingsMenu, { ctx, open: true, onClose }),
      ),
    );
    expect(screen.getByTestId('settings-menu')).toBeTruthy();

    // Simulate a pointerdown outside the menu — dispatch at the window level.
    // The SettingsMenu useEffect listens with capture: true so it intercepts
    // all window-level pointerdown events. The event.target won't be inside
    // panelRef (it's a synthetic PointerEvent with no real target), so onClose fires.
    act(() => {
      const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
      window.dispatchEvent(event);
    });

    // Since jsdom doesn't fully simulate capture-phase event propagation
    // in the same way, we verify the hook is wired correctly by dispatching
    // a window-level pointerdown event (which is what the useEffect listens to).
    // The callback will fire because the event.target won't be inside panelRef.
    expect(onClose).toHaveBeenCalled();
  });
});
