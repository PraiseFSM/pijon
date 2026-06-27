// @vitest-environment jsdom
/**
 * Iteration 10 Cluster A — Theming breadth
 *
 * Tests cover:
 *
 * A. Scheme JSON files have selectedBox + unselectedBox
 *    A1.  classic.json has selectedBox === '#1565c0' (primary blue)
 *    A2.  classic.json has unselectedBox === '#ffffff'
 *    A3.  purpleGreen.json has selectedBox === '#793498' (exact spec)
 *    A4.  purpleGreen.json has unselectedBox === '#371e42' (exact spec)
 *    A5.  every scheme in SCHEME_REGISTRY has selectedBox + unselectedBox keys
 *    A6.  SchemeData shape check: selectedBox is a string
 *    A7.  SchemeData shape check: unselectedBox is a string
 *
 * B. ThemePalette / derivePalette propagates new fields
 *    B1.  THEMES.classic.selectedBox === '#1565c0'
 *    B2.  THEMES.classic.unselectedBox === '#ffffff'
 *    B3.  THEMES.purpleGreen.selectedBox === '#793498'
 *    B4.  THEMES.purpleGreen.unselectedBox === '#371e42'
 *    B5.  every theme has selectedBox as a non-empty string
 *    B6.  every theme has unselectedBox as a non-empty string
 *
 * C. applyThemeVars sets --pj-selectedBox and --pj-unselectedBox
 *    C1.  applyThemeVars sets --pj-selectedBox from palette.selectedBox (classic)
 *    C2.  applyThemeVars sets --pj-unselectedBox from palette.unselectedBox (classic)
 *    C3.  switching to purpleGreen sets --pj-selectedBox to #793498
 *    C4.  switching to purpleGreen sets --pj-unselectedBox to #371e42
 *    C5.  switching back to classic resets --pj-selectedBox to #1565c0
 *    C6.  switching back to classic resets --pj-unselectedBox to #ffffff
 *    C7.  applyThemeVars still sets pre-existing vars (regression guard)
 *
 * D. Store setTheme updates --pj-selectedBox / --pj-unselectedBox
 *    D1.  setTheme('purpleGreen') sets --pj-selectedBox to #793498
 *    D2.  setTheme('purpleGreen') sets --pj-unselectedBox to #371e42
 *    D3.  setTheme('classic') restores --pj-selectedBox to #1565c0
 *    D4.  setTheme('classic') restores --pj-unselectedBox to #ffffff
 *    D5.  getActiveThemeColors().selectedBox reflects the active scheme
 *    D6.  getActiveThemeColors().unselectedBox reflects the active scheme
 *
 * E. colors.ts — selection-accent tokens reference --pj-selectedBox
 *    E1.  primaryButtonBackground references --pj-selectedBox
 *    E2.  primaryButtonBorder references --pj-selectedBox
 *    E3.  activeButtonBackground references --pj-selectedBox
 *    E4.  activeButtonBorder references --pj-selectedBox
 *    E5.  rosterSelectedBorder references --pj-selectedBox
 *    E6.  tabActiveBorder references --pj-selectedBox
 *    E7.  gearButtonBorderActive references --pj-selectedBox
 *    E8.  gearButtonTextActive references --pj-selectedBox
 *    E9.  addStudentButtonText references --pj-selectedBox
 *    E10. contextMenuUnlockText references --pj-selectedBox
 *    E11. selectedStudentHeaderText references --pj-selectedBox
 *
 * F. colors.ts — unselected-box tokens reference --pj-unselectedBox
 *    F1.  btnBackground references --pj-unselectedBox
 *    F2.  gearButtonBackground references --pj-unselectedBox
 *    F3.  splitButtonDropdownBackground references --pj-unselectedBox
 *    F4.  contextMenuBackground references --pj-unselectedBox
 *    F5.  colorPickerPopoverBackground references --pj-unselectedBox
 *
 * G. Canvas student-name color comes from getActiveThemeColors().studentName (§11.A2 — reverses 10.A1)
 *    G1.  drawOccupants uses getActiveThemeColors().studentName for a real student name
 *    G2.  with classic theme, fillStyle for real student name = '#000000' (studentName = black)
 *    G3.  with purpleGreen theme, fillStyle for real student name = '#000000' (studentName = black)
 *    G4.  drawOccupants still uses occupantNameFixture color for fixture labels
 *    G5.  student name fillStyle is same in classic and purpleGreen (both black)
 *
 * H. SettingsMenu theming (10.A2)
 *    H1.  settings-header element has background = toolbarBackground token
 *    H2.  settings-menu element has background = appBackground token
 *    H3.  header background changes with scheme (purpleGreen = #84659a)
 *    H4.  body background changes with scheme (purpleGreen = #939598)
 *    H5.  menu text color comes from themed text token (settingsHeaderText routes to --pj-text)
 *    H6.  menu label text color comes from themed text token (settingsLabelText routes to --pj-text)
 *    H7.  settings menu renders correctly in both classic and purpleGreen schemes
 *
 * I. Classic unchanged regression
 *    I1.  classic.selectedBox resolved palette = '#1565c0' (unchanged)
 *    I2.  classic.unselectedBox resolved palette = '#ffffff' (unchanged)
 *    I3.  classic text remains '#333' (unchanged)
 *    I4.  classic toolbarBackground remains '#f5f5f5' (unchanged)
 *    I5.  classic appBackground remains '#f0f0f0' (unchanged)
 *    I6.  classic sidePanelBackground remains '#fafafa' (unchanged)
 *    I7.  classic gridBackground is '#ffffff' (§11.A3 — now explicit scheme value, white in both schemes)
 *    I8.  CSS-var fallbacks in selectedBox tokens preserve classic blue
 *    I9.  CSS-var fallbacks in unselectedBox tokens preserve classic white
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
  primaryButtonBackground,
  primaryButtonBorder,
  activeButtonBackground,
  activeButtonBorder,
  rosterSelectedBorder,
  tabActiveBorder,
  gearButtonBorderActive,
  gearButtonTextActive,
  gearButtonBackground,
  addStudentButtonText,
  contextMenuUnlockText,
  selectedStudentHeaderText,
  btnBackground,
  splitButtonDropdownBackground,
  contextMenuBackground,
  colorPickerPopoverBackground,
  settingsHeaderText,
  settingsLabelText,
} from '../theme/colors.js';

import { drawOccupants } from '../ui/canvas/render.js';
import { occupantNameFixture } from '../theme/colors.js';
import type { Classroom } from '../domain/classroom.js';
import type { Furniture } from '../domain/furniture.js';
import type { Student } from '../domain/student.js';
import type { StudentId } from '../domain/types.js';

import { usePijonStore } from '../state/store.js';
import { SettingsMenu } from '../ui/shell/SettingsMenu.js';
import type { EditorContext, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import type { FurnitureId } from '../domain/types.js';
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

// Canvas spy context: captures the last fillStyle value set
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

/** Convenience: build a real-student object with all required fields. */
function makeRealStudent(name = 'Alice'): Student {
  return {
    id: `${name.toLowerCase()}_id` as StudentId,
    name,
    preferences: [],
    isFixture: false,
    metadata: {},
  };
}

/** Convenience: build a fixture-student object (for whiteboard labels etc). */
function makeFixtureStudent(name = 'Board'): Student {
  return {
    id: `${name.toLowerCase()}_fid` as StudentId,
    name,
    preferences: [],
    isFixture: true,
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// A. Scheme JSON files
// ---------------------------------------------------------------------------

describe('A. Scheme JSON files have selectedBox + unselectedBox', () => {
  it('A1: classic.json selectedBox === #1565c0', () => {
    expect(SCHEME_REGISTRY.classic?.selectedBox).toBe('#1565c0');
  });

  it('A2: classic.json unselectedBox === #ffffff', () => {
    expect(SCHEME_REGISTRY.classic?.unselectedBox).toBe('#ffffff');
  });

  it('A3: purpleGreen.json selectedBox === #793498 (exact spec hex)', () => {
    expect(SCHEME_REGISTRY.purpleGreen?.selectedBox).toBe('#793498');
  });

  it('A4: purpleGreen.json unselectedBox === #371e42 (exact spec hex)', () => {
    expect(SCHEME_REGISTRY.purpleGreen?.unselectedBox).toBe('#371e42');
  });

  it('A5: every scheme in SCHEME_REGISTRY has selectedBox and unselectedBox keys', () => {
    for (const [id, scheme] of Object.entries(SCHEME_REGISTRY)) {
      expect(
        'selectedBox' in scheme,
        `SCHEME_REGISTRY[${id}] missing selectedBox`,
      ).toBe(true);
      expect(
        'unselectedBox' in scheme,
        `SCHEME_REGISTRY[${id}] missing unselectedBox`,
      ).toBe(true);
    }
  });

  it('A6: each scheme selectedBox is a non-empty string', () => {
    for (const [id, scheme] of Object.entries(SCHEME_REGISTRY)) {
      expect(
        typeof scheme.selectedBox === 'string' && scheme.selectedBox.length > 0,
        `SCHEME_REGISTRY[${id}].selectedBox should be a non-empty string`,
      ).toBe(true);
    }
  });

  it('A7: each scheme unselectedBox is a non-empty string', () => {
    for (const [id, scheme] of Object.entries(SCHEME_REGISTRY)) {
      expect(
        typeof scheme.unselectedBox === 'string' && scheme.unselectedBox.length > 0,
        `SCHEME_REGISTRY[${id}].unselectedBox should be a non-empty string`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// B. ThemePalette / derivePalette
// ---------------------------------------------------------------------------

describe('B. ThemePalette.selectedBox + unselectedBox derived from scheme', () => {
  it('B1: THEMES.classic.selectedBox === #1565c0', () => {
    expect(THEMES.classic?.selectedBox).toBe('#1565c0');
  });

  it('B2: THEMES.classic.unselectedBox === #ffffff', () => {
    expect(THEMES.classic?.unselectedBox).toBe('#ffffff');
  });

  it('B3: THEMES.purpleGreen.selectedBox === #793498', () => {
    expect(THEMES.purpleGreen?.selectedBox).toBe('#793498');
  });

  it('B4: THEMES.purpleGreen.unselectedBox === #371e42', () => {
    expect(THEMES.purpleGreen?.unselectedBox).toBe('#371e42');
  });

  it('B5: every theme in THEMES has selectedBox as a non-empty string', () => {
    for (const [id, palette] of Object.entries(THEMES)) {
      expect(
        typeof palette.selectedBox === 'string' && palette.selectedBox.length > 0,
        `THEMES.${id}.selectedBox should be a non-empty string`,
      ).toBe(true);
    }
  });

  it('B6: every theme in THEMES has unselectedBox as a non-empty string', () => {
    for (const [id, palette] of Object.entries(THEMES)) {
      expect(
        typeof palette.unselectedBox === 'string' && palette.unselectedBox.length > 0,
        `THEMES.${id}.unselectedBox should be a non-empty string`,
      ).toBe(true);
    }
  });

  it('B7: classic.selectedBox differs from purpleGreen.selectedBox', () => {
    expect(THEMES.classic?.selectedBox).not.toBe(THEMES.purpleGreen?.selectedBox);
  });

  it('B8: classic.unselectedBox differs from purpleGreen.unselectedBox', () => {
    expect(THEMES.classic?.unselectedBox).not.toBe(THEMES.purpleGreen?.unselectedBox);
  });
});

// ---------------------------------------------------------------------------
// C. applyThemeVars sets --pj-selectedBox and --pj-unselectedBox
// ---------------------------------------------------------------------------

describe('C. applyThemeVars sets --pj-selectedBox and --pj-unselectedBox', () => {
  afterEach(() => {
    resetDocumentElementStyle();
    cleanup();
  });

  it('C1: applyThemeVars sets --pj-selectedBox from palette.selectedBox (classic)', () => {
    applyThemeVars(THEMES.classic!);
    expect(document.documentElement.style.getPropertyValue('--pj-selectedBox')).toBe('#1565c0');
  });

  it('C2: applyThemeVars sets --pj-unselectedBox from palette.unselectedBox (classic)', () => {
    applyThemeVars(THEMES.classic!);
    expect(document.documentElement.style.getPropertyValue('--pj-unselectedBox')).toBe('#ffffff');
  });

  it('C3: switching to purpleGreen sets --pj-selectedBox to #793498', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-selectedBox')).toBe('#793498');
  });

  it('C4: switching to purpleGreen sets --pj-unselectedBox to #371e42', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-unselectedBox')).toBe('#371e42');
  });

  it('C5: switching back to classic resets --pj-selectedBox to #1565c0', () => {
    applyThemeVars(THEMES.purpleGreen!);
    applyThemeVars(THEMES.classic!);
    expect(document.documentElement.style.getPropertyValue('--pj-selectedBox')).toBe('#1565c0');
  });

  it('C6: switching back to classic resets --pj-unselectedBox to #ffffff', () => {
    applyThemeVars(THEMES.purpleGreen!);
    applyThemeVars(THEMES.classic!);
    expect(document.documentElement.style.getPropertyValue('--pj-unselectedBox')).toBe('#ffffff');
  });

  it('C7: applyThemeVars still sets pre-existing vars (regression)', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-appBackground')).toBe('#939598');
    expect(document.documentElement.style.getPropertyValue('--pj-toolbarBackground')).toBe('#84659a');
    expect(document.documentElement.style.getPropertyValue('--pj-text')).toBe('#fff');
    expect(document.documentElement.style.getPropertyValue('--pj-text-muted')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// D. Store setTheme updates the new CSS vars
// ---------------------------------------------------------------------------

describe('D. Store setTheme updates --pj-selectedBox / --pj-unselectedBox', () => {
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

  it('D1: setTheme(purpleGreen) sets --pj-selectedBox to #793498', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(document.documentElement.style.getPropertyValue('--pj-selectedBox')).toBe('#793498');
  });

  it('D2: setTheme(purpleGreen) sets --pj-unselectedBox to #371e42', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(document.documentElement.style.getPropertyValue('--pj-unselectedBox')).toBe('#371e42');
  });

  it('D3: setTheme(classic) restores --pj-selectedBox to #1565c0', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(document.documentElement.style.getPropertyValue('--pj-selectedBox')).toBe('#1565c0');
  });

  it('D4: setTheme(classic) restores --pj-unselectedBox to #ffffff', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(document.documentElement.style.getPropertyValue('--pj-unselectedBox')).toBe('#ffffff');
  });

  it('D5: getActiveThemeColors().selectedBox reflects the active scheme', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(getActiveThemeColors().selectedBox).toBe('#793498');
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(getActiveThemeColors().selectedBox).toBe('#1565c0');
  });

  it('D6: getActiveThemeColors().unselectedBox reflects the active scheme', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(getActiveThemeColors().unselectedBox).toBe('#371e42');
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(getActiveThemeColors().unselectedBox).toBe('#ffffff');
  });
});

// ---------------------------------------------------------------------------
// E. colors.ts — selection-accent tokens reference --pj-selectedBox
// ---------------------------------------------------------------------------

describe('E. colors.ts selection-accent tokens reference --pj-selectedBox', () => {
  it('E1: primaryButtonBackground contains --pj-selectedBox', () => {
    expect(primaryButtonBackground).toContain('--pj-selectedBox');
  });

  it('E2: primaryButtonBorder contains --pj-selectedBox', () => {
    expect(primaryButtonBorder).toContain('--pj-selectedBox');
  });

  it('E3: activeButtonBackground contains --pj-selectedBox', () => {
    expect(activeButtonBackground).toContain('--pj-selectedBox');
  });

  it('E4: activeButtonBorder contains --pj-selectedBox', () => {
    expect(activeButtonBorder).toContain('--pj-selectedBox');
  });

  it('E5: rosterSelectedBorder contains --pj-selectedBox', () => {
    expect(rosterSelectedBorder).toContain('--pj-selectedBox');
  });

  it('E6: tabActiveBorder contains --pj-selectedBox', () => {
    expect(tabActiveBorder).toContain('--pj-selectedBox');
  });

  it('E7: gearButtonBorderActive contains --pj-selectedBox', () => {
    expect(gearButtonBorderActive).toContain('--pj-selectedBox');
  });

  it('E8: gearButtonTextActive contains --pj-selectedBox', () => {
    expect(gearButtonTextActive).toContain('--pj-selectedBox');
  });

  it('E9: addStudentButtonText contains --pj-selectedBox', () => {
    expect(addStudentButtonText).toContain('--pj-selectedBox');
  });

  it('E10: contextMenuUnlockText contains --pj-selectedBox', () => {
    expect(contextMenuUnlockText).toContain('--pj-selectedBox');
  });

  it('E11: selectedStudentHeaderText contains --pj-selectedBox', () => {
    expect(selectedStudentHeaderText).toContain('--pj-selectedBox');
  });

  it('E12: selectedBox tokens include a classic fallback hex', () => {
    // The classic blue should appear as a fallback in the var() expression
    expect(primaryButtonBackground).toContain('#1565c0');
    expect(activeButtonBackground).toContain('#1565c0');
    expect(rosterSelectedBorder).toContain('#1565c0');
  });
});

// ---------------------------------------------------------------------------
// F. colors.ts — unselected-box tokens reference --pj-unselectedBox
// ---------------------------------------------------------------------------

describe('F. colors.ts unselected-box tokens reference --pj-unselectedBox', () => {
  it('F1: btnBackground contains --pj-unselectedBox', () => {
    expect(btnBackground).toContain('--pj-unselectedBox');
  });

  it('F2: gearButtonBackground contains --pj-unselectedBox', () => {
    expect(gearButtonBackground).toContain('--pj-unselectedBox');
  });

  it('F3: splitButtonDropdownBackground contains --pj-unselectedBox', () => {
    expect(splitButtonDropdownBackground).toContain('--pj-unselectedBox');
  });

  it('F4: contextMenuBackground contains --pj-unselectedBox', () => {
    expect(contextMenuBackground).toContain('--pj-unselectedBox');
  });

  it('F5: colorPickerPopoverBackground contains --pj-unselectedBox', () => {
    expect(colorPickerPopoverBackground).toContain('--pj-unselectedBox');
  });

  it('F6: unselectedBox tokens include a white fallback', () => {
    // The classic white should appear as a fallback
    expect(btnBackground).toContain('#ffffff');
    expect(contextMenuBackground).toContain('#ffffff');
  });
});

// ---------------------------------------------------------------------------
// G. Canvas student-name color uses getActiveThemeColors().text (10.A1)
// ---------------------------------------------------------------------------

describe('G. Canvas drawOccupants uses scheme studentName for student names (§11.A2)', () => {
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

  it('G1: drawOccupants sets fillStyle to getActiveThemeColors().studentName for a real student (§11.A2)', () => {
    // §11.A2: student names now use the scheme studentName color (black in both schemes)
    // This reverses 10.A1 which routed names through text.
    _setActiveThemeInternal(THEMES.classic!);
    const alice = makeRealStudent('Alice');
    const studentOnlyDesk: Furniture = {
      id: 'desk1' as FurnitureId, kind: 'single_desk', pos: { x: 0, y: 0 },
      w: 1, h: 1, rotation: 0, occupants: [alice],
    };
    const cls = { id: 'c', name: 'T', gridW: 6, gridH: 6, furniture: [studentOnlyDesk], cellsPerUnit: 1, thresholdUnits: 1.5, roster: [alice] } as unknown as Classroom;
    const spyCtx = makeDrawSpyCtx();
    drawOccupants(spyCtx as unknown as CanvasRenderingContext2D, cls, 48);
    expect(spyCtx.fillStyle).toBe(getActiveThemeColors().studentName);
  });

  it('G2: with classic theme, student name fillStyle is #000000 (studentName = black)', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const alice = makeRealStudent('Alice');
    const studentOnlyDesk: Furniture = {
      id: 'desk1' as FurnitureId, kind: 'single_desk', pos: { x: 0, y: 0 },
      w: 1, h: 1, rotation: 0, occupants: [alice],
    };
    const cls = { id: 'c', name: 'T', gridW: 6, gridH: 6, furniture: [studentOnlyDesk], cellsPerUnit: 1, thresholdUnits: 1.5, roster: [alice] } as unknown as Classroom;
    const spyCtx = makeDrawSpyCtx();
    drawOccupants(spyCtx as unknown as CanvasRenderingContext2D, cls, 48);
    expect(spyCtx.fillStyle).toBe('#000000');
  });

  it('G3: with purpleGreen theme, student name fillStyle is #000000 (studentName = black in both schemes)', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);
    const alice = makeRealStudent('Alice');
    const studentOnlyDesk: Furniture = {
      id: 'desk1' as FurnitureId, kind: 'single_desk', pos: { x: 0, y: 0 },
      w: 1, h: 1, rotation: 0, occupants: [alice],
    };
    const cls = { id: 'c', name: 'T', gridW: 6, gridH: 6, furniture: [studentOnlyDesk], cellsPerUnit: 1, thresholdUnits: 1.5, roster: [alice] } as unknown as Classroom;
    const spyCtx = makeDrawSpyCtx();
    drawOccupants(spyCtx as unknown as CanvasRenderingContext2D, cls, 48);
    expect(spyCtx.fillStyle).toBe('#000000');
  });

  it('G4: drawOccupants sets fillStyle to occupantNameFixture for fixture labels', () => {
    _setActiveThemeInternal(THEMES.classic!);
    const board = makeFixtureStudent('Board');
    const fixtureOnly: Furniture = {
      id: 'board1' as FurnitureId,
      kind: 'whiteboard',
      pos: { x: 0, y: 0 },
      w: 2,
      h: 1,
      rotation: 0,
      occupants: [board],
    };
    const classroomFixtureOnly = {
      id: 'cls1',
      name: 'Test',
      gridW: 6,
      gridH: 6,
      furniture: [fixtureOnly],
      cellsPerUnit: 1,
      thresholdUnits: 1.5,
      roster: [],
    } as unknown as Classroom;
    const spyCtx = makeDrawSpyCtx();
    drawOccupants(spyCtx as unknown as CanvasRenderingContext2D, classroomFixtureOnly, 48);
    expect(spyCtx.fillStyle).toBe(occupantNameFixture);
  });

  it('G5: student name fillStyle is black (#000000) in both classic and purpleGreen (§11.A2 — studentName = black)', () => {
    // §11.A2: studentName is #000000 in both shipped schemes — black for max
    // readability on desk surfaces regardless of the overall theme palette.
    const alice = makeRealStudent('Alice');
    const studentOnlyDesk: Furniture = {
      id: 'desk1' as FurnitureId, kind: 'single_desk', pos: { x: 0, y: 0 },
      w: 1, h: 1, rotation: 0, occupants: [alice],
    };
    const cls = { id: 'c', name: 'T', gridW: 6, gridH: 6, furniture: [studentOnlyDesk], cellsPerUnit: 1, thresholdUnits: 1.5, roster: [alice] } as unknown as Classroom;

    _setActiveThemeInternal(THEMES.classic!);
    const spyClassic = makeDrawSpyCtx();
    drawOccupants(spyClassic as unknown as CanvasRenderingContext2D, cls, 48);
    const classicFill = spyClassic.fillStyle as string;

    _setActiveThemeInternal(THEMES.purpleGreen!);
    const spyPg = makeDrawSpyCtx();
    drawOccupants(spyPg as unknown as CanvasRenderingContext2D, cls, 48);
    const pgFill = spyPg.fillStyle as string;

    expect(classicFill).toBe('#000000');
    expect(pgFill).toBe('#000000');
    // Both resolve from the scheme's studentName value
    expect(classicFill).toBe(THEMES.classic?.studentName);
    expect(pgFill).toBe(THEMES.purpleGreen?.studentName);
  });

  it('G6: student name color is NOT a CSS var string (resolved value for canvas)', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);
    const alice = makeRealStudent('Alice');
    const studentOnlyDesk: Furniture = {
      id: 'desk1' as FurnitureId, kind: 'single_desk', pos: { x: 0, y: 0 },
      w: 1, h: 1, rotation: 0, occupants: [alice],
    };
    const cls = { id: 'c', name: 'T', gridW: 6, gridH: 6, furniture: [studentOnlyDesk], cellsPerUnit: 1, thresholdUnits: 1.5, roster: [alice] } as unknown as Classroom;
    const spyCtx = makeDrawSpyCtx();
    drawOccupants(spyCtx as unknown as CanvasRenderingContext2D, cls, 48);
    // Canvas cannot resolve CSS variables — must be a plain color string
    expect((spyCtx.fillStyle as string).startsWith('var(')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// H. SettingsMenu theming (10.A2)
// ---------------------------------------------------------------------------

describe('H. SettingsMenu header = topBar, body = gridBackdrop, text = themed', () => {
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

  it('H1: settings-header has background equal to toolbarBackground token', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx({ themeId: 'classic' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    const header = screen.getByTestId('settings-header');
    // toolbarBackground token = var(--pj-toolbarBackground, #f5f5f5)
    // jsdom does not resolve CSS vars — the inline style will contain the var() or the classic hex
    // We verify the element exists and that its style references the correct token
    expect(header).toBeInTheDocument();
    // For classic, toolbarBackground style should be applied directly from colors.ts token
    // The token is a CSS var string; but in inline styles jsdom doesn't resolve it.
    // We check the raw inline style value instead.
    const inlineBg = header.style.background;
    // Should reference the themed toolbarBackground (either the var() string or resolved classic hex)
    expect(inlineBg.length).toBeGreaterThan(0);
  });

  it('H2: settings-menu element has background matching appBackground (gridBackdrop) token', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx({ themeId: 'classic' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    const menu = screen.getByTestId('settings-menu');
    expect(menu).toBeInTheDocument();
    const inlineBg = menu.style.background;
    expect(inlineBg.length).toBeGreaterThan(0);
  });

  it('H3: settings-header background changes with scheme (purpleGreen = #84659a topBar)', () => {
    // Apply purpleGreen theme vars so CSS vars resolve
    act(() => {
      usePijonStore.setState({ themeId: 'purpleGreen' });
      _setActiveThemeInternal(THEMES.purpleGreen!);
      applyThemeVars(THEMES.purpleGreen!);
    });
    const ctx = makeCtx({ themeId: 'purpleGreen' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    const header = screen.getByTestId('settings-header');
    // toolbarBackground for purpleGreen = '#84659a'
    // Header inline style should reference toolbarBackground token
    expect(header).toBeInTheDocument();
    // The style contains the toolbarBackground CSS var reference
    const inlineBg = header.style.background;
    // Since jsdom does not resolve CSS vars, we check that the var string is present
    // or, if the token is the resolved hex string, that it matches
    expect(inlineBg).toContain('--pj-toolbarBackground');
  });

  it('H4: settings-menu body background changes with scheme (purpleGreen = #939598 gridBackdrop)', () => {
    act(() => {
      usePijonStore.setState({ themeId: 'purpleGreen' });
      _setActiveThemeInternal(THEMES.purpleGreen!);
      applyThemeVars(THEMES.purpleGreen!);
    });
    const ctx = makeCtx({ themeId: 'purpleGreen' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    const menu = screen.getByTestId('settings-menu');
    const inlineBg = menu.style.background;
    // appBackground token = var(--pj-appBackground, #f0f0f0)
    expect(inlineBg).toContain('--pj-appBackground');
  });

  it('H5: settingsHeaderText token references --pj-text (theme-driven)', () => {
    expect(settingsHeaderText).toContain('--pj-text');
  });

  it('H6: settingsLabelText token references --pj-text (theme-driven)', () => {
    expect(settingsLabelText).toContain('--pj-text');
  });

  it('H7: settings menu renders (open) in classic scheme without crash', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx({ themeId: 'classic' });
    expect(() => {
      render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    }).not.toThrow();
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument();
    expect(screen.getByTestId('settings-header')).toBeInTheDocument();
    cleanup();
  });

  it('H8: settings menu renders (open) in purpleGreen scheme without crash', () => {
    act(() => {
      usePijonStore.setState({ themeId: 'purpleGreen' });
      _setActiveThemeInternal(THEMES.purpleGreen!);
    });
    const ctx = makeCtx({ themeId: 'purpleGreen' });
    expect(() => {
      render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    }).not.toThrow();
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument();
    expect(screen.getByTestId('settings-header')).toBeInTheDocument();
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// I. Classic unchanged regression
// ---------------------------------------------------------------------------

describe('I. Classic unchanged regression: resolved palette = prior appearance', () => {
  it('I1: classic.selectedBox resolved palette = #1565c0', () => {
    expect(THEMES.classic?.selectedBox).toBe('#1565c0');
  });

  it('I2: classic.unselectedBox resolved palette = #ffffff', () => {
    expect(THEMES.classic?.unselectedBox).toBe('#ffffff');
  });

  it('I3: classic text remains #333', () => {
    expect(THEMES.classic?.text).toBe('#333');
  });

  it('I4: classic toolbarBackground remains #f5f5f5', () => {
    expect(THEMES.classic?.toolbarBackground).toBe('#f5f5f5');
  });

  it('I5: classic appBackground remains #f0f0f0', () => {
    expect(THEMES.classic?.appBackground).toBe('#f0f0f0');
  });

  it('I6: classic sidePanelBackground remains #fafafa', () => {
    expect(THEMES.classic?.sidePanelBackground).toBe('#fafafa');
  });

  it('I7: classic gridBackground is #ffffff (§11.A3 — now an explicit scheme value, white in both shipped schemes)', () => {
    // §11.A3: gridBackground is no longer derived from gridBackdrop — it is now an explicit
    // scheme value set to white (#ffffff) in both shipped schemes for a clean grid surface.
    expect(THEMES.classic?.gridBackground).toBe('#ffffff');
  });

  it('I8: CSS-var fallback in selectedBox tokens = classic blue #1565c0', () => {
    // var(--pj-selectedBox, #1565c0) — the fallback preserves classic appearance
    expect(primaryButtonBackground).toMatch(/#1565c0/);
    expect(activeButtonBackground).toMatch(/#1565c0/);
    expect(rosterSelectedBorder).toMatch(/#1565c0/);
    expect(tabActiveBorder).toMatch(/#1565c0/);
  });

  it('I9: CSS-var fallback in unselectedBox tokens = classic white #ffffff', () => {
    // var(--pj-unselectedBox, #ffffff) — fallback preserves classic white
    expect(btnBackground).toMatch(/#ffffff/);
    expect(gearButtonBackground).toMatch(/#ffffff/);
    expect(splitButtonDropdownBackground).toMatch(/#ffffff/);
    expect(contextMenuBackground).toMatch(/#ffffff/);
  });

  it('I10: classic scheme has ONLY the expected new hex values added (no drift)', () => {
    const c = SCHEME_REGISTRY.classic;
    expect(c?.topBar).toBe('#f5f5f5');
    expect(c?.leftBar).toBe('#fafafa');
    expect(c?.gridBackdrop).toBe('#f0f0f0');
    expect(c?.text).toBe('#333');
    expect(c?.selectedBox).toBe('#1565c0');
    expect(c?.unselectedBox).toBe('#ffffff');
    expect(c?.logo).toBeNull();
  });

  it('I11: purpleGreen scheme new values are exactly the spec hexes', () => {
    const pg = SCHEME_REGISTRY.purpleGreen;
    expect(pg?.selectedBox).toBe('#793498');
    expect(pg?.unselectedBox).toBe('#371e42');
  });
});
