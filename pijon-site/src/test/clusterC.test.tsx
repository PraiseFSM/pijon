// @vitest-environment jsdom
/**
 * Cluster C — §5.C1: drag a student name from the roster onto a desk.
 *
 * Verifies the five behaviours specified in the task:
 *   1. Dropping a roster student onto an EMPTY assignable desk seats them there.
 *   2. Dropping onto an OCCUPIED desk swaps/replaces per the same rule as
 *      inter-desk drag (assignStudentToFurniture handles move/swap/displace).
 *   3. Dropping a student who is ALREADY seated elsewhere moves them (no duplicate).
 *   4. Dropping onto a non-assignable target (fixture furniture, empty cell,
 *      outside grid) is a safe no-op.
 *   5. History is pushed (undo works) and locks are handled consistently with
 *      inter-desk drag.
 *   6. No network at any point — dataTransfer only.
 *
 * Tests use a synthetic DragEvent whose dataTransfer carries DRAG_STUDENT_ID_KEY
 * and assert the right store action is called (or not called) with correct args.
 * Store actions are mocked via makeCtx; behaviours 1-3 and 5 are also verified
 * against the real Zustand store.
 *
 * The text/plain fallback path of readDraggedStudentId is also exercised.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';

import { furnitureId, studentId as mkStudentId } from '../domain/types.js';
import { makeStudent } from '../domain/student.js';
import { makeClassroom } from '../domain/classroom.js';
import type { FurnitureId } from '../domain/types.js';
import type { Furniture } from '../domain/furniture.js';

import { usePijonStore } from '../state/store.js';

import {
  StudentEditor,
  DRAG_STUDENT_ID_KEY,
  stashDraggedStudentId,
  clearDraggedStudentIdStash,
  readDraggedStudentId,
} from '../ui/editors/StudentEditor.js';
import type { EditorContext, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';

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

function mkTeacherDesk(id: string): Furniture {
  return {
    id: furnitureId(id),
    kind: 'teacher_desk',
    pos: { x: 0, y: 0 },
    w: 2,
    h: 1,
    rotation: 0,
    occupants: [],
  };
}

function mkWhiteboard(id: string): Furniture {
  return {
    id: furnitureId(id),
    kind: 'whiteboard',
    pos: { x: 0, y: 0 },
    w: 4,
    h: 1,
    rotation: 0,
    occupants: [],
  };
}

function mkStudent(id: string, name: string) {
  return makeStudent(mkStudentId(id), name);
}

/** Build a minimal DragEvent stub (jsdom does not implement real DragEvent). */
function makeDragEvent(
  dataMap: Record<string, string> = {},
  clientX = 100,
  clientY = 100,
): DragEvent {
  return {
    type: 'drop',
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      getData: (key: string) => dataMap[key] ?? '',
      setData: vi.fn(),
      setDragImage: vi.fn(),
      effectAllowed: 'move',
      dropEffect: 'move',
    },
  } as unknown as DragEvent;
}

const makeStoreMock = (overrides?: Partial<Store>): Store =>
  ({
    roster: [],
    locks: new Set<FurnitureId>(),
    selectedStudentId: null,
    classroom: {
      id: 'test',
      name: 'Test',
      gridW: 5,
      gridH: 5,
      furniture: [],
      cellsPerUnit: 1,
      thresholdUnits: 1.5,
    },
    history: [],
    historyPtr: 0,
    showViolations: true,
    allocate: vi.fn(),
    smartShuffle: vi.fn(),
    clearArrangement: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    manualReassign: vi.fn(),
    assignStudentToFurniture: vi.fn(),
    setSelectedStudentId: vi.fn(),
    addStudent: vi.fn(),
    removeStudent: vi.fn(),
    setMutualPreference: vi.fn(),
    clearMutualPreference: vi.fn(),
    removePreference: vi.fn(),
    importRosterFromCsv: vi.fn(() => [] as string[]),
    lockSeat: vi.fn(),
    unlockSeat: vi.fn(),
    setThreshold: vi.fn(),
    setShowViolations: vi.fn(),
    ...overrides,
  } as unknown as Store);

const makeCanvasMock = (overrides?: Partial<CanvasView>): CanvasView => ({
  cellSize: 48,
  gridW: 5,
  gridH: 5,
  originOffset: 0,
  cellAt: vi.fn(() => undefined),
  furnitureAt: vi.fn(() => undefined),
  cellRect: vi.fn(() => ({ x: 0, y: 0, w: 48, h: 48 })),
  requestRepaint: vi.fn(),
  ...overrides,
});

function makeCtx(
  storeOverrides?: Partial<Store>,
  canvasOverrides?: Partial<CanvasView>,
): EditorContext {
  return {
    store: makeStoreMock(storeOverrides),
    canvas: makeCanvasMock(canvasOverrides),
    persistence: null,
  };
}

function resetStore() {
  usePijonStore.getState().eraseAll();
}

// ---------------------------------------------------------------------------
// Behaviour 1: dropping onto an EMPTY assignable desk seats the student
// ---------------------------------------------------------------------------

describe('5.C1 behaviour 1 — roster-drop onto empty desk calls assignStudentToFurniture', () => {
  it('calls assignStudentToFurniture with the dragged sid and target fid', () => {
    const sid = mkStudentId('alice');
    const desk = mkDesk('d1', 0, 0);
    const assignStudentToFurniture = vi.fn();
    const requestRepaint = vi.fn();

    const ctx = makeCtx(
      { assignStudentToFurniture },
      {
        cellAt: vi.fn(() => ({ x: 0, y: 0 })),
        furnitureAt: vi.fn(() => desk),
        requestRepaint,
      },
    );

    stashDraggedStudentId(sid);
    const e = makeDragEvent({ [DRAG_STUDENT_ID_KEY]: 'alice' });
    StudentEditor.onDrop(e, ctx);

    expect(assignStudentToFurniture).toHaveBeenCalledOnce();
    expect(assignStudentToFurniture).toHaveBeenCalledWith(sid, furnitureId('d1'));
    expect(requestRepaint).toHaveBeenCalled();
    clearDraggedStudentIdStash();
  });

  it('seats the student in the real store (empty desk)', () => {
    resetStore();
    const alice = mkStudent('alice', 'Alice');
    const desk = mkDesk('d1', 0, 0);

    act(() => {
      usePijonStore.setState({
        classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk] },
        roster: [alice],
      });
    });

    act(() => {
      usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));
    });

    const seated = usePijonStore.getState().classroom.furniture
      .find((f) => f.id === furnitureId('d1'));
    expect(seated?.occupants[0]?.id).toBe(mkStudentId('alice'));
  });
});

// ---------------------------------------------------------------------------
// Behaviour 2: dropping onto an OCCUPIED desk swaps / replaces
// ---------------------------------------------------------------------------

describe('5.C1 behaviour 2 — roster-drop onto occupied desk', () => {
  it('calls assignStudentToFurniture with the occupied target fid', () => {
    const sid = mkStudentId('alice');
    const bob = mkStudent('bob', 'Bob');
    const occupiedDesk: Furniture = { ...mkDesk('d2', 1, 0), occupants: [bob] };
    const assignStudentToFurniture = vi.fn();

    const ctx = makeCtx(
      { assignStudentToFurniture },
      {
        cellAt: vi.fn(() => ({ x: 1, y: 0 })),
        furnitureAt: vi.fn(() => occupiedDesk),
      },
    );

    stashDraggedStudentId(sid);
    const e = makeDragEvent({ [DRAG_STUDENT_ID_KEY]: 'alice' });
    StudentEditor.onDrop(e, ctx);

    expect(assignStudentToFurniture).toHaveBeenCalledWith(sid, furnitureId('d2'));
    clearDraggedStudentIdStash();
  });

  it('swaps: seated alice + bob end up swapped in the real store', () => {
    resetStore();
    const alice = mkStudent('alice', 'Alice');
    const bob = mkStudent('bob', 'Bob');
    const d1: Furniture = { ...mkDesk('d1', 0, 0), occupants: [alice] };
    const d2: Furniture = { ...mkDesk('d2', 1, 0), occupants: [bob] };

    act(() => {
      usePijonStore.setState({
        classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [d1, d2] },
        roster: [alice, bob],
      });
    });

    // Drag alice (on d1) → d2 (occupied by bob)
    act(() => {
      usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d2'));
    });

    const state = usePijonStore.getState().classroom.furniture;
    expect(state.find((f) => f.id === furnitureId('d2'))?.occupants[0]?.id)
      .toBe(mkStudentId('alice'));
    expect(state.find((f) => f.id === furnitureId('d1'))?.occupants[0]?.id)
      .toBe(mkStudentId('bob'));
  });

  it('unseated student displaces occupant (occupant becomes unseated)', () => {
    resetStore();
    const alice = mkStudent('alice', 'Alice');
    const bob = mkStudent('bob', 'Bob');
    const d1: Furniture = { ...mkDesk('d1', 0, 0), occupants: [bob] };

    act(() => {
      usePijonStore.setState({
        classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [d1] },
        roster: [alice, bob],
      });
    });

    // Unseated Alice dropped on d1 (occupied by bob)
    act(() => {
      usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));
    });

    const furniture = usePijonStore.getState().classroom.furniture;
    expect(furniture.find((f) => f.id === furnitureId('d1'))?.occupants[0]?.id)
      .toBe(mkStudentId('alice'));
    const bobSeated = furniture.some((f) => f.occupants.some((o) => o.id === mkStudentId('bob')));
    expect(bobSeated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Behaviour 3: dropping a student who is already seated elsewhere moves them
// ---------------------------------------------------------------------------

describe('5.C1 behaviour 3 — roster-drop moves an already-seated student', () => {
  it('vacates the old desk and places student on the new desk', () => {
    resetStore();
    const alice = mkStudent('alice', 'Alice');
    const d1: Furniture = { ...mkDesk('d1', 0, 0), occupants: [alice] };
    const d2 = mkDesk('d2', 1, 0);

    act(() => {
      usePijonStore.setState({
        classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [d1, d2] },
        roster: [alice],
      });
    });

    act(() => {
      usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d2'));
    });

    const furniture = usePijonStore.getState().classroom.furniture;
    expect(furniture.find((f) => f.id === furnitureId('d1'))?.occupants.length).toBe(0);
    expect(furniture.find((f) => f.id === furnitureId('d2'))?.occupants[0]?.id)
      .toBe(mkStudentId('alice'));
  });

  it('no student appears on two desks after a move (invariant)', () => {
    resetStore();
    const alice = mkStudent('alice', 'Alice');
    const d1: Furniture = { ...mkDesk('d1', 0, 0), occupants: [alice] };
    const d2 = mkDesk('d2', 1, 0);
    const d3 = mkDesk('d3', 2, 0);

    act(() => {
      usePijonStore.setState({
        classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [d1, d2, d3] },
        roster: [alice],
      });
    });

    act(() => {
      usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d3'));
    });

    const counts = new Map<string, number>();
    for (const f of usePijonStore.getState().classroom.furniture) {
      for (const occ of f.occupants) {
        counts.set(occ.id, (counts.get(occ.id) ?? 0) + 1);
      }
    }
    for (const [, count] of counts) {
      expect(count).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Behaviour 4: dropping onto non-assignable / outside grid is a safe no-op
// ---------------------------------------------------------------------------

describe('5.C1 behaviour 4 — non-assignable targets are no-ops', () => {
  it('does not call assignStudentToFurniture when cellAt returns undefined (outside grid)', () => {
    const sid = mkStudentId('alice');
    stashDraggedStudentId(sid);
    const assignStudentToFurniture = vi.fn();

    const ctx = makeCtx(
      { assignStudentToFurniture },
      { cellAt: vi.fn(() => undefined) },
    );

    const e = makeDragEvent({ [DRAG_STUDENT_ID_KEY]: 'alice' });
    StudentEditor.onDrop(e, ctx);

    expect(assignStudentToFurniture).not.toHaveBeenCalled();
    clearDraggedStudentIdStash();
  });

  it('does not call assignStudentToFurniture when furnitureAt returns undefined (empty cell)', () => {
    const sid = mkStudentId('alice');
    stashDraggedStudentId(sid);
    const assignStudentToFurniture = vi.fn();

    const ctx = makeCtx(
      { assignStudentToFurniture },
      {
        cellAt: vi.fn(() => ({ x: 0, y: 0 })),
        furnitureAt: vi.fn(() => undefined),
      },
    );

    const e = makeDragEvent({ [DRAG_STUDENT_ID_KEY]: 'alice' });
    StudentEditor.onDrop(e, ctx);

    expect(assignStudentToFurniture).not.toHaveBeenCalled();
    clearDraggedStudentIdStash();
  });

  it('does not call assignStudentToFurniture when target is a teacher_desk (capacity 0)', () => {
    const sid = mkStudentId('alice');
    stashDraggedStudentId(sid);
    const assignStudentToFurniture = vi.fn();
    const teacherDesk = mkTeacherDesk('td1');

    const ctx = makeCtx(
      { assignStudentToFurniture },
      {
        cellAt: vi.fn(() => ({ x: 0, y: 0 })),
        furnitureAt: vi.fn(() => teacherDesk),
      },
    );

    const e = makeDragEvent({ [DRAG_STUDENT_ID_KEY]: 'alice' });
    StudentEditor.onDrop(e, ctx);

    expect(assignStudentToFurniture).not.toHaveBeenCalled();
    clearDraggedStudentIdStash();
  });

  it('does not call assignStudentToFurniture when target is a whiteboard (capacity 0)', () => {
    const sid = mkStudentId('alice');
    stashDraggedStudentId(sid);
    const assignStudentToFurniture = vi.fn();
    const wb = mkWhiteboard('wb1');

    const ctx = makeCtx(
      { assignStudentToFurniture },
      {
        cellAt: vi.fn(() => ({ x: 0, y: 0 })),
        furnitureAt: vi.fn(() => wb),
      },
    );

    const e = makeDragEvent({ [DRAG_STUDENT_ID_KEY]: 'alice' });
    StudentEditor.onDrop(e, ctx);

    expect(assignStudentToFurniture).not.toHaveBeenCalled();
    clearDraggedStudentIdStash();
  });

  it('does not call assignStudentToFurniture when no studentId in dataTransfer and stash is clear', () => {
    clearDraggedStudentIdStash();
    const assignStudentToFurniture = vi.fn();
    const desk = mkDesk('d1', 0, 0);

    const ctx = makeCtx(
      { assignStudentToFurniture },
      {
        cellAt: vi.fn(() => ({ x: 0, y: 0 })),
        furnitureAt: vi.fn(() => desk),
      },
    );

    const e = makeDragEvent({});
    StudentEditor.onDrop(e, ctx);

    expect(assignStudentToFurniture).not.toHaveBeenCalled();
  });

  it('store is a no-op when target is teacher_desk in the real store (classroom unchanged)', () => {
    resetStore();
    const alice = mkStudent('alice', 'Alice');
    const teacherDesk = mkTeacherDesk('td1');

    act(() => {
      usePijonStore.setState({
        classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [teacherDesk] },
        roster: [alice],
      });
    });

    const classroomBefore = usePijonStore.getState().classroom;
    act(() => {
      usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('td1'));
    });
    expect(usePijonStore.getState().classroom).toBe(classroomBefore);
  });

  it('store is a no-op for a desk with a fixture occupant (classroom unchanged)', () => {
    resetStore();
    // A whiteboard furniture with a fixture occupant is the "isFixture" path in the store
    const fixtureOccupant = { ...mkStudent('wb-fixture', 'Whiteboard'), isFixture: true };
    const wb = mkWhiteboard('wb1');
    const wbWithFixture: Furniture = { ...wb, occupants: [fixtureOccupant] };

    const alice = mkStudent('alice', 'Alice');

    act(() => {
      usePijonStore.setState({
        classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [wbWithFixture] },
        roster: [alice, fixtureOccupant],
      });
    });

    const classroomBefore = usePijonStore.getState().classroom;
    act(() => {
      // whiteboard has capacity 0, so assignStudentToFurniture is a no-op even
      // without the isFixture(f) check — the capacity guard fires first.
      usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('wb1'));
    });
    expect(usePijonStore.getState().classroom).toBe(classroomBefore);
  });
});

// ---------------------------------------------------------------------------
// Behaviour 5: history is pushed (undo works) and locks are cleared
// ---------------------------------------------------------------------------

describe('5.C1 behaviour 5 — history pushed and undo works after roster-drop', () => {
  beforeEach(() => { resetStore(); });

  it('pushes a history entry after seating', () => {
    const alice = mkStudent('alice', 'Alice');
    const desk = mkDesk('d1', 0, 0);
    const baseClassroom = { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk] };

    act(() => {
      usePijonStore.setState({
        classroom: baseClassroom,
        roster: [alice],
        history: [baseClassroom],
        historyPtr: 0,
      });
    });

    act(() => {
      usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));
    });

    expect(usePijonStore.getState().historyPtr).toBe(1);
    expect(usePijonStore.getState().history.length).toBe(2);
  });

  it('undo after roster-drop restores the empty desk', () => {
    const alice = mkStudent('alice', 'Alice');
    const desk = mkDesk('d1', 0, 0);
    const baseClassroom = { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk] };

    act(() => {
      usePijonStore.setState({
        classroom: baseClassroom,
        roster: [alice],
        history: [baseClassroom],
        historyPtr: 0,
      });
    });

    act(() => {
      usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));
    });
    act(() => {
      usePijonStore.getState().undo();
    });

    const d1 = usePijonStore.getState().classroom.furniture.find((f) => f.id === furnitureId('d1'));
    expect(d1?.occupants.length).toBe(0);
  });

  it('undo after swap restores both students to original desks', () => {
    const alice = mkStudent('alice', 'Alice');
    const bob = mkStudent('bob', 'Bob');
    const d1Base: Furniture = { ...mkDesk('d1', 0, 0), occupants: [alice] };
    const d2Base: Furniture = { ...mkDesk('d2', 1, 0), occupants: [bob] };
    const baseClassroom = { ...makeClassroom('c1', 'Room', 5, 5), furniture: [d1Base, d2Base] };

    act(() => {
      usePijonStore.setState({
        classroom: baseClassroom,
        roster: [alice, bob],
        history: [baseClassroom],
        historyPtr: 0,
      });
    });

    act(() => {
      usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d2'));
    });
    act(() => {
      usePijonStore.getState().undo();
    });

    const state = usePijonStore.getState();
    expect(state.classroom.furniture.find((f) => f.id === furnitureId('d1'))?.occupants[0]?.id)
      .toBe(mkStudentId('alice'));
    expect(state.classroom.furniture.find((f) => f.id === furnitureId('d2'))?.occupants[0]?.id)
      .toBe(mkStudentId('bob'));
  });

  it('clears the lock on the target desk after a roster-drop', () => {
    const alice = mkStudent('alice', 'Alice');
    const desk = mkDesk('d1', 0, 0);

    act(() => {
      usePijonStore.setState({
        classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk] },
        roster: [alice],
        locks: new Set([furnitureId('d1')]),
      });
    });

    act(() => {
      usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));
    });

    expect(usePijonStore.getState().locks.has(furnitureId('d1'))).toBe(false);
  });

  it('clears locks on both desks during a swap', () => {
    const alice = mkStudent('alice', 'Alice');
    const bob = mkStudent('bob', 'Bob');
    const d1: Furniture = { ...mkDesk('d1', 0, 0), occupants: [alice] };
    const d2: Furniture = { ...mkDesk('d2', 1, 0), occupants: [bob] };

    act(() => {
      usePijonStore.setState({
        classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [d1, d2] },
        roster: [alice, bob],
        locks: new Set([furnitureId('d1'), furnitureId('d2')]),
      });
    });

    act(() => {
      usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d2'));
    });

    expect(usePijonStore.getState().locks.has(furnitureId('d1'))).toBe(false);
    expect(usePijonStore.getState().locks.has(furnitureId('d2'))).toBe(false);
  });

  it('clears the lock on the old desk when moving a seated student', () => {
    const alice = mkStudent('alice', 'Alice');
    const d1: Furniture = { ...mkDesk('d1', 0, 0), occupants: [alice] };
    const d2 = mkDesk('d2', 1, 0);

    act(() => {
      usePijonStore.setState({
        classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [d1, d2] },
        roster: [alice],
        locks: new Set([furnitureId('d1')]),
      });
    });

    act(() => {
      usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d2'));
    });

    expect(usePijonStore.getState().locks.has(furnitureId('d1'))).toBe(false);
  });

  it('no history pushed on a no-op (capacity-0 target)', () => {
    const alice = mkStudent('alice', 'Alice');
    const teacherDesk = mkTeacherDesk('td1');

    act(() => {
      usePijonStore.setState({
        classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [teacherDesk] },
        roster: [alice],
        history: [],
        historyPtr: -1,
      });
    });

    act(() => {
      usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('td1'));
    });

    expect(usePijonStore.getState().history.length).toBe(0);
    expect(usePijonStore.getState().historyPtr).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Behaviour 6: no network — dataTransfer only (text/plain fallback)
// ---------------------------------------------------------------------------

describe('5.C1 behaviour 6 — dataTransfer only, no network; text/plain fallback', () => {
  it('reads studentId from the DRAG_STUDENT_ID_KEY key', () => {
    clearDraggedStudentIdStash();
    const e = makeDragEvent({ [DRAG_STUDENT_ID_KEY]: 'alice-net' });
    expect(readDraggedStudentId(e)).toBe('alice-net');
  });

  it('falls back to text/plain when DRAG_STUDENT_ID_KEY is absent', () => {
    clearDraggedStudentIdStash();
    const e = makeDragEvent({ 'text/plain': 'alice-plain' });
    expect(readDraggedStudentId(e)).toBe('alice-plain');
  });

  it('falls back to the module stash when both dataTransfer keys are empty (Firefox/Safari path)', () => {
    clearDraggedStudentIdStash();
    stashDraggedStudentId(mkStudentId('alice-stash'));
    const e = makeDragEvent({});
    expect(readDraggedStudentId(e)).toBe('alice-stash');
    clearDraggedStudentIdStash();
  });

  it('routes dataTransfer fallback through onDrop using text/plain only', () => {
    clearDraggedStudentIdStash();
    const assignStudentToFurniture = vi.fn();
    const desk = mkDesk('d1', 0, 0);
    const sid = mkStudentId('alice-fallback');

    const ctx = makeCtx(
      { assignStudentToFurniture },
      {
        cellAt: vi.fn(() => ({ x: 0, y: 0 })),
        furnitureAt: vi.fn(() => desk),
      },
    );

    // DRAG_STUDENT_ID_KEY absent — only text/plain
    const e = makeDragEvent({ 'text/plain': 'alice-fallback' });
    StudentEditor.onDrop(e, ctx);

    expect(assignStudentToFurniture).toHaveBeenCalledWith(sid, furnitureId('d1'));
  });

  it('stash is cleared by onDrop so subsequent drops cannot bleed', () => {
    const sid = mkStudentId('alice');
    stashDraggedStudentId(sid);

    const desk = mkDesk('d1', 0, 0);
    const ctx = makeCtx(
      { assignStudentToFurniture: vi.fn() },
      {
        cellAt: vi.fn(() => ({ x: 0, y: 0 })),
        furnitureAt: vi.fn(() => desk),
      },
    );

    const e = makeDragEvent({ [DRAG_STUDENT_ID_KEY]: 'alice' });
    StudentEditor.onDrop(e, ctx);

    // After the drop the stash must be null
    const subsequent = makeDragEvent({});
    expect(readDraggedStudentId(subsequent)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// onDrop calls e.preventDefault (drag accept)
// ---------------------------------------------------------------------------

describe('5.C1 onDrop API contract', () => {
  it('calls e.preventDefault() on every drop to accept it', () => {
    clearDraggedStudentIdStash();
    const ctx = makeCtx({}, { cellAt: vi.fn(() => undefined) });
    const e = makeDragEvent({});
    StudentEditor.onDrop(e, ctx);
    expect((e.preventDefault as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});
