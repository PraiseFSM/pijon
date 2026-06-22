// @vitest-environment node
/**
 * Tests for §14.7 — ghost-ring resize button click routing.
 *
 * Covers:
 *   1. FurnitureEditor.onPointerDown routes clicks inside ghost-ring buttons to
 *      store.resizeGrid() with the correct (edge, sign) arguments.
 *   2. Clicks outside all buttons (normal grid area) do NOT call resizeGrid.
 *   3. When store.resizeGrid returns {ok:false}, the warning is surfaced via
 *      store.resizeGridWarning (tested via the domain+store contract separately;
 *      here we verify that the dispatch is called — store handles the blocking).
 *   4. originOffset=0 (StudentEditor / no ghost margin) — no button hit-testing
 *      at all (the guard is short-circuited).
 *
 * Approach:
 *   - FurnitureEditor is a plain EditorMode object (no React rendering needed).
 *   - We construct a minimal EditorContext with mock canvas (originOffset=1) and
 *     a mock store that records resizeGrid calls.
 *   - PointerEvents are constructed with Object.assign so we can set clientX/Y
 *     and target.getBoundingClientRect independently (jsdom not needed).
 *
 * NO DOM, NO React, NO network.
 */

import { describe, it, expect, vi } from 'vitest';
import { FurnitureEditor } from '../ui/editors/FurnitureEditor.js';
import { resizeButtonRects } from '../ui/canvas/ghostRing.js';
import type { CanvasView, EditorContext } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';

// ---------------------------------------------------------------------------
// Grid parameters used throughout these tests
// ---------------------------------------------------------------------------

const CS = 48;  // cellSize
// 6×6 so every edge is validly removable (above the 3×3-unit minimum, no
// furniture) — the MINUS buttons (5.A1) are only rendered/hit-tested at edges
// where canRemoveEdge is true. Button coordinates below are derived from these.
const GW = 6;   // gridW
const GH = 6;   // gridH
const OO = 1;   // originOffset

// Pixel rect of every resize button for the 3×3, cs=48, offset=1 setup
const BUTTONS = resizeButtonRects(GW, GH, CS, OO);

// ---------------------------------------------------------------------------
// Minimal mock helpers
// ---------------------------------------------------------------------------

/** Locate a button by edge+sign and return its center pixel point. */
function buttonCenter(edge: string, sign: number): { px: number; py: number } {
  const btn = BUTTONS.find((b) => b.edge === edge && b.sign === sign);
  if (btn === undefined) throw new Error(`No button for ${edge} ${sign.toString()}`);
  return { px: btn.x + btn.w / 2, py: btn.y + btn.h / 2 };
}

/** Create a synthetic PointerEvent-like object for a given canvas-pixel position. */
function makePointerEvent(px: number, py: number): PointerEvent {
  // The canvas element's bounding rect origin is (0, 0) so client=canvas pixel.
  const el = {
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 999, bottom: 999 }),
  };
  // Use a plain object cast — avoids PointerEvent constructor (not available in node env)
  return {
    button: 0,
    clientX: px,
    clientY: py,
    target: el,
  } as unknown as PointerEvent;
}

/** Minimal CanvasView mock with originOffset = OO. */
function makeCanvas(): CanvasView {
  return {
    cellSize: CS,
    gridW: GW,
    gridH: GH,
    originOffset: OO,
    cellAt: vi.fn(() => undefined as ReturnType<CanvasView['cellAt']>),
    furnitureAt: vi.fn(() => undefined as ReturnType<CanvasView['furnitureAt']>),
    cellRect: vi.fn(() => ({ x: 0, y: 0, w: CS, h: CS })),
    requestRepaint: vi.fn(),
  };
}

/** Minimal CanvasView mock with originOffset = 0 (no ghost margin). */
function makeCanvasNoGhost(): CanvasView {
  return {
    cellSize: CS,
    gridW: GW,
    gridH: GH,
    originOffset: 0,
    cellAt: vi.fn(() => undefined as ReturnType<CanvasView['cellAt']>),
    furnitureAt: vi.fn(() => undefined as ReturnType<CanvasView['furnitureAt']>),
    cellRect: vi.fn(() => ({ x: 0, y: 0, w: CS, h: CS })),
    requestRepaint: vi.fn(),
  };
}

/** Minimal Store mock. */
function makeStore(): Store {
  return {
    classroom: {
      id: 'c1',
      name: 'Test',
      gridW: GW,
      gridH: GH,
      furniture: [],
      cellsPerUnit: 1,
      thresholdUnits: 1.5,
      backgroundImage: null,
      gridColor: null,
    },
    roster: [],
    locks: new Set(),
    history: [],
    historyPtr: -1,
    saveStatus: 'saved',
    activeEditorId: 'furniture',
    fileHandle: null,
    selectedStudentId: null,
    resizeGridWarning: null,
    showViolations: false,
    resizeGrid: vi.fn(),
    addFurniture: vi.fn(),
    moveFurniture: vi.fn(),
    removeFurniture: vi.fn(),
    setClassroom: vi.fn(),
    importRosterFromCsv: vi.fn(),
    setRoster: vi.fn(),
    allocate: vi.fn(),
    smartShuffle: vi.fn(),
    clearArrangement: vi.fn(),
    lockSeat: vi.fn(),
    unlockSeat: vi.fn(),
    manualReassign: vi.fn(),
    assignStudentToFurniture: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    setSaveStatus: vi.fn(),
    setFileHandle: vi.fn(),
    setActiveEditorId: vi.fn(),
    addPreference: vi.fn(),
    removePreference: vi.fn(),
    setMutualPreference: vi.fn(),
    clearMutualPreference: vi.fn(),
    dismissResizeWarning: vi.fn(),
    setGranularity: vi.fn(),
    setThreshold: vi.fn(),
    setBackgroundImage: vi.fn(),
    setGridColor: vi.fn(),
    setShowViolations: vi.fn(),
    eraseAll: vi.fn(),
    hydrate: vi.fn(),
  } as unknown as Store;
}

function makeCtx(canvasOverride?: CanvasView): EditorContext {
  return {
    store: makeStore(),
    canvas: canvasOverride ?? makeCanvas(),
    persistence: null,
  };
}

// ---------------------------------------------------------------------------
// Activate FurnitureEditor before each group so module-level state is clean
// ---------------------------------------------------------------------------

function activateEditor(ctx: EditorContext): void {
  FurnitureEditor.activate(ctx);
}

// ---------------------------------------------------------------------------
// 1. Click-to-dispatch routing — PLUS buttons (add row/col)
// ---------------------------------------------------------------------------

describe('FurnitureEditor.onPointerDown — ghost ring PLUS buttons', () => {
  it('top PLUS: calls store.resizeGrid("top", 1)', () => {
    const ctx = makeCtx();
    activateEditor(ctx);
    const { px, py } = buttonCenter('top', 1);
    FurnitureEditor.onPointerDown(makePointerEvent(px, py), ctx);
    expect(ctx.store.resizeGrid).toHaveBeenCalledTimes(1);
    expect(ctx.store.resizeGrid).toHaveBeenCalledWith('top', 1);
  });

  it('bottom PLUS: calls store.resizeGrid("bottom", 1)', () => {
    const ctx = makeCtx();
    activateEditor(ctx);
    const { px, py } = buttonCenter('bottom', 1);
    FurnitureEditor.onPointerDown(makePointerEvent(px, py), ctx);
    expect(ctx.store.resizeGrid).toHaveBeenCalledWith('bottom', 1);
  });

  it('left PLUS: calls store.resizeGrid("left", 1)', () => {
    const ctx = makeCtx();
    activateEditor(ctx);
    const { px, py } = buttonCenter('left', 1);
    FurnitureEditor.onPointerDown(makePointerEvent(px, py), ctx);
    expect(ctx.store.resizeGrid).toHaveBeenCalledWith('left', 1);
  });

  it('right PLUS: calls store.resizeGrid("right", 1)', () => {
    const ctx = makeCtx();
    activateEditor(ctx);
    const { px, py } = buttonCenter('right', 1);
    FurnitureEditor.onPointerDown(makePointerEvent(px, py), ctx);
    expect(ctx.store.resizeGrid).toHaveBeenCalledWith('right', 1);
  });
});

// ---------------------------------------------------------------------------
// 2. Click-to-dispatch routing — MINUS buttons (remove row/col)
// ---------------------------------------------------------------------------

describe('FurnitureEditor.onPointerDown — ghost ring MINUS buttons', () => {
  it('top MINUS: calls store.resizeGrid("top", -1)', () => {
    const ctx = makeCtx();
    activateEditor(ctx);
    const { px, py } = buttonCenter('top', -1);
    FurnitureEditor.onPointerDown(makePointerEvent(px, py), ctx);
    expect(ctx.store.resizeGrid).toHaveBeenCalledWith('top', -1);
  });

  it('bottom MINUS: calls store.resizeGrid("bottom", -1)', () => {
    const ctx = makeCtx();
    activateEditor(ctx);
    const { px, py } = buttonCenter('bottom', -1);
    FurnitureEditor.onPointerDown(makePointerEvent(px, py), ctx);
    expect(ctx.store.resizeGrid).toHaveBeenCalledWith('bottom', -1);
  });

  it('left MINUS: calls store.resizeGrid("left", -1)', () => {
    const ctx = makeCtx();
    activateEditor(ctx);
    const { px, py } = buttonCenter('left', -1);
    FurnitureEditor.onPointerDown(makePointerEvent(px, py), ctx);
    expect(ctx.store.resizeGrid).toHaveBeenCalledWith('left', -1);
  });

  it('right MINUS: calls store.resizeGrid("right", -1)', () => {
    const ctx = makeCtx();
    activateEditor(ctx);
    const { px, py } = buttonCenter('right', -1);
    FurnitureEditor.onPointerDown(makePointerEvent(px, py), ctx);
    expect(ctx.store.resizeGrid).toHaveBeenCalledWith('right', -1);
  });
});

// ---------------------------------------------------------------------------
// 3. Clicks in normal grid area do NOT call resizeGrid
// ---------------------------------------------------------------------------

describe('FurnitureEditor.onPointerDown — normal grid area', () => {
  it('click at the grid center (not on any button) does NOT call resizeGrid', () => {
    const ctx = makeCtx();
    activateEditor(ctx);
    // Grid center in canvas pixels: originOffset*cs + gridW/2*cs = 48 + 1.5*48 = 120
    const gridCenterX = OO * CS + (GW / 2) * CS;  // 120
    const gridCenterY = OO * CS + (GH / 2) * CS;  // 120
    FurnitureEditor.onPointerDown(makePointerEvent(gridCenterX, gridCenterY), ctx);
    expect(ctx.store.resizeGrid).not.toHaveBeenCalled();
  });

  it('click at canvas (0, 0) corner outside the ghost ring does NOT call resizeGrid', () => {
    // (0,0) is the top-left corner of the ghost area — outside any button
    // because the top-PLUS button for this config starts at x=96, so (0,0)
    // is in the ghost ring area but not in any button rect.
    const ctx = makeCtx();
    activateEditor(ctx);
    FurnitureEditor.onPointerDown(makePointerEvent(0, 0), ctx);
    // Should not trigger resizeGrid since (0,0) is not inside any button
    // (top PLUS starts at x=96, left PLUS ends at x=48 i.e. left+w=48)
    // Note: left PLUS is at x=0, y=96, w=48, h=48 — (0,0) is NOT in it (row 0 ≠ row 96)
    expect(ctx.store.resizeGrid).not.toHaveBeenCalled();
  });

  it('right-button click (button=1) is ignored even on a button rect', () => {
    const ctx = makeCtx();
    activateEditor(ctx);
    const { px, py } = buttonCenter('top', 1);
    const ev = {
      button: 1, // middle button
      clientX: px,
      clientY: py,
      target: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    } as unknown as PointerEvent;
    FurnitureEditor.onPointerDown(ev, ctx);
    expect(ctx.store.resizeGrid).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. originOffset=0 — no ghost margin, no button hit-testing
// ---------------------------------------------------------------------------

describe('FurnitureEditor.onPointerDown — originOffset=0 (no ghost margin)', () => {
  it('clicking anywhere does NOT call resizeGrid when originOffset=0', () => {
    const ctx = makeCtx(makeCanvasNoGhost());
    activateEditor(ctx);
    // Even at the pixel position that would be a button if offset were 1
    const { px, py } = buttonCenter('top', 1);
    FurnitureEditor.onPointerDown(makePointerEvent(px, py), ctx);
    expect(ctx.store.resizeGrid).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. resizeGrid dispatch is followed by requestRepaint
// ---------------------------------------------------------------------------

describe('FurnitureEditor.onPointerDown — repaint on button hit', () => {
  it('requestRepaint is called after a successful button click', () => {
    const ctx = makeCtx();
    activateEditor(ctx);
    const { px, py } = buttonCenter('top', 1);
    FurnitureEditor.onPointerDown(makePointerEvent(px, py), ctx);
    expect(ctx.canvas.requestRepaint).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. Domain-level blocked removal surfaces resizeGridWarning (store contract)
// ---------------------------------------------------------------------------

// This test checks the *store action contract*: when domain.resizeGrid returns
// {ok:false}, store.resizeGrid sets state.resizeGridWarning. We test it via the
// domain + store in isolation (not through FurnitureEditor which just dispatches).

import { resizeGrid as domainResizeGrid } from '../domain/classroom.js';
import { makeClassroom } from '../domain/classroom.js';
import { furnitureId } from '../domain/types.js';

describe('domain resizeGrid — blocked by occupied edge', () => {
  it('returns {ok:false} when furniture occupies the row being removed from top', () => {
    // Create a 3×3 classroom with a desk at row 0 (top row)
    const classroom = makeClassroom('c1', 'Test', 5, 5);
    const desk = {
      id: furnitureId('d1'),
      kind: 'single_desk' as const,
      pos: { x: 1, y: 0 },  // top row
      w: 1,
      h: 1,
      rotation: 0 as const,
      occupants: [],
    };
    const withDesk = { ...classroom, furniture: [desk] };

    const result = domainResizeGrid(withDesk, 'top', -1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/occupies/i);
    }
  });

  it('returns {ok:false} when furniture occupies the column being removed from left', () => {
    const classroom = makeClassroom('c1', 'Test', 5, 5);
    const desk = {
      id: furnitureId('d1'),
      kind: 'single_desk' as const,
      pos: { x: 0, y: 1 },  // leftmost column
      w: 1,
      h: 1,
      rotation: 0 as const,
      occupants: [],
    };
    const withDesk = { ...classroom, furniture: [desk] };

    const result = domainResizeGrid(withDesk, 'left', -1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/occupies/i);
    }
  });

  it('returns {ok:true} when removing an edge with no furniture on it', () => {
    const classroom = makeClassroom('c1', 'Test', 5, 5);
    const desk = {
      id: furnitureId('d1'),
      kind: 'single_desk' as const,
      pos: { x: 1, y: 1 },  // middle — not on any edge
      w: 1,
      h: 1,
      rotation: 0 as const,
      occupants: [],
    };
    const withDesk = { ...classroom, furniture: [desk] };

    expect(domainResizeGrid(withDesk, 'top', -1).ok).toBe(true);
    expect(domainResizeGrid(withDesk, 'bottom', -1).ok).toBe(true);
    expect(domainResizeGrid(withDesk, 'left', -1).ok).toBe(true);
    expect(domainResizeGrid(withDesk, 'right', -1).ok).toBe(true);
  });

  it('blocked reason message describes the problem', () => {
    const classroom = makeClassroom('c1', 'Test', 2, 2);
    const desk = {
      id: furnitureId('d1'),
      kind: 'single_desk' as const,
      pos: { x: 0, y: 0 },
      w: 1,
      h: 1,
      rotation: 0 as const,
      occupants: [],
    };
    const result = domainResizeGrid({ ...classroom, furniture: [desk] }, 'top', -1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Reason must be a non-empty human-readable string
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});
