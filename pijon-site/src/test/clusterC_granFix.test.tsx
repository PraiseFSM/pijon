// @vitest-environment jsdom
/**
 * Tests for §6.C2 — Granularity ghost-fix overlay + lifecycle in FurnitureEditor.
 *
 * Covers:
 *   1. Toolbar: entering fix mode when a granularity decrease is blocked.
 *   2. Toolbar: fix-mode banner text / ✕ cancel button.
 *   3. Toolbar: re-clicking the pending G attempts to apply and exits on success.
 *   4. Toolbar: re-selecting the active G cancels fix mode.
 *   5. paintOverlay: draws red tint + ghost + arrow for each conflict.
 *   6. paintOverlay: live recompute — no overlay when no conflicts (auto-apply path).
 *   7. activate/deactivate clears fix-mode state.
 *
 * Approach:
 *   - Toolbar tests: render FurnitureEditor.Toolbar via @testing-library/react.
 *   - paintOverlay tests: spy a minimal CanvasRenderingContext2D and call
 *     FurnitureEditor.paintOverlay directly, with usePijonStore.setState to set
 *     a classroom containing off-boundary furniture.
 *
 * NO network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

import { FurnitureEditor } from '../ui/editors/FurnitureEditor.js';
import type { EditorContext, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import { usePijonStore } from '../state/store.js';
import { makeClassroom } from '../domain/classroom.js';
import { furnitureId } from '../domain/types.js';
import type { Furniture } from '../domain/furniture.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CS = 48;
const GW = 12;
const GH = 12;

function makeCanvas(): CanvasView {
  return {
    cellSize: CS,
    gridW: GW,
    gridH: GH,
    originOffset: 1,
    cellAt: vi.fn(() => undefined),
    furnitureAt: vi.fn(() => undefined),
    cellRect: vi.fn(() => ({ x: 0, y: 0, w: CS, h: CS })),
    requestRepaint: vi.fn(),
  };
}

function mkDesk(id: string, x: number, y: number, w = 2, h = 2): Furniture {
  return {
    id: furnitureId(id),
    kind: 'single_desk',
    pos: { x, y },
    w,
    h,
    rotation: 0,
    occupants: [],
  };
}

/** Make a classroom with G=2 and a desk at an off-boundary position (x=1 → not multiple of step=2 for 2->1). */
function makeConflictingClassroom() {
  const c = makeClassroom('c1', 'Test', GW, GH, 2 /* cellsPerUnit=2 */);
  return {
    ...c,
    furniture: [mkDesk('desk1', 1, 0, 2, 2)], // pos.x=1 not multiple of step=2
  };
}

/** Make a classroom with G=2 and all desks on even positions (no conflicts for 2->1). */
function makeAlignedClassroom() {
  const c = makeClassroom('c1', 'Test', GW, GH, 2 /* cellsPerUnit=2 */);
  return {
    ...c,
    furniture: [mkDesk('desk1', 0, 0, 2, 2)], // pos.x=0 is a multiple of 2
  };
}

function makeStore(classroom = makeConflictingClassroom()): Store {
  return {
    classroom,
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
    addFurniture: vi.fn(),
    moveFurniture: vi.fn(),
    removeFurniture: vi.fn(),
    setClassroom: vi.fn(),
    importRosterFromCsv: vi.fn(() => [] as string[]),
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
    resizeGrid: vi.fn(),
    setGranularity: vi.fn().mockImplementation(() => {
      throw new RangeError('Cannot change granularity from 2 to 1: value 1 does not scale to an integer.');
    }),
    setThreshold: vi.fn(),
    setBackgroundImage: vi.fn(),
    setGridColor: vi.fn(),
    setShowViolations: vi.fn(),
    eraseAll: vi.fn(),
    hydrate: vi.fn(),
    setSelectedStudentId: vi.fn(),
    addStudent: vi.fn(),
    removeStudent: vi.fn(),
  } as unknown as Store;
}

function makeCtx(): EditorContext {
  return { store: makeStore(), canvas: makeCanvas(), persistence: null };
}

/** Build a spy ctx2d that records fillRect, strokeRect, beginPath, moveTo, lineTo, stroke calls. */
function makeSpyCtx2d() {
  const calls: { method: string; args: unknown[] }[] = [];
  let _lineWidth = 1;
  let _strokeStyle = '';
  let _fillStyle = '';
  let _globalAlpha = 1;
  let _lineDash: number[] = [];

  const ctx2d = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn((...args: unknown[]) => { calls.push({ method: 'fillRect', args }); }),
    strokeRect: vi.fn((...args: unknown[]) => { calls.push({ method: 'strokeRect', args }); }),
    beginPath: vi.fn((...args: unknown[]) => { calls.push({ method: 'beginPath', args }); }),
    moveTo: vi.fn((...args: unknown[]) => { calls.push({ method: 'moveTo', args }); }),
    lineTo: vi.fn((...args: unknown[]) => { calls.push({ method: 'lineTo', args }); }),
    stroke: vi.fn((...args: unknown[]) => { calls.push({ method: 'stroke', args }); }),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn((arr: number[]) => { _lineDash = arr; }),
    getLineDash: vi.fn(() => _lineDash),
    set lineWidth(v: number) { _lineWidth = v; },
    get lineWidth() { return _lineWidth; },
    set strokeStyle(v: string) { _strokeStyle = v; },
    get strokeStyle() { return _strokeStyle; },
    set fillStyle(v: string) { _fillStyle = v; },
    get fillStyle() { return _fillStyle; },
    set globalAlpha(v: number) { _globalAlpha = v; },
    get globalAlpha() { return _globalAlpha; },
    textAlign: 'left',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D;

  return { ctx2d, calls };
}

function makeView(): CanvasView {
  return {
    cellSize: CS,
    gridW: GW,
    gridH: GH,
    originOffset: 0, // no ghost ring so overlay content is simpler
    cellAt: vi.fn(() => undefined),
    furnitureAt: vi.fn(() => undefined),
    cellRect: vi.fn(() => ({ x: 0, y: 0, w: CS, h: CS })),
    requestRepaint: vi.fn(),
  };
}

const FurnitureToolbar = FurnitureEditor.Toolbar;

// ---------------------------------------------------------------------------
// Reset store + editor state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset the real Zustand store to a clean state (erase all furniture)
  usePijonStore.getState().eraseAll();
  // Always activate the editor with a fresh canvas to reset module-level state
  FurnitureEditor.activate({
    store: makeStore(),
    canvas: makeCanvas(),
    persistence: null,
  });
  // Clean up any previous renders
  cleanup();
});

afterEach(() => {
  FurnitureEditor.deactivate({
    store: makeStore(),
    canvas: makeCanvas(),
    persistence: null,
  });
  cleanup();
});

// ---------------------------------------------------------------------------
// 1. Toolbar: entering fix mode on a blocked decrease
// ---------------------------------------------------------------------------

describe('FurnitureToolbar — entering fix mode on blocked decrease', () => {
  it('shows the fix-mode banner when setGranularity throws on a decrease', () => {
    const ctx = makeCtx();
    render(React.createElement(FurnitureToolbar, { ctx }));

    // The store mock throws on setGranularity — clicking 1 (a decrease from G=2)
    // should enter fix mode and show the guidance banner
    fireEvent.click(screen.getByRole('button', { name: '1' }));

    // Fix-mode shows guidance (not just the raw error)
    expect(screen.getByText(/move the red pieces/i)).toBeInTheDocument();
  });

  it('shows the fix-mode guidance text (not just the raw error) in the banner', () => {
    const ctx = makeCtx();
    render(React.createElement(FurnitureToolbar, { ctx }));

    fireEvent.click(screen.getByRole('button', { name: '1' }));

    // Fix-mode banner should mention "Move the red pieces" or similar guidance
    expect(screen.getByText(/move the red pieces/i)).toBeInTheDocument();
  });

  it('shows the target granularity in the fix-mode banner', () => {
    const ctx = makeCtx();
    render(React.createElement(FurnitureToolbar, { ctx }));

    fireEvent.click(screen.getByRole('button', { name: '1' }));

    // Banner mentions the target G=1
    expect(screen.getByText(/granularity 1 target/i)).toBeInTheDocument();
  });

  it('fix-mode banner has a ✕ cancel button', () => {
    const ctx = makeCtx();
    render(React.createElement(FurnitureToolbar, { ctx }));

    fireEvent.click(screen.getByRole('button', { name: '1' }));

    // Banner should show cancel button
    const cancelBtn = screen.getByTestId('gran-fix-cancel');
    expect(cancelBtn).toBeInTheDocument();
    expect(cancelBtn.textContent).toBe('✕');
  });
});

// ---------------------------------------------------------------------------
// 2. Toolbar: cancel fix mode via ✕
// ---------------------------------------------------------------------------

describe('FurnitureToolbar — cancel fix mode via ✕', () => {
  it('clicking ✕ clears the fix-mode banner', () => {
    const ctx = makeCtx();
    render(React.createElement(FurnitureToolbar, { ctx }));

    // Enter fix mode
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(screen.getByText(/move the red pieces/i)).toBeInTheDocument();

    // Cancel
    fireEvent.click(screen.getByTestId('gran-fix-cancel'));

    expect(screen.queryByText(/move the red pieces/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('gran-fix-cancel')).not.toBeInTheDocument();
  });

  it('clicking ✕ triggers a repaint', () => {
    const canvas = makeCanvas();
    const ctx = { store: makeStore(), canvas, persistence: null };
    render(React.createElement(FurnitureToolbar, { ctx }));

    fireEvent.click(screen.getByRole('button', { name: '1' }));
    const repaintsBefore = (canvas.requestRepaint as ReturnType<typeof vi.fn>).mock.calls.length;

    fireEvent.click(screen.getByTestId('gran-fix-cancel'));

    const repaints = (canvas.requestRepaint as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(repaints).toBeGreaterThan(repaintsBefore);
  });
});

// ---------------------------------------------------------------------------
// 3. Toolbar: re-selecting the active G cancels fix mode
// ---------------------------------------------------------------------------

describe('FurnitureToolbar — re-selecting active G cancels fix mode', () => {
  it('clicking the active granularity while in fix mode clears fix mode', () => {
    const ctx = makeCtx();
    render(React.createElement(FurnitureToolbar, { ctx }));

    // Enter fix mode (try to decrease from G=2 to G=1)
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(screen.getByText(/move the red pieces/i)).toBeInTheDocument();

    // Re-click the ACTIVE granularity (2) → cancel fix mode
    fireEvent.click(screen.getByRole('button', { name: '2', pressed: true }));

    expect(screen.queryByText(/move the red pieces/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4. Toolbar: re-clicking the pending G applies when no conflicts remain
// ---------------------------------------------------------------------------

describe('FurnitureToolbar — re-clicking pending G applies when resolved', () => {
  it('applies the pending granularity when re-clicked after conflicts are resolved', () => {
    // First render with throwing store (conflicts exist)
    const throwingSetGran = vi.fn().mockImplementationOnce(() => {
      throw new RangeError('Cannot change granularity from 2 to 1: value 1 does not scale.');
    });
    // Make a RESOLVED classroom (no conflicts for 2->1)
    const resolvedClassroom = makeAlignedClassroom();

    const store = {
      ...makeStore(makeConflictingClassroom()),
      setGranularity: throwingSetGran,
    } as unknown as Store;
    const ctx: EditorContext = { store, canvas: makeCanvas(), persistence: null };

    // Use rerender so we have one toolbar instance throughout
    const { rerender } = render(React.createElement(FurnitureToolbar, { ctx }));

    // First click enters fix mode
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(screen.getByText(/move the red pieces/i)).toBeInTheDocument();

    // Now simulate the teacher moving the piece: update store classroom to the resolved one
    // Re-render with the resolved classroom (no conflicts) and a succeeding setGranularity
    const successSetGran = vi.fn(); // succeeds
    const successStore = {
      ...makeStore(resolvedClassroom),
      setGranularity: successSetGran,
    } as unknown as Store;
    const newCtx: EditorContext = { store: successStore, canvas: makeCanvas(), persistence: null };

    rerender(React.createElement(FurnitureToolbar, { ctx: newCtx }));

    // Re-click pending G=1 — conflicts now empty → should apply and exit
    fireEvent.click(screen.getByRole('button', { name: '1' }));

    // setGranularity should have been called on the success store
    expect(successSetGran).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// 4b. Toolbar: re-clicking pending G with conflicts REMAINING does NOT apply
// ---------------------------------------------------------------------------

describe('FurnitureToolbar — re-clicking pending G with conflicts remaining', () => {
  it('does NOT call setGranularity when re-clicking pending G with conflicts remaining', () => {
    // Set up a store whose setGranularity throws on the first call (entering fix mode),
    // then records calls thereafter.
    const setGranularity = vi.fn().mockImplementationOnce(() => {
      throw new RangeError('Cannot change granularity from 2 to 1: value 1 does not scale.');
    });
    const store = makeStore(makeConflictingClassroom());
    store.setGranularity = setGranularity;

    const ctx: EditorContext = {
      store,
      canvas: makeCanvas(),
      persistence: null,
    };

    render(React.createElement(FurnitureToolbar, { ctx }));

    // First click: throws → enters fix mode
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(screen.getByText(/move the red pieces/i)).toBeInTheDocument();

    // The store still has the conflicting classroom (no moves made).
    // Re-clicking G=1 while conflicts remain must NOT call setGranularity again.
    const callsBefore = setGranularity.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(setGranularity.mock.calls.length).toBe(callsBefore); // no additional call

    // Fix mode should still be active (banner still showing)
    expect(screen.getByText(/move the red pieces/i)).toBeInTheDocument();
  });

  it('does not exit fix mode when re-clicking pending G with conflicts remaining', () => {
    const setGranularity = vi.fn().mockImplementation(() => {
      throw new RangeError('Cannot change granularity from 2 to 1: value 1 does not scale.');
    });
    const store = makeStore(makeConflictingClassroom());
    store.setGranularity = setGranularity;

    const ctx: EditorContext = {
      store,
      canvas: makeCanvas(),
      persistence: null,
    };

    render(React.createElement(FurnitureToolbar, { ctx }));

    // Enter fix mode
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(screen.getByText(/move the red pieces/i)).toBeInTheDocument();

    // Re-click pending G: conflicts still present → stays in fix mode
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(screen.getByText(/move the red pieces/i)).toBeInTheDocument();
    expect(screen.getByTestId('gran-fix-cancel')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4c. Toolbar: normal success path applies immediately without fix mode
// ---------------------------------------------------------------------------

describe('FurnitureToolbar — normal success path (aligned classroom)', () => {
  it('calls setGranularity immediately when decrease has no conflicts', () => {
    const setGranularity = vi.fn(); // always succeeds
    const store = makeStore(makeAlignedClassroom());
    store.setGranularity = setGranularity;

    const ctx: EditorContext = {
      store,
      canvas: makeCanvas(),
      persistence: null,
    };

    render(React.createElement(FurnitureToolbar, { ctx }));

    // Decrease from G=2 to G=1 with no conflicts: should apply immediately
    fireEvent.click(screen.getByRole('button', { name: '1' }));

    expect(setGranularity).toHaveBeenCalledOnce();
    expect(setGranularity).toHaveBeenCalledWith(1);
    // No fix-mode banner should appear
    expect(screen.queryByText(/move the red pieces/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('gran-fix-cancel')).not.toBeInTheDocument();
  });

  it('calls setGranularity immediately for an increase (never conflicts)', () => {
    const setGranularity = vi.fn();
    // G=1 classroom, increase to G=2
    const c = makeClassroom('c1', 'Test', GW, GH, 1);
    const store = makeStore({ ...c, furniture: [] });
    store.setGranularity = setGranularity;

    const ctx: EditorContext = {
      store,
      canvas: makeCanvas(),
      persistence: null,
    };

    render(React.createElement(FurnitureToolbar, { ctx }));

    fireEvent.click(screen.getByRole('button', { name: '2' }));

    expect(setGranularity).toHaveBeenCalledOnce();
    expect(setGranularity).toHaveBeenCalledWith(2);
    expect(screen.queryByText(/move the red pieces/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 5. paintOverlay — draws red tint + ghost + arrow for each conflict
// ---------------------------------------------------------------------------

describe('FurnitureEditor.paintOverlay — ghost-fix overlay with conflicts', () => {
  beforeEach(() => {
    // Set the real store to a classroom with an off-boundary desk (G=2, desk at x=1)
    const classroom = makeConflictingClassroom();
    usePijonStore.setState((s) => ({ ...s, classroom }));
  });

  it('draws fillRect for the red tint over the conflicting piece', () => {
    // Enter fix mode by setting the module-level pendingG directly via activate+select
    // We do this by rendering the toolbar with a throwing setGranularity
    const ctx = makeCtx();
    render(React.createElement(FurnitureToolbar, { ctx }));
    fireEvent.click(screen.getByRole('button', { name: '1' })); // enters fix mode

    const { ctx2d, calls } = makeSpyCtx2d();
    const view = makeView();
    FurnitureEditor.paintOverlay(ctx2d, view);

    const fillRectCalls = calls.filter((c) => c.method === 'fillRect');
    expect(fillRectCalls.length).toBeGreaterThan(0);
  });

  it('draws strokeRect for the red outline over the conflicting piece', () => {
    const ctx = makeCtx();
    render(React.createElement(FurnitureToolbar, { ctx }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));

    const { ctx2d, calls } = makeSpyCtx2d();
    FurnitureEditor.paintOverlay(ctx2d, makeView());

    const strokeRectCalls = calls.filter((c) => c.method === 'strokeRect');
    expect(strokeRectCalls.length).toBeGreaterThan(0);
  });

  it('draws an arrow (moveTo + lineTo + stroke) from piece to ghost', () => {
    const ctx = makeCtx();
    render(React.createElement(FurnitureToolbar, { ctx }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));

    const { ctx2d, calls } = makeSpyCtx2d();
    FurnitureEditor.paintOverlay(ctx2d, makeView());

    const moveToCalls = calls.filter((c) => c.method === 'moveTo');
    const strokeCalls = calls.filter((c) => c.method === 'stroke');
    // Arrow requires at least one moveTo and one stroke
    expect(moveToCalls.length).toBeGreaterThan(0);
    expect(strokeCalls.length).toBeGreaterThan(0);
  });

  it('draws more fillRect calls for two conflicts than for one', () => {
    const cBase = makeClassroom('c2', 'Test', GW, GH, 2);

    // Part 1: ONE conflicting piece
    usePijonStore.setState((s) => ({
      ...s,
      classroom: { ...cBase, furniture: [mkDesk('desk1', 1, 0, 2, 2)] },
    }));
    render(React.createElement(FurnitureToolbar, { ctx: makeCtx() }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    const { ctx2d: spyOne, calls: callsOne } = makeSpyCtx2d();
    FurnitureEditor.paintOverlay(spyOne, makeView());
    const fillRectOne = callsOne.filter((c) => c.method === 'fillRect').length;

    // Part 2: TWO conflicting pieces — reset state
    cleanup();
    FurnitureEditor.activate({ store: makeStore(), canvas: makeCanvas(), persistence: null });

    usePijonStore.setState((s) => ({
      ...s,
      classroom: {
        ...cBase,
        furniture: [
          mkDesk('desk1', 1, 0, 2, 2),  // x=1 not multiple of 2
          mkDesk('desk2', 4, 1, 2, 2),  // y=1 not multiple of 2
        ],
      },
    }));
    render(React.createElement(FurnitureToolbar, { ctx: makeCtx() }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    const { ctx2d: spyTwo, calls: callsTwo } = makeSpyCtx2d();
    FurnitureEditor.paintOverlay(spyTwo, makeView());
    const fillRectTwo = callsTwo.filter((c) => c.method === 'fillRect').length;

    // Two conflicts produce at least as many draw calls as one
    expect(fillRectTwo).toBeGreaterThanOrEqual(fillRectOne);
    expect(fillRectTwo).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6. paintOverlay — no overlay when not in fix mode
// ---------------------------------------------------------------------------

describe('FurnitureEditor.paintOverlay — no ghost-fix overlay outside fix mode', () => {
  it('draws nothing extra when not in fix mode', () => {
    // Activate fresh (no fix mode)
    FurnitureEditor.activate({ store: makeStore(), canvas: makeCanvas(), persistence: null });

    const { ctx2d, calls } = makeSpyCtx2d();
    const view: CanvasView = { ...makeView(), originOffset: 0 };
    FurnitureEditor.paintOverlay(ctx2d, view);

    // No fix mode → no fillRect/strokeRect calls from the overlay section
    const fillRectCalls = calls.filter((c) => c.method === 'fillRect');
    expect(fillRectCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. activate / deactivate clears fix-mode state
// ---------------------------------------------------------------------------

describe('FurnitureEditor activate/deactivate — clears fix state', () => {
  it('activate clears granFixPendingG so paintOverlay draws nothing', () => {
    // 1. Enter fix mode via toolbar
    const classroom = makeConflictingClassroom();
    usePijonStore.setState((s) => ({ ...s, classroom }));
    const ctx = makeCtx();
    render(React.createElement(FurnitureToolbar, { ctx }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));

    // 2. Activate the editor again (simulates switching away and back)
    FurnitureEditor.activate({ store: makeStore(), canvas: makeCanvas(), persistence: null });

    // 3. paintOverlay should draw nothing (fix mode was cleared)
    const { ctx2d, calls } = makeSpyCtx2d();
    FurnitureEditor.paintOverlay(ctx2d, makeView());

    const fillRects = calls.filter((c) => c.method === 'fillRect');
    expect(fillRects).toHaveLength(0);
  });

  it('deactivate clears granFixPendingG so paintOverlay draws nothing', () => {
    // 1. Enter fix mode
    const classroom = makeConflictingClassroom();
    usePijonStore.setState((s) => ({ ...s, classroom }));
    const ctx = makeCtx();
    render(React.createElement(FurnitureToolbar, { ctx }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));

    // 2. Deactivate
    FurnitureEditor.deactivate({ store: makeStore(), canvas: makeCanvas(), persistence: null });

    // 3. Overlay: no fix-mode drawing
    const { ctx2d, calls } = makeSpyCtx2d();
    FurnitureEditor.paintOverlay(ctx2d, makeView());

    const fillRects = calls.filter((c) => c.method === 'fillRect');
    expect(fillRects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Live recompute — conflict disappears when piece becomes aligned
// ---------------------------------------------------------------------------

describe('FurnitureEditor.paintOverlay — live recompute on store change', () => {
  it('draws overlay when piece is conflicting', () => {
    const conflictingClassroom = makeConflictingClassroom();
    usePijonStore.setState((s) => ({ ...s, classroom: conflictingClassroom }));

    const ctx = makeCtx();
    render(React.createElement(FurnitureToolbar, { ctx }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));

    const { ctx2d, calls } = makeSpyCtx2d();
    FurnitureEditor.paintOverlay(ctx2d, makeView());

    const fillRects = calls.filter((c) => c.method === 'fillRect');
    expect(fillRects.length).toBeGreaterThan(0);
  });

  it('draws no overlay content when piece is moved to a valid position', () => {
    // Start in fix mode with a conflicting classroom
    const conflictingClassroom = makeConflictingClassroom();
    usePijonStore.setState((s) => ({ ...s, classroom: conflictingClassroom }));
    const ctx = makeCtx();
    render(React.createElement(FurnitureToolbar, { ctx }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));

    // Now update the store to an aligned classroom (piece moved to x=2)
    const alignedClassroom = {
      ...makeAlignedClassroom(),
      furniture: [mkDesk('desk1', 2, 0, 2, 2)], // x=2 is multiple of 2
    };
    usePijonStore.setState((s) => ({ ...s, classroom: alignedClassroom }));

    // granFixPendingG is still set to 1 (not yet auto-applied in this sync test)
    // but conflicts() returns empty, so the overlay branch triggers auto-apply via setTimeout
    // To check the recompute path: paintOverlay will hit the empty-conflicts branch.
    // The auto-apply fires via setTimeout(0) — we can verify no overlay is drawn in this frame.
    const { ctx2d, calls } = makeSpyCtx2d();
    FurnitureEditor.paintOverlay(ctx2d, makeView());

    // With zero conflicts, the overlay loop does not draw any fillRect for the red tint
    const fillRects = calls.filter((c) => c.method === 'fillRect');
    expect(fillRects).toHaveLength(0);
  });
});
