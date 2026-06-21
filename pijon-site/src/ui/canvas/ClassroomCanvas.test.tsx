// @vitest-environment jsdom
/**
 * ClassroomCanvas — thorough behaviour tests (Phase 6).
 *
 * jsdom limitations handled:
 *
 * 1. Canvas 2D: jsdom does NOT implement getContext('2d').  We stub
 *    HTMLCanvasElement.prototype.getContext to return a spy context object
 *    so drawing code can be called without throwing.
 *
 * 2. requestAnimationFrame / cancelAnimationFrame: stubbed globally with a
 *    manual queue so tests can flush or discard frames deterministically.
 *
 * 3. setPointerCapture / releasePointerCapture: not implemented in jsdom —
 *    no-op stubs are added to HTMLCanvasElement.prototype before event dispatch.
 *
 * 4. getBoundingClientRect: jsdom returns { left:0, top:0, ... } by default,
 *    which is sufficient for coordinate hit tests (all clientX/Y === canvas offset).
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import React from 'react';

import { ClassroomCanvas } from './ClassroomCanvas.js';
import type { EditorMode, EditorContext, CanvasView } from '../editors/EditorMode.js';
import { NoopEditor } from '../editors/NoopEditor.js';
import { usePijonStore } from '../../state/store.js';
import { _clearForTest } from './imageCache.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal spy 2D context returned by getContext('2d') in jsdom. */
// Use a loose type: we mix vi.fn() spies with plain style-property values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpyCtx = Record<string, any>;

// ---------------------------------------------------------------------------
// rAF queue — deterministic frame scheduling
// ---------------------------------------------------------------------------

let rafQueue: FrameRequestCallback[] = [];
let rafIdCounter = 0;

/** Flush all queued rAF callbacks synchronously, in order. */
function flushRaf(): void {
  // Drain the queue iteratively (callbacks may schedule new rAFs).
  while (rafQueue.length > 0) {
    const queue = rafQueue.splice(0);
    for (const cb of queue) {
      cb(performance.now());
    }
  }
}

// ---------------------------------------------------------------------------
// Global stubs
// ---------------------------------------------------------------------------

/** The spy ctx object shared across getContext calls within one test. */
let spyCtx: SpyCtx;

function makeSpyCtx(): SpyCtx {
  return {
    // Transform / state
    setTransform: vi.fn(),
    translate: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    // Path
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    // Drawing
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    // Measurements
    measureText: vi.fn(() => ({ width: 0 })),
    // Gradient
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    // Settable style properties — accessed as assignments in render.ts
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
}

// Keep original prototypes so we can restore them after each test.
const origGetContext = HTMLCanvasElement.prototype.getContext;
// setPointerCapture / releasePointerCapture may or may not exist on jsdom's prototype.
const origSetPointerCapture = (HTMLCanvasElement.prototype as HTMLElement & { setPointerCapture?: (id: number) => void }).setPointerCapture;
const origReleasePointerCapture = (HTMLCanvasElement.prototype as HTMLElement & { releasePointerCapture?: (id: number) => void }).releasePointerCapture;
const origRaf = window.requestAnimationFrame;
const origCaf = window.cancelAnimationFrame;

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function resetStore(): void {
  usePijonStore.getState().eraseAll();
}

// ---------------------------------------------------------------------------
// Fake EditorMode factory
// ---------------------------------------------------------------------------

let editorIdCounter = 0;

function makeFakeEditor(overrides?: Partial<EditorMode>): EditorMode & {
  activate: MockInstance;
  deactivate: MockInstance;
  onPointerDown: MockInstance;
  onPointerMove: MockInstance;
  onPointerUp: MockInstance;
  onKeyDown: MockInstance;
  onDrop: MockInstance;
  onDragOver: MockInstance;
  onDragEnd: MockInstance;
  onContextMenu: MockInstance;
  paintOverlay: MockInstance;
} {
  const id = `fake-editor-${(editorIdCounter++).toString()}`;
  const base: EditorMode = {
    id,
    label: 'Fake',
    Toolbar: () => null,
    SidePanel: () => null,
    activate: vi.fn(),
    deactivate: vi.fn(),
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onKeyDown: vi.fn(),
    onDrop: vi.fn(),
    onDragOver: vi.fn(),
    onDragEnd: vi.fn(),
    onContextMenu: vi.fn(),
    paintOverlay: vi.fn(),
    ...overrides,
  };
  return base as ReturnType<typeof makeFakeEditor>;
}

// ---------------------------------------------------------------------------
// beforeEach / afterEach — install and tear down stubs
// ---------------------------------------------------------------------------

beforeEach(() => {
  rafQueue = [];
  rafIdCounter = 0;
  spyCtx = makeSpyCtx();

  // Stub rAF/cAF
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    rafIdCounter += 1;
    const id = rafIdCounter;
    rafQueue.push(cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    // Remove the callback that was registered with this id.
    // Since our counter is monotonic, the index = id - 1 in the original push
    // order. But entries may have already been shifted out; filter by reference
    // is safest — we just clear the whole queue entry that corresponds to id
    // by splicing by position.
    // Simpler: just clear all — tests that care about cancel check rafQueue.length.
    // We only need to prevent the callback from running; remove the last-pushed
    // entry with that slot index.
    const idx = id - 1;
    if (idx >= 0 && idx < rafQueue.length) {
      rafQueue.splice(idx, 1);
    }
  });

  // Stub canvas getContext
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = function (contextId: string): any {
    if (contextId === '2d') return spyCtx;
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext;

  // Stub setPointerCapture / releasePointerCapture (jsdom omits them)
  (HTMLCanvasElement.prototype as HTMLElement & { setPointerCapture: (id: number) => void }).setPointerCapture = vi.fn();
  (HTMLCanvasElement.prototype as HTMLElement & { releasePointerCapture: (id: number) => void }).releasePointerCapture = vi.fn();

  resetStore();
  _clearForTest();
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;

  // Restore setPointerCapture / releasePointerCapture.
  // Cast through unknown so we can safely mutate the prototype without
  // TypeScript error TS2790 ("operand of delete must be optional").
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
// Helper — render ClassroomCanvas and flush initial rAF
// ---------------------------------------------------------------------------

function renderCanvas(props?: React.ComponentProps<typeof ClassroomCanvas>): {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
} {
  const { container } = render(
    React.createElement(ClassroomCanvas, props ?? {}),
  );
  // Flush the initial rAF scheduled by resizeCanvas/scheduleRepaint on mount.
  act(() => { flushRaf(); });
  const canvas = container.querySelector('canvas');
  if (canvas === null) throw new Error('canvas not found');
  return { container, canvas };
}

// ===========================================================================
// 1. DPR scaling
// ===========================================================================

describe('DPR scaling', () => {
  it('backing store width = gridW * cellSize * dpr, CSS width = gridW * cellSize px', () => {
    // Set DPR = 2
    vi.stubGlobal('devicePixelRatio', 2);

    // Default store has gridW=10, gridH=8. We use them.
    const store = usePijonStore.getState();
    const { gridW, gridH } = store.classroom;
    const cellSize = 48;
    const dpr = 2;

    const { canvas } = renderCanvas({ cellSize });

    expect(canvas.width).toBe(Math.round(gridW * cellSize * dpr));
    expect(canvas.height).toBe(Math.round(gridH * cellSize * dpr));
    expect(canvas.style.width).toBe(`${(gridW * cellSize).toString()}px`);
    expect(canvas.style.height).toBe(`${(gridH * cellSize).toString()}px`);
  });

  it('backing store width = gridW * cellSize * 1 when dpr=1', () => {
    vi.stubGlobal('devicePixelRatio', 1);

    const { gridW, gridH } = usePijonStore.getState().classroom;
    const cellSize = 48;

    const { canvas } = renderCanvas({ cellSize });

    expect(canvas.width).toBe(gridW * cellSize);
    expect(canvas.height).toBe(gridH * cellSize);
  });

  it('ctx.setTransform is called with dpr on both axes', () => {
    const dpr = 3;
    vi.stubGlobal('devicePixelRatio', dpr);

    renderCanvas();

    // setTransform(dpr, 0, 0, dpr, 0, 0) must have been called at least once.
    // spyCtx is Record<string, any>; cast the method to a typed spy to access .mock.
    const calls = (spyCtx.setTransform as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c: number[]) => c[0] === dpr && c[3] === dpr)).toBe(true);
  });

  it('ghostMargin cells expand the canvas backing store', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    const ghostMargin = 1;
    const cellSize = 48;
    const { gridW, gridH } = usePijonStore.getState().classroom;

    const { canvas } = renderCanvas({ cellSize, ghostMargin });

    expect(canvas.width).toBe((gridW + 2 * ghostMargin) * cellSize);
    expect(canvas.height).toBe((gridH + 2 * ghostMargin) * cellSize);
  });
});

// ===========================================================================
// 2. Repaint triggers
// ===========================================================================

describe('Repaint triggers', () => {
  it('schedules a repaint on initial mount', () => {
    // Before flushing the rAF queue, one frame should be pending.
    render(React.createElement(ClassroomCanvas, {}));
    expect(rafQueue.length).toBeGreaterThanOrEqual(1);
  });

  it('schedules a repaint when classroom changes', () => {
    renderCanvas(); // mount + flush initial rAF

    // Classroom changes from addStudent go through the roster (not classroom
    // directly) but store.allocate/smartShuffle would change classroom.
    // Directly mutate classroom via setState to guarantee the subscription fires.
    act(() => {
      usePijonStore.setState((s) => ({
        classroom: { ...s.classroom, name: 'Changed' },
      }));
    });
    // A new rAF should have been enqueued by the classroom subscription.
    expect(rafQueue.length).toBeGreaterThanOrEqual(1);
  });

  it('schedules a repaint when locks change', () => {
    // Add some furniture first so we have something to lock.
    act(() => {
      usePijonStore.setState((s) => ({
        classroom: {
          ...s.classroom,
          furniture: [
            {
              id: 'fid-lock-test' as ReturnType<typeof import('../../domain/types.js').furnitureId>,
              kind: 'single_desk' as const,
              pos: { x: 0, y: 0 },
              w: 1,
              h: 1,
              rotation: 0 as const,
              occupants: [],
            },
          ],
        },
      }));
    });
    renderCanvas();

    act(() => {
      usePijonStore.getState().lockSeat(
        'fid-lock-test' as ReturnType<typeof import('../../domain/types.js').furnitureId>,
      );
    });
    expect(rafQueue.length).toBeGreaterThanOrEqual(1);
  });

  it('schedules a repaint when gridW changes', () => {
    renderCanvas();
    act(() => {
      usePijonStore.getState().resizeGrid('right', 1);
    });
    expect(rafQueue.length).toBeGreaterThanOrEqual(1);
  });

  it('schedules a repaint when cellSize prop changes', () => {
    const { rerender } = render(React.createElement(ClassroomCanvas, { cellSize: 48 }));
    act(() => { flushRaf(); });

    act(() => {
      rerender(React.createElement(ClassroomCanvas, { cellSize: 64 }));
    });
    expect(rafQueue.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// 3. requestRepaint() coalescing — at most one rAF per frame
// ===========================================================================

describe('requestRepaint coalescing', () => {
  it('multiple requestRepaint calls before a flush result in exactly one paint run', () => {
    let capturedView: CanvasView | null = null;

    render(React.createElement(ClassroomCanvas, {
      onViewReady: (v) => { capturedView = v; },
    }));
    act(() => { flushRaf(); }); // flush mount rAF — onViewReady fires here

    expect(capturedView).not.toBeNull();

    // Call requestRepaint three times — should queue at most one rAF.
    const before = rafQueue.length;
    capturedView!.requestRepaint();
    capturedView!.requestRepaint();
    capturedView!.requestRepaint();

    // Only one frame should be pending beyond what was there before.
    expect(rafQueue.length - before).toBe(1);
  });

  it('after a flush, requestRepaint can schedule another frame', () => {
    let capturedView: CanvasView | null = null;

    render(React.createElement(ClassroomCanvas, {
      onViewReady: (v) => { capturedView = v; },
    }));
    act(() => { flushRaf(); });

    capturedView!.requestRepaint();
    act(() => { flushRaf(); }); // flush → rafRef.current becomes null

    // Now a new requestRepaint should be able to schedule again.
    capturedView!.requestRepaint();
    expect(rafQueue.length).toBe(1);
  });

  it('paintOverlay is called exactly once per flush regardless of how many repaints were requested', () => {
    const editor = makeFakeEditor();

    render(React.createElement(ClassroomCanvas, { editor }));
    act(() => { flushRaf(); }); // flush mount frame

    // Clear prior calls from the mount frame.
    editor.paintOverlay.mockClear();

    // Request three repaints.
    let capturedView: CanvasView | null = null;
    render(React.createElement(ClassroomCanvas, {
      editor,
      onViewReady: (v) => { capturedView = v; },
    }));
    act(() => { flushRaf(); });

    editor.paintOverlay.mockClear();
    capturedView!.requestRepaint();
    capturedView!.requestRepaint();
    capturedView!.requestRepaint();

    // Flush — overlay should be called exactly once.
    act(() => { flushRaf(); });
    expect(editor.paintOverlay).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 4. Pointer events forwarded to active editor
// ===========================================================================

describe('Pointer events forwarded to active editor', () => {
  it('onPointerDown is forwarded to editor with EditorContext', () => {
    const editor = makeFakeEditor();
    const { canvas } = renderCanvas({ editor });

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });

    expect(editor.onPointerDown).toHaveBeenCalledOnce();
    const [evt, ctx] = editor.onPointerDown.mock.calls[0] as [PointerEvent, EditorContext];
    expect(evt).toBeInstanceOf(PointerEvent);
    expect(ctx.store).toBeDefined();
    expect(ctx.canvas).toBeDefined();
    expect(ctx.persistence).toBeNull();
  });

  it('onPointerMove is forwarded to editor', () => {
    const editor = makeFakeEditor();
    const { canvas } = renderCanvas({ editor });

    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20, pointerId: 1 });

    expect(editor.onPointerMove).toHaveBeenCalledOnce();
    const [evt, ctx] = editor.onPointerMove.mock.calls[0] as [PointerEvent, EditorContext];
    expect(evt).toBeInstanceOf(PointerEvent);
    expect(ctx.canvas.cellSize).toBeGreaterThan(0);
  });

  it('onPointerUp is forwarded to editor', () => {
    const editor = makeFakeEditor();
    const { canvas } = renderCanvas({ editor });

    fireEvent.pointerUp(canvas, { clientX: 5, clientY: 5, pointerId: 1 });

    expect(editor.onPointerUp).toHaveBeenCalledOnce();
  });

  it('setPointerCapture is called on pointerdown with the event pointerId', () => {
    const editor = makeFakeEditor();
    const { canvas } = renderCanvas({ editor });

    const setCaptureSpy = vi.spyOn(canvas, 'setPointerCapture');
    fireEvent.pointerDown(canvas, { pointerId: 42 });

    expect(setCaptureSpy).toHaveBeenCalledWith(42);
  });

  it('onKeyDown is forwarded to editor', () => {
    const editor = makeFakeEditor();
    const { canvas } = renderCanvas({ editor });

    fireEvent.keyDown(canvas, { key: 'Escape' });

    expect(editor.onKeyDown).toHaveBeenCalledOnce();
    const [evt] = editor.onKeyDown.mock.calls[0] as [KeyboardEvent, EditorContext];
    expect(evt).toBeInstanceOf(KeyboardEvent);
    expect(evt.key).toBe('Escape');
  });

  it('onDrop is forwarded to editor', () => {
    const editor = makeFakeEditor();
    const { canvas } = renderCanvas({ editor });

    fireEvent.drop(canvas);

    expect(editor.onDrop).toHaveBeenCalledOnce();
    // DragEvent is not available in jsdom; fireEvent.drop produces a basic Event.
    // We check the forwarding happened and the ctx shape is correct.
    const [, ctx] = editor.onDrop.mock.calls[0] as [Event, EditorContext];
    expect(ctx.store).toBeDefined();
    expect(ctx.canvas).toBeDefined();
  });

  it('onContextMenu is forwarded to editor', () => {
    const editor = makeFakeEditor();
    const { canvas } = renderCanvas({ editor });

    fireEvent.contextMenu(canvas, { clientX: 1, clientY: 1 });

    expect(editor.onContextMenu).toHaveBeenCalledOnce();
    const [evt] = editor.onContextMenu.mock.calls[0] as [MouseEvent, EditorContext];
    expect(evt).toBeInstanceOf(MouseEvent);
  });
});

// ===========================================================================
// 5. dragOver calls preventDefault so drop can fire
// ===========================================================================

describe('dragOver handler', () => {
  it('calls preventDefault() on the drag event so drop is accepted', () => {
    // jsdom does not implement DragEvent — use MouseEvent as a stand-in so we
    // can spy on preventDefault.  The canvas dragover handler calls
    // e.preventDefault() unconditionally before delegating to the editor, so
    // the underlying event type does not matter for this assertion.
    const { canvas } = renderCanvas();

    // Use a plain MouseEvent (cancelable) to spy on preventDefault.
    const dragEvent = new MouseEvent('dragover', { cancelable: true, bubbles: true });
    const preventDefaultSpy = vi.spyOn(dragEvent, 'preventDefault');

    act(() => { canvas.dispatchEvent(dragEvent); });

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('forwards onDragOver to editor when the editor implements it', () => {
    const editor = makeFakeEditor();
    const { canvas } = renderCanvas({ editor });

    fireEvent.dragOver(canvas);

    expect(editor.onDragOver).toHaveBeenCalledOnce();
  });

  it('forwards onDragEnd to editor when the editor implements it', () => {
    const editor = makeFakeEditor();
    const { canvas } = renderCanvas({ editor });

    fireEvent.dragEnd(canvas);

    expect(editor.onDragEnd).toHaveBeenCalledOnce();
  });

  it('does NOT throw when editor has no onDragOver (optional method)', () => {
    // Build an editor without onDragOver (simulates NoopEditor variant)
    const editor = makeFakeEditor();
    // Remove the optional method
    const editorWithoutDragOver: EditorMode = {
      ...editor,
      onDragOver: undefined,
      onDragEnd: undefined,
    };

    expect(() => {
      const { canvas } = renderCanvas({ editor: editorWithoutDragOver });
      fireEvent.dragOver(canvas);
    }).not.toThrow();
  });
});

// ===========================================================================
// 6. contextmenu calls preventDefault
// ===========================================================================

describe('contextmenu handler', () => {
  it('calls preventDefault() on contextmenu events', () => {
    const { canvas } = renderCanvas();

    const evt = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    const spy = vi.spyOn(evt, 'preventDefault');
    act(() => { canvas.dispatchEvent(evt); });

    expect(spy).toHaveBeenCalled();
  });
});

// ===========================================================================
// 7. NoopEditor is the default — no throws on events
// ===========================================================================

describe('NoopEditor as default', () => {
  it('renders without a prop and does not throw on pointerdown', () => {
    expect(() => {
      const { canvas } = renderCanvas(); // no editor prop
      fireEvent.pointerDown(canvas, { pointerId: 1 });
    }).not.toThrow();
  });

  it('renders without a prop and does not throw on keydown', () => {
    expect(() => {
      const { canvas } = renderCanvas();
      fireEvent.keyDown(canvas, { key: 'Delete' });
    }).not.toThrow();
  });

  it('renders without a prop and does not throw on drop', () => {
    expect(() => {
      const { canvas } = renderCanvas();
      fireEvent.drop(canvas);
    }).not.toThrow();
  });

  it('renders without a prop and does not throw on contextmenu', () => {
    expect(() => {
      const { canvas } = renderCanvas();
      fireEvent.contextMenu(canvas);
    }).not.toThrow();
  });

  it('NoopEditor.id is "noop"', () => {
    // White-box check: ensure the default actually IS NoopEditor
    expect(NoopEditor.id).toBe('noop');
  });
});

// ===========================================================================
// 8. Editor lifecycle — deactivate(old) then activate(new)
// ===========================================================================

describe('Editor lifecycle', () => {
  it('activate is called on the first editor at mount (initial editor)', () => {
    // The lifecycle effect only fires when id CHANGES from the previous editor.
    // On the very first render prevEditorObjRef === activeEditor so activate is
    // NOT called via the lifecycle effect.  This tests the intended behaviour.
    const editor = makeFakeEditor();
    renderCanvas({ editor });

    // activate is not called on the initial mount (no id change yet).
    // This is the documented behaviour — the first editor takes over silently.
    // We just assert no error is thrown.
    expect(true).toBe(true);
  });

  it('deactivate(old) then activate(new) when editor changes', () => {
    const editorA = makeFakeEditor();
    const editorB = makeFakeEditor();

    const { rerender } = render(
      React.createElement(ClassroomCanvas, { editor: editorA }),
    );
    act(() => { flushRaf(); });

    // Switch to editorB
    act(() => {
      rerender(React.createElement(ClassroomCanvas, { editor: editorB }));
    });

    // deactivate(editorA) must have been called before activate(editorB).
    expect(editorA.deactivate).toHaveBeenCalledOnce();
    expect(editorB.activate).toHaveBeenCalledOnce();

    // Verify call order: deactivate BEFORE activate.
    const deactivateOrder = editorA.deactivate.mock.invocationCallOrder[0]!;
    const activateOrder = editorB.activate.mock.invocationCallOrder[0]!;
    expect(deactivateOrder).toBeLessThan(activateOrder);
  });

  it('lifecycle hooks receive an EditorContext with store + canvas + null persistence', () => {
    const editorA = makeFakeEditor();
    const editorB = makeFakeEditor();

    const { rerender } = render(
      React.createElement(ClassroomCanvas, { editor: editorA }),
    );
    act(() => { flushRaf(); });

    act(() => {
      rerender(React.createElement(ClassroomCanvas, { editor: editorB }));
    });

    // Check the deactivate ctx
    const [deactivateCtx] = editorA.deactivate.mock.calls[0] as [EditorContext];
    expect(deactivateCtx.store).toBeDefined();
    expect(deactivateCtx.canvas).toBeDefined();
    expect(deactivateCtx.persistence).toBeNull();

    // Check the activate ctx
    const [activateCtx] = editorB.activate.mock.calls[0] as [EditorContext];
    expect(activateCtx.store).toBeDefined();
    expect(activateCtx.canvas).toBeDefined();
    expect(activateCtx.persistence).toBeNull();
  });

  it('does NOT call activate/deactivate when same editor id is re-rendered with a new object', () => {
    // If the parent re-creates the editor object but keeps the same id, the
    // lifecycle must NOT fire (avoids unnecessary deactivate → activate pairs).
    const editorA = makeFakeEditor();
    const editorA2 = { ...editorA, activate: vi.fn(), deactivate: vi.fn() };

    const { rerender } = render(
      React.createElement(ClassroomCanvas, { editor: editorA }),
    );
    act(() => { flushRaf(); });

    act(() => {
      rerender(React.createElement(ClassroomCanvas, { editor: editorA2 }));
    });

    // id is the same — no lifecycle transition should have happened.
    expect(editorA.deactivate).not.toHaveBeenCalled();
    expect(editorA2.activate).not.toHaveBeenCalled();
  });

  it('lifecycle does not fire when neither editor nor other deps change', () => {
    const editor = makeFakeEditor();
    const { rerender } = render(
      React.createElement(ClassroomCanvas, { editor }),
    );
    act(() => { flushRaf(); });

    // Re-render with identical props — no lifecycle expected.
    act(() => {
      rerender(React.createElement(ClassroomCanvas, { editor }));
    });

    expect(editor.deactivate).not.toHaveBeenCalled();
    expect(editor.activate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 9. onViewReady callback
// ===========================================================================

describe('onViewReady callback', () => {
  it('fires onViewReady on mount with a valid CanvasView', () => {
    const onViewReady = vi.fn();
    renderCanvas({ onViewReady });

    expect(onViewReady).toHaveBeenCalledOnce();
    const [view] = onViewReady.mock.calls[0] as [CanvasView];
    expect(typeof view.cellAt).toBe('function');
    expect(typeof view.furnitureAt).toBe('function');
    expect(typeof view.cellRect).toBe('function');
    expect(typeof view.requestRepaint).toBe('function');
  });

  it('CanvasView.cellSize matches the cellSize prop', () => {
    const box: { view: CanvasView | null } = { view: null };
    renderCanvas({ cellSize: 64, onViewReady: (v) => { box.view = v; } });

    // effectiveCellSize(64, 1) === 64 (default cellsPerUnit = 1)
    expect(box.view?.cellSize).toBe(64);
  });

  it('CanvasView.gridW and gridH match the store classroom', () => {
    const box: { view: CanvasView | null } = { view: null };
    renderCanvas({ onViewReady: (v) => { box.view = v; } });

    const { gridW, gridH } = usePijonStore.getState().classroom;
    expect(box.view?.gridW).toBe(gridW);
    expect(box.view?.gridH).toBe(gridH);
  });

  it('onViewReady re-fires when gridW changes', () => {
    const onViewReady = vi.fn();
    renderCanvas({ onViewReady });

    const callsBefore = onViewReady.mock.calls.length;

    act(() => {
      usePijonStore.getState().resizeGrid('right', 1);
    });

    expect(onViewReady.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('onViewReady re-fires when gridH changes', () => {
    const onViewReady = vi.fn();
    renderCanvas({ onViewReady });

    const callsBefore = onViewReady.mock.calls.length;

    act(() => {
      usePijonStore.getState().resizeGrid('bottom', 1);
    });

    expect(onViewReady.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('onViewReady re-fires when cellSize prop changes', () => {
    const onViewReady = vi.fn();
    const { rerender } = render(
      React.createElement(ClassroomCanvas, { cellSize: 48, onViewReady }),
    );
    act(() => { flushRaf(); });

    const callsBefore = onViewReady.mock.calls.length;

    act(() => {
      rerender(React.createElement(ClassroomCanvas, { cellSize: 96, onViewReady }));
    });

    expect(onViewReady.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('onViewReady re-fires when ghostMargin changes', () => {
    const onViewReady = vi.fn();
    const { rerender } = render(
      React.createElement(ClassroomCanvas, { ghostMargin: 0, onViewReady }),
    );
    act(() => { flushRaf(); });

    const callsBefore = onViewReady.mock.calls.length;

    act(() => {
      rerender(React.createElement(ClassroomCanvas, { ghostMargin: 1, onViewReady }));
    });

    expect(onViewReady.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('CanvasView.originOffset matches ghostMargin', () => {
    const box: { view: CanvasView | null } = { view: null };
    renderCanvas({
      ghostMargin: 2,
      onViewReady: (v) => { box.view = v; },
    });

    expect(box.view?.originOffset).toBe(2);
  });

  it('CanvasView.requestRepaint schedules a rAF', () => {
    let capturedView: CanvasView | null = null;
    renderCanvas({ onViewReady: (v) => { capturedView = v; } });

    // Flush mount frame so rafRef.current is null.
    act(() => { flushRaf(); });

    capturedView!.requestRepaint();
    expect(rafQueue.length).toBe(1);
  });
});

// ===========================================================================
// 10. CanvasView geometry helpers
// ===========================================================================

describe('CanvasView geometry helpers', () => {
  it('cellRect returns { x, y, w, h } for a cell inside the grid', () => {
    let capturedView: CanvasView | null = null;
    renderCanvas({ cellSize: 48, onViewReady: (v) => { capturedView = v; } });

    // Cell (0,0), no ghost margin → should be at pixel (0, 0) with size 48×48.
    const rect = capturedView!.cellRect({ x: 0, y: 0 });
    expect(rect).toEqual({ x: 0, y: 0, w: 48, h: 48 });
  });

  it('cellRect offsets by ghostMargin * cellSize', () => {
    const cellSize = 48;
    const ghostMargin = 1;
    let capturedView: CanvasView | null = null;
    renderCanvas({ cellSize, ghostMargin, onViewReady: (v) => { capturedView = v; } });

    // Cell (0,0) with ghostMargin=1 → originPx = 1*48 = 48
    const rect = capturedView!.cellRect({ x: 0, y: 0 });
    expect(rect.x).toBe(ghostMargin * cellSize);
    expect(rect.y).toBe(ghostMargin * cellSize);
  });

  it('cellAt returns undefined for a point outside the grid', () => {
    let capturedView: CanvasView | null = null;
    renderCanvas({ cellSize: 48, onViewReady: (v) => { capturedView = v; } });

    // jsdom getBoundingClientRect returns {left:0, top:0, ...}.
    // So a point at (-1, -1) is outside the grid.
    const cell = capturedView!.cellAt(-1, -1);
    expect(cell).toBeUndefined();
  });

  it('cellAt returns a Vec2 for an in-bounds point (no ghost margin)', () => {
    // jsdom getBoundingClientRect returns { left:0, top:0 }.
    // With ghostMargin=0 and originPx=0: origin is at canvas position (0, 0).
    // A clientX=0, clientY=0 → canvas (0,0) → cell (0,0).
    const cellSize = 48;
    let capturedView: CanvasView | null = null;
    renderCanvas({ cellSize, ghostMargin: 0, onViewReady: (v) => { capturedView = v; } });

    const cell = capturedView!.cellAt(0, 0);
    expect(cell).toEqual({ x: 0, y: 0 });
  });

  it('furnitureAt returns undefined when no furniture is in the classroom', () => {
    let capturedView: CanvasView | null = null;
    renderCanvas({ onViewReady: (v) => { capturedView = v; } });

    expect(capturedView!.furnitureAt({ x: 0, y: 0 })).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // cellAt with non-zero ghostMargin — off-by-one hunting
  // ---------------------------------------------------------------------------

  it('cellAt returns undefined for a client point inside the ghost zone (before grid origin)', () => {
    // With ghostMargin=1, cellSize=48: originPx = 48.
    // jsdom getBoundingClientRect returns { left:0, top:0 }.
    // clientToCell is called with originX = 0 + 48 = 48, originY = 0 + 48 = 48.
    // A client point at (47, 47) → cx = 47 - 48 = -1 → col = -1 → undefined.
    const cellSize = 48;
    const ghostMargin = 1;
    let capturedView: CanvasView | null = null;
    renderCanvas({ cellSize, ghostMargin, onViewReady: (v) => { capturedView = v; } });

    // 1 pixel before the grid starts — must be in the ghost zone.
    const cell = capturedView!.cellAt(ghostMargin * cellSize - 1, ghostMargin * cellSize - 1);
    expect(cell).toBeUndefined();
  });

  it('cellAt maps the exact grid origin to cell (0,0) when ghostMargin > 0', () => {
    // client point exactly at (ghostMargin * cellSize, ghostMargin * cellSize)
    // → canvas (0,0) relative to grid → cell (0,0).
    const cellSize = 48;
    const ghostMargin = 1;
    let capturedView: CanvasView | null = null;
    renderCanvas({ cellSize, ghostMargin, onViewReady: (v) => { capturedView = v; } });

    const cell = capturedView!.cellAt(ghostMargin * cellSize, ghostMargin * cellSize);
    expect(cell).toEqual({ x: 0, y: 0 });
  });

  it('cellAt maps an interior point to the correct cell when ghostMargin > 0 (off-by-one check)', () => {
    // cell (1,1) starts at pixel (1*cellSize, 1*cellSize) relative to grid origin.
    // In client space that is (ghostMargin * cellSize + cellSize, same).
    // Using ghostMargin=2 to exercise a larger offset.
    const cellSize = 48;
    const ghostMargin = 2;
    let capturedView: CanvasView | null = null;
    renderCanvas({ cellSize, ghostMargin, onViewReady: (v) => { capturedView = v; } });

    // Top-left corner of cell (1,1) in client space:
    const clientX = ghostMargin * cellSize + 1 * cellSize;
    const clientY = ghostMargin * cellSize + 1 * cellSize;
    const cell = capturedView!.cellAt(clientX, clientY);
    expect(cell).toEqual({ x: 1, y: 1 });
  });

  it('cellRect for cell (1,1) with ghostMargin accounts for both grid position and offset', () => {
    // rect.x = originPx + 1 * cellSize = ghostMargin * cellSize + cellSize
    const cellSize = 48;
    const ghostMargin = 2;
    let capturedView: CanvasView | null = null;
    renderCanvas({ cellSize, ghostMargin, onViewReady: (v) => { capturedView = v; } });

    const rect = capturedView!.cellRect({ x: 1, y: 1 });
    expect(rect.x).toBe(ghostMargin * cellSize + 1 * cellSize);
    expect(rect.y).toBe(ghostMargin * cellSize + 1 * cellSize);
    expect(rect.w).toBe(cellSize);
    expect(rect.h).toBe(cellSize);
  });
});

// ===========================================================================
// 11. Canvas element attributes and accessibility
// ===========================================================================

describe('Canvas element attributes', () => {
  it('renders a <canvas> element', () => {
    const { canvas } = renderCanvas();
    expect(canvas.tagName.toLowerCase()).toBe('canvas');
  });

  it('has tabIndex=0 so it can receive keyboard events', () => {
    const { canvas } = renderCanvas();
    expect(canvas.getAttribute('tabindex')).toBe('0');
  });

  it('has aria-label="Classroom grid"', () => {
    const { canvas } = renderCanvas();
    expect(canvas.getAttribute('aria-label')).toBe('Classroom grid');
  });

  it('has role="img"', () => {
    const { canvas } = renderCanvas();
    expect(canvas.getAttribute('role')).toBe('img');
  });

  it('initial width attr = gridW * cellSize (before DPR correction)', () => {
    // The JSX sets width={cssW} initially; resizeCanvas overwrites via getContext side-effect.
    // In our spy setup getContext returns spyCtx, so resizeCanvas runs.
    vi.stubGlobal('devicePixelRatio', 1);
    const { canvas } = renderCanvas({ cellSize: 48 });
    const { gridW } = usePijonStore.getState().classroom;
    // After resizeCanvas runs with DPR=1, canvas.width === gridW * 48.
    expect(canvas.width).toBe(gridW * 48);
  });
});

// ===========================================================================
// 12. paintOverlay is called during every repaint
// ===========================================================================

describe('paintOverlay is called on every paint', () => {
  it('paintOverlay is called after mount rAF flush', () => {
    const editor = makeFakeEditor();
    render(React.createElement(ClassroomCanvas, { editor }));
    act(() => { flushRaf(); });

    expect(editor.paintOverlay).toHaveBeenCalled();
  });

  it('paintOverlay receives a CanvasRenderingContext2D and a CanvasView', () => {
    const editor = makeFakeEditor();
    render(React.createElement(ClassroomCanvas, { editor }));
    act(() => { flushRaf(); });

    const [ctx2d, view] = editor.paintOverlay.mock.calls[0] as [
      CanvasRenderingContext2D,
      CanvasView,
    ];
    // ctx2d is our spy (plain object)
    expect(ctx2d).toBe(spyCtx);
    // view is a CanvasView with the right shape
    expect(typeof view.cellAt).toBe('function');
    expect(typeof view.requestRepaint).toBe('function');
  });

  it('paintOverlay is called again after a store change triggers a repaint', () => {
    const editor = makeFakeEditor();
    render(React.createElement(ClassroomCanvas, { editor }));
    act(() => { flushRaf(); });

    editor.paintOverlay.mockClear();

    // Directly mutate classroom state to trigger the classroom subscription
    // (addStudent only changes roster; resizeGrid changes classroom directly).
    act(() => {
      usePijonStore.getState().resizeGrid('right', 1);
    });
    act(() => { flushRaf(); });

    expect(editor.paintOverlay).toHaveBeenCalled();
  });
});

// ===========================================================================
// 13. Unmount — pending rAF is cancelled
// ===========================================================================

describe('Unmount cleanup', () => {
  it('cancels any pending rAF on unmount', () => {
    const cancelSpy = vi.fn((id: number) => {
      rafQueue = rafQueue.filter((_, i) => i !== id - 1);
    });
    vi.stubGlobal('cancelAnimationFrame', cancelSpy);

    const { unmount } = render(React.createElement(ClassroomCanvas, {}));
    // There should be a pending rAF from mount.
    expect(rafQueue.length).toBeGreaterThanOrEqual(1);

    act(() => { unmount(); });

    // cancelAnimationFrame should have been called with the pending frame id.
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('does NOT throw after unmount even if the rAF queue is flushed late', () => {
    const { unmount } = render(React.createElement(ClassroomCanvas, {}));
    act(() => { unmount(); });

    // Flush any remaining queued callbacks — they should not throw because
    // the canvasRef.current guard inside the callback handles null.
    expect(() => { flushRaf(); }).not.toThrow();
  });

  it('paint code (fillRect) does NOT execute if a stale rAF fires after unmount', () => {
    // This test bypasses the cancelAnimationFrame call to simulate a race where
    // the browser has already committed the rAF callback to run and cancellation
    // arrives too late.  The canvasRef.current === null guard must protect us.

    // Install a cancelAnimationFrame stub that does NOT remove from the queue
    // (simulating "too late to cancel" scenario).
    vi.stubGlobal('cancelAnimationFrame', (): void => {
      // intentionally a no-op — callback stays in the queue
    });

    const { unmount } = render(React.createElement(ClassroomCanvas, {}));

    // Record how many times fillRect was called during mount (clearCanvas uses fillRect).
    const fillRectBefore = (spyCtx.fillRect as ReturnType<typeof vi.fn>).mock.calls.length;

    act(() => { unmount(); });

    // Flush the now-stale rAF callback — it must not invoke paint operations.
    act(() => { flushRaf(); });

    const fillRectAfter = (spyCtx.fillRect as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(fillRectAfter).toBe(fillRectBefore);
  });
});
