// @vitest-environment jsdom
/**
 * Iteration 11 Cluster A — More configurable scheme colors + top-bar-right region
 *
 * Tests cover:
 *
 * A. Scheme JSON files have all four new values (11.A1–11.A4)
 *    A1.  classic.json has buttonText === '#333'
 *    A2.  classic.json has studentName === '#000000'
 *    A3.  classic.json has gridBackground === '#ffffff'
 *    A4.  classic.json has topBarRight === '#f5f5f5' (= classic topBar)
 *    A5.  purpleGreen.json has buttonText (non-empty string)
 *    A6.  purpleGreen.json has studentName === '#000000'
 *    A7.  purpleGreen.json has gridBackground === '#ffffff'
 *    A8.  purpleGreen.json has topBarRight === '#553726' (checker-updated for contrast; differs from topBar)
 *    A9.  every scheme in SCHEME_REGISTRY has all four new keys
 *    A10. purpleGreen.buttonText is legible (non-empty, not the same as a dark color)
 *
 * B. ThemePalette / derivePalette propagates new fields (11.A1–11.A4)
 *    B1.  THEMES.classic.buttonText === '#333'
 *    B2.  THEMES.classic.studentName === '#000000'
 *    B3.  THEMES.classic.gridBackground === '#ffffff'
 *    B4.  THEMES.classic.topBarRight === '#f5f5f5'
 *    B5.  THEMES.purpleGreen.studentName === '#000000'
 *    B6.  THEMES.purpleGreen.gridBackground === '#ffffff'
 *    B7.  THEMES.purpleGreen.topBarRight === '#553726' (checker-updated for contrast)
 *    B8.  every theme in THEMES has non-empty buttonText, studentName, gridBackground, topBarRight
 *
 * C. applyThemeVars sets new CSS custom properties
 *    C1.  applyThemeVars sets --pj-buttonText (classic)
 *    C2.  applyThemeVars sets --pj-topBarRight (classic)
 *    C3.  switching to purpleGreen updates --pj-buttonText
 *    C4.  switching to purpleGreen updates --pj-topBarRight to #553726 (checker-updated)
 *    C5.  switching back to classic resets --pj-buttonText to #333
 *    C6.  switching back to classic resets --pj-topBarRight to #f5f5f5
 *    C7.  applyThemeVars still sets pre-existing vars (regression)
 *
 * D. Store setTheme updates new CSS vars
 *    D1.  setTheme(purpleGreen) sets --pj-buttonText
 *    D2.  setTheme(purpleGreen) sets --pj-topBarRight to #553726 (checker-updated for contrast)
 *    D3.  setTheme(classic) resets --pj-topBarRight to #f5f5f5
 *    D4.  getActiveThemeColors().buttonText reflects the active scheme
 *    D5.  getActiveThemeColors().studentName === #000000 in both schemes
 *    D6.  getActiveThemeColors().gridBackground === #ffffff in both schemes
 *    D7.  getActiveThemeColors().topBarRight matches the scheme topBarRight
 *
 * E. colors.ts — btnText token routes through --pj-buttonText (11.A1)
 *    E1.  btnText contains --pj-buttonText (not --pj-btnText)
 *    E2.  btnText has a classic fallback hex #333
 *
 * F. colors.ts — topBarRightBackground token (11.A4)
 *    F1.  topBarRightBackground contains --pj-topBarRight
 *    F2.  topBarRightBackground has a classic fallback hex #f5f5f5
 *
 * G. Canvas drawOccupants uses studentName (11.A2)
 *    G1.  drawOccupants sets fillStyle to getActiveThemeColors().studentName for real student
 *    G2.  classic scheme: student name fillStyle is #000000
 *    G3.  purpleGreen scheme: student name fillStyle is #000000 (black in both)
 *    G4.  fixture labels still use occupantNameFixture (unchanged)
 *    G5.  studentName is NOT a CSS var string (resolved value for canvas)
 *    G6.  drawOccupants studentName comes from THEMES.classic.studentName
 *    G7.  drawOccupants studentName comes from THEMES.purpleGreen.studentName
 *
 * H. Canvas clearCanvas uses gridBackground from scheme (11.A3)
 *    H1.  clearCanvas fills with getActiveThemeColors().gridBackground
 *    H2.  classic scheme: clearCanvas fills with #ffffff
 *    H3.  purpleGreen scheme: clearCanvas fills with #ffffff
 *    H4.  gridBackground is NOT a CSS var string (resolved value for canvas)
 *    H5.  gridBackground matches the scheme value from SCHEME_REGISTRY
 *
 * I. TopBar top-bar-right region (11.A4)
 *    I1.  top-bar-right element is present in the DOM
 *    I2.  top-bar-right element has background referencing --pj-topBarRight
 *    I3.  saved-indicator has transparent background (no brown / SPECIAL_TEXT_BG)
 *    I4.  erase-all-button has transparent background (no brown / SPECIAL_TEXT_BG)
 *    I5.  saved-indicator and erase-all-button are inside top-bar-right
 *    I6.  top-bar-right background contains --pj-topBarRight var string
 *    I7.  top-bar-right is present in Students editor mode
 *    I8.  saved-indicator background is NOT rgb(85, 55, 38) (old #553726)
 *    I9.  erase-all-button background is NOT rgb(85, 55, 38) (old #553726)
 *
 * J. Classic unchanged regression (§11 values added; existing surfaces unmodified)
 *    J1.  classic.topBar unchanged (#f5f5f5)
 *    J2.  classic.leftBar unchanged (#fafafa)
 *    J3.  classic.gridBackdrop unchanged (#f0f0f0)
 *    J4.  classic.text unchanged (#333)
 *    J5.  classic.selectedBox unchanged (#1565c0)
 *    J6.  classic.unselectedBox unchanged (#ffffff)
 *    J7.  THEMES.classic.toolbarBackground unchanged (#f5f5f5)
 *    J8.  THEMES.classic.appBackground unchanged (#f0f0f0)
 *    J9.  THEMES.classic.sidePanelBackground unchanged (#fafafa)
 *    J10. topBarRight defaults to topBar in classic (so it looks like the current bar)
 *
 * LOCAL-FIRST: no network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import React from 'react';

import {
  THEMES,
  SCHEME_REGISTRY,
  getActiveThemeColors,
  _setActiveThemeInternal,
  applyThemeVars,
} from '../theme/themes.js';

import {
  btnText,
  topBarRightBackground,
  topBarRightText,
  occupantNameFixture,
} from '../theme/colors.js';

import { drawOccupants } from '../ui/canvas/render.js';
import { clearCanvas } from '../ui/canvas/render.js';
import type { Classroom } from '../domain/classroom.js';
import type { Furniture } from '../domain/furniture.js';
import type { Student } from '../domain/student.js';
import type { StudentId, FurnitureId } from '../domain/types.js';

import { usePijonStore } from '../state/store.js';
import { TopBar } from '../ui/shell/TopBar.js';
import { FurnitureEditor } from '../ui/editors/FurnitureEditor.js';
import { StudentEditor } from '../ui/editors/StudentEditor.js';
import type { EditorContext, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import type { ThemeId } from '../theme/themes.js';

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
    historyPtr: -1,
    saveStatus: 'saved' as const,
    activeEditorId: 'furniture',
    fileHandle: null,
    resizeGridWarning: null,
    showViolations: true,
    showLinks: false,
    uiScale: 1.2,
    themeId: 'classic' as ThemeId,
    eraseAll: vi.fn(),
    setThreshold: vi.fn(),
    setShowViolations: vi.fn(),
    setShowLinks: vi.fn(),
    setUiScale: vi.fn(),
    setTheme: vi.fn(),
    setBackgroundImage: vi.fn(),
    setGridColor: vi.fn(),
    allocate: vi.fn(),
    smartShuffle: vi.fn(),
    clearArrangement: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    ...overrides,
  } as unknown as Store);

const makeCtx = (overrides?: Partial<Store>): EditorContext => ({
  store: makeStoreMock(overrides),
  canvas: makeCanvasMock(),
  persistence: null,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpyCtx = Record<string, any>;

function makeDrawSpyCtx(): SpyCtx {
  let _fillStyle = '';
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillText: vi.fn(),
    set fillStyle(v: string) { _fillStyle = v; },
    get fillStyle() { return _fillStyle; },
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: vi.fn(),
    strokeStyle: '',
    lineWidth: 1,
  };
}

function makeClearCanvasSpyCtx(): SpyCtx {
  let _fillStyle = '';
  const fillRectCalls: [number, number, number, number][] = [];
  return {
    get fillStyle() { return _fillStyle; },
    set fillStyle(v: string) { _fillStyle = v; },
    fillRect(x: number, y: number, w: number, h: number): void {
      fillRectCalls.push([x, y, w, h]);
    },
    get fillRectCalls() { return fillRectCalls; },
  };
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

function makeFixtureStudent(name = 'Board'): Student {
  return {
    id: `${name.toLowerCase()}_fid` as StudentId,
    name,
    preferences: [],
    isFixture: true,
    metadata: {},
  };
}

function makeClassroomWithStudent(student: Student, kind: 'real' | 'fixture' = 'real'): Classroom {
  const desk: Furniture = {
    id: 'desk1' as FurnitureId,
    kind: kind === 'fixture' ? 'whiteboard' : 'single_desk',
    pos: { x: 0, y: 0 },
    w: 1,
    h: 1,
    rotation: 0,
    occupants: [student],
  };
  return {
    id: 'cls1',
    name: 'Test',
    gridW: 6,
    gridH: 6,
    furniture: [desk],
    cellsPerUnit: 1,
    thresholdUnits: 1.5,
    roster: [student],
  } as unknown as Classroom;
}

// ---------------------------------------------------------------------------
// A. Scheme JSON files have all four new values
// ---------------------------------------------------------------------------

describe('A. Scheme JSON files have all four new values (11.A1-11.A4)', () => {
  it('A1: classic.json has buttonText === #333', () => {
    expect(SCHEME_REGISTRY.classic?.buttonText).toBe('#333');
  });

  it('A2: classic.json has studentName === #000000', () => {
    expect(SCHEME_REGISTRY.classic?.studentName).toBe('#000000');
  });

  it('A3: classic.json has gridBackground === #ffffff', () => {
    expect(SCHEME_REGISTRY.classic?.gridBackground).toBe('#ffffff');
  });

  it('A4: classic.json has topBarRight === #f5f5f5 (= classic topBar)', () => {
    expect(SCHEME_REGISTRY.classic?.topBarRight).toBe('#f5f5f5');
    expect(SCHEME_REGISTRY.classic?.topBarRight).toBe(SCHEME_REGISTRY.classic?.topBar);
  });

  it('A5: purpleGreen.json has buttonText (non-empty string)', () => {
    expect(typeof SCHEME_REGISTRY.purpleGreen?.buttonText).toBe('string');
    expect((SCHEME_REGISTRY.purpleGreen?.buttonText ?? '').length).toBeGreaterThan(0);
  });

  it('A6: purpleGreen.json has studentName === #000000', () => {
    expect(SCHEME_REGISTRY.purpleGreen?.studentName).toBe('#000000');
  });

  it('A7: purpleGreen.json has gridBackground === #ffffff', () => {
    expect(SCHEME_REGISTRY.purpleGreen?.gridBackground).toBe('#ffffff');
  });

  it('A8: purpleGreen.json has topBarRight === #553726 (checker-updated from #84659a for WCAG contrast)', () => {
    // Checker changed topBarRight from topBar (#84659a) to #553726 so white text
    // is legible (contrast ratio > 4.5:1). It intentionally differs from topBar.
    expect(SCHEME_REGISTRY.purpleGreen?.topBarRight).toBe('#553726');
    // Confirm it is NOT the same as topBar (the checker customised it for contrast)
    expect(SCHEME_REGISTRY.purpleGreen?.topBarRight).not.toBe(SCHEME_REGISTRY.purpleGreen?.topBar);
  });

  it('A9: every scheme in SCHEME_REGISTRY has all four new keys', () => {
    const newKeys = ['buttonText', 'studentName', 'gridBackground', 'topBarRight'] as const;
    for (const [id, scheme] of Object.entries(SCHEME_REGISTRY)) {
      for (const key of newKeys) {
        expect(
          key in scheme,
          `SCHEME_REGISTRY[${id}] missing key "${key}"`,
        ).toBe(true);
      }
    }
  });

  it('A10: purpleGreen.buttonText is a non-empty color string (not #333 dark — legible on dark buttons)', () => {
    const bt = SCHEME_REGISTRY.purpleGreen?.buttonText ?? '';
    expect(bt.length).toBeGreaterThan(0);
    // purpleGreen buttons are dark (unselectedBox = #371e42), so buttonText must not be a very dark color
    expect(bt).not.toBe('#000');
    expect(bt).not.toBe('#000000');
  });
});

// ---------------------------------------------------------------------------
// B. ThemePalette / derivePalette propagates new fields
// ---------------------------------------------------------------------------

describe('B. ThemePalette / derivePalette propagates new fields', () => {
  it('B1: THEMES.classic.buttonText === #333', () => {
    expect(THEMES.classic?.buttonText).toBe('#333');
  });

  it('B2: THEMES.classic.studentName === #000000', () => {
    expect(THEMES.classic?.studentName).toBe('#000000');
  });

  it('B3: THEMES.classic.gridBackground === #ffffff', () => {
    expect(THEMES.classic?.gridBackground).toBe('#ffffff');
  });

  it('B4: THEMES.classic.topBarRight === #f5f5f5', () => {
    expect(THEMES.classic?.topBarRight).toBe('#f5f5f5');
  });

  it('B5: THEMES.purpleGreen.studentName === #000000', () => {
    expect(THEMES.purpleGreen?.studentName).toBe('#000000');
  });

  it('B6: THEMES.purpleGreen.gridBackground === #ffffff', () => {
    expect(THEMES.purpleGreen?.gridBackground).toBe('#ffffff');
  });

  it('B7: THEMES.purpleGreen.topBarRight === #553726 (checker-updated for WCAG contrast)', () => {
    expect(THEMES.purpleGreen?.topBarRight).toBe('#553726');
  });

  it('B8: every theme has non-empty buttonText, studentName, gridBackground, topBarRight', () => {
    const newFields = ['buttonText', 'studentName', 'gridBackground', 'topBarRight'] as const;
    for (const [id, palette] of Object.entries(THEMES)) {
      for (const field of newFields) {
        const val = palette[field];
        expect(
          typeof val === 'string' && val.length > 0,
          `THEMES.${id}.${field} should be a non-empty string`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// C. applyThemeVars sets new CSS custom properties
// ---------------------------------------------------------------------------

describe('C. applyThemeVars sets --pj-buttonText and --pj-topBarRight', () => {
  afterEach(() => {
    resetDocumentElementStyle();
    cleanup();
  });

  it('C1: applyThemeVars sets --pj-buttonText (classic)', () => {
    applyThemeVars(THEMES.classic!);
    expect(document.documentElement.style.getPropertyValue('--pj-buttonText')).toBe('#333');
  });

  it('C2: applyThemeVars sets --pj-topBarRight (classic = #f5f5f5)', () => {
    applyThemeVars(THEMES.classic!);
    expect(document.documentElement.style.getPropertyValue('--pj-topBarRight')).toBe('#f5f5f5');
  });

  it('C3: switching to purpleGreen updates --pj-buttonText', () => {
    applyThemeVars(THEMES.purpleGreen!);
    const val = document.documentElement.style.getPropertyValue('--pj-buttonText');
    expect(val.length).toBeGreaterThan(0);
    expect(val).toBe(THEMES.purpleGreen?.buttonText);
  });

  it('C4: switching to purpleGreen sets --pj-topBarRight to #553726 (checker-updated for contrast)', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-topBarRight')).toBe('#553726');
  });

  it('C5: switching back to classic resets --pj-buttonText to #333', () => {
    applyThemeVars(THEMES.purpleGreen!);
    applyThemeVars(THEMES.classic!);
    expect(document.documentElement.style.getPropertyValue('--pj-buttonText')).toBe('#333');
  });

  it('C6: switching back to classic resets --pj-topBarRight to #f5f5f5', () => {
    applyThemeVars(THEMES.purpleGreen!);
    applyThemeVars(THEMES.classic!);
    expect(document.documentElement.style.getPropertyValue('--pj-topBarRight')).toBe('#f5f5f5');
  });

  it('C7: applyThemeVars still sets pre-existing vars (regression guard)', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-appBackground')).toBe('#939598');
    expect(document.documentElement.style.getPropertyValue('--pj-toolbarBackground')).toBe('#84659a');
    expect(document.documentElement.style.getPropertyValue('--pj-text')).toBe('#fff');
    expect(document.documentElement.style.getPropertyValue('--pj-selectedBox')).toBe('#793498');
    expect(document.documentElement.style.getPropertyValue('--pj-unselectedBox')).toBe('#371e42');
  });
});

// ---------------------------------------------------------------------------
// D. Store setTheme updates new CSS vars
// ---------------------------------------------------------------------------

describe('D. Store setTheme updates new CSS vars', () => {
  beforeEach(() => {
    lsStub = makeLocalStorageStub();
    vi.stubGlobal('localStorage', lsStub);
    _setActiveThemeInternal(THEMES.classic!);
    resetDocumentElementStyle();
    resetStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _setActiveThemeInternal(THEMES.classic!);
    resetDocumentElementStyle();
    cleanup();
  });

  it('D1: setTheme(purpleGreen) sets --pj-buttonText to purpleGreen buttonText', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    const val = document.documentElement.style.getPropertyValue('--pj-buttonText');
    expect(val).toBe(THEMES.purpleGreen?.buttonText ?? '');
  });

  it('D2: setTheme(purpleGreen) sets --pj-topBarRight to #553726 (checker-updated for contrast)', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(document.documentElement.style.getPropertyValue('--pj-topBarRight')).toBe('#553726');
  });

  it('D3: setTheme(classic) resets --pj-topBarRight to #f5f5f5', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(document.documentElement.style.getPropertyValue('--pj-topBarRight')).toBe('#f5f5f5');
  });

  it('D4: getActiveThemeColors().buttonText reflects the active scheme', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(getActiveThemeColors().buttonText).toBe(THEMES.purpleGreen?.buttonText ?? '');
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(getActiveThemeColors().buttonText).toBe('#333');
  });

  it('D5: getActiveThemeColors().studentName === #000000 in both schemes', () => {
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(getActiveThemeColors().studentName).toBe('#000000');
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(getActiveThemeColors().studentName).toBe('#000000');
  });

  it('D6: getActiveThemeColors().gridBackground === #ffffff in both schemes', () => {
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(getActiveThemeColors().gridBackground).toBe('#ffffff');
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(getActiveThemeColors().gridBackground).toBe('#ffffff');
  });

  it('D7: getActiveThemeColors().topBarRight matches the scheme topBarRight', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    // purpleGreen.topBarRight was checker-updated from #84659a to #553726 for WCAG contrast
    expect(getActiveThemeColors().topBarRight).toBe('#553726');
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(getActiveThemeColors().topBarRight).toBe('#f5f5f5');
  });
});

// ---------------------------------------------------------------------------
// E. colors.ts — btnText routes through --pj-buttonText (11.A1)
// ---------------------------------------------------------------------------

describe('E. colors.ts btnText routes through --pj-buttonText (11.A1)', () => {
  it('E1: btnText contains --pj-buttonText', () => {
    expect(btnText).toContain('--pj-buttonText');
  });

  it('E2: btnText has a classic fallback hex #333', () => {
    expect(btnText).toContain('#333');
  });
});

// ---------------------------------------------------------------------------
// F. colors.ts — topBarRightBackground token (11.A4)
// ---------------------------------------------------------------------------

describe('F. colors.ts topBarRightBackground token routes through --pj-topBarRight (11.A4)', () => {
  it('F1: topBarRightBackground contains --pj-topBarRight', () => {
    expect(topBarRightBackground).toContain('--pj-topBarRight');
  });

  it('F2: topBarRightBackground has a classic fallback hex #f5f5f5', () => {
    expect(topBarRightBackground).toContain('#f5f5f5');
  });
});

// ---------------------------------------------------------------------------
// G. Canvas drawOccupants uses studentName (11.A2)
// ---------------------------------------------------------------------------

describe('G. Canvas drawOccupants uses scheme studentName for real student names (11.A2)', () => {
  beforeEach(() => {
    lsStub = makeLocalStorageStub();
    vi.stubGlobal('localStorage', lsStub);
    _setActiveThemeInternal(THEMES.classic!);
    resetDocumentElementStyle();
    resetStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _setActiveThemeInternal(THEMES.classic!);
    resetDocumentElementStyle();
    cleanup();
  });

  it('G1: drawOccupants sets fillStyle to getActiveThemeColors().studentName for real student', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const alice = makeRealStudent('Alice');
    const cls = makeClassroomWithStudent(alice);
    const spyCtx = makeDrawSpyCtx();
    drawOccupants(spyCtx as unknown as CanvasRenderingContext2D, cls, 48);
    expect(spyCtx.fillStyle).toBe(getActiveThemeColors().studentName);
  });

  it('G2: classic scheme: student name fillStyle is #000000', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const alice = makeRealStudent('Alice');
    const cls = makeClassroomWithStudent(alice);
    const spyCtx = makeDrawSpyCtx();
    drawOccupants(spyCtx as unknown as CanvasRenderingContext2D, cls, 48);
    expect(spyCtx.fillStyle).toBe('#000000');
  });

  it('G3: purpleGreen scheme: student name fillStyle is #000000 (black in both schemes)', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);
    const alice = makeRealStudent('Alice');
    const cls = makeClassroomWithStudent(alice);
    const spyCtx = makeDrawSpyCtx();
    drawOccupants(spyCtx as unknown as CanvasRenderingContext2D, cls, 48);
    expect(spyCtx.fillStyle).toBe('#000000');
  });

  it('G4: fixture labels still use occupantNameFixture color (unchanged by 11.A2)', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const board = makeFixtureStudent('Board');
    const cls = makeClassroomWithStudent(board, 'fixture');
    const spyCtx = makeDrawSpyCtx();
    drawOccupants(spyCtx as unknown as CanvasRenderingContext2D, cls, 48);
    expect(spyCtx.fillStyle).toBe(occupantNameFixture);
  });

  it('G5: studentName is NOT a CSS var string (resolved for canvas, never a var() call)', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);
    const alice = makeRealStudent('Alice');
    const cls = makeClassroomWithStudent(alice);
    const spyCtx = makeDrawSpyCtx();
    drawOccupants(spyCtx as unknown as CanvasRenderingContext2D, cls, 48);
    expect((spyCtx.fillStyle as string).startsWith('var(')).toBe(false);
  });

  it('G6: drawOccupants studentName comes from THEMES.classic.studentName', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const alice = makeRealStudent('Alice');
    const cls = makeClassroomWithStudent(alice);
    const spyCtx = makeDrawSpyCtx();
    drawOccupants(spyCtx as unknown as CanvasRenderingContext2D, cls, 48);
    expect(spyCtx.fillStyle).toBe(THEMES.classic?.studentName);
  });

  it('G7: drawOccupants studentName comes from THEMES.purpleGreen.studentName', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);
    const alice = makeRealStudent('Alice');
    const cls = makeClassroomWithStudent(alice);
    const spyCtx = makeDrawSpyCtx();
    drawOccupants(spyCtx as unknown as CanvasRenderingContext2D, cls, 48);
    expect(spyCtx.fillStyle).toBe(THEMES.purpleGreen?.studentName);
  });
});

// ---------------------------------------------------------------------------
// H. Canvas clearCanvas uses gridBackground from scheme (11.A3)
// ---------------------------------------------------------------------------

describe('H. Canvas clearCanvas uses scheme gridBackground (11.A3)', () => {
  beforeEach(() => {
    lsStub = makeLocalStorageStub();
    vi.stubGlobal('localStorage', lsStub);
    _setActiveThemeInternal(THEMES.classic!);
    resetDocumentElementStyle();
    resetStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _setActiveThemeInternal(THEMES.classic!);
    resetDocumentElementStyle();
    cleanup();
  });

  it('H1: clearCanvas fills with getActiveThemeColors().gridBackground', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const spyCtx = makeClearCanvasSpyCtx();
    clearCanvas(spyCtx as unknown as CanvasRenderingContext2D, 100, 100);
    expect(spyCtx.fillStyle).toBe(getActiveThemeColors().gridBackground);
  });

  it('H2: classic scheme: clearCanvas fills with #ffffff', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const spyCtx = makeClearCanvasSpyCtx();
    clearCanvas(spyCtx as unknown as CanvasRenderingContext2D, 100, 100);
    expect(spyCtx.fillStyle).toBe('#ffffff');
  });

  it('H3: purpleGreen scheme: clearCanvas fills with #ffffff (white in both schemes)', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);
    const spyCtx = makeClearCanvasSpyCtx();
    clearCanvas(spyCtx as unknown as CanvasRenderingContext2D, 100, 100);
    expect(spyCtx.fillStyle).toBe('#ffffff');
  });

  it('H4: gridBackground fillStyle is NOT a CSS var string (resolved for canvas)', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);
    const spyCtx = makeClearCanvasSpyCtx();
    clearCanvas(spyCtx as unknown as CanvasRenderingContext2D, 100, 100);
    expect((spyCtx.fillStyle as string).startsWith('var(')).toBe(false);
  });

  it('H5: clearCanvas fill matches SCHEME_REGISTRY.classic.gridBackground', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const spyCtx = makeClearCanvasSpyCtx();
    clearCanvas(spyCtx as unknown as CanvasRenderingContext2D, 100, 100);
    expect(spyCtx.fillStyle).toBe(SCHEME_REGISTRY.classic?.gridBackground);
  });
});

// ---------------------------------------------------------------------------
// I. TopBar top-bar-right region (11.A4)
// ---------------------------------------------------------------------------

describe('I. TopBar top-bar-right region uses topBarRight background (11.A4)', () => {
  beforeEach(() => {
    lsStub = makeLocalStorageStub();
    vi.stubGlobal('localStorage', lsStub);
    _setActiveThemeInternal(THEMES.classic!);
    resetDocumentElementStyle();
    applyThemeVars(THEMES.classic!);
    resetStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _setActiveThemeInternal(THEMES.classic!);
    resetDocumentElementStyle();
    cleanup();
  });

  it('I1: top-bar-right element is present in the DOM (Furniture mode)', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    expect(screen.getByTestId('top-bar-right')).toBeInTheDocument();
  });

  it('I2: top-bar-right element has a non-empty background style (topBarRight surface)', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const region = screen.getByTestId('top-bar-right');
    expect(region.style.background.length).toBeGreaterThan(0);
  });

  it('I3: saved-indicator has transparent background (no brown / SPECIAL_TEXT_BG)', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic', saveStatus: 'saved' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const indicator = screen.getByTestId('saved-indicator');
    expect(indicator.style.background).toBe('transparent');
  });

  it('I4: erase-all-button has transparent background (no brown / SPECIAL_TEXT_BG)', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const btn = screen.getByTestId('erase-all-button');
    expect(btn.style.background).toBe('transparent');
  });

  it('I5: saved-indicator and erase-all-button are both inside the top-bar-right region', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const region = screen.getByTestId('top-bar-right');
    const indicator = screen.getByTestId('saved-indicator');
    const btn = screen.getByTestId('erase-all-button');
    expect(region.contains(indicator)).toBe(true);
    expect(region.contains(btn)).toBe(true);
  });

  it('I6: top-bar-right background style string contains --pj-topBarRight', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const region = screen.getByTestId('top-bar-right');
    expect(region.style.background).toContain('--pj-topBarRight');
  });

  it('I7: top-bar-right is present in Students editor mode', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic', activeEditorId: 'student' }); });
    const ctx = makeCtx({ activeEditorId: 'student' });
    render(React.createElement(TopBar, { activeEditor: StudentEditor, ctx }));
    expect(screen.getByTestId('top-bar-right')).toBeInTheDocument();
  });

  it('I8: saved-indicator background is NOT rgb(85, 55, 38) (old SPECIAL_TEXT_BG brown)', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic', saveStatus: 'saved' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const indicator = screen.getByTestId('saved-indicator');
    expect(indicator.style.background).not.toBe('rgb(85, 55, 38)');
  });

  it('I9: erase-all-button background is NOT rgb(85, 55, 38) (old SPECIAL_TEXT_BG brown)', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const btn = screen.getByTestId('erase-all-button');
    expect(btn.style.background).not.toBe('rgb(85, 55, 38)');
  });
});

// ---------------------------------------------------------------------------
// J. Classic unchanged regression
// ---------------------------------------------------------------------------

describe('J. Classic unchanged regression (§11 values added; existing surfaces unmodified)', () => {
  it('J1: classic.topBar unchanged (#f5f5f5)', () => {
    expect(SCHEME_REGISTRY.classic?.topBar).toBe('#f5f5f5');
  });

  it('J2: classic.leftBar unchanged (#fafafa)', () => {
    expect(SCHEME_REGISTRY.classic?.leftBar).toBe('#fafafa');
  });

  it('J3: classic.gridBackdrop unchanged (#f0f0f0)', () => {
    expect(SCHEME_REGISTRY.classic?.gridBackdrop).toBe('#f0f0f0');
  });

  it('J4: classic.text unchanged (#333)', () => {
    expect(SCHEME_REGISTRY.classic?.text).toBe('#333');
  });

  it('J5: classic.selectedBox unchanged (#1565c0)', () => {
    expect(SCHEME_REGISTRY.classic?.selectedBox).toBe('#1565c0');
  });

  it('J6: classic.unselectedBox unchanged (#ffffff)', () => {
    expect(SCHEME_REGISTRY.classic?.unselectedBox).toBe('#ffffff');
  });

  it('J7: THEMES.classic.toolbarBackground unchanged (#f5f5f5)', () => {
    expect(THEMES.classic?.toolbarBackground).toBe('#f5f5f5');
  });

  it('J8: THEMES.classic.appBackground unchanged (#f0f0f0)', () => {
    expect(THEMES.classic?.appBackground).toBe('#f0f0f0');
  });

  it('J9: THEMES.classic.sidePanelBackground unchanged (#fafafa)', () => {
    expect(THEMES.classic?.sidePanelBackground).toBe('#fafafa');
  });

  it('J10: classic topBarRight defaults to classic topBar value (looks like the current bar by default)', () => {
    expect(THEMES.classic?.topBarRight).toBe(THEMES.classic?.toolbarBackground);
  });
});

// ---------------------------------------------------------------------------
// K. topBarRightText legibility token (§11.A5)
//
// Erase-all and Saved-locally text/border must be legible on the topBarRight
// surface in BOTH schemes. The fix: scheme.topBarRightText (classic=#333,
// purpleGreen=#fff) is plumbed through ThemePalette and --pj-topBarRightText,
// and all TopBar right-region text uses this token.
//
//    K1.  classic.topBarRightText === '#333' (legible on #f5f5f5: 12.6:1)
//    K2.  purpleGreen.topBarRightText === '#ffffff' (legible on #84659a: 4.87:1 >= WCAG AA)
//    K3.  THEMES.classic.topBarRightText === '#333'
//    K4.  THEMES.purpleGreen.topBarRightText === '#ffffff'
//    K5.  applyThemeVars sets --pj-topBarRightText (classic)
//    K6.  applyThemeVars sets --pj-topBarRightText to #ffffff for purpleGreen
//    K7.  switching back to classic resets --pj-topBarRightText to #333
//    K8.  every scheme in SCHEME_REGISTRY has topBarRightText key
//    K9.  every theme in THEMES has non-empty topBarRightText
//    K10. topBarRightText colors.ts token contains --pj-topBarRightText
//    K11. topBarRightText colors.ts token has classic fallback #333
//    K12. saved-indicator color uses --pj-topBarRightText token (legible on surface)
//    K13. erase-all-button color uses --pj-topBarRightText token (legible on surface)
//    K14. erase-all-button border uses --pj-topBarRightText token (legible on surface)
//    K15. classic topBarRightText matches scheme text (same surface, same legibility)
// ---------------------------------------------------------------------------

describe('K. topBarRightText legibility token (§11.A5)', () => {
  let lsStubK: Storage;

  beforeEach(() => {
    lsStubK = makeLocalStorageStub();
    vi.stubGlobal('localStorage', lsStubK);
    _setActiveThemeInternal(THEMES.classic!);
    resetDocumentElementStyle();
    applyThemeVars(THEMES.classic!);
    resetStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _setActiveThemeInternal(THEMES.classic!);
    resetDocumentElementStyle();
    cleanup();
  });

  it('K1: classic.topBarRightText === #333 (legible on #f5f5f5)', () => {
    expect(SCHEME_REGISTRY.classic?.topBarRightText).toBe('#333');
  });

  it('K2: purpleGreen.topBarRightText === #ffffff (legible on #84659a: WCAG AA)', () => {
    expect(SCHEME_REGISTRY.purpleGreen?.topBarRightText).toBe('#ffffff');
  });

  it('K3: THEMES.classic.topBarRightText === #333', () => {
    expect(THEMES.classic?.topBarRightText).toBe('#333');
  });

  it('K4: THEMES.purpleGreen.topBarRightText === #ffffff', () => {
    expect(THEMES.purpleGreen?.topBarRightText).toBe('#ffffff');
  });

  it('K5: applyThemeVars sets --pj-topBarRightText for classic', () => {
    applyThemeVars(THEMES.classic!);
    expect(document.documentElement.style.getPropertyValue('--pj-topBarRightText')).toBe('#333');
  });

  it('K6: applyThemeVars sets --pj-topBarRightText to #ffffff for purpleGreen', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-topBarRightText')).toBe('#ffffff');
  });

  it('K7: switching back to classic resets --pj-topBarRightText to #333', () => {
    applyThemeVars(THEMES.purpleGreen!);
    applyThemeVars(THEMES.classic!);
    expect(document.documentElement.style.getPropertyValue('--pj-topBarRightText')).toBe('#333');
  });

  it('K8: every scheme in SCHEME_REGISTRY has topBarRightText key', () => {
    for (const [id, scheme] of Object.entries(SCHEME_REGISTRY)) {
      expect(
        'topBarRightText' in scheme,
        `SCHEME_REGISTRY[${id}] missing key "topBarRightText"`,
      ).toBe(true);
    }
  });

  it('K9: every theme in THEMES has non-empty topBarRightText', () => {
    for (const [id, palette] of Object.entries(THEMES)) {
      const val = palette.topBarRightText;
      expect(
        typeof val === 'string' && val.length > 0,
        `THEMES.${id}.topBarRightText should be a non-empty string`,
      ).toBe(true);
    }
  });

  it('K10: colors.ts topBarRightText token contains --pj-topBarRightText', () => {
    expect(topBarRightText).toContain('--pj-topBarRightText');
  });

  it('K11: colors.ts topBarRightText token has classic fallback #333', () => {
    expect(topBarRightText).toContain('#333');
  });

  it('K12: saved-indicator color uses --pj-topBarRightText token (legible on topBarRight surface)', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic', saveStatus: 'saved' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const indicator = screen.getByTestId('saved-indicator');
    expect(indicator.style.color).toContain('--pj-topBarRightText');
  });

  it('K13: erase-all-button text color uses --pj-topBarRightText token (legible on topBarRight surface)', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const btn = screen.getByTestId('erase-all-button');
    expect(btn.style.color).toContain('--pj-topBarRightText');
  });

  it('K14: erase-all-button border uses --pj-topBarRightText token (legible on topBarRight surface)', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const btn = screen.getByTestId('erase-all-button');
    expect(btn.style.border).toContain('--pj-topBarRightText');
  });

  it('K15: classic topBarRightText matches classic scheme text (same surface legibility)', () => {
    expect(THEMES.classic?.topBarRightText).toBe(SCHEME_REGISTRY.classic?.text);
  });
});
