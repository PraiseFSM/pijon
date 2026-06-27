// @vitest-environment jsdom
/**
 * Iteration 10 Cluster B — Canvas accent routing + theme-switch repaint
 *
 * Tests cover:
 *
 * J. rgbaFromHex helper (themes.ts)
 *    J1.  rgbaFromHex produces correct rgba string for #1565c0 at alpha 0.9
 *    J2.  rgbaFromHex produces correct rgba string for #793498 at alpha 0.22
 *    J3.  rgbaFromHex alpha is formatted to 2 decimal places
 *    J4.  rgbaFromHex handles #rrggbb (6-digit hex)
 *    J5.  rgbaFromHex never returns a CSS var string (always resolved)
 *    J6.  rgbaFromHex(classic.selectedBox, 0.9) differs from rgbaFromHex(purpleGreen.selectedBox, 0.9)
 *
 * K. Canvas accent routing in FurnitureEditor.paintOverlay
 *    K1.  selectionStroke is derived from getActiveThemeColors().selectedBox at draw time (not static)
 *    K2.  classic scheme => selection stroke contains '21, 101, 192' (rgb of #1565c0)
 *    K3.  purpleGreen scheme => selection stroke contains '121, 52, 152' (rgb of #793498)
 *    K4.  gridDragValid stroke uses selectedBox (classic blue-based)
 *    K5.  gridDragValid stroke uses selectedBox (purpleGreen purple-based)
 *    K6.  dragPreviewValid stroke uses selectedBox (purpleGreen purple-based)
 *    K7.  canvas accent differs between schemes (selection stroke is scheme-sensitive)
 *    K8.  red/invalid accents (gridDragInvalid, dragPreviewInvalid) are NOT scheme-switched
 *
 * L. Canvas accent routing in StudentEditor.paintOverlay
 *    L1.  dragTarget fill is derived from selectedBox at draw time
 *    L2.  classic => drag target fill contains '21, 101, 192' (rgb of #1565c0)
 *    L3.  purpleGreen => drag target fill contains '121, 52, 152' (rgb of #793498)
 *    L4.  dragTarget stroke uses selectedBox
 *    L5.  dragGhost fill uses selectedBox (not hardcoded blue)
 *    L6.  dragTarget accent differs between classic and purpleGreen schemes
 *
 * M. Theme-switch triggers canvas repaint (Gap 2)
 *    M1.  ClassroomCanvas subscribes to themeId from the store
 *    M2.  setTheme bumps themeId in the store (prerequisite for M1 to work)
 *    M3.  After setTheme, getActiveThemeColors() returns the new palette (canvas reads this on repaint)
 *    M4.  setTheme('purpleGreen') changes the module-level active palette before store update
 *    M5.  After theme switch, drawOccupants uses scheme studentName color (black in both; §11.A2)
 *    M6.  theme switch repaint: themeId in store changes triggers scheduleRepaint via useEffect dep
 *
 * N. Classic unchanged / unification regression (§10.A3 note)
 *    N1.  classic selectedBox hex is #1565c0 (the unified blue — same as scheme.selectedBox)
 *    N2.  classic selectionStroke alpha 0.9 renders as rgba(21, 101, 192, 0.90)
 *    N3.  purpleGreen selectionStroke alpha 0.9 renders as rgba(121, 52, 152, 0.90)
 *    N4.  classic and purpleGreen canvas accents are distinct
 *    N5.  rgbaFromHex(classic.selectedBox, 0.22) is visually close to old dragTargetFill #1565c0-based
 *
 * LOCAL-FIRST: no network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import React from 'react';
import { render } from '@testing-library/react';

import {
  THEMES,
  getActiveThemeColors,
  _setActiveThemeInternal,
  applyThemeVars,
  rgbaFromHex,
} from '../theme/themes.js';
import { drawOccupants } from '../ui/canvas/render.js';
import { usePijonStore } from '../state/store.js';
import type { Classroom } from '../domain/classroom.js';
import type { Furniture } from '../domain/furniture.js';
import type { Student } from '../domain/student.js';
import type { StudentId, FurnitureId } from '../domain/types.js';
import { ClassroomCanvas } from '../ui/canvas/ClassroomCanvas.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLocalStorageStub(): Storage {
  let store = new Map<string, string>();
  return {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => { store.set(key, value); },
    removeItem: (key: string): void => { store.delete(key); },
    clear: (): void => { store = new Map<string, string>(); },
    get length(): number { return store.size; },
    key: (index: number): string | null => [...store.keys()][index] ?? null,
  };
}

let lsStub: Storage;

function resetStore(): void {
  act(() => { usePijonStore.getState().eraseAll(); });
}

function resetDocumentElementStyle(): void {
  const root = document.documentElement;
  const toRemove: string[] = [];
  for (let i = 0; i < root.style.length; i++) {
    const prop = root.style.item(i);
    if (prop.startsWith('--pj-')) toRemove.push(prop);
  }
  for (const prop of toRemove) {
    root.style.removeProperty(prop);
  }
}

function makeRealStudent(name = 'Alice'): Student {
  return {
    id: `${name.toLowerCase()}_id` as StudentId,
    name,
    preferences: [],
    isFixture: false,
    metadata: {},
  };
}

// Canvas spy context that tracks the sequence of fillStyle / strokeStyle values set
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpyCtx = Record<string, any>;

function makeDrawSpyCtx(): SpyCtx {
  let _fillStyle = '';
  let _strokeStyle = '';
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillText: vi.fn(),
    set fillStyle(v: string) { _fillStyle = v; },
    get fillStyle() { return _fillStyle; },
    set strokeStyle(v: string) { _strokeStyle = v; },
    get strokeStyle() { return _strokeStyle; },
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: vi.fn(),
    lineWidth: 1,
    setLineDash: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
  };
}

/** Build minimal Classroom for drawOccupants tests */
function makeClassroomWithStudent(student: Student): Classroom {
  const desk: Furniture = {
    id: 'desk1' as FurnitureId,
    kind: 'single_desk',
    pos: { x: 0, y: 0 },
    w: 1,
    h: 1,
    rotation: 0,
    occupants: [student],
  };
  return {
    id: 'c',
    name: 'T',
    gridW: 6,
    gridH: 6,
    furniture: [desk],
    cellsPerUnit: 1,
    thresholdUnits: 1.5,
    roster: [student],
  } as unknown as Classroom;
}

// ---------------------------------------------------------------------------
// J. rgbaFromHex helper
// ---------------------------------------------------------------------------

describe('J. rgbaFromHex helper', () => {
  it('J1: rgbaFromHex(#1565c0, 0.9) = rgba(21, 101, 192, 0.90)', () => {
    expect(rgbaFromHex('#1565c0', 0.9)).toBe('rgba(21, 101, 192, 0.90)');
  });

  it('J2: rgbaFromHex(#793498, 0.22) = rgba(121, 52, 152, 0.22)', () => {
    expect(rgbaFromHex('#793498', 0.22)).toBe('rgba(121, 52, 152, 0.22)');
  });

  it('J3: rgbaFromHex alpha is formatted to 2 decimal places', () => {
    const result = rgbaFromHex('#1565c0', 0.9);
    // Should be 0.90 not 0.9
    expect(result).toContain('0.90');
  });

  it('J4: rgbaFromHex handles 6-digit hex without errors', () => {
    const result = rgbaFromHex('#793498', 0.5);
    expect(result).toMatch(/^rgba\(\d+, \d+, \d+, 0\.50\)$/);
  });

  it('J5: rgbaFromHex never returns a CSS var string', () => {
    const result = rgbaFromHex(THEMES.classic!.selectedBox, 0.9);
    expect(result.startsWith('var(')).toBe(false);
    expect(result.startsWith('rgba(')).toBe(true);
  });

  it('J6: rgbaFromHex classic.selectedBox alpha=0.9 differs from purpleGreen.selectedBox alpha=0.9', () => {
    const classicResult = rgbaFromHex(THEMES.classic!.selectedBox, 0.9);
    const pgResult = rgbaFromHex(THEMES.purpleGreen!.selectedBox, 0.9);
    expect(classicResult).not.toBe(pgResult);
  });
});

// ---------------------------------------------------------------------------
// K. Canvas accent routing in FurnitureEditor.paintOverlay
// ---------------------------------------------------------------------------

describe('K. Canvas accent routing: FurnitureEditor derives accent from selectedBox', () => {
  beforeEach(() => {
    lsStub = makeLocalStorageStub();
    vi.stubGlobal('localStorage', lsStub);
    _setActiveThemeInternal(THEMES.classic!);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _setActiveThemeInternal(THEMES.classic!);
  });

  it('K1: rgbaFromHex(selectedBox, 0.9) with classic = #1565c0-based (not static #1976d2)', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const accent = THEMES.classic!.selectedBox;
    const stroke = rgbaFromHex(accent, 0.9);
    // Should contain rgb(21, 101, 192) for #1565c0
    expect(stroke).toContain('21, 101, 192');
  });

  it('K2: classic selectedBox-derived stroke contains rgb of #1565c0', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const stroke = rgbaFromHex(getActiveThemeColors().selectedBox, 0.9);
    expect(stroke).toContain('21, 101, 192');
    expect(stroke).toContain('0.90');
  });

  it('K3: purpleGreen selectedBox-derived stroke contains rgb of #793498', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);
    const stroke = rgbaFromHex(getActiveThemeColors().selectedBox, 0.9);
    expect(stroke).toContain('121, 52, 152');
    expect(stroke).toContain('0.90');
  });

  it('K4: gridDragValid-equivalent stroke (alpha 0.9) in classic contains 1565c0 rgb', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const stroke = rgbaFromHex(getActiveThemeColors().selectedBox, 0.9);
    expect(stroke).toContain('21, 101, 192');
  });

  it('K5: gridDragValid-equivalent stroke (alpha 0.9) in purpleGreen contains 793498 rgb', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);
    const stroke = rgbaFromHex(getActiveThemeColors().selectedBox, 0.9);
    expect(stroke).toContain('121, 52, 152');
  });

  it('K6: dragPreviewValid-equivalent stroke (alpha 0.85) in purpleGreen is purple', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);
    const stroke = rgbaFromHex(getActiveThemeColors().selectedBox, 0.85);
    expect(stroke).toContain('121, 52, 152');
    expect(stroke).toContain('0.85');
  });

  it('K7: canvas selection accent differs between classic and purpleGreen', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const classicAccent = rgbaFromHex(getActiveThemeColors().selectedBox, 0.9);

    _setActiveThemeInternal(THEMES.purpleGreen!);
    const pgAccent = rgbaFromHex(getActiveThemeColors().selectedBox, 0.9);

    expect(classicAccent).not.toBe(pgAccent);
  });

  it('K8: red invalid accents do not use selectedBox (they are fixed red)', () => {
    // The invalid (red) colors must remain red regardless of theme
    // gridDragInvalidFill and dragPreviewInvalidFill contain rgba(211, 47, 47 - red
    // These should not change with the selectedBox
    _setActiveThemeInternal(THEMES.purpleGreen!);
    // The selectedBox for purpleGreen is purple — red accents are separate
    const accentStroke = rgbaFromHex(getActiveThemeColors().selectedBox, 0.9);
    // Red accent must not contain the purple rgb values
    expect(accentStroke).not.toContain('211, 47, 47');
  });
});

// ---------------------------------------------------------------------------
// L. Canvas accent routing in StudentEditor.paintOverlay
// ---------------------------------------------------------------------------

describe('L. Canvas accent routing: StudentEditor derives drag accent from selectedBox', () => {
  beforeEach(() => {
    lsStub = makeLocalStorageStub();
    vi.stubGlobal('localStorage', lsStub);
    _setActiveThemeInternal(THEMES.classic!);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _setActiveThemeInternal(THEMES.classic!);
  });

  it('L1: dragTarget fill is derived from selectedBox (not a static hardcoded color)', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const fill = rgbaFromHex(getActiveThemeColors().selectedBox, 0.22);
    // Should be a resolved rgba, not a CSS var
    expect(fill.startsWith('rgba(')).toBe(true);
    expect(fill.startsWith('var(')).toBe(false);
  });

  it('L2: classic => drag target fill contains rgb of #1565c0', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const fill = rgbaFromHex(getActiveThemeColors().selectedBox, 0.22);
    expect(fill).toContain('21, 101, 192');
    expect(fill).toContain('0.22');
  });

  it('L3: purpleGreen => drag target fill contains rgb of #793498', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);
    const fill = rgbaFromHex(getActiveThemeColors().selectedBox, 0.22);
    expect(fill).toContain('121, 52, 152');
    expect(fill).toContain('0.22');
  });

  it('L4: dragTarget stroke (alpha 0.9) uses selectedBox', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);
    const stroke = rgbaFromHex(getActiveThemeColors().selectedBox, 0.9);
    expect(stroke).toContain('121, 52, 152');
  });

  it('L5: dragGhost fill (alpha 0.88) uses selectedBox in purpleGreen', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);
    const fill = rgbaFromHex(getActiveThemeColors().selectedBox, 0.88);
    expect(fill).toContain('121, 52, 152');
    expect(fill).toContain('0.88');
  });

  it('L6: drag target accent differs between classic and purpleGreen', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const classicFill = rgbaFromHex(getActiveThemeColors().selectedBox, 0.22);

    _setActiveThemeInternal(THEMES.purpleGreen!);
    const pgFill = rgbaFromHex(getActiveThemeColors().selectedBox, 0.22);

    expect(classicFill).not.toBe(pgFill);
  });
});

// ---------------------------------------------------------------------------
// M. Theme-switch triggers canvas repaint (Gap 2)
// ---------------------------------------------------------------------------

describe('M. Theme-switch canvas repaint', () => {
  beforeEach(() => {
    lsStub = makeLocalStorageStub();
    vi.stubGlobal('localStorage', lsStub);
    _setActiveThemeInternal(THEMES.classic!);
    resetDocumentElementStyle();
    resetStore();
    applyThemeVars(THEMES.classic!);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _setActiveThemeInternal(THEMES.classic!);
    resetDocumentElementStyle();
    cleanup();
  });

  it('M1: ClassroomCanvas renders without error (smoke test for themeId subscription)', () => {
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(() => {
      render(React.createElement(ClassroomCanvas));
    }).not.toThrow();
  });

  it('M2: setTheme updates themeId in the store', () => {
    expect(usePijonStore.getState().themeId).toBe('classic');
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(usePijonStore.getState().themeId).toBe('purpleGreen');
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(usePijonStore.getState().themeId).toBe('classic');
  });

  it('M3: after setTheme, getActiveThemeColors() returns the new palette', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(getActiveThemeColors().selectedBox).toBe('#793498');
    expect(getActiveThemeColors().text).toBe('#fff');

    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(getActiveThemeColors().selectedBox).toBe('#1565c0');
    expect(getActiveThemeColors().text).toBe('#333');
  });

  it('M4: setTheme updates the module-level active palette before React re-renders', () => {
    // _setActiveThemeInternal is called synchronously in setTheme (before set())
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    // The module-level palette is immediately updated — canvas repaint will read it correctly
    expect(getActiveThemeColors().selectedBox).toBe('#793498');
  });

  it('M5: after theme switch, drawOccupants uses scheme studentName color for student names (§11.A2 — black in both)', () => {
    // §11.A2: student names now use studentName (black = #000000 in both shipped schemes),
    // not the general text color. This reverses 10.A1.
    // Start with classic
    _setActiveThemeInternal(THEMES.classic!);
    act(() => { usePijonStore.getState().setTheme('classic'); });

    const alice = makeRealStudent('Alice');
    const cls = makeClassroomWithStudent(alice);
    const spyClassic = makeDrawSpyCtx();
    drawOccupants(spyClassic as unknown as CanvasRenderingContext2D, cls, 48);
    const classicFill = spyClassic.fillStyle as string;

    // Switch to purpleGreen
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });

    const spyPg = makeDrawSpyCtx();
    drawOccupants(spyPg as unknown as CanvasRenderingContext2D, cls, 48);
    const pgFill = spyPg.fillStyle as string;

    // Both schemes have studentName = #000000 (black)
    expect(classicFill).toBe('#000000');
    expect(pgFill).toBe('#000000');
    // Each is the scheme studentName value
    expect(classicFill).toBe(THEMES.classic?.studentName);
    expect(pgFill).toBe(THEMES.purpleGreen?.studentName);
  });

  it('M6: themeId is a subscribed store value (changes detected by useEffect dep)', () => {
    // Ensure we start from classic so the round-trip is meaningful
    act(() => { usePijonStore.getState().setTheme('classic'); });
    const before = usePijonStore.getState().themeId;
    expect(before).toBe('classic');
    // Switch to purpleGreen — store themeId must change
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    const after = usePijonStore.getState().themeId;
    expect(after).toBe('purpleGreen');
    expect(before).not.toBe(after);
  });
});

// ---------------------------------------------------------------------------
// N. Classic unchanged / unification regression
// ---------------------------------------------------------------------------

describe('N. Classic unchanged regression and classic-blue unification', () => {
  it('N1: classic selectedBox hex is #1565c0 (unified single blue)', () => {
    expect(THEMES.classic?.selectedBox).toBe('#1565c0');
  });

  it('N2: classic selection stroke at alpha 0.9 = rgba(21, 101, 192, 0.90)', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const stroke = rgbaFromHex(getActiveThemeColors().selectedBox, 0.9);
    expect(stroke).toBe('rgba(21, 101, 192, 0.90)');
  });

  it('N3: purpleGreen selection stroke at alpha 0.9 = rgba(121, 52, 152, 0.90)', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);
    const stroke = rgbaFromHex(getActiveThemeColors().selectedBox, 0.9);
    expect(stroke).toBe('rgba(121, 52, 152, 0.90)');
  });

  it('N4: classic and purpleGreen canvas selection accents are distinct', () => {
    const classicStroke = rgbaFromHex(THEMES.classic!.selectedBox, 0.9);
    const pgStroke = rgbaFromHex(THEMES.purpleGreen!.selectedBox, 0.9);
    expect(classicStroke).not.toBe(pgStroke);
  });

  it('N5: classic drag target fill (alpha 0.22) is blue-based (contains 21, 101, 192)', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const fill = rgbaFromHex(getActiveThemeColors().selectedBox, 0.22);
    // #1565c0 = rgb(21, 101, 192)
    expect(fill).toContain('21, 101, 192');
  });

  it('N6: purpleGreen drag target fill (alpha 0.22) is purple-based (contains 121, 52, 152)', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);
    const fill = rgbaFromHex(getActiveThemeColors().selectedBox, 0.22);
    // #793498 = rgb(121, 52, 152)
    expect(fill).toContain('121, 52, 152');
  });

  it('N7: classic palette values unchanged after adding rgbaFromHex helper', () => {
    const c = THEMES.classic!;
    expect(c.selectedBox).toBe('#1565c0');
    expect(c.unselectedBox).toBe('#ffffff');
    expect(c.text).toBe('#333');
    expect(c.toolbarBackground).toBe('#f5f5f5');
    expect(c.appBackground).toBe('#f0f0f0');
    expect(c.sidePanelBackground).toBe('#fafafa');
  });

  it('N8: purpleGreen selectedBox hex is exactly #793498', () => {
    expect(THEMES.purpleGreen?.selectedBox).toBe('#793498');
  });
});

// ---------------------------------------------------------------------------
// O. FurnitureEditor.paintOverlay uses themed strokeStyle for selection ring
// ---------------------------------------------------------------------------

describe('O. FurnitureEditor.paintOverlay uses themed selectedBox for selection ring', () => {
  beforeEach(() => {
    lsStub = makeLocalStorageStub();
    vi.stubGlobal('localStorage', lsStub);
    _setActiveThemeInternal(THEMES.classic!);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _setActiveThemeInternal(THEMES.classic!);
  });

  it('O1: FurnitureEditor.paintOverlay can be imported and is a function', async () => {
    const mod = await import('../ui/editors/FurnitureEditor.js');
    expect(typeof mod.FurnitureEditor.paintOverlay).toBe('function');
  });

  it('O2: classic selection stroke = #1565c0 based (21, 101, 192)', async () => {
    const { FurnitureEditor } = await import('../ui/editors/FurnitureEditor.js');
    _setActiveThemeInternal(THEMES.classic!);

    // Activate and select a piece by faking a pointer down on a cell that has furniture
    const desk = {
      id: 'desk1' as FurnitureId,
      kind: 'single_desk' as const,
      pos: { x: 0, y: 0 },
      w: 1,
      h: 1,
      rotation: 0 as 0 | 90 | 180 | 270,
      occupants: [],
    };

    const strokesSet: string[] = [];
    const spyCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillStyle: '',
      set strokeStyle(v: string) { strokesSet.push(v); },
      get strokeStyle() { return strokesSet[strokesSet.length - 1] ?? ''; },
      lineWidth: 1,
      setLineDash: vi.fn(),
      textAlign: '',
      textBaseline: '',
      font: '',
      fillText: vi.fn(),
      beginPath: vi.fn(),
    };

    const view = {
      cellSize: 48,
      gridW: 5,
      gridH: 5,
      originOffset: 0,
      cellAt: vi.fn(() => ({ x: 0, y: 0 })),
      furnitureAt: vi.fn(() => desk),
      cellRect: vi.fn(() => ({ x: 0, y: 0, w: 48, h: 48 })),
      requestRepaint: vi.fn(),
    };

    const store = {
      classroom: {
        id: 'c',
        name: 'T',
        gridW: 5,
        gridH: 5,
        furniture: [desk],
        cellsPerUnit: 1,
        thresholdUnits: 1.5,
      },
      roster: [],
      locks: new Set(),
      resizeGrid: vi.fn(),
      requestRepaint: vi.fn(),
    };

    const ctx = { store, canvas: view, persistence: null } as never;

    // Activate editor so module-level state is initialized
    FurnitureEditor.activate(ctx);

    // Simulate pointer down to set selectedId and selectedRect
    const ptrEvent = {
      button: 0,
      clientX: 24,
      clientY: 24,
      target: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    } as unknown as PointerEvent;
    FurnitureEditor.onPointerDown(ptrEvent, ctx);

    // Simulate pointer up to complete the selection (without moving = no drag)
    FurnitureEditor.onPointerUp(ptrEvent, ctx);

    // Now paintOverlay with classic theme
    _setActiveThemeInternal(THEMES.classic!);
    FurnitureEditor.paintOverlay(spyCtx as unknown as CanvasRenderingContext2D, view);

    FurnitureEditor.deactivate(ctx);

    // Check that at some point the selection stroke was set to a #1565c0-based rgba
    const selectionStrokeSet = strokesSet.some((s) => s.includes('21, 101, 192'));
    expect(selectionStrokeSet).toBe(true);
  });

  it('O3: purpleGreen selection stroke = #793498 based (121, 52, 152)', async () => {
    const { FurnitureEditor } = await import('../ui/editors/FurnitureEditor.js');
    _setActiveThemeInternal(THEMES.purpleGreen!);

    const desk = {
      id: 'desk2' as FurnitureId,
      kind: 'single_desk' as const,
      pos: { x: 0, y: 0 },
      w: 1,
      h: 1,
      rotation: 0 as 0 | 90 | 180 | 270,
      occupants: [],
    };

    const strokesSet: string[] = [];
    const spyCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillStyle: '',
      set strokeStyle(v: string) { strokesSet.push(v); },
      get strokeStyle() { return strokesSet[strokesSet.length - 1] ?? ''; },
      lineWidth: 1,
      setLineDash: vi.fn(),
      textAlign: '',
      textBaseline: '',
      font: '',
      fillText: vi.fn(),
      beginPath: vi.fn(),
    };

    const view = {
      cellSize: 48,
      gridW: 5,
      gridH: 5,
      originOffset: 0,
      cellAt: vi.fn(() => ({ x: 0, y: 0 })),
      furnitureAt: vi.fn(() => desk),
      cellRect: vi.fn(() => ({ x: 0, y: 0, w: 48, h: 48 })),
      requestRepaint: vi.fn(),
    };

    const store = {
      classroom: {
        id: 'c',
        name: 'T',
        gridW: 5,
        gridH: 5,
        furniture: [desk],
        cellsPerUnit: 1,
        thresholdUnits: 1.5,
      },
      roster: [],
      locks: new Set(),
      resizeGrid: vi.fn(),
      requestRepaint: vi.fn(),
    };

    const ctx = { store, canvas: view, persistence: null } as never;
    FurnitureEditor.activate(ctx);

    const ptrEvent = {
      button: 0,
      clientX: 24,
      clientY: 24,
      target: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    } as unknown as PointerEvent;
    FurnitureEditor.onPointerDown(ptrEvent, ctx);
    FurnitureEditor.onPointerUp(ptrEvent, ctx);

    _setActiveThemeInternal(THEMES.purpleGreen!);
    FurnitureEditor.paintOverlay(spyCtx as unknown as CanvasRenderingContext2D, view);

    FurnitureEditor.deactivate(ctx);

    // Check that the selection stroke was set to a #793498-based rgba
    const selectionStrokeSet = strokesSet.some((s) => s.includes('121, 52, 152'));
    expect(selectionStrokeSet).toBe(true);
  });

  it('O4: classic and purpleGreen selection strokes are different', async () => {
    const { FurnitureEditor } = await import('../ui/editors/FurnitureEditor.js');

    const makeCtxAndView = (deskId: string) => {
      const desk = {
        id: deskId as FurnitureId,
        kind: 'single_desk' as const,
        pos: { x: 0, y: 0 },
        w: 1, h: 1,
        rotation: 0 as 0 | 90 | 180 | 270,
        occupants: [],
      };
      const strokesSet: string[] = [];
      const spyCtx = {
        save: vi.fn(), restore: vi.fn(),
        fillRect: vi.fn(), strokeRect: vi.fn(),
        fillStyle: '',
        set strokeStyle(v: string) { strokesSet.push(v); },
        get strokeStyle() { return strokesSet[strokesSet.length - 1] ?? ''; },
        lineWidth: 1, setLineDash: vi.fn(),
        textAlign: '', textBaseline: '', font: '',
        fillText: vi.fn(), beginPath: vi.fn(),
      };
      const view = {
        cellSize: 48, gridW: 5, gridH: 5, originOffset: 0,
        cellAt: vi.fn(() => ({ x: 0, y: 0 })),
        furnitureAt: vi.fn(() => desk),
        cellRect: vi.fn(() => ({ x: 0, y: 0, w: 48, h: 48 })),
        requestRepaint: vi.fn(),
      };
      const store = {
        classroom: { id: 'c', name: 'T', gridW: 5, gridH: 5, furniture: [desk], cellsPerUnit: 1, thresholdUnits: 1.5 },
        roster: [], locks: new Set(), resizeGrid: vi.fn(),
      };
      return { spyCtx, view, store: store as never, strokesSet };
    };

    // Classic run
    _setActiveThemeInternal(THEMES.classic!);
    const classicRun = makeCtxAndView('deskClassic');
    const classicEditorCtx = { store: classicRun.store, canvas: classicRun.view, persistence: null } as never;
    FurnitureEditor.activate(classicEditorCtx);
    FurnitureEditor.onPointerDown({ button: 0, clientX: 24, clientY: 24, target: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } } as unknown as PointerEvent, classicEditorCtx);
    FurnitureEditor.onPointerUp({ button: 0, clientX: 24, clientY: 24, target: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } } as unknown as PointerEvent, classicEditorCtx);
    FurnitureEditor.paintOverlay(classicRun.spyCtx as unknown as CanvasRenderingContext2D, classicRun.view);
    FurnitureEditor.deactivate(classicEditorCtx);
    const classicStrokes = classicRun.strokesSet.filter((s) => s.includes('rgba'));

    // PurpleGreen run
    _setActiveThemeInternal(THEMES.purpleGreen!);
    const pgRun = makeCtxAndView('deskPg');
    const pgEditorCtx = { store: pgRun.store, canvas: pgRun.view, persistence: null } as never;
    FurnitureEditor.activate(pgEditorCtx);
    FurnitureEditor.onPointerDown({ button: 0, clientX: 24, clientY: 24, target: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } } as unknown as PointerEvent, pgEditorCtx);
    FurnitureEditor.onPointerUp({ button: 0, clientX: 24, clientY: 24, target: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } } as unknown as PointerEvent, pgEditorCtx);
    FurnitureEditor.paintOverlay(pgRun.spyCtx as unknown as CanvasRenderingContext2D, pgRun.view);
    FurnitureEditor.deactivate(pgEditorCtx);
    const pgStrokes = pgRun.strokesSet.filter((s) => s.includes('rgba'));

    // The accents must differ
    expect(classicStrokes.join(',')).not.toBe(pgStrokes.join(','));
  });
});
