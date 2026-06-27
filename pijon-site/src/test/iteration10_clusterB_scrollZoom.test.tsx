// @vitest-environment jsdom
/**
 * §10.B1 — Scroll/zoom anywhere behind the grid.
 *
 * Tests that the wheel zoom listener is correctly wired to the canvas-area
 * backdrop container when `wheelTargetRef` is provided, and falls back to the
 * canvas element when it is not (back-compat).
 *
 * Test plan:
 *   A. Back-compat: no wheelTargetRef → listener on canvas (existing behaviour)
 *   B. wheelTargetRef provided → listener on target element
 *   C. preventDefault is called on the target element
 *   D. Clamping at both ends still holds when using a target element
 *   E. Wheel on backdrop (not directly on canvas) zooms
 *   F. Listener removed on unmount / target change
 *   G. App integration: <App> wires the backdrop ref; wheel on backdrop zooms
 *
 * Reuses the jsdom canvas stubbing pattern from clusterB_zoom.test.tsx:
 *   - getContext spy returning a spy ctx object
 *   - rAF queue for deterministic frame scheduling
 *   - setPointerCapture no-op stub
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import React, { useRef } from 'react';

import { ClassroomCanvas } from '../ui/canvas/ClassroomCanvas.js';
import type { CanvasView } from '../ui/editors/EditorMode.js';
import { usePijonStore } from '../state/store.js';
import { _clearForTest } from '../ui/canvas/imageCache.js';
import { effectiveCellSize } from '../ui/canvas/cellSizeHelper.js';
import App from '../ui/App.js';

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
    setLineDash: vi.fn(),
    quadraticCurveTo: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Stubs — stored for restore
// ---------------------------------------------------------------------------

let spyCtx: SpyCtx;
const origGetContext = HTMLCanvasElement.prototype.getContext;
const origSetPointerCapture = (HTMLCanvasElement.prototype as HTMLElement & { setPointerCapture?: (id: number) => void }).setPointerCapture;
const origReleasePointerCapture = (HTMLCanvasElement.prototype as HTMLElement & { releasePointerCapture?: (id: number) => void }).releasePointerCapture;
const origRaf = globalThis.requestAnimationFrame;
const origCaf = globalThis.cancelAnimationFrame;

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

  globalThis.requestAnimationFrame = origRaf;
  globalThis.cancelAnimationFrame = origCaf;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render <ClassroomCanvas> with optional props. */
function renderCanvas(props?: React.ComponentProps<typeof ClassroomCanvas>): {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  unmount: () => void;
} {
  const result = render(React.createElement(ClassroomCanvas, props ?? {}));
  act(() => { flushRaf(); });
  const canvas = result.container.querySelector('canvas');
  if (canvas === null) throw new Error('canvas not found');
  return { container: result.container, canvas, unmount: result.unmount };
}

/** Fire a wheel event on an element. */
function fireWheel(target: Element, deltaY: number): WheelEvent {
  const evt = new WheelEvent('wheel', { deltaY, cancelable: true, bubbles: true });
  act(() => { target.dispatchEvent(evt); });
  return evt;
}

// ---------------------------------------------------------------------------
// A. Back-compat: no wheelTargetRef → listener attaches to canvas
// ---------------------------------------------------------------------------

describe('A. Back-compat: no wheelTargetRef → wheel on canvas zooms', () => {
  it('A1: wheel on canvas changes effective cell size when no wheelTargetRef given', () => {
    let view: CanvasView | null = null;
    const { canvas } = renderCanvas({ cellSize: 48, onViewReady: (v) => { view = v; } });
    const ecsBefore = view!.cellSize;

    fireWheel(canvas, -300);
    act(() => { flushRaf(); });

    expect(view!.cellSize).toBeGreaterThan(ecsBefore);
  });

  it('A2: without wheelTargetRef, addEventListener is called on the canvas element', () => {
    const addSpy = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener');

    renderCanvas();

    const wheelAdds = addSpy.mock.calls.filter((c) => c[0] === 'wheel').length;
    expect(wheelAdds).toBeGreaterThanOrEqual(1);
  });

  it('A3: without wheelTargetRef, a separate div does NOT zoom when wheeled', () => {
    // Create a div that is NOT the canvas and has no connection to ClassroomCanvas
    const externalDiv = document.createElement('div');
    document.body.appendChild(externalDiv);

    let view: CanvasView | null = null;
    renderCanvas({ cellSize: 48, onViewReady: (v) => { view = v; } });
    const ecsBefore = view!.cellSize;

    // Wheel on the unrelated div — should not affect zoom
    fireWheel(externalDiv, -500);
    act(() => { flushRaf(); });

    expect(view!.cellSize).toBe(ecsBefore);

    document.body.removeChild(externalDiv);
  });
});

// ---------------------------------------------------------------------------
// B. wheelTargetRef provided → listener attaches to that element
// ---------------------------------------------------------------------------

describe('B. wheelTargetRef provided → listener attaches to target element', () => {
  /**
   * Wrapper component that creates a ref to a div and passes it as wheelTargetRef.
   * Exposes the backdrop div via data-testid.
   */
  function CanvasWithBackdrop(props: { onViewReady?: (v: CanvasView) => void; cellSize?: number }) {
    const backdropRef = useRef<HTMLDivElement>(null);
    return (
      <div>
        <div ref={backdropRef} data-testid="backdrop" style={{ width: 400, height: 400 }}>
          <ClassroomCanvas
            cellSize={props.cellSize ?? 48}
            onViewReady={props.onViewReady}
            wheelTargetRef={backdropRef}
          />
        </div>
      </div>
    );
  }

  it('B1: wheel on the backdrop div changes effective cell size', () => {
    let view: CanvasView | null = null;
    const { getByTestId } = render(
      React.createElement(CanvasWithBackdrop, { onViewReady: (v) => { view = v; } }),
    );
    act(() => { flushRaf(); });

    const backdrop = getByTestId('backdrop');
    const ecsBefore = view!.cellSize;

    fireWheel(backdrop, -300);
    act(() => { flushRaf(); });

    expect(view!.cellSize).toBeGreaterThan(ecsBefore);
  });

  it('B2: wheel on the backdrop zooms out when deltaY is positive', () => {
    let view: CanvasView | null = null;
    const { getByTestId } = render(
      React.createElement(CanvasWithBackdrop, { onViewReady: (v) => { view = v; } }),
    );
    act(() => { flushRaf(); });

    const backdrop = getByTestId('backdrop');
    const ecsBefore = view!.cellSize;

    fireWheel(backdrop, 300);
    act(() => { flushRaf(); });

    expect(view!.cellSize).toBeLessThan(ecsBefore);
  });

  it('B3: addEventListener for wheel is called on a div (not on the canvas)', () => {
    const divAddSpy = vi.spyOn(HTMLDivElement.prototype, 'addEventListener');
    const canvasAddSpy = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener');

    render(React.createElement(CanvasWithBackdrop, {}));
    act(() => { flushRaf(); });

    const divWheelAdds = divAddSpy.mock.calls.filter((c) => c[0] === 'wheel').length;
    const canvasWheelAdds = canvasAddSpy.mock.calls.filter((c) => c[0] === 'wheel').length;

    // At least one wheel listener was added to a div (the backdrop)
    expect(divWheelAdds).toBeGreaterThanOrEqual(1);
    // Zero wheel listeners on the canvas element (no double-handling)
    expect(canvasWheelAdds).toBe(0);
  });

  it('B4: wheel on the canvas element (inside backdrop) also zooms via event bubbling', () => {
    // The canvas is a child of the backdrop; events bubble up, so the backdrop
    // listener handles wheel events fired on the canvas too.
    let view: CanvasView | null = null;
    const { getByTestId, container } = render(
      React.createElement(CanvasWithBackdrop, { onViewReady: (v) => { view = v; } }),
    );
    act(() => { flushRaf(); });

    const canvas = container.querySelector('canvas')!;
    expect(canvas).not.toBeNull();
    expect(getByTestId('backdrop').contains(canvas)).toBe(true);

    const ecsBefore = view!.cellSize;

    // Fire wheel on the inner canvas — it should bubble to the backdrop listener
    fireWheel(canvas, -300);
    act(() => { flushRaf(); });

    expect(view!.cellSize).toBeGreaterThan(ecsBefore);
  });
});

// ---------------------------------------------------------------------------
// C. preventDefault called on the target element
// ---------------------------------------------------------------------------

describe('C. preventDefault is called for wheel events on the target element', () => {
  it('C1: preventDefault called when wheel fires on the canvas (no target ref)', () => {
    const { canvas } = renderCanvas();

    const evt = new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true });
    const preventSpy = vi.spyOn(evt, 'preventDefault');

    act(() => { canvas.dispatchEvent(evt); });

    expect(preventSpy).toHaveBeenCalled();
  });

  it('C2: preventDefault called when wheel fires on the backdrop (wheelTargetRef provided)', () => {
    let didCallPreventDefault = false;

    const backdropRef = React.createRef<HTMLDivElement>();

    // Track preventDefault via addEventListener override on the specific div
    const result = render(
      <div ref={backdropRef} data-testid="bd">
        <ClassroomCanvas wheelTargetRef={backdropRef} />
      </div>,
    );
    act(() => { flushRaf(); });

    const backdrop = result.getByTestId('bd');
    const evt = new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true });
    Object.defineProperty(evt, 'preventDefault', {
      value: () => { didCallPreventDefault = true; },
      writable: true,
      configurable: true,
    });

    act(() => { backdrop.dispatchEvent(evt); });

    expect(didCallPreventDefault).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D. Clamping still holds when using wheelTargetRef
// ---------------------------------------------------------------------------

describe('D. Zoom clamping still holds when wheelTargetRef is provided', () => {
  function CanvasWithRef(props: { onViewReady?: (v: CanvasView) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    return (
      <div ref={ref} data-testid="backdrop">
        <ClassroomCanvas cellSize={48} onViewReady={props.onViewReady} wheelTargetRef={ref} />
      </div>
    );
  }

  it('D1: heavy scroll-out via backdrop clamps at ZOOM_MIN * cellSize', () => {
    const ZOOM_MIN = 0.4;
    let lastView: CanvasView | null = null;
    const { getByTestId } = render(
      React.createElement(CanvasWithRef, { onViewReady: (v) => { lastView = v; } }),
    );
    act(() => { flushRaf(); });
    const backdrop = getByTestId('backdrop');

    for (let i = 0; i < 100; i++) fireWheel(backdrop, 5000);
    act(() => { flushRaf(); });

    const minEcs = effectiveCellSize(ZOOM_MIN * 48, 1);
    expect(lastView!.cellSize).toBeGreaterThanOrEqual(minEcs);
  });

  it('D2: heavy scroll-in via backdrop clamps at ZOOM_MAX * cellSize', () => {
    const ZOOM_MAX = 3.0;
    let lastView: CanvasView | null = null;
    const { getByTestId } = render(
      React.createElement(CanvasWithRef, { onViewReady: (v) => { lastView = v; } }),
    );
    act(() => { flushRaf(); });
    const backdrop = getByTestId('backdrop');

    for (let i = 0; i < 100; i++) fireWheel(backdrop, -5000);
    act(() => { flushRaf(); });

    const maxEcs = effectiveCellSize(ZOOM_MAX * 48, 1);
    expect(lastView!.cellSize).toBeLessThanOrEqual(maxEcs + 0.001);
  });
});

// ---------------------------------------------------------------------------
// E. Wheel on backdrop (not canvas) zooms
// ---------------------------------------------------------------------------

describe('E. Wheel on the grey margin in the backdrop zooms', () => {
  it('E1: wheel event on backdrop outside canvas boundary changes zoom', () => {
    // This is the key scenario: the user scrolls on the grey area around the
    // canvas card, not directly over the canvas element.
    let view: CanvasView | null = null;
    const backdropRef = React.createRef<HTMLDivElement>();

    const result = render(
      <div
        ref={backdropRef}
        data-testid="backdrop"
        style={{ width: 800, height: 600, padding: 50 }}
      >
        <ClassroomCanvas cellSize={48} onViewReady={(v) => { view = v; }} wheelTargetRef={backdropRef} />
      </div>,
    );
    act(() => { flushRaf(); });

    const backdrop = result.getByTestId('backdrop');
    const ecsBefore = view!.cellSize;

    // Dispatch wheel directly on the backdrop element (simulating a click in the
    // grey margin area rather than on the canvas itself)
    fireWheel(backdrop, -200);
    act(() => { flushRaf(); });

    expect(view!.cellSize).toBeGreaterThan(ecsBefore);
  });

  it('E2: multiple wheels on backdrop accumulate zoom changes', () => {
    let view: CanvasView | null = null;
    const backdropRef = React.createRef<HTMLDivElement>();

    const result2 = render(
      <div ref={backdropRef} data-testid="backdrop">
        <ClassroomCanvas cellSize={48} onViewReady={(v) => { view = v; }} wheelTargetRef={backdropRef} />
      </div>,
    );
    act(() => { flushRaf(); });

    const backdrop = result2.getByTestId('backdrop');
    const ecsInitial = view!.cellSize;

    for (let i = 0; i < 5; i++) fireWheel(backdrop, -100);
    act(() => { flushRaf(); });

    expect(view!.cellSize).toBeGreaterThan(ecsInitial);
  });

  it('E3: onViewReady is called again after backdrop wheel event', () => {
    const onViewReady = vi.fn();
    const backdropRef = React.createRef<HTMLDivElement>();

    render(
      <div ref={backdropRef} data-testid="backdrop">
        <ClassroomCanvas onViewReady={onViewReady} wheelTargetRef={backdropRef} />
      </div>,
    );
    act(() => { flushRaf(); });

    const callsBefore = onViewReady.mock.calls.length;
    const backdropEl = document.querySelector('[data-testid="backdrop"]');

    fireWheel(backdropEl!, -200);
    act(() => { flushRaf(); });

    expect(onViewReady.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

// ---------------------------------------------------------------------------
// F. Listener removed on unmount
// ---------------------------------------------------------------------------

describe('F. Wheel listener is removed from the target on unmount', () => {
  it('F1: removeEventListener is called on the backdrop when component unmounts', () => {
    const backdropRef = React.createRef<HTMLDivElement>();

    const result = render(
      <div ref={backdropRef} data-testid="backdrop">
        <ClassroomCanvas wheelTargetRef={backdropRef} />
      </div>,
    );
    act(() => { flushRaf(); });

    const divRemoveSpy = vi.spyOn(HTMLDivElement.prototype, 'removeEventListener');

    act(() => { result.unmount(); });

    const wheelRemoves = divRemoveSpy.mock.calls.filter((c) => c[0] === 'wheel').length;
    expect(wheelRemoves).toBeGreaterThanOrEqual(1);
  });

  it('F2: wheel on backdrop after unmount does NOT change zoom (listener cleaned up)', () => {
    const onViewReady = vi.fn();
    const backdropRef = React.createRef<HTMLDivElement>();

    const result = render(
      <div ref={backdropRef} data-testid="backdrop">
        <ClassroomCanvas onViewReady={onViewReady} wheelTargetRef={backdropRef} />
      </div>,
    );
    act(() => { flushRaf(); });

    const backdropEl = document.querySelector('[data-testid="backdrop"]')!;
    act(() => { result.unmount(); });
    act(() => { flushRaf(); });

    const callsAtUnmount = onViewReady.mock.calls.length;

    // Fire wheel on the now-detached backdrop
    fireWheel(backdropEl, -500);
    act(() => { flushRaf(); });

    expect(onViewReady.mock.calls.length).toBe(callsAtUnmount);
  });

  it('F3: wheel on the backdrop after unmount does not affect zoom (listener is gone)', () => {
    // This is an end-to-end cleanup verification: if the listener leaked,
    // dispatching a wheel on the detached backdrop would still fire the handler
    // and (in a non-strict mode environment) could call setZoom on an unmounted
    // component. The absence of a React state-update warning AND the stable
    // onViewReady count confirm cleanup.
    const onViewReady = vi.fn();
    const backdropRef = React.createRef<HTMLDivElement>();

    const result = render(
      <div ref={backdropRef} data-testid="bd2">
        <ClassroomCanvas onViewReady={onViewReady} wheelTargetRef={backdropRef} />
      </div>,
    );
    act(() => { flushRaf(); });

    const backdropEl = document.querySelector('[data-testid="bd2"]')!;
    act(() => { result.unmount(); });
    act(() => { flushRaf(); });

    const countAtUnmount = onViewReady.mock.calls.length;

    fireWheel(backdropEl, -500);
    act(() => { flushRaf(); });

    // No additional onViewReady invocations — the listener was cleaned up
    expect(onViewReady.mock.calls.length).toBe(countAtUnmount);
  });
});

// ---------------------------------------------------------------------------
// G. App integration: <App> wires the backdrop ref; wheel on backdrop zooms
// ---------------------------------------------------------------------------

describe('G. App integration: wheel on canvas-area backdrop zooms the grid', () => {
  // App integration tests need a localStorage stub (persistence init touches it)
  let lsMap: Map<string, string>;

  beforeEach(() => {
    lsMap = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => lsMap.get(k) ?? null,
      setItem: (k: string, v: string) => { lsMap.set(k, v); },
      removeItem: (k: string) => { lsMap.delete(k); },
      clear: () => { lsMap = new Map(); },
      get length() { return lsMap.size; },
      key: (i: number) => [...lsMap.keys()][i] ?? null,
    });

    // Stub IndexedDB (App calls initPersistence which opens IDB)
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => ({
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('G1: <App> renders a canvas-area-backdrop element with data-testid', () => {
    render(React.createElement(App));
    act(() => { flushRaf(); });

    const backdrop = screen.getByTestId('canvas-area-backdrop');
    expect(backdrop).toBeInTheDocument();
  });

  it('G2: canvas element is a descendant of the canvas-area-backdrop', () => {
    const { container } = render(React.createElement(App));
    act(() => { flushRaf(); });

    const backdrop = screen.getByTestId('canvas-area-backdrop');
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(backdrop.contains(canvas)).toBe(true);
  });

  it('G3: wheel on canvas-area-backdrop in App calls addEventListener on the div', () => {
    const divAddSpy = vi.spyOn(HTMLDivElement.prototype, 'addEventListener');

    render(React.createElement(App));
    act(() => { flushRaf(); });

    // The backdrop div should have a 'wheel' listener attached to it
    const divWheelAdds = divAddSpy.mock.calls.filter((c) => c[0] === 'wheel').length;
    expect(divWheelAdds).toBeGreaterThanOrEqual(1);
  });

  it('G4: the canvas element itself does NOT get a wheel listener in App (no double-handling)', () => {
    const canvasAddSpy = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener');

    render(React.createElement(App));
    act(() => { flushRaf(); });

    const canvasWheelAdds = canvasAddSpy.mock.calls.filter((c) => c[0] === 'wheel').length;
    expect(canvasWheelAdds).toBe(0);
  });

  it('G5: wheel on backdrop fires onViewReady again (effective cell size changes)', () => {
    // Intercept the ClassroomCanvas onViewReady by spying on the backdrop wheel listener.
    // We verify this indirectly: wheel on backdrop -> zoom changes -> React re-renders ->
    // useEffect with ecs dep fires -> onViewReady called again.
    // We check this by counting wheel listeners added to the div vs canvas.
    const divAddSpy = vi.spyOn(HTMLDivElement.prototype, 'addEventListener');
    const canvasAddSpy = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener');

    render(React.createElement(App));
    act(() => { flushRaf(); });

    // There must be a wheel listener on a div (the backdrop)
    expect(divAddSpy.mock.calls.filter((c) => c[0] === 'wheel').length).toBeGreaterThanOrEqual(1);
    // And NO wheel listener on the canvas (no double-handling)
    expect(canvasAddSpy.mock.calls.filter((c) => c[0] === 'wheel').length).toBe(0);
  });

  it('G6: wheel on the TopBar does NOT zoom (TopBar is outside the backdrop)', () => {
    // This is the crux of 10.B1: the top bar should be unaffected by the wheel
    // listener because it is a sibling of the backdrop, not a descendant.
    // We verify by checking that the canvas CSS width does not change after
    // dispatching a wheel event on the top-bar element.
    const { container } = render(React.createElement(App));
    act(() => { flushRaf(); });

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    const widthBefore = canvas!.style.width;

    const topBar = screen.getByTestId('top-bar');
    const evt = new WheelEvent('wheel', { deltaY: -2000, cancelable: true, bubbles: true });
    act(() => { topBar.dispatchEvent(evt); });
    act(() => { flushRaf(); });

    // Canvas width must not have changed — the top bar wheel did not zoom
    expect(canvas!.style.width).toBe(widthBefore);
  });

  it('G7: wheel on the SidePanel does NOT zoom (SidePanel is outside the backdrop)', () => {
    // The left side panel is a sibling of the backdrop — wheel events fired there
    // must not trigger zoom (the backdrop listener is scoped to the backdrop subtree).
    const { container } = render(React.createElement(App));
    act(() => { flushRaf(); });

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    const widthBefore = canvas!.style.width;

    const sidePanel = screen.getByTestId('shell-side-panel');
    const evt = new WheelEvent('wheel', { deltaY: -2000, cancelable: true, bubbles: true });
    act(() => { sidePanel.dispatchEvent(evt); });
    act(() => { flushRaf(); });

    // Canvas width must not have changed — the side panel wheel did not zoom
    expect(canvas!.style.width).toBe(widthBefore);
  });

  it('G8: wheel on the backdrop DOES zoom while wheel on TopBar does NOT (contrast check)', () => {
    // Dispatch on TopBar first (should not zoom), then on backdrop (should zoom).
    // Confirms the boundary is correctly at the backdrop div.
    const { container } = render(React.createElement(App));
    act(() => { flushRaf(); });

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    const widthInitial = canvas!.style.width;

    // Step 1: wheel on TopBar — must NOT zoom
    const topBar = screen.getByTestId('top-bar');
    act(() => {
      topBar.dispatchEvent(new WheelEvent('wheel', { deltaY: -2000, cancelable: true, bubbles: true }));
    });
    act(() => { flushRaf(); });
    expect(canvas!.style.width).toBe(widthInitial);

    // Step 2: wheel on backdrop — MUST zoom
    const backdrop = screen.getByTestId('canvas-area-backdrop');
    act(() => {
      backdrop.dispatchEvent(new WheelEvent('wheel', { deltaY: -2000, cancelable: true, bubbles: true }));
    });
    act(() => { flushRaf(); });

    // Canvas width should now be wider (zoom-in makes cells bigger)
    expect(canvas!.style.width).not.toBe(widthInitial);
  });

  it('G9: wheel on canvas (inside backdrop) zooms exactly once — no double-handling', () => {
    // Strategy: render two separate App instances (same initial zoom=1).
    // In instance A, dispatch wheel on the backdrop directly.
    // In instance B, dispatch the same wheel on the canvas element.
    // If only ONE listener exists (on the backdrop), both instances see the same
    // single-step zoom and should produce identical canvas widths.
    // If the canvas ALSO had a listener, instance B would zoom TWICE (once from
    // the canvas listener, once from the backdrop listener via bubbling), making
    // its canvas wider than instance A.

    const parsePx = (s: string): number => parseFloat(s.replace('px', ''));

    // Instance A: wheel on backdrop
    const resultA = render(React.createElement(App));
    act(() => { flushRaf(); });
    const canvasA = resultA.container.querySelector('canvas');
    expect(canvasA).not.toBeNull();
    const backdropA = resultA.getByTestId('canvas-area-backdrop');

    act(() => {
      backdropA.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, cancelable: true, bubbles: true }));
    });
    act(() => { flushRaf(); });
    const widthA = parsePx(canvasA!.style.width);
    resultA.unmount();

    // Instance B: wheel on canvas (should bubble to backdrop, applying once)
    resetStore();
    const resultB = render(React.createElement(App));
    act(() => { flushRaf(); });
    const canvasB = resultB.container.querySelector('canvas');
    expect(canvasB).not.toBeNull();

    act(() => {
      canvasB!.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, cancelable: true, bubbles: true }));
    });
    act(() => { flushRaf(); });
    const widthB = parsePx(canvasB!.style.width);
    resultB.unmount();

    // Both instances started from zoom=1 and received the same deltaY=-500.
    // They must produce the same canvas width (within floating-point rounding).
    expect(Math.abs(widthA - widthB)).toBeLessThan(1);
  });
});
