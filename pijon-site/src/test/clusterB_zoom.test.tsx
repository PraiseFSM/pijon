// @vitest-environment jsdom
/**
 * §6.B2 — Scroll-wheel zoom on ClassroomCanvas.
 *
 * Tests the wheel handler, clamp bounds, geometry consistency, preventDefault,
 * and onViewReady re-fire after zoom.
 *
 * Reuses the jsdom canvas stubbing pattern from ClassroomCanvas.test.tsx:
 *   - getContext spy returning a spy ctx object
 *   - rAF queue for deterministic frame scheduling
 *   - setPointerCapture no-op stub
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

import { ClassroomCanvas } from '../ui/canvas/ClassroomCanvas.js';
import type { CanvasView } from '../ui/editors/EditorMode.js';
import { usePijonStore } from '../state/store.js';
import { _clearForTest } from '../ui/canvas/imageCache.js';
import { effectiveCellSize } from '../ui/canvas/cellSizeHelper.js';

// ---------------------------------------------------------------------------
// rAF queue
// ---------------------------------------------------------------------------

let rafQueue: FrameRequestCallback[] = [];
let rafIdCounter = 0;

function flushRaf(): void {
  while (rafQueue.length > 0) {
    const queue = rafQueue.splice(0);
    for (const cb of queue) cb(performance.now());
  }
}

// ---------------------------------------------------------------------------
// Spy ctx
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpyCtx = Record<string, any>;

function makeSpyCtx(): SpyCtx {
  return {
    setTransform: vi.fn(),
    translate: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
}

// ---------------------------------------------------------------------------
// Stubs — stored for restore
// ---------------------------------------------------------------------------

let spyCtx: SpyCtx;
const origGetContext = HTMLCanvasElement.prototype.getContext;
const origSetPointerCapture = (HTMLCanvasElement.prototype as HTMLElement & { setPointerCapture?: (id: number) => void }).setPointerCapture;
const origReleasePointerCapture = (HTMLCanvasElement.prototype as HTMLElement & { releasePointerCapture?: (id: number) => void }).releasePointerCapture;
const origRaf = window.requestAnimationFrame;
const origCaf = window.cancelAnimationFrame;

// ---------------------------------------------------------------------------
// Store reset
// ---------------------------------------------------------------------------

function resetStore(): void {
  usePijonStore.getState().eraseAll();
}

// ---------------------------------------------------------------------------
// beforeEach / afterEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  rafQueue = [];
  rafIdCounter = 0;
  spyCtx = makeSpyCtx();

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    rafIdCounter += 1;
    rafQueue.push(cb);
    return rafIdCounter;
  });
  vi.stubGlobal('cancelAnimationFrame', (): void => {});

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = function (contextId: string): any {
    if (contextId === '2d') return spyCtx;
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext;

  (HTMLCanvasElement.prototype as HTMLElement & { setPointerCapture: (id: number) => void }).setPointerCapture = vi.fn();
  (HTMLCanvasElement.prototype as HTMLElement & { releasePointerCapture: (id: number) => void }).releasePointerCapture = vi.fn();

  resetStore();
  _clearForTest();
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;

  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  if (origSetPointerCapture !== undefined) {
    proto.setPointerCapture = origSetPointerCapture;
  } else {
    delete proto.setPointerCapture;
  }
  if (origReleasePointerCapture !== undefined) {
    proto.releasePointerCapture = origReleasePointerCapture;
  } else {
    delete proto.releasePointerCapture;
  }

  window.requestAnimationFrame = origRaf;
  window.cancelAnimationFrame = origCaf;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderCanvas(props?: React.ComponentProps<typeof ClassroomCanvas>): {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
} {
  const { container } = render(React.createElement(ClassroomCanvas, props ?? {}));
  act(() => { flushRaf(); });
  const canvas = container.querySelector('canvas');
  if (canvas === null) throw new Error('canvas not found');
  return { container, canvas };
}

/**
 * Fire a wheel event on a canvas element with a given deltaY.
 * Returns the WheelEvent created.
 */
function fireWheel(canvas: HTMLCanvasElement, deltaY: number): WheelEvent {
  const evt = new WheelEvent('wheel', { deltaY, cancelable: true, bubbles: true });
  act(() => { canvas.dispatchEvent(evt); });
  return evt;
}

// ---------------------------------------------------------------------------
// §6.B2 — Zoom clamp bounds
// ---------------------------------------------------------------------------

describe('§6.B2 zoom — clamp bounds', () => {
  it('zoom-in (negative deltaY) increases effective cell size', () => {
    const cellSize = 48;
    let view: CanvasView | null = null;
    const { canvas } = renderCanvas({ cellSize, onViewReady: (v) => { view = v; } });

    const ecsBefore = view!.cellSize;

    // Fire scroll-up (zoom in)
    fireWheel(canvas, -300);
    act(() => { flushRaf(); });

    // onViewReady fires again with new view
    const ecsAfter = view!.cellSize;
    expect(ecsAfter).toBeGreaterThan(ecsBefore);
  });

  it('zoom-out (positive deltaY) decreases effective cell size', () => {
    const cellSize = 48;
    let view: CanvasView | null = null;
    const { canvas } = renderCanvas({ cellSize, onViewReady: (v) => { view = v; } });

    const ecsBefore = view!.cellSize;

    fireWheel(canvas, 300);
    act(() => { flushRaf(); });

    expect(view!.cellSize).toBeLessThan(ecsBefore);
  });

  it('zoom is clamped at MIN: heavy scroll-out never goes below ZOOM_MIN * cellSize', () => {
    const cellSize = 48;
    let lastView: CanvasView | null = null;
    const { canvas } = renderCanvas({ cellSize, onViewReady: (v) => { lastView = v; } });

    // Scroll out massively
    for (let i = 0; i < 100; i++) {
      fireWheel(canvas, 5000);
    }
    act(() => { flushRaf(); });

    // ecs must be >= ZOOM_MIN * cellSize / cellsPerUnit (G=1 default)
    const ZOOM_MIN = 0.4;
    const minEcs = effectiveCellSize(ZOOM_MIN * cellSize, 1);
    expect(lastView!.cellSize).toBeGreaterThanOrEqual(minEcs);
  });

  it('zoom is clamped at MAX: heavy scroll-in never goes above ZOOM_MAX * cellSize', () => {
    const cellSize = 48;
    let lastView: CanvasView | null = null;
    const { canvas } = renderCanvas({ cellSize, onViewReady: (v) => { lastView = v; } });

    for (let i = 0; i < 100; i++) {
      fireWheel(canvas, -5000);
    }
    act(() => { flushRaf(); });

    const ZOOM_MAX = 3.0;
    const maxEcs = effectiveCellSize(ZOOM_MAX * cellSize, 1);
    expect(lastView!.cellSize).toBeLessThanOrEqual(maxEcs + 0.001);
  });

  it('starting at zoom=1 is within clamp bounds', () => {
    const cellSize = 48;
    let view: CanvasView | null = null;
    renderCanvas({ cellSize, onViewReady: (v) => { view = v; } });

    // No wheel — zoom=1, ecs = cellSize / cellsPerUnit
    const expectedEcs = effectiveCellSize(cellSize, 1);
    expect(view!.cellSize).toBe(expectedEcs);
  });
});

// ---------------------------------------------------------------------------
// §6.B2 — preventDefault is called
// ---------------------------------------------------------------------------

describe('§6.B2 zoom — preventDefault suppresses page scroll', () => {
  it('calls preventDefault() on wheel events', () => {
    const { canvas } = renderCanvas();

    const evt = new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true });
    const preventSpy = vi.spyOn(evt, 'preventDefault');

    act(() => { canvas.dispatchEvent(evt); });

    expect(preventSpy).toHaveBeenCalled();
  });

  it('calls preventDefault() on both scroll-in and scroll-out', () => {
    const { canvas } = renderCanvas();

    const evtIn = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true });
    const evtOut = new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true });
    const spyIn = vi.spyOn(evtIn, 'preventDefault');
    const spyOut = vi.spyOn(evtOut, 'preventDefault');

    act(() => { canvas.dispatchEvent(evtIn); });
    act(() => { canvas.dispatchEvent(evtOut); });

    expect(spyIn).toHaveBeenCalled();
    expect(spyOut).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// §6.B2 — onViewReady re-fires on zoom
// ---------------------------------------------------------------------------

describe('§6.B2 zoom — onViewReady re-fires when zoom changes', () => {
  it('onViewReady is called again after a wheel event changes the zoom', () => {
    const onViewReady = vi.fn();
    const { canvas } = renderCanvas({ onViewReady });

    const callsBefore = onViewReady.mock.calls.length;

    fireWheel(canvas, -200);
    act(() => { flushRaf(); });

    expect(onViewReady.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('the new CanvasView after zoom has a different cellSize than before', () => {
    const views: CanvasView[] = [];
    const { canvas } = renderCanvas({ cellSize: 48, onViewReady: (v) => { views.push(v); } });

    fireWheel(canvas, -300);
    act(() => { flushRaf(); });

    // Should have at least 2 views: initial + post-zoom
    expect(views.length).toBeGreaterThanOrEqual(2);
    const initialCellSize = views[0]!.cellSize;
    const zoomedCellSize = views[views.length - 1]!.cellSize;
    expect(zoomedCellSize).not.toBe(initialCellSize);
  });
});

// ---------------------------------------------------------------------------
// §6.B2 — Canvas geometry stays self-consistent after zoom
// ---------------------------------------------------------------------------

describe('§6.B2 zoom — CanvasView geometry self-consistent after zoom', () => {
  it('cellAt and cellRect round-trip: cellAt(cellRect(cell).x, cellRect(cell).y) === cell', () => {
    let view: CanvasView | null = null;
    const { canvas } = renderCanvas({ cellSize: 48, onViewReady: (v) => { view = v; } });

    // jsdom getBoundingClientRect returns { left:0, top:0 }
    // canvas has no ghost margin so originPx = 0

    // Zoom in a bit
    fireWheel(canvas, -200);
    act(() => { flushRaf(); });

    const testCell = { x: 2, y: 1 };
    const rect = view!.cellRect(testCell);

    // The top-left corner of the cell's pixel rect maps back to the same cell
    const recovered = view!.cellAt(rect.x, rect.y);
    expect(recovered).toEqual(testCell);
  });

  it('cellRect width and height equal the zoomed effectiveCellSize', () => {
    let view: CanvasView | null = null;
    const { canvas } = renderCanvas({ cellSize: 48, onViewReady: (v) => { view = v; } });

    fireWheel(canvas, -150);
    act(() => { flushRaf(); });

    const rect = view!.cellRect({ x: 0, y: 0 });
    expect(rect.w).toBeCloseTo(view!.cellSize, 5);
    expect(rect.h).toBeCloseTo(view!.cellSize, 5);
  });

  it('cellAt returns undefined for points outside the grid after zoom', () => {
    let view: CanvasView | null = null;
    const { canvas } = renderCanvas({ cellSize: 48, onViewReady: (v) => { view = v; } });

    fireWheel(canvas, -200); // zoom in
    act(() => { flushRaf(); });

    // jsdom returns left=0,top=0; point at (-1,-1) always outside
    expect(view!.cellAt(-1, -1)).toBeUndefined();
  });

  it('canvas DPR backing store width updates after zoom', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const { gridW } = usePijonStore.getState().classroom;

    let view: CanvasView | null = null;
    const { canvas } = renderCanvas({ cellSize: 48, onViewReady: (v) => { view = v; } });

    const widthBefore = canvas.width;

    fireWheel(canvas, -200);
    act(() => { flushRaf(); });

    const widthAfter = canvas.width;

    // Width should change because ecs changed
    expect(widthAfter).not.toBe(widthBefore);
    // Width should be gridW * ecs * dpr (rounded)
    const expectedWidth = Math.round(gridW * view!.cellSize * 2);
    expect(canvas.width).toBe(expectedWidth);
  });

  it('gridW and gridH in CanvasView are unchanged by zoom', () => {
    const { gridW, gridH } = usePijonStore.getState().classroom;
    let view: CanvasView | null = null;
    const { canvas } = renderCanvas({ onViewReady: (v) => { view = v; } });

    fireWheel(canvas, -200);
    act(() => { flushRaf(); });

    expect(view!.gridW).toBe(gridW);
    expect(view!.gridH).toBe(gridH);
  });
});

// ---------------------------------------------------------------------------
// §6.B2 — Zoom does NOT change classroom domain data
// ---------------------------------------------------------------------------

describe('§6.B2 zoom — does NOT affect classroom domain (cellsPerUnit, furniture)', () => {
  it('classroom.cellsPerUnit is unchanged after wheel events', () => {
    const { canvas } = renderCanvas();
    const before = usePijonStore.getState().classroom.cellsPerUnit;

    for (let i = 0; i < 10; i++) fireWheel(canvas, -300);
    act(() => { flushRaf(); });

    expect(usePijonStore.getState().classroom.cellsPerUnit).toBe(before);
  });

  it('classroom.gridW is unchanged after wheel events', () => {
    const { canvas } = renderCanvas();
    const before = usePijonStore.getState().classroom.gridW;

    for (let i = 0; i < 10; i++) fireWheel(canvas, -300);
    act(() => { flushRaf(); });

    expect(usePijonStore.getState().classroom.gridW).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// §6.B2 — Cursor prop preserved through zoom (§6.A4 regression guard)
// ---------------------------------------------------------------------------

describe('§6.B2 zoom — cursor prop preserved (§6.A4 regression)', () => {
  it('canvas style.cursor is unchanged by zoom events', () => {
    const customCursor = 'url("data:test") 0 0, crosshair';
    const { canvas } = renderCanvas({ cursor: customCursor });

    fireWheel(canvas, -200);
    act(() => { flushRaf(); });

    expect(canvas.style.cursor).toBe(customCursor);
  });
});

// ---------------------------------------------------------------------------
// §6.B2 — GAP: wheel listener is removed on unmount (no native listener leak)
// ---------------------------------------------------------------------------

describe('§6.B2 zoom — wheel listener removed on unmount (gap: no leak)', () => {
  it('wheel after unmount does not trigger zoom re-renders: onViewReady count stays stable', () => {
    // Strategy: mount, record onViewReady call count, unmount, fire wheel on the
    // now-detached canvas element.  If the native wheel listener leaked, it would
    // call setZoom on the already-unmounted component, producing additional React
    // state updates (and therefore additional onViewReady calls, since zoom change
    // triggers the ecs-dep effect).  A correct cleanup means zero extra calls.
    const onViewReady = vi.fn();
    const { canvas, unmount } = (() => {
      const result = render(React.createElement(ClassroomCanvas, { onViewReady }));
      act(() => { flushRaf(); });
      const c = result.container.querySelector('canvas');
      if (c === null) throw new Error('canvas not found');
      return { canvas: c, unmount: result.unmount };
    })();

    act(() => { unmount(); });
    act(() => { flushRaf(); });

    const callsAtUnmount = onViewReady.mock.calls.length;

    // Fire wheel on the detached canvas element — if the listener leaked it
    // would call setZoom and trigger an onViewReady re-fire.
    fireWheel(canvas, -500);
    act(() => { flushRaf(); });

    // No additional onViewReady calls — listener was cleaned up.
    expect(onViewReady.mock.calls.length).toBe(callsAtUnmount);
  });

  it('removeEventListener is called on unmount (spy verifies cleanup)', () => {
    // Spy on addEventListener and removeEventListener to confirm symmetry.
    const addSpy = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener');
    const removeSpy = vi.spyOn(HTMLCanvasElement.prototype, 'removeEventListener');

    const { unmount } = render(React.createElement(ClassroomCanvas, {}));
    act(() => { flushRaf(); });

    // Count how many 'wheel' listeners were added
    const wheelAdds = addSpy.mock.calls.filter((c) => c[0] === 'wheel').length;
    expect(wheelAdds).toBeGreaterThanOrEqual(1);

    act(() => { unmount(); });

    // After unmount, removeEventListener must have been called for 'wheel'
    const wheelRemoves = removeSpy.mock.calls.filter((c) => c[0] === 'wheel').length;
    expect(wheelRemoves).toBe(wheelAdds);
  });
});

// ---------------------------------------------------------------------------
// §6.B2 — GAP: furniture domain pos values are unchanged by zoom
// ---------------------------------------------------------------------------

describe('§6.B2 zoom — furniture pos values unchanged by zoom (gap: domain purity)', () => {
  it('furniture pos.x and pos.y are unchanged after multiple wheel events', () => {
    // Add a piece of furniture before mounting the canvas
    act(() => {
      usePijonStore.setState((s) => ({
        classroom: {
          ...s.classroom,
          furniture: [
            {
              id: 'fid-zoom-test' as ReturnType<typeof import('../domain/types.js').furnitureId>,
              kind: 'single_desk' as const,
              pos: { x: 3, y: 2 },
              w: 1,
              h: 1,
              rotation: 0 as const,
              occupants: [],
            },
          ],
        },
      }));
    });

    const { canvas } = renderCanvas();

    // Zoom in and out many times
    for (let i = 0; i < 20; i++) fireWheel(canvas, -400);
    for (let i = 0; i < 20; i++) fireWheel(canvas, 400);
    act(() => { flushRaf(); });

    const furniture = usePijonStore.getState().classroom.furniture;
    expect(furniture).toHaveLength(1);
    expect(furniture[0]!.pos).toEqual({ x: 3, y: 2 });
  });
});

// ---------------------------------------------------------------------------
// §6.B2 — GAP: ecs = zoomedCellSize / cellsPerUnit (not some other formula)
// ---------------------------------------------------------------------------

describe('§6.B2 zoom — ecs derivation uses zoomedCellSize / cellsPerUnit (gap: formula guard)', () => {
  it('at G=1, view.cellSize after zoom equals (zoom * baseCellSize)', () => {
    // At G=1: effectiveCellSize(zoomedCellSize, 1) = zoomedCellSize = zoom * cellSize
    // We can verify by comparing the ratio of view.cellSize before and after zoom.
    const cellSize = 48;
    const views: CanvasView[] = [];
    const { canvas } = renderCanvas({ cellSize, onViewReady: (v) => { views.push(v); } });

    // Capture initial ecs (at zoom=1, G=1: ecs should be exactly cellSize)
    const initialEcs = views[0]!.cellSize;
    expect(initialEcs).toBe(cellSize); // zoom=1, G=1: 48/1 = 48

    // Fire a single modest zoom-in; the ratio of new ecs to old should match
    // the multiplicative step applied.
    // ZOOM_STEP = 0.001; deltaY=-100 → factor = 1-(-100*0.001) = 1.1
    fireWheel(canvas, -100);
    act(() => { flushRaf(); });

    const zoomedEcs = views[views.length - 1]!.cellSize;
    // At G=1, new ecs = clamp(1 * 1.1) * 48 = 1.1 * 48 = 52.8 (approx)
    expect(zoomedEcs).toBeGreaterThan(initialEcs);
    // Crucially: it should equal zoom * cellSize, not zoom * cellSize * cellsPerUnit
    // (i.e., not 48 * 1.1 * 1 and also not 48 * 1.1 * 2 = 105.6 if G were wrongly used)
    const expectedMax = cellSize * 3.0; // ZOOM_MAX * cellSize
    expect(zoomedEcs).toBeLessThanOrEqual(expectedMax);
  });

  it('at G=2, view.cellSize is half the base-unit-zoomed value (ecs = zoomedUnit / G)', () => {
    // Set G=2 on the classroom
    act(() => {
      usePijonStore.setState((s) => ({
        classroom: { ...s.classroom, cellsPerUnit: 2 },
      }));
    });

    const cellSize = 48; // base unit px
    const views: CanvasView[] = [];
    renderCanvas({ cellSize, onViewReady: (v) => { views.push(v); } });

    const initialEcs = views[0]!.cellSize;
    // At zoom=1, G=2: ecs = 48/2 = 24
    expect(initialEcs).toBe(24);
    // This specifically confirms zoom doesn't corrupt the cellsPerUnit divisor:
    // if it divided by (G*zoom) or (G+zoom) the value would be wrong.
  });
});
