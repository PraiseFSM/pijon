// @vitest-environment jsdom
/**
 * Iteration 13 Cluster A — Assigner accepts fixture-occupied desks (§13.A2).
 *
 * Tests:
 *   - clicking a real student then a whiteboard fixture creates the preference
 *   - clicking a whiteboard fixture then a real student creates the preference (reverse order)
 *   - clicking two fixtures is a no-op (fixture↔fixture guard)
 *   - first-click amber-ring feedback works for fixture-occupied desks
 *   - clicking an empty (no occupant) furniture is still a no-op
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { StudentEditor } from '../ui/editors/StudentEditor.js';
import type { EditorContext, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import type { FurnitureId } from '../domain/types.js';
import { studentId as mkStudentId, furnitureId as mkFurnitureId } from '../domain/types.js';
import { makeStudent, makeFixture } from '../domain/student.js';
import { fixtureId } from '../domain/classroom.js';
import { DEFAULT_CELLS_PER_UNIT, DEFAULT_THRESHOLD_UNITS } from '../domain/classroom.js';
import type { Furniture } from '../domain/furniture.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeStoreMock = (overrides?: Partial<Store>): Store =>
  ({
    roster: [],
    locks: new Set<FurnitureId>(),
    selectedStudentId: null,
    classroom: {
      id: 'test-classroom',
      name: 'Test',
      gridW: 10,
      gridH: 8,
      furniture: [],
      cellsPerUnit: DEFAULT_CELLS_PER_UNIT,
      thresholdUnits: DEFAULT_THRESHOLD_UNITS,
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

const makeCanvasMock = (): CanvasView => ({
  cellSize: 48,
  gridW: 10,
  gridH: 8,
  originOffset: 0,
  cellAt: vi.fn(() => undefined),
  furnitureAt: vi.fn(() => undefined),
  cellRect: vi.fn(() => ({ x: 0, y: 0, w: 48, h: 48 })),
  requestRepaint: vi.fn(),
});

function makeCtx(storeOverrides?: Partial<Store>): EditorContext {
  return {
    store: makeStoreMock(storeOverrides),
    canvas: makeCanvasMock(),
    persistence: null,
  };
}

// Build students and furniture
const alice = makeStudent(mkStudentId('alice-a13'), 'Alice');
const bob = makeStudent(mkStudentId('bob-a13'), 'Bob');

// Whiteboard with fixture occupant
const wbFid = mkFurnitureId('wb-assigner13');
const fixName = 'Whiteboard';
const wbFix = makeFixture(fixtureId(`${fixName}:${wbFid}`), fixName);

const deskAliceFid = mkFurnitureId('desk-alice13');
const deskBobFid = mkFurnitureId('desk-bob13');

const aliceDesk: Furniture = {
  id: deskAliceFid,
  kind: 'single_desk',
  pos: { x: 0, y: 0 },
  w: 1,
  h: 1,
  rotation: 0,
  occupants: [alice],
};

const bobDesk: Furniture = {
  id: deskBobFid,
  kind: 'single_desk',
  pos: { x: 1, y: 0 },
  w: 1,
  h: 1,
  rotation: 0,
  occupants: [bob],
};

// Whiteboard at row 2 col 0 (4 wide)
const wbFurniture: Furniture = {
  id: wbFid,
  kind: 'whiteboard',
  pos: { x: 0, y: 2 },
  w: 4,
  h: 1,
  rotation: 0,
  occupants: [wbFix],
};

// Empty whiteboard (no occupant)
const emptyWbFid = mkFurnitureId('wb-empty13');
const emptyWb: Furniture = {
  id: emptyWbFid,
  kind: 'whiteboard',
  pos: { x: 5, y: 2 },
  w: 4,
  h: 1,
  rotation: 0,
  occupants: [],
};

// Two fixture-occupied pieces for fixture↔fixture test
const fix1Fid = mkFurnitureId('td-fix13-1');
const fix1Name = "Teacher's Desk";
const fix1 = makeFixture(fixtureId(`${fix1Name}:${fix1Fid}`), fix1Name);
const teacherDeskF1: Furniture = {
  id: fix1Fid,
  kind: 'teacher_desk',
  pos: { x: 0, y: 5 },
  w: 2,
  h: 2,
  rotation: 0,
  occupants: [fix1],
};

const fix2Fid = mkFurnitureId('wb-fix13-2');
const fix2Name = 'Whiteboard';
const fix2 = makeFixture(fixtureId(`${fix2Name}:${fix2Fid}`), fix2Name);
const wbF2: Furniture = {
  id: fix2Fid,
  kind: 'whiteboard',
  pos: { x: 3, y: 5 },
  w: 4,
  h: 1,
  rotation: 0,
  occupants: [fix2],
};

const classroom = {
  id: 'test-classroom',
  name: 'Test',
  gridW: 10,
  gridH: 8,
  furniture: [aliceDesk, bobDesk, wbFurniture, emptyWb, teacherDeskF1, wbF2],
  cellsPerUnit: DEFAULT_CELLS_PER_UNIT,
  thresholdUnits: DEFAULT_THRESHOLD_UNITS,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('13.A2 assigner accepts fixture-occupied desks', () => {
  afterEach(() => {
    StudentEditor.deactivate(makeCtx());
  });

  it('real student → fixture: setMutualPreference is called with correct ids', () => {
    const ctx = makeCtx({
      classroom,
      roster: [alice, bob, wbFix],
    });
    StudentEditor.activate(ctx);

    // Render toolbar and enable assigner mode
    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    // Click 1: Alice desk at (0,0)
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0, y: 0 });
    act(() => {
      StudentEditor.onPointerDown(new PointerEvent('pointerdown', { button: 0, bubbles: true }), ctx);
    });

    // Click 2: whiteboard at (0,2)
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0, y: 2 });
    act(() => {
      StudentEditor.onPointerDown(new PointerEvent('pointerdown', { button: 0, bubbles: true }), ctx);
    });

    expect(ctx.store.setMutualPreference).toHaveBeenCalledWith(alice.id, wbFix.id, expect.any(Number));

    StudentEditor.deactivate(ctx);
  });

  it('fixture → real student: setMutualPreference is called with correct ids (reverse order)', () => {
    const ctx = makeCtx({
      classroom,
      roster: [alice, bob, wbFix],
    });
    StudentEditor.activate(ctx);

    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    // Click 1: whiteboard at (0,2)
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0, y: 2 });
    act(() => {
      StudentEditor.onPointerDown(new PointerEvent('pointerdown', { button: 0, bubbles: true }), ctx);
    });

    // Click 2: Alice desk at (0,0)
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0, y: 0 });
    act(() => {
      StudentEditor.onPointerDown(new PointerEvent('pointerdown', { button: 0, bubbles: true }), ctx);
    });

    expect(ctx.store.setMutualPreference).toHaveBeenCalledWith(wbFix.id, alice.id, expect.any(Number));

    StudentEditor.deactivate(ctx);
  });

  it('fixture↔fixture: setMutualPreference is NOT called (no-op)', () => {
    const ctx = makeCtx({
      classroom,
      roster: [fix1, fix2],
    });
    StudentEditor.activate(ctx);

    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    // Click 1: teacher_desk at (0,5) — fix1
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0, y: 5 });
    act(() => {
      StudentEditor.onPointerDown(new PointerEvent('pointerdown', { button: 0, bubbles: true }), ctx);
    });

    // Click 2: whiteboard at (3,5) — fix2
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 3, y: 5 });
    act(() => {
      StudentEditor.onPointerDown(new PointerEvent('pointerdown', { button: 0, bubbles: true }), ctx);
    });

    // fixture↔fixture must not call setMutualPreference
    expect(ctx.store.setMutualPreference).not.toHaveBeenCalled();

    StudentEditor.deactivate(ctx);
  });

  it('empty whiteboard (no occupant) is not a valid assigner target', () => {
    const ctx = makeCtx({
      classroom,
      roster: [alice],
    });
    StudentEditor.activate(ctx);

    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    // Click 1: Alice desk at (0,0)
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0, y: 0 });
    act(() => {
      StudentEditor.onPointerDown(new PointerEvent('pointerdown', { button: 0, bubbles: true }), ctx);
    });

    // Click 2: empty whiteboard at (5,2) — should be a no-op (no occupant)
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 5, y: 2 });
    act(() => {
      StudentEditor.onPointerDown(new PointerEvent('pointerdown', { button: 0, bubbles: true }), ctx);
    });

    // No preference set
    expect(ctx.store.setMutualPreference).not.toHaveBeenCalled();

    StudentEditor.deactivate(ctx);
  });

  it('first-click on fixture-occupied whiteboard requests repaint (amber ring feedback)', () => {
    const ctx = makeCtx({
      classroom,
      roster: [alice, wbFix],
    });
    StudentEditor.activate(ctx);

    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    const repaintSpy = ctx.canvas.requestRepaint as ReturnType<typeof vi.fn>;
    repaintSpy.mockClear();

    // Click on the whiteboard as first click (fixture selected)
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0, y: 2 });
    act(() => {
      StudentEditor.onPointerDown(new PointerEvent('pointerdown', { button: 0, bubbles: true }), ctx);
    });

    // Repaint must have been requested (amber ring for first selection)
    expect(repaintSpy).toHaveBeenCalled();

    StudentEditor.deactivate(ctx);
  });

  it('first-click on real student desk in assigner mode shows amber ring (regression guard)', () => {
    const ctx = makeCtx({
      classroom,
      roster: [alice],
    });
    StudentEditor.activate(ctx);

    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    const repaintSpy = ctx.canvas.requestRepaint as ReturnType<typeof vi.fn>;
    repaintSpy.mockClear();

    // Click Alice desk at (0,0)
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0, y: 0 });
    act(() => {
      StudentEditor.onPointerDown(new PointerEvent('pointerdown', { button: 0, bubbles: true }), ctx);
    });

    expect(repaintSpy).toHaveBeenCalled();

    StudentEditor.deactivate(ctx);
  });
});
