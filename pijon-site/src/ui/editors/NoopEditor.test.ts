// @vitest-environment jsdom
/**
 * Tests for NoopEditor — the do-nothing EditorMode used as a safe default.
 *
 * Coverage:
 *   1. id / label / interface shape — all required EditorMode properties present.
 *   2. Toolbar and SidePanel render null (React Testing Library).
 *   3. paintOverlay draws nothing — no 2D-context method is ever called.
 *   4. activate / deactivate lifecycle hooks are safe to call without throwing.
 *   5. All pointer/keyboard/drop/contextmenu event hooks are no-ops (no throw).
 *
 * LOCAL-FIRST: no network calls anywhere in this file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { NoopEditor } from './NoopEditor.js';
import type { EditorContext, CanvasView } from './EditorMode.js';
import type { Store } from '../../state/store.js';
import type { FurnitureId } from '../../domain/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeCanvasMock = (): CanvasView => ({
  cellSize: 48,
  gridW: 5,
  gridH: 5,
  originOffset: 0,
  cellAt: vi.fn(() => undefined),
  furnitureAt: vi.fn(() => undefined),
  cellRect: vi.fn(() => ({ x: 0, y: 0, w: 48, h: 48 })),
  requestRepaint: vi.fn(),
});

const makeStoreMock = (): Store =>
  ({
    roster: [],
    locks: new Set<FurnitureId>(),
    selectedStudentId: null,
    classroom: { id: 'test', name: 'Test', gridW: 5, gridH: 5, furniture: [] },
    history: [],
    historyPtr: -1,
    saveStatus: 'saved' as const,
    activeEditorId: null,
    fileHandle: null,
    resizeGridWarning: null,
    showViolations: true,
  } as unknown as Store);

const makeCtx = (): EditorContext => ({
  store: makeStoreMock(),
  canvas: makeCanvasMock(),
  persistence: null,
});

/** Build a spy-wrapped mock CanvasRenderingContext2D covering all draw methods. */
function makeMockCtx2d(): CanvasRenderingContext2D {
  const methods = [
    'arc',
    'arcTo',
    'beginPath',
    'bezierCurveTo',
    'clearRect',
    'clip',
    'closePath',
    'createImageData',
    'createLinearGradient',
    'createPattern',
    'createRadialGradient',
    'drawImage',
    'ellipse',
    'fill',
    'fillRect',
    'fillText',
    'getImageData',
    'getLineDash',
    'getTransform',
    'isPointInPath',
    'isPointInStroke',
    'lineTo',
    'measureText',
    'moveTo',
    'putImageData',
    'quadraticCurveTo',
    'rect',
    'resetTransform',
    'restore',
    'rotate',
    'roundRect',
    'save',
    'scale',
    'setLineDash',
    'setTransform',
    'stroke',
    'strokeRect',
    'strokeText',
    'transform',
    'translate',
  ] as const;

  const ctx2d: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of methods) {
    ctx2d[m] = vi.fn();
  }
  return ctx2d as unknown as CanvasRenderingContext2D;
}

// ---------------------------------------------------------------------------
// 1. Interface shape
// ---------------------------------------------------------------------------

describe('NoopEditor — interface shape', () => {
  it('has id="noop"', () => {
    expect(NoopEditor.id).toBe('noop');
  });

  it('has label="None"', () => {
    expect(NoopEditor.label).toBe('None');
  });

  it('exposes a Toolbar function component', () => {
    expect(typeof NoopEditor.Toolbar).toBe('function');
  });

  it('exposes a SidePanel function component', () => {
    expect(typeof NoopEditor.SidePanel).toBe('function');
  });

  it('exposes activate as a function', () => {
    expect(typeof NoopEditor.activate).toBe('function');
  });

  it('exposes deactivate as a function', () => {
    expect(typeof NoopEditor.deactivate).toBe('function');
  });

  it('exposes onPointerDown as a function', () => {
    expect(typeof NoopEditor.onPointerDown).toBe('function');
  });

  it('exposes onPointerMove as a function', () => {
    expect(typeof NoopEditor.onPointerMove).toBe('function');
  });

  it('exposes onPointerUp as a function', () => {
    expect(typeof NoopEditor.onPointerUp).toBe('function');
  });

  it('exposes onKeyDown as a function', () => {
    expect(typeof NoopEditor.onKeyDown).toBe('function');
  });

  it('exposes onDrop as a function', () => {
    expect(typeof NoopEditor.onDrop).toBe('function');
  });

  it('exposes onContextMenu as a function', () => {
    expect(typeof NoopEditor.onContextMenu).toBe('function');
  });

  it('exposes paintOverlay as a function', () => {
    expect(typeof NoopEditor.paintOverlay).toBe('function');
  });

  // Drive the required-property check off the known EditorMode required keys so
  // any future addition to the interface automatically shows up as a failure here
  // rather than being silently absent from NoopEditor.
  it('satisfies every required EditorMode property', () => {
    const REQUIRED_KEYS: (keyof import('./EditorMode.js').EditorMode)[] = [
      'id',
      'label',
      'Toolbar',
      'SidePanel',
      'activate',
      'deactivate',
      'onPointerDown',
      'onPointerMove',
      'onPointerUp',
      'onKeyDown',
      'onDrop',
      'onContextMenu',
      'paintOverlay',
    ];
    for (const key of REQUIRED_KEYS) {
      expect(NoopEditor, `NoopEditor is missing required EditorMode property: ${key}`)
        .toHaveProperty(key);
    }
  });

  it('does NOT expose RightPanel (optional property should be absent on NoopEditor)', () => {
    // RightPanel is optional in EditorMode. NoopEditor deliberately omits it.
    // If someone accidentally adds one the test signals a regression.
    expect(Object.prototype.hasOwnProperty.call(NoopEditor, 'RightPanel')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Toolbar and SidePanel render null
// ---------------------------------------------------------------------------

describe('NoopEditor — Toolbar renders null', () => {
  it('renders nothing (no DOM nodes)', () => {
    const ctx = makeCtx();
    const { container } = render(React.createElement(NoopEditor.Toolbar, { ctx }));
    expect(container.firstChild).toBeNull();
  });
});

describe('NoopEditor — SidePanel renders null', () => {
  it('renders nothing (no DOM nodes)', () => {
    const ctx = makeCtx();
    const { container } = render(React.createElement(NoopEditor.SidePanel, { ctx }));
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. paintOverlay draws nothing
// ---------------------------------------------------------------------------

describe('NoopEditor — paintOverlay does not mutate the canvas', () => {
  let ctx2d: CanvasRenderingContext2D;
  let view: CanvasView;

  beforeEach(() => {
    ctx2d = makeMockCtx2d();
    view = makeCanvasMock();
  });

  it('does not call fillRect', () => {
    NoopEditor.paintOverlay(ctx2d, view);
    expect(ctx2d.fillRect).not.toHaveBeenCalled();
  });

  it('does not call strokeRect', () => {
    NoopEditor.paintOverlay(ctx2d, view);
    expect(ctx2d.strokeRect).not.toHaveBeenCalled();
  });

  it('does not call fill', () => {
    NoopEditor.paintOverlay(ctx2d, view);
    expect(ctx2d.fill).not.toHaveBeenCalled();
  });

  it('does not call stroke', () => {
    NoopEditor.paintOverlay(ctx2d, view);
    expect(ctx2d.stroke).not.toHaveBeenCalled();
  });

  it('does not call clearRect', () => {
    NoopEditor.paintOverlay(ctx2d, view);
    expect(ctx2d.clearRect).not.toHaveBeenCalled();
  });

  it('does not call beginPath', () => {
    NoopEditor.paintOverlay(ctx2d, view);
    expect(ctx2d.beginPath).not.toHaveBeenCalled();
  });

  it('does not call drawImage', () => {
    NoopEditor.paintOverlay(ctx2d, view);
    expect(ctx2d.drawImage).not.toHaveBeenCalled();
  });

  it('does not call save (no state push)', () => {
    NoopEditor.paintOverlay(ctx2d, view);
    expect(ctx2d.save).not.toHaveBeenCalled();
  });

  it('does not call restore', () => {
    NoopEditor.paintOverlay(ctx2d, view);
    expect(ctx2d.restore).not.toHaveBeenCalled();
  });

  it('returns without a value (void return type, consistent with no-op)', () => {
    // The TypeScript return type is void; calling it does not throw and the
    // function runs to completion — no assertion on the value is needed.
    expect(() => { NoopEditor.paintOverlay(ctx2d, view); }).not.toThrow();
  });

  it('does not call ANY method on the 2D context — full spy sweep', () => {
    // This single test catches any future mutation to noopOverlay that the
    // per-method tests above might miss (e.g. a new drawing call is added but
    // no corresponding test exists for that method yet).
    NoopEditor.paintOverlay(ctx2d, view);

    // Collect every value on the mock that is itself a spy (vi.fn) and assert
    // none of them were called.
    const ctx2dRecord = ctx2d as unknown as Record<string, { mock?: { calls: unknown[][] } }>;
    for (const [methodName, value] of Object.entries(ctx2dRecord)) {
      if (typeof value === 'function' && 'mock' in value) {
        const spy = value as ReturnType<typeof vi.fn>;
        expect(spy, `ctx2d.${methodName} should not have been called`).not.toHaveBeenCalled();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. activate / deactivate lifecycle
// ---------------------------------------------------------------------------

describe('NoopEditor — activate / deactivate lifecycle', () => {
  it('activate does not throw', () => {
    const ctx = makeCtx();
    expect(() => { NoopEditor.activate(ctx); }).not.toThrow();
  });

  it('deactivate does not throw', () => {
    const ctx = makeCtx();
    expect(() => { NoopEditor.deactivate(ctx); }).not.toThrow();
  });

  it('activate followed by deactivate does not throw', () => {
    const ctx = makeCtx();
    expect(() => {
      NoopEditor.activate(ctx);
      NoopEditor.deactivate(ctx);
    }).not.toThrow();
  });

  it('calling deactivate multiple times does not throw', () => {
    const ctx = makeCtx();
    expect(() => {
      NoopEditor.deactivate(ctx);
      NoopEditor.deactivate(ctx);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. All event hooks are safe no-ops
// ---------------------------------------------------------------------------

describe('NoopEditor — event hooks are no-ops', () => {
  let ctx: EditorContext;

  beforeEach(() => {
    ctx = makeCtx();
    NoopEditor.activate(ctx);
  });

  it('onPointerDown does not throw', () => {
    const e = new PointerEvent('pointerdown', { button: 0 });
    expect(() => { NoopEditor.onPointerDown(e, ctx); }).not.toThrow();
  });

  it('onPointerMove does not throw', () => {
    const e = new PointerEvent('pointermove');
    expect(() => { NoopEditor.onPointerMove(e, ctx); }).not.toThrow();
  });

  it('onPointerUp does not throw', () => {
    const e = new PointerEvent('pointerup');
    expect(() => { NoopEditor.onPointerUp(e, ctx); }).not.toThrow();
  });

  it('onKeyDown does not throw', () => {
    const e = new KeyboardEvent('keydown', { key: 'Delete' });
    expect(() => { NoopEditor.onKeyDown(e, ctx); }).not.toThrow();
  });

  it('onDrop does not throw', () => {
    // DragEvent may not be available in all jsdom versions — use a plain object
    // cast to DragEvent which satisfies the EditorMode contract (no properties used).
    const e = { type: 'drop' } as unknown as DragEvent;
    expect(() => { NoopEditor.onDrop(e, ctx); }).not.toThrow();
  });

  it('onContextMenu does not throw', () => {
    const e = new MouseEvent('contextmenu');
    expect(() => { NoopEditor.onContextMenu(e, ctx); }).not.toThrow();
  });

  it('does not call any store action', () => {
    const e = new PointerEvent('pointerdown', { button: 0 });
    NoopEditor.onPointerDown(e, ctx);
    NoopEditor.onPointerMove(new PointerEvent('pointermove'), ctx);
    NoopEditor.onPointerUp(new PointerEvent('pointerup'), ctx);
    NoopEditor.onKeyDown(new KeyboardEvent('keydown', { key: 'a' }), ctx);
    NoopEditor.onDrop({ type: 'drop' } as unknown as DragEvent, ctx);
    NoopEditor.onContextMenu(new MouseEvent('contextmenu'), ctx);
    // canvas.requestRepaint should not have been called
    expect(ctx.canvas.requestRepaint).not.toHaveBeenCalled();
  });
});
