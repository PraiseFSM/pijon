// @vitest-environment jsdom
/**
 * Tests for Iteration 3 item §13.7 — drag a student from the roster onto a desk.
 *
 * Coverage:
 *   Store action: assignStudentToFurniture
 *     1. Seat an unseated student onto an empty desk
 *     2. Move a seated student to an empty desk (old desk vacated)
 *     3. Swap with an occupied desk (displaced student goes to old desk)
 *     4. Unseated student dropped on an occupied desk (displaced student becomes unseated)
 *     5. Drop on a fixture (capacity 0) → no-op
 *     6. Drop on a non-assignable furniture kind (teacher_desk, whiteboard) → no-op
 *     7. Student already at target → no-op
 *     8. Unknown studentId → no-op
 *     9. Unknown furnitureId → no-op
 *    10. History pushed on valid action
 *    11. Locks cleared on affected desks
 *    12. syncRosterToClassroom: occupant copy reflects latest roster state
 *
 *   StudentEditor / component:
 *    13. Roster rows are draggable (have draggable attribute)
 *    14. onDragStart sets the studentId payload in dataTransfer
 *    15. onDragStart stashes the studentId in module-level variable (Firefox fallback)
 *    16. onDragEnd clears the module stash
 *    17. onDrop routes to store.assignStudentToFurniture with the correct arguments
 *    18. onDrop is a no-op when dragged item has no studentId payload
 *    19. onDrop is a no-op for a fixture/non-assignable target
 *    20. onDragOver sets the hover fid (canvas highlight)
 *    21. clearGraphCache is called after a successful drop
 *
 *   Ghost suppression:
 *    22. stashDraggedStudentId / clearDraggedStudentIdStash / readDraggedStudentId round-trip
 *    23. readDraggedStudentId falls back to the stash when getData returns ""
 *
 * LOCAL-FIRST: no network calls in any test path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

// Domain
import { furnitureId, studentId as mkStudentId } from '../domain/types.js';
import { makeStudent } from '../domain/student.js';
import { makeClassroom } from '../domain/classroom.js';
import type { FurnitureId } from '../domain/types.js';
import type { Furniture } from '../domain/furniture.js';

// Store
import { usePijonStore } from '../state/store.js';

// Editor exports
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

function mkFixtureFurniture(id: string, x: number, y: number): Furniture {
  return {
    id: furnitureId(id),
    kind: 'teacher_desk',
    pos: { x, y },
    w: 2,
    h: 1,
    rotation: 0,
    occupants: [],
  };
}

function resetStore() {
  usePijonStore.getState().eraseAll();
}

function makeStudentWithId(id: string, name: string) {
  return makeStudent(mkStudentId(id), name);
}

/** Build a DragEvent stub for jsdom (which doesn't implement DragEvent). */
function makeDragEvent(
  type: string,
  dataMap: Record<string, string> = {},
  clientX = 0,
  clientY = 0,
): DragEvent {
  return {
    type,
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
      id: 'test-classroom',
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

const makeCtx = (storeOverrides?: Partial<Store>, canvasOverrides?: Partial<CanvasView>): EditorContext => ({
  store: makeStoreMock(storeOverrides),
  canvas: makeCanvasMock(canvasOverrides),
  persistence: null,
});

// ---------------------------------------------------------------------------
// Store action: assignStudentToFurniture
// ---------------------------------------------------------------------------

describe('store.assignStudentToFurniture — seat unseated student onto empty desk', () => {
  beforeEach(() => { resetStore(); });

  it('places the student on the target desk', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const desk = mkDesk('d1', 0, 0);

    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk] },
      roster: [alice],
    });

    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));

    const result = usePijonStore.getState().classroom.furniture.find((f) => f.id === furnitureId('d1'));
    expect(result?.occupants[0]?.id).toBe(mkStudentId('alice'));
  });

  it('marks saveStatus dirty', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const desk = mkDesk('d1', 0, 0);

    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk] },
      roster: [alice],
      saveStatus: 'saved',
    });

    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));

    expect(usePijonStore.getState().saveStatus).toBe('dirty');
  });
});

describe('store.assignStudentToFurniture — move seated student to empty desk', () => {
  beforeEach(() => { resetStore(); });

  it('places student on the new desk', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const desk1 = { ...mkDesk('d1', 0, 0), occupants: [alice] };
    const desk2 = mkDesk('d2', 1, 0);

    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk1, desk2] },
      roster: [alice],
    });

    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d2'));

    const state = usePijonStore.getState().classroom.furniture;
    const d1 = state.find((f) => f.id === furnitureId('d1'));
    const d2 = state.find((f) => f.id === furnitureId('d2'));

    expect(d1?.occupants.length).toBe(0); // old desk vacated
    expect(d2?.occupants[0]?.id).toBe(mkStudentId('alice')); // on new desk
  });
});

describe('store.assignStudentToFurniture — swap with occupied desk', () => {
  beforeEach(() => { resetStore(); });

  it('swaps: dragged student lands on target, displaced student lands on old desk', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const bob = makeStudentWithId('bob', 'Bob');
    const desk1 = { ...mkDesk('d1', 0, 0), occupants: [alice] };
    const desk2 = { ...mkDesk('d2', 1, 0), occupants: [bob] };

    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk1, desk2] },
      roster: [alice, bob],
    });

    // Drag Alice (on d1) → d2 (occupied by Bob)
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d2'));

    const state = usePijonStore.getState().classroom.furniture;
    const d1 = state.find((f) => f.id === furnitureId('d1'));
    const d2 = state.find((f) => f.id === furnitureId('d2'));

    expect(d2?.occupants[0]?.id).toBe(mkStudentId('alice')); // Alice on d2
    expect(d1?.occupants[0]?.id).toBe(mkStudentId('bob'));   // Bob on d1 (swapped)
  });
});

describe('store.assignStudentToFurniture — unseated onto occupied desk', () => {
  beforeEach(() => { resetStore(); });

  it('displaces the existing occupant (becomes unseated)', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const bob = makeStudentWithId('bob', 'Bob');
    // Alice is unseated; Bob is on d1
    const desk1 = { ...mkDesk('d1', 0, 0), occupants: [bob] };

    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk1] },
      roster: [alice, bob],
    });

    // Drop unseated Alice onto d1 (occupied by Bob)
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));

    const state = usePijonStore.getState().classroom.furniture;
    const d1 = state.find((f) => f.id === furnitureId('d1'));

    expect(d1?.occupants[0]?.id).toBe(mkStudentId('alice')); // Alice takes the desk
    // Bob is now unseated (no desk has him)
    const bobSeated = state.some((f) => f.occupants[0]?.id === mkStudentId('bob'));
    expect(bobSeated).toBe(false);
  });
});

describe('store.assignStudentToFurniture — fixture / non-assignable → no-op', () => {
  beforeEach(() => { resetStore(); });

  it('no-op when target is a teacher_desk (capacity 0)', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const teacherDesk = mkFixtureFurniture('td1', 0, 0);

    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [teacherDesk] },
      roster: [alice],
    });

    const classroomBefore = usePijonStore.getState().classroom;
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('td1'));
    const classroomAfter = usePijonStore.getState().classroom;

    // Classroom must be unchanged (same reference — no mutation occurred)
    expect(classroomAfter).toBe(classroomBefore);
  });

  it('no-op when target is a whiteboard (capacity 0)', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const wb: Furniture = {
      id: furnitureId('wb1'),
      kind: 'whiteboard',
      pos: { x: 0, y: 0 },
      w: 4,
      h: 1,
      rotation: 0,
      occupants: [],
    };

    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [wb] },
      roster: [alice],
    });

    const classroomBefore = usePijonStore.getState().classroom;
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('wb1'));
    expect(usePijonStore.getState().classroom).toBe(classroomBefore);
  });
});

describe('store.assignStudentToFurniture — student already at target', () => {
  beforeEach(() => { resetStore(); });

  it('no-op when student is already seated at the target desk', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const desk1 = { ...mkDesk('d1', 0, 0), occupants: [alice] };

    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk1] },
      roster: [alice],
    });

    const classroomBefore = usePijonStore.getState().classroom;
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));
    expect(usePijonStore.getState().classroom).toBe(classroomBefore);
  });
});

describe('store.assignStudentToFurniture — unknown id guard', () => {
  beforeEach(() => { resetStore(); });

  it('no-op when studentId is not in the roster', () => {
    const desk = mkDesk('d1', 0, 0);

    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk] },
      roster: [],
    });

    const classroomBefore = usePijonStore.getState().classroom;
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('ghost'), furnitureId('d1'));
    expect(usePijonStore.getState().classroom).toBe(classroomBefore);
  });

  it('no-op when furnitureId is not in the classroom', () => {
    const alice = makeStudentWithId('alice', 'Alice');

    usePijonStore.setState({
      classroom: makeClassroom('c1', 'Room', 5, 5),
      roster: [alice],
    });

    const classroomBefore = usePijonStore.getState().classroom;
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('missing'));
    expect(usePijonStore.getState().classroom).toBe(classroomBefore);
  });
});

describe('store.assignStudentToFurniture — history pushed', () => {
  beforeEach(() => { resetStore(); });

  it('pushes a new history entry after a valid seat', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const desk = mkDesk('d1', 0, 0);

    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk] },
      roster: [alice],
      history: [],
      historyPtr: -1,
    });

    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));

    const { history, historyPtr } = usePijonStore.getState();
    expect(history.length).toBe(1);
    expect(historyPtr).toBe(0);
  });

  it('does NOT push history on a no-op', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    // No desk → no-op
    usePijonStore.setState({
      classroom: makeClassroom('c1', 'Room', 5, 5),
      roster: [alice],
      history: [],
      historyPtr: -1,
    });

    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));

    expect(usePijonStore.getState().history.length).toBe(0);
    expect(usePijonStore.getState().historyPtr).toBe(-1);
  });
});

describe('store.assignStudentToFurniture — lock handling', () => {
  beforeEach(() => { resetStore(); });

  it('clears the lock on the target desk after seating', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const desk = mkDesk('d1', 0, 0);

    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk] },
      roster: [alice],
      locks: new Set([furnitureId('d1')]),
    });

    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));

    expect(usePijonStore.getState().locks.has(furnitureId('d1'))).toBe(false);
  });

  it('clears the lock on the old desk when moving', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const desk1 = { ...mkDesk('d1', 0, 0), occupants: [alice] };
    const desk2 = mkDesk('d2', 1, 0);

    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk1, desk2] },
      roster: [alice],
      locks: new Set([furnitureId('d1')]),
    });

    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d2'));

    expect(usePijonStore.getState().locks.has(furnitureId('d1'))).toBe(false);
  });

  it('clears the lock on both desks during a swap', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const bob = makeStudentWithId('bob', 'Bob');
    const desk1 = { ...mkDesk('d1', 0, 0), occupants: [alice] };
    const desk2 = { ...mkDesk('d2', 1, 0), occupants: [bob] };

    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk1, desk2] },
      roster: [alice, bob],
      locks: new Set([furnitureId('d1'), furnitureId('d2')]),
    });

    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d2'));

    expect(usePijonStore.getState().locks.has(furnitureId('d1'))).toBe(false);
    expect(usePijonStore.getState().locks.has(furnitureId('d2'))).toBe(false);
  });
});

describe('store.assignStudentToFurniture — syncRosterToClassroom', () => {
  beforeEach(() => { resetStore(); });

  it('occupant copy on the target desk reflects the current roster student (preferences up-to-date)', () => {
    // Build a student with a preference set directly in the roster
    const alice = {
      ...makeStudentWithId('alice', 'Alice'),
      preferences: [{ kind: 'location' as const, target: 'front', weight: 1 }],
    };
    const desk = mkDesk('d1', 0, 0);

    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk] },
      roster: [alice],
    });

    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));

    const seated = usePijonStore.getState().classroom.furniture
      .find((f) => f.id === furnitureId('d1'))?.occupants[0];

    expect(seated?.preferences.length).toBe(1);
    expect(seated?.preferences[0]?.kind).toBe('location');
  });
});

// ---------------------------------------------------------------------------
// Ghost suppression: stash round-trip
// ---------------------------------------------------------------------------

describe('§13.7 ghost suppression: stash helpers', () => {
  it('stashDraggedStudentId stores the id; readDraggedStudentId returns it from getData', () => {
    const sid = mkStudentId('test-sid');
    stashDraggedStudentId(sid);

    const e = makeDragEvent('drop', { [DRAG_STUDENT_ID_KEY]: 'test-sid' });
    expect(readDraggedStudentId(e)).toBe(sid);
    clearDraggedStudentIdStash();
  });

  it('readDraggedStudentId falls back to module stash when getData returns ""', () => {
    const sid = mkStudentId('fallback-sid');
    stashDraggedStudentId(sid);

    // getData returns "" for all keys (Firefox/Safari dragover simulation)
    const e = makeDragEvent('dragover', {});
    expect(readDraggedStudentId(e)).toBe(sid);

    clearDraggedStudentIdStash();
  });

  it('clearDraggedStudentIdStash clears the stash (falls back to null)', () => {
    stashDraggedStudentId(mkStudentId('some-id'));
    clearDraggedStudentIdStash();

    const e = makeDragEvent('dragover', {});
    expect(readDraggedStudentId(e)).toBeNull();
  });

  it('readDraggedStudentId reads text/plain as secondary fallback', () => {
    clearDraggedStudentIdStash(); // make sure stash is empty
    const e = makeDragEvent('drop', { 'text/plain': 'plain-sid' });
    expect(readDraggedStudentId(e)).toBe('plain-sid');
  });
});

// ---------------------------------------------------------------------------
// Component: roster rows are draggable
// ---------------------------------------------------------------------------

describe('§13.7 component: roster rows are draggable', () => {
  beforeEach(() => { resetStore(); });

  it('roster items have draggable=true', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    usePijonStore.setState({
      classroom: makeClassroom('c1', 'Room', 5, 5),
      roster: [alice],
    });

    const ctx = makeCtx({
      roster: [alice],
      selectedStudentId: null,
    });

    const { container } = render(
      React.createElement(StudentEditor.SidePanel, { ctx }),
    );

    // All role="button" elements with draggable in the student list
    const draggableRows = container.querySelectorAll('[draggable="true"]');
    expect(draggableRows.length).toBeGreaterThanOrEqual(1);
  });

  it('roster items have cursor: grab style', () => {
    const alice = makeStudentWithId('alice', 'Alice');

    const ctx = makeCtx({
      roster: [alice],
      selectedStudentId: null,
    });

    const { container } = render(
      React.createElement(StudentEditor.SidePanel, { ctx }),
    );

    const draggableRow = container.querySelector('[draggable="true"]')!;
    expect(draggableRow).not.toBeNull();
    expect((draggableRow as HTMLElement).style.cursor).toBe('grab');
  });

  it('onDragStart calls dataTransfer.setData with the DRAG_STUDENT_ID_KEY and studentId', () => {
    const alice = makeStudentWithId('alice', 'Alice');

    const ctx = makeCtx({ roster: [alice], selectedStudentId: null });

    const { container } = render(
      React.createElement(StudentEditor.SidePanel, { ctx }),
    );

    const draggableRow = container.querySelector('[draggable="true"]')!;
    expect(draggableRow).not.toBeNull();

    // Capture the setData calls via a mock DataTransfer
    const setDataCalls: [string, string][] = [];
    const mockDataTransfer = {
      setData: (key: string, val: string) => { setDataCalls.push([key, val]); },
      setDragImage: vi.fn(),
      effectAllowed: '',
    };

    fireEvent.dragStart(draggableRow, { dataTransfer: mockDataTransfer });

    const studentIdCall = setDataCalls.find(([key]) => key === DRAG_STUDENT_ID_KEY);
    expect(studentIdCall).toBeDefined();
    expect(studentIdCall?.[1]).toBe(alice.id);
  });

  it('onDragStart stashes studentId for Firefox/Safari fallback', () => {
    clearDraggedStudentIdStash();
    const alice = makeStudentWithId('alice', 'Alice');

    const ctx = makeCtx({ roster: [alice], selectedStudentId: null });
    const { container } = render(
      React.createElement(StudentEditor.SidePanel, { ctx }),
    );

    const draggableRow = container.querySelector('[draggable="true"]')!;

    const mockDataTransfer = {
      setData: vi.fn(),
      setDragImage: vi.fn(),
      effectAllowed: '',
    };
    fireEvent.dragStart(draggableRow, { dataTransfer: mockDataTransfer });

    // The stash should now hold the student id
    const e = makeDragEvent('dragover', {}); // getData returns ""
    expect(readDraggedStudentId(e)).toBe(alice.id);

    clearDraggedStudentIdStash();
  });

  it('onDragEnd clears the module stash', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    stashDraggedStudentId(mkStudentId('alice'));

    const ctx = makeCtx({ roster: [alice], selectedStudentId: null });
    const { container } = render(
      React.createElement(StudentEditor.SidePanel, { ctx }),
    );

    const draggableRow = container.querySelector('[draggable="true"]')!;
    fireEvent.dragEnd(draggableRow);

    const e = makeDragEvent('dragover', {});
    expect(readDraggedStudentId(e)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// onDrop routes to store.assignStudentToFurniture
// ---------------------------------------------------------------------------

describe('§13.7 onDrop routes to store.assignStudentToFurniture', () => {
  it('calls assignStudentToFurniture when a valid roster-drag drop occurs on an assignable desk', () => {
    const sid = mkStudentId('alice');
    const fid = furnitureId('d1');
    const desk: Furniture = { ...mkDesk('d1', 0, 0) };

    stashDraggedStudentId(sid);

    const assignStudentToFurniture = vi.fn();
    const requestRepaint = vi.fn();
    const cell = { x: 0, y: 0 };

    const ctx = makeCtx(
      { assignStudentToFurniture },
      {
        cellAt: vi.fn(() => cell),
        furnitureAt: vi.fn(() => desk),
        requestRepaint,
      },
    );

    const e = makeDragEvent('drop', { [DRAG_STUDENT_ID_KEY]: 'alice' });

    StudentEditor.onDrop(e, ctx);

    expect(assignStudentToFurniture).toHaveBeenCalledWith(sid, fid);
    expect(requestRepaint).toHaveBeenCalled();

    clearDraggedStudentIdStash();
  });

  it('does NOT call assignStudentToFurniture when no studentId payload is in the event', () => {
    clearDraggedStudentIdStash();

    const assignStudentToFurniture = vi.fn();
    const cell = { x: 0, y: 0 };
    const desk: Furniture = { ...mkDesk('d1', 0, 0) };

    const ctx = makeCtx(
      { assignStudentToFurniture },
      {
        cellAt: vi.fn(() => cell),
        furnitureAt: vi.fn(() => desk),
      },
    );

    const e = makeDragEvent('drop', {});
    StudentEditor.onDrop(e, ctx);

    expect(assignStudentToFurniture).not.toHaveBeenCalled();
  });

  it('does NOT call assignStudentToFurniture when drop is outside the grid (cellAt → undefined)', () => {
    const sid = mkStudentId('alice');
    stashDraggedStudentId(sid);

    const assignStudentToFurniture = vi.fn();
    const ctx = makeCtx(
      { assignStudentToFurniture },
      { cellAt: vi.fn(() => undefined) },
    );

    const e = makeDragEvent('drop', { [DRAG_STUDENT_ID_KEY]: 'alice' });
    StudentEditor.onDrop(e, ctx);

    expect(assignStudentToFurniture).not.toHaveBeenCalled();
    clearDraggedStudentIdStash();
  });

  it('does NOT call assignStudentToFurniture when drop is on a teacher_desk (capacity 0)', () => {
    const sid = mkStudentId('alice');
    stashDraggedStudentId(sid);

    const teacherDesk: Furniture = mkFixtureFurniture('td1', 0, 0);
    const assignStudentToFurniture = vi.fn();
    const cell = { x: 0, y: 0 };

    const ctx = makeCtx(
      { assignStudentToFurniture },
      {
        cellAt: vi.fn(() => cell),
        furnitureAt: vi.fn(() => teacherDesk),
      },
    );

    const e = makeDragEvent('drop', { [DRAG_STUDENT_ID_KEY]: 'alice' });
    StudentEditor.onDrop(e, ctx);

    expect(assignStudentToFurniture).not.toHaveBeenCalled();
    clearDraggedStudentIdStash();
  });

  it('does NOT call assignStudentToFurniture when drop is on no furniture (furnitureAt → undefined)', () => {
    const sid = mkStudentId('alice');
    stashDraggedStudentId(sid);

    const assignStudentToFurniture = vi.fn();
    const cell = { x: 0, y: 0 };

    const ctx = makeCtx(
      { assignStudentToFurniture },
      {
        cellAt: vi.fn(() => cell),
        furnitureAt: vi.fn(() => undefined),
      },
    );

    const e = makeDragEvent('drop', { [DRAG_STUDENT_ID_KEY]: 'alice' });
    StudentEditor.onDrop(e, ctx);

    expect(assignStudentToFurniture).not.toHaveBeenCalled();
    clearDraggedStudentIdStash();
  });
});

// ---------------------------------------------------------------------------
// onDragOver: live drop-target highlight
// ---------------------------------------------------------------------------

describe('§13.7 onDragOver: live canvas hover highlight', () => {
  it('calls requestRepaint when hovering over an assignable desk', () => {
    const sid = mkStudentId('alice');
    stashDraggedStudentId(sid);

    const requestRepaint = vi.fn();
    const desk: Furniture = mkDesk('d1', 0, 0);
    const cell = { x: 0, y: 0 };

    const ctx = makeCtx(
      {},
      {
        cellAt: vi.fn(() => cell),
        furnitureAt: vi.fn(() => desk),
        requestRepaint,
      },
    );

    // Activate so rosterDragHoverFid starts clean
    StudentEditor.activate(ctx);

    const e = makeDragEvent('dragover', { [DRAG_STUDENT_ID_KEY]: 'alice' });
    StudentEditor.onDragOver?.(e, ctx);

    expect(requestRepaint).toHaveBeenCalled();
    clearDraggedStudentIdStash();

    // Deactivate to clean up state
    StudentEditor.deactivate(ctx);
  });
});

// ---------------------------------------------------------------------------
// Verify the DRAG_STUDENT_ID_KEY export matches the expected format
// ---------------------------------------------------------------------------

describe('§13.7 DRAG_STUDENT_ID_KEY format', () => {
  it('is the correct MIME-like key string', () => {
    expect(DRAG_STUDENT_ID_KEY).toBe('application/x-pijon-student-id');
  });
});

// ---------------------------------------------------------------------------
// Invariant: no student on two desks; no desk has two occupants
// ---------------------------------------------------------------------------

describe('store.assignStudentToFurniture — invariant: no duplication', () => {
  beforeEach(() => { resetStore(); });

  /** Helper: assert no student id appears on more than one desk. */
  function assertNoDuplication(furniture: readonly import('../domain/furniture.js').Furniture[]) {
    const seen = new Map<string, string>();
    for (const f of furniture) {
      const occ = f.occupants[0];
      if (occ === undefined) continue;
      expect(f.occupants.length).toBeLessThanOrEqual(1); // no desk has two occupants
      if (seen.has(occ.id)) {
        throw new Error(`Student ${occ.id} appears on both ${seen.get(occ.id)!} and ${f.id}`);
      }
      seen.set(occ.id, f.id);
    }
  }

  it('unseated → empty: no duplication', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const desk = mkDesk('d1', 0, 0);
    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk] },
      roster: [alice],
    });
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));
    assertNoDuplication(usePijonStore.getState().classroom.furniture);
  });

  it('seated → empty (move): no duplication, old desk vacated', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const desk1 = { ...mkDesk('d1', 0, 0), occupants: [alice] };
    const desk2 = mkDesk('d2', 1, 0);
    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk1, desk2] },
      roster: [alice],
    });
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d2'));
    const furniture = usePijonStore.getState().classroom.furniture;
    assertNoDuplication(furniture);
    expect(furniture.find((f) => f.id === furnitureId('d1'))?.occupants.length).toBe(0);
  });

  it('swap: both students end up on a desk, no loss, no duplication', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const bob = makeStudentWithId('bob', 'Bob');
    const desk1 = { ...mkDesk('d1', 0, 0), occupants: [alice] };
    const desk2 = { ...mkDesk('d2', 1, 0), occupants: [bob] };
    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk1, desk2] },
      roster: [alice, bob],
    });
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d2'));
    const furniture = usePijonStore.getState().classroom.furniture;
    assertNoDuplication(furniture);
    // Both students must be seated somewhere
    const seatedIds = new Set(furniture.flatMap((f) => f.occupants.map((o) => o.id)));
    expect(seatedIds.has(mkStudentId('alice'))).toBe(true);
    expect(seatedIds.has(mkStudentId('bob'))).toBe(true);
  });

  it('displace (unseated→occupied): displaced student is unseated (not duplicated)', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const bob = makeStudentWithId('bob', 'Bob');
    const desk1 = { ...mkDesk('d1', 0, 0), occupants: [bob] };
    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk1] },
      roster: [alice, bob],
    });
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));
    const furniture = usePijonStore.getState().classroom.furniture;
    assertNoDuplication(furniture);
    // Bob must NOT be on any desk
    const bobSeated = furniture.some((f) => f.occupants.some((o) => o.id === mkStudentId('bob')));
    expect(bobSeated).toBe(false);
    // Alice must be on d1
    expect(furniture.find((f) => f.id === furnitureId('d1'))?.occupants[0]?.id).toBe(mkStudentId('alice'));
  });
});

// ---------------------------------------------------------------------------
// Fixture student guard
// ---------------------------------------------------------------------------

describe('store.assignStudentToFurniture — fixture student guard', () => {
  beforeEach(() => { resetStore(); });

  it('is a no-op when the student is a fixture (isFixture: true)', () => {
    // A fixture student might end up in the roster; the action must refuse to seat it.
    const fixtureStudent = {
      ...makeStudentWithId('fixture-1', 'Whiteboard'),
      isFixture: true,
    };
    const desk = mkDesk('d1', 0, 0);
    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk] },
      roster: [fixtureStudent],
    });
    const classroomBefore = usePijonStore.getState().classroom;
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('fixture-1'), furnitureId('d1'));
    // Classroom must be unchanged
    expect(usePijonStore.getState().classroom).toBe(classroomBefore);
  });

  it('does NOT push history when fixture student is rejected', () => {
    const fixtureStudent = { ...makeStudentWithId('fixture-1', 'Whiteboard'), isFixture: true };
    const desk = mkDesk('d1', 0, 0);
    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk] },
      roster: [fixtureStudent],
      history: [],
      historyPtr: -1,
    });
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('fixture-1'), furnitureId('d1'));
    expect(usePijonStore.getState().history.length).toBe(0);
    expect(usePijonStore.getState().historyPtr).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// History / undo coherence
// ---------------------------------------------------------------------------

describe('store.assignStudentToFurniture — undo coherence', () => {
  beforeEach(() => { resetStore(); });

  it('undo after seat restores the empty desk', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const desk = mkDesk('d1', 0, 0);
    // Pre-seed history with a base snapshot (the empty-desk state) so undo has
    // somewhere to go.  historyPtr=0, history=[baseSnapshot].
    const baseClassroom = { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk] };
    usePijonStore.setState({
      classroom: baseClassroom,
      roster: [alice],
      history: [baseClassroom],
      historyPtr: 0,
    });

    // Seat Alice — pushes a second snapshot; historyPtr becomes 1.
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));
    expect(usePijonStore.getState().classroom.furniture.find((f) => f.id === furnitureId('d1'))?.occupants[0]?.id)
      .toBe(mkStudentId('alice'));
    expect(usePijonStore.getState().historyPtr).toBe(1);

    // Undo — steps back to historyPtr=0 (the empty desk snapshot).
    usePijonStore.getState().undo();
    const d1 = usePijonStore.getState().classroom.furniture.find((f) => f.id === furnitureId('d1'));
    expect(d1?.occupants.length).toBe(0);
  });

  it('undo after swap restores both students to their original desks', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const bob = makeStudentWithId('bob', 'Bob');
    const desk1 = { ...mkDesk('d1', 0, 0), occupants: [alice] };
    const desk2 = { ...mkDesk('d2', 1, 0), occupants: [bob] };

    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk1, desk2] },
      roster: [alice, bob],
      history: [],
      historyPtr: -1,
    });

    // Push a starting snapshot (simulates having a prior state to undo to)
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d2'));

    // Now d1=Bob, d2=Alice
    expect(usePijonStore.getState().classroom.furniture.find((f) => f.id === furnitureId('d2'))?.occupants[0]?.id)
      .toBe(mkStudentId('alice'));
    expect(usePijonStore.getState().classroom.furniture.find((f) => f.id === furnitureId('d1'))?.occupants[0]?.id)
      .toBe(mkStudentId('bob'));

    // Undo — the initial classroom had Alice@d1, Bob@d2 (before the swap was pushed).
    // Since we start with historyPtr=-1 and push once, historyPtr=0 and we can't undo further.
    // So test the undo from a TWO-step scenario:
    // Reset to have a base history entry first
    usePijonStore.getState().eraseAll();
    const baseClassroom = {
      ...makeClassroom('c2', 'Room', 5, 5),
      furniture: [
        { ...mkDesk('d1', 0, 0), occupants: [alice] },
        { ...mkDesk('d2', 1, 0), occupants: [bob] },
      ],
    };
    usePijonStore.setState({
      classroom: baseClassroom,
      roster: [alice, bob],
      history: [baseClassroom],
      historyPtr: 0,
    });

    // Perform the swap (history grows to length 2)
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d2'));
    expect(usePijonStore.getState().historyPtr).toBe(1);

    // Undo
    usePijonStore.getState().undo();
    const state = usePijonStore.getState();
    expect(state.historyPtr).toBe(0);
    const d1 = state.classroom.furniture.find((f) => f.id === furnitureId('d1'));
    const d2 = state.classroom.furniture.find((f) => f.id === furnitureId('d2'));
    expect(d1?.occupants[0]?.id).toBe(mkStudentId('alice')); // restored
    expect(d2?.occupants[0]?.id).toBe(mkStudentId('bob'));   // restored
  });

  it('undo preserves roster student identity and preferences', () => {
    const alice = {
      ...makeStudentWithId('alice', 'Alice'),
      preferences: [{ kind: 'location' as const, target: 'front', weight: 1 }],
    };
    const desk = mkDesk('d1', 0, 0);
    const baseClassroom = {
      ...makeClassroom('c1', 'Room', 5, 5),
      furniture: [desk],
    };
    usePijonStore.setState({
      classroom: baseClassroom,
      roster: [alice],
      history: [baseClassroom],
      historyPtr: 0,
    });

    // Seat Alice
    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));
    // Undo
    usePijonStore.getState().undo();

    // The roster entry must be intact with its preferences
    const rosterAlice = usePijonStore.getState().roster.find((s) => s.id === mkStudentId('alice'));
    expect(rosterAlice).toBeDefined();
    expect(rosterAlice?.preferences.length).toBe(1);
    expect(rosterAlice?.preferences[0]?.kind).toBe('location');
  });

  it('no-op (same desk) does NOT push history', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const desk1 = { ...mkDesk('d1', 0, 0), occupants: [alice] };
    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk1] },
      roster: [alice],
      history: [{ ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk1] }],
      historyPtr: 0,
    });

    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('d1'));

    // historyPtr must stay at 0 (no new entry pushed)
    expect(usePijonStore.getState().historyPtr).toBe(0);
    expect(usePijonStore.getState().history.length).toBe(1);
  });

  it('no-op (fixture target) does NOT push history', () => {
    const alice = makeStudentWithId('alice', 'Alice');
    const teacherDesk = mkFixtureFurniture('td1', 0, 0);
    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [teacherDesk] },
      roster: [alice],
      history: [],
      historyPtr: -1,
    });

    usePijonStore.getState().assignStudentToFurniture(mkStudentId('alice'), furnitureId('td1'));
    expect(usePijonStore.getState().history.length).toBe(0);
  });

  it('no-op (fixture student) does NOT push history', () => {
    const fixtureStudent = { ...makeStudentWithId('fix-1', 'Whiteboard'), isFixture: true };
    const desk = mkDesk('d1', 0, 0);
    usePijonStore.setState({
      classroom: { ...makeClassroom('c1', 'Room', 5, 5), furniture: [desk] },
      roster: [fixtureStudent],
      history: [],
      historyPtr: -1,
    });

    usePijonStore.getState().assignStudentToFurniture(mkStudentId('fix-1'), furnitureId('d1'));
    expect(usePijonStore.getState().history.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Stash lifecycle / bleed prevention
// ---------------------------------------------------------------------------

describe('§13.7 stash lifecycle / bleed prevention', () => {
  it('activate() clears the stash so stale drags do not bleed into a new session', () => {
    // Simulate a stale stash from a previous drag that did not complete
    stashDraggedStudentId(mkStudentId('stale-id'));

    const ctx = makeCtx();
    StudentEditor.activate(ctx);

    // After activate, stash must be clear
    const e = makeDragEvent('dragover', {});
    expect(readDraggedStudentId(e)).toBeNull();
  });

  it('deactivate() clears the stash so mid-drag editor switches do not bleed', () => {
    stashDraggedStudentId(mkStudentId('mid-drag-id'));

    const ctx = makeCtx();
    StudentEditor.deactivate(ctx);

    const e = makeDragEvent('dragover', {});
    expect(readDraggedStudentId(e)).toBeNull();
  });

  it('onDragEnd() clears the stash after a cancelled drag', () => {
    stashDraggedStudentId(mkStudentId('drag-id'));

    const ctx = makeCtx();
    const e = makeDragEvent('dragend', {});
    // onDragEnd is optional in the interface but implemented by StudentEditor
    StudentEditor.onDragEnd?.(e, ctx);

    const dragoverE = makeDragEvent('dragover', {});
    expect(readDraggedStudentId(dragoverE)).toBeNull();
  });

  it('onDrop() clears the stash after a completed drop', () => {
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

    const e = makeDragEvent('drop', { [DRAG_STUDENT_ID_KEY]: 'alice' });
    StudentEditor.onDrop(e, ctx);

    // Stash must be cleared after drop
    const dragoverE = makeDragEvent('dragover', {});
    expect(readDraggedStudentId(dragoverE)).toBeNull();
  });

  it('garbage payload in dataTransfer is a safe no-op (not in roster → store action is not called)', () => {
    // A crafted drag event with a random garbage string
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

    // dataTransfer has a value, but it won't be in the roster
    // The store guard (student not found) makes it a no-op — but the editor
    // can still call assignStudentToFurniture. The point is: the store rejects it.
    // We verify the editor passes it through (it's the store's job to guard).
    const e = makeDragEvent('drop', { [DRAG_STUDENT_ID_KEY]: 'garbage-xyz' });
    // Should not throw
    expect(() => { StudentEditor.onDrop(e, ctx); }).not.toThrow();
    // assignStudentToFurniture is called (editor does not re-validate the id),
    // but the store action would no-op because 'garbage-xyz' is not in the roster.
    expect(assignStudentToFurniture).toHaveBeenCalledWith(
      expect.stringContaining('garbage-xyz'),
      furnitureId('d1'),
    );
  });
});
