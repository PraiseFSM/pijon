// @vitest-environment jsdom
/**
 * Cluster C — Color themes (§7.C1 + §7.C2)
 *
 * Covers:
 *
 * A. themes.ts — THEMES registry and palette values
 *    A1.  THEMES has 'classic' entry
 *    A2.  THEMES has 'purpleGreen' entry
 *    A3.  purpleGreen.appBackground === '#939598' (behind-grid spec hex)
 *    A4.  purpleGreen.toolbarBackground === '#84659a' (top-bar spec hex)
 *    A5.  purpleGreen.sidePanelBackground === '#48765d' (left-panel spec hex)
 *    A6.  classic.appBackground === '#f0f0f0' (unchanged from pre-theme)
 *    A7.  classic.toolbarBackground === '#f5f5f5'
 *    A8.  classic.sidePanelBackground === '#fafafa'
 *    A9.  DEFAULT_THEME_ID is 'classic'
 *    A10. Every ThemeId key in THEMES has all required ThemePalette fields
 *    A11. getActiveThemeColors() returns classic palette by default
 *    A12. _setActiveThemeInternal() changes what getActiveThemeColors() returns
 *
 * B. applyThemeVars — CSS custom property injection
 *    B1.  Sets --pj-appBackground on documentElement
 *    B2.  Sets --pj-toolbarBackground on documentElement
 *    B3.  Sets --pj-sidePanelBackground on documentElement
 *    B4.  Sets --pj-toolbarBorder on documentElement
 *    B5.  Sets --pj-panelBorder on documentElement
 *    B6.  Sets --pj-btnText on documentElement
 *    B7.  Sets --pj-sidePanelHeaderText on documentElement
 *    B8.  Sets --pj-shellBackground on documentElement
 *    B9.  Sets --pj-logoText on documentElement
 *    B10. Calling with purpleGreen palette sets the three spec hexes
 *    B11. Calling with classic palette restores classic values
 *
 * C. Store — theme state and persistence
 *    C1.  themeId defaults to 'classic'
 *    C2.  setTheme('purpleGreen') updates themeId in the store
 *    C3.  setTheme persists the value to localStorage
 *    C4.  readPersistedTheme() returns 'classic' when key is absent
 *    C5.  readPersistedTheme() returns 'classic' when value is corrupt
 *    C6.  readPersistedTheme() returns 'classic' when value is unknown
 *    C7.  readPersistedTheme() round-trip: write 'purpleGreen', read it back
 *    C8.  eraseAll() preserves themeId (it is a display pref, not class data)
 *    C9.  setTheme updates the module-level canvas palette (getActiveThemeColors)
 *    C10. setTheme calls applyThemeVars (CSS vars are set on documentElement)
 *
 * D. SettingsMenu — theme picker UI
 *    D1.  Theme picker renders 'Classic' button (data-testid=settings-theme-classic)
 *    D2.  Theme picker renders 'Purple/Green' button (data-testid=settings-theme-purpleGreen)
 *    D3.  'Classic' button is aria-pressed=true when themeId='classic'
 *    D4.  'Purple/Green' button is aria-pressed=false when themeId='classic'
 *    D5.  'Purple/Green' button is aria-pressed=true when themeId='purpleGreen'
 *    D6.  'Classic' button is aria-pressed=false when themeId='purpleGreen'
 *    D7.  Clicking 'Purple/Green' calls ctx.store.setTheme('purpleGreen')
 *    D8.  Clicking 'Classic' calls ctx.store.setTheme('classic')
 *    D9.  Clicking a theme button calls ctx.canvas.requestRepaint
 *    D10. Theme picker is present in the shared menu when opened from Furniture mode
 *    D11. Theme picker is present in the shared menu when opened from Students mode
 *
 * E. Canvas — resolved palette switches with theme
 *    E1.  After setTheme('purpleGreen'), getActiveThemeColors().gridBackground differs
 *         from classic's gridBackground
 *    E2.  After setTheme('classic'), getActiveThemeColors().gridBackground matches
 *         classic palette
 *    E3.  clearCanvas uses getActiveThemeColors().gridBackground (not a CSS var string)
 *    E4.  drawGrid uses getActiveThemeColors().gridLine for unit boundaries
 *    E5.  drawGrid uses getActiveThemeColors().gridLineSubunit for sub-unit lines
 *
 * LOCAL-FIRST: no network calls anywhere.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';

import {
  THEMES,
  DEFAULT_THEME_ID,
  getActiveThemeColors,
  _setActiveThemeInternal,
  applyThemeVars,
} from '../theme/themes.js';
import type { ThemeId, ThemePalette } from '../theme/themes.js';

import {
  usePijonStore,
  readPersistedTheme,
} from '../state/store.js';

import { SettingsMenu } from '../ui/shell/SettingsMenu.js';
import { TopBar } from '../ui/shell/TopBar.js';
import { FurnitureEditor } from '../ui/editors/FurnitureEditor.js';
import { StudentEditor } from '../ui/editors/StudentEditor.js';

import { clearCanvas, drawGrid } from '../ui/canvas/render.js';

import type { EditorContext, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import type { FurnitureId } from '../domain/types.js';

// ---------------------------------------------------------------------------
// localStorage stub (jsdom does not expose it without a configured URL)
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore(): void {
  act(() => { usePijonStore.getState().eraseAll(); });
}

function resetDocumentElementStyle(): void {
  // Remove all --pj-* CSS custom properties set by applyThemeVars
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

// ---------------------------------------------------------------------------
// Spy canvas context for render tests
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
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  };
}

// ---------------------------------------------------------------------------
// A. THEMES registry
// ---------------------------------------------------------------------------

describe('A. themes.ts — THEMES registry', () => {
  it('A1: THEMES has a classic entry', () => {
    expect('classic' in THEMES).toBe(true);
  });

  it('A2: THEMES has a purpleGreen entry', () => {
    expect('purpleGreen' in THEMES).toBe(true);
  });

  it('A3: purpleGreen.appBackground is #939598 (spec hex)', () => {
    expect(THEMES.purpleGreen!.appBackground).toBe('#939598');
  });

  it('A4: purpleGreen.toolbarBackground is #84659a (spec hex)', () => {
    expect(THEMES.purpleGreen!.toolbarBackground).toBe('#84659a');
  });

  it('A5: purpleGreen.sidePanelBackground is #48765d (spec hex)', () => {
    expect(THEMES.purpleGreen!.sidePanelBackground).toBe('#48765d');
  });

  it('A6: classic.appBackground is #f0f0f0 (unchanged from pre-theme)', () => {
    expect(THEMES.classic!.appBackground).toBe('#f0f0f0');
  });

  it('A7: classic.toolbarBackground is #f5f5f5', () => {
    expect(THEMES.classic!.toolbarBackground).toBe('#f5f5f5');
  });

  it('A8: classic.sidePanelBackground is #fafafa', () => {
    expect(THEMES.classic!.sidePanelBackground).toBe('#fafafa');
  });

  it('A9: DEFAULT_THEME_ID is classic', () => {
    expect(DEFAULT_THEME_ID).toBe('classic');
  });

  it('A10: every theme entry has all required ThemePalette fields', () => {
    const requiredFields: (keyof ThemePalette)[] = [
      'label',
      'appBackground',
      'toolbarBackground',
      'sidePanelBackground',
      'toolbarBorder',
      'panelBorder',
      'btnText',
      'sidePanelHeaderText',
      'shellBackground',
      'logoText',
      // §10.A3/A4 — new scheme values
      'selectedBox',
      'unselectedBox',
      'gridBackground',
      'gridLine',
      'gridLineSubunit',
    ];
    for (const id of Object.keys(THEMES)) {
      const palette = THEMES[id];
      if (palette === undefined) continue; // type guard for noUncheckedIndexedAccess
      for (const field of requiredFields) {
        expect(
          typeof palette[field],
          `THEMES.${id}.${field} should be a string`,
        ).toBe('string');
      }
    }
  });

  it('A11: getActiveThemeColors() returns classic palette by default (gridBackground)', () => {
    // Reset to classic before the test
    _setActiveThemeInternal(THEMES.classic!);
    const colors = getActiveThemeColors();
    expect(colors.gridBackground).toBe(THEMES.classic!.gridBackground);
  });

  it('A12: _setActiveThemeInternal changes what getActiveThemeColors returns', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);
    expect(getActiveThemeColors().gridBackground).toBe(THEMES.purpleGreen!.gridBackground);
    // Restore
    _setActiveThemeInternal(THEMES.classic!);
  });
});

// ---------------------------------------------------------------------------
// B. applyThemeVars — CSS custom property injection
// ---------------------------------------------------------------------------

describe('B. applyThemeVars — CSS custom properties', () => {
  afterEach(() => {
    resetDocumentElementStyle();
    cleanup();
  });

  it('B1: sets --pj-appBackground on documentElement', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-appBackground')).toBe('#939598');
  });

  it('B2: sets --pj-toolbarBackground on documentElement', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-toolbarBackground')).toBe('#84659a');
  });

  it('B3: sets --pj-sidePanelBackground on documentElement', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-sidePanelBackground')).toBe('#48765d');
  });

  it('B4: sets --pj-toolbarBorder on documentElement', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-toolbarBorder')).toBeTruthy();
  });

  it('B5: sets --pj-panelBorder on documentElement', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-panelBorder')).toBeTruthy();
  });

  it('B6: sets --pj-btnText on documentElement', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-btnText')).toBeTruthy();
  });

  it('B7: sets --pj-sidePanelHeaderText on documentElement', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-sidePanelHeaderText')).toBeTruthy();
  });

  it('B8: sets --pj-shellBackground on documentElement', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-shellBackground')).toBeTruthy();
  });

  it('B9: sets --pj-logoText on documentElement', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-logoText')).toBeTruthy();
  });

  it('B10: purpleGreen palette sets the three spec hexes on documentElement', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-appBackground')).toBe('#939598');
    expect(document.documentElement.style.getPropertyValue('--pj-toolbarBackground')).toBe('#84659a');
    expect(document.documentElement.style.getPropertyValue('--pj-sidePanelBackground')).toBe('#48765d');
  });

  it('B11: applying classic palette restores classic values', () => {
    // Apply purple/green first
    applyThemeVars(THEMES.purpleGreen!);
    // Then apply classic
    applyThemeVars(THEMES.classic!);
    expect(document.documentElement.style.getPropertyValue('--pj-appBackground')).toBe('#f0f0f0');
    expect(document.documentElement.style.getPropertyValue('--pj-toolbarBackground')).toBe('#f5f5f5');
    expect(document.documentElement.style.getPropertyValue('--pj-sidePanelBackground')).toBe('#fafafa');
  });
});

// ---------------------------------------------------------------------------
// C. Store — theme state and persistence
// ---------------------------------------------------------------------------

describe('C. Store — themeId state and persistence', () => {
  beforeEach(() => {
    lsStub = makeLocalStorageStub();
    vi.stubGlobal('localStorage', lsStub);
    // Reset canvas palette to classic before each test
    _setActiveThemeInternal(THEMES.classic!);
    resetDocumentElementStyle();
    resetStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // Restore classic in the canvas palette cache after each test
    _setActiveThemeInternal(THEMES.classic!);
    resetDocumentElementStyle();
    cleanup();
  });

  it('C1: themeId defaults to classic', () => {
    const { themeId } = usePijonStore.getState();
    expect(themeId).toBe('classic');
  });

  it('C2: setTheme updates themeId in the store', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(usePijonStore.getState().themeId).toBe('purpleGreen');
  });

  it('C3: setTheme persists the value to localStorage', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(lsStub.getItem('pijon_themeId')).toBe('purpleGreen');
  });

  it('C4: readPersistedTheme returns classic when key is absent', () => {
    lsStub.removeItem('pijon_themeId');
    expect(readPersistedTheme()).toBe('classic');
  });

  it('C5: readPersistedTheme returns classic when value is corrupt (not a valid ThemeId)', () => {
    lsStub.setItem('pijon_themeId', 'notATheme');
    expect(readPersistedTheme()).toBe('classic');
  });

  it('C6: readPersistedTheme returns classic when stored value is an empty string', () => {
    lsStub.setItem('pijon_themeId', '');
    expect(readPersistedTheme()).toBe('classic');
  });

  it('C7: readPersistedTheme round-trip — write purpleGreen, read it back', () => {
    lsStub.setItem('pijon_themeId', 'purpleGreen');
    expect(readPersistedTheme()).toBe('purpleGreen');
  });

  it('C8: eraseAll preserves themeId (display pref, not class data)', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(usePijonStore.getState().themeId).toBe('purpleGreen');
    act(() => { usePijonStore.getState().eraseAll(); });
    expect(usePijonStore.getState().themeId).toBe('purpleGreen');
  });

  it('C9: setTheme updates the module-level canvas palette (getActiveThemeColors)', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(getActiveThemeColors().gridBackground).toBe(THEMES.purpleGreen!.gridBackground);

    // Restore
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(getActiveThemeColors().gridBackground).toBe(THEMES.classic!.gridBackground);
  });

  it('C10: setTheme calls applyThemeVars (CSS vars are set on documentElement)', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(
      document.documentElement.style.getPropertyValue('--pj-appBackground'),
    ).toBe('#939598');

    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(
      document.documentElement.style.getPropertyValue('--pj-appBackground'),
    ).toBe('#f0f0f0');
  });
});

// ---------------------------------------------------------------------------
// D. SettingsMenu — theme picker UI
// ---------------------------------------------------------------------------

describe('D. SettingsMenu — theme picker', () => {
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

  it('D1: theme picker renders Classic button', () => {
    const ctx = makeCtx({ themeId: 'classic' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    expect(screen.getByTestId('settings-theme-classic')).toBeInTheDocument();
  });

  it('D2: theme picker renders Purple/Green button', () => {
    const ctx = makeCtx({ themeId: 'classic' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    expect(screen.getByTestId('settings-theme-purpleGreen')).toBeInTheDocument();
  });

  it('D3: Classic button is aria-pressed=true when themeId=classic', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx({ themeId: 'classic' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    expect(screen.getByTestId('settings-theme-classic').getAttribute('aria-pressed')).toBe('true');
  });

  it('D4: Purple/Green button is aria-pressed=false when themeId=classic', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx({ themeId: 'classic' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    expect(screen.getByTestId('settings-theme-purpleGreen').getAttribute('aria-pressed')).toBe('false');
  });

  it('D5: Purple/Green button is aria-pressed=true when themeId=purpleGreen', () => {
    act(() => { usePijonStore.setState({ themeId: 'purpleGreen' }); });
    const ctx = makeCtx({ themeId: 'purpleGreen' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    expect(screen.getByTestId('settings-theme-purpleGreen').getAttribute('aria-pressed')).toBe('true');
  });

  it('D6: Classic button is aria-pressed=false when themeId=purpleGreen', () => {
    act(() => { usePijonStore.setState({ themeId: 'purpleGreen' }); });
    const ctx = makeCtx({ themeId: 'purpleGreen' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    expect(screen.getByTestId('settings-theme-classic').getAttribute('aria-pressed')).toBe('false');
  });

  it('D7: clicking Purple/Green calls ctx.store.setTheme(purpleGreen)', () => {
    const ctx = makeCtx({ themeId: 'classic' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    act(() => { fireEvent.click(screen.getByTestId('settings-theme-purpleGreen')); });
    expect(ctx.store.setTheme).toHaveBeenCalledWith('purpleGreen');
  });

  it('D8: clicking Classic calls ctx.store.setTheme(classic)', () => {
    const ctx = makeCtx({ themeId: 'purpleGreen' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    act(() => { fireEvent.click(screen.getByTestId('settings-theme-classic')); });
    expect(ctx.store.setTheme).toHaveBeenCalledWith('classic');
  });

  it('D9: clicking a theme button calls ctx.canvas.requestRepaint', () => {
    const ctx = makeCtx({ themeId: 'classic' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    act(() => { fireEvent.click(screen.getByTestId('settings-theme-purpleGreen')); });
    expect(ctx.canvas.requestRepaint).toHaveBeenCalled();
  });

  it('D10: theme picker is present when menu opened from Furniture mode', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'furniture', themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));

    act(() => { fireEvent.click(screen.getByTestId('settings-gear-button')); });
    expect(screen.getByTestId('settings-theme-classic')).toBeInTheDocument();
    expect(screen.getByTestId('settings-theme-purpleGreen')).toBeInTheDocument();
  });

  it('D11: theme picker is present when menu opened from Students mode', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'student', themeId: 'classic' }); });
    const ctx = makeCtx();
    act(() => { StudentEditor.activate(ctx); });
    render(React.createElement(TopBar, { activeEditor: StudentEditor, ctx }));

    act(() => { fireEvent.click(screen.getByTestId('settings-gear-button')); });
    expect(screen.getByTestId('settings-theme-classic')).toBeInTheDocument();
    expect(screen.getByTestId('settings-theme-purpleGreen')).toBeInTheDocument();
    act(() => { StudentEditor.deactivate(ctx); });
  });
});

// ---------------------------------------------------------------------------
// E. Canvas — resolved palette switches with theme
// ---------------------------------------------------------------------------

describe('E. Canvas — resolved palette via getActiveThemeColors', () => {
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

  it('E1: after setTheme(purpleGreen), getActiveThemeColors().gridBackground matches THEMES.purpleGreen (§11.A3)', () => {
    // §11.A3: gridBackground is now an explicit scheme value (white = #ffffff in both shipped
    // schemes). The resolved palette always reflects the scheme value — previously it was
    // derived from gridBackdrop so the two schemes produced different values; now both are white.
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    const activeBg = getActiveThemeColors().gridBackground;
    expect(activeBg).toBe(THEMES.purpleGreen!.gridBackground);
    expect(activeBg).toBe('#ffffff'); // explicit white in both shipped schemes
  });

  it('E2: after setTheme(classic), getActiveThemeColors().gridBackground matches classic', () => {
    // Switch to purpleGreen first
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    // Then back to classic
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(getActiveThemeColors().gridBackground).toBe(THEMES.classic!.gridBackground);
  });

  it('E3: clearCanvas fills with the active theme gridBackground (not a CSS var string)', () => {
    // Set purpleGreen so the fill differs from classic
    _setActiveThemeInternal(THEMES.purpleGreen!);

    const spyCtx = makeSpyCtx() as CanvasRenderingContext2D & SpyCtx;
    clearCanvas(spyCtx, 100, 100);

    // fillStyle must be a resolved hex, not a CSS var string
    const { fillStyle } = spyCtx;
    expect(typeof fillStyle).toBe('string');
    expect((fillStyle as string).startsWith('var(')).toBe(false);
    expect(fillStyle).toBe(THEMES.purpleGreen!.gridBackground);

    // Restore
    _setActiveThemeInternal(THEMES.classic!);
  });

  it('E4: drawGrid uses the active theme gridLine for unit-boundary strokeStyle', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);

    const spyCtx = makeSpyCtx() as CanvasRenderingContext2D & SpyCtx;
    // Track strokeStyle assignments
    const strokeStyles: string[] = [];
    Object.defineProperty(spyCtx, 'strokeStyle', {
      get: () => strokeStyles[strokeStyles.length - 1] ?? '',
      set: (v: string) => { strokeStyles.push(v); },
      configurable: true,
    });

    drawGrid(spyCtx, 4, 4, 24, 1);

    // The first strokeStyle set should be the unit-boundary gridLine from the theme
    expect(strokeStyles.some((s) => s === THEMES.purpleGreen!.gridLine)).toBe(true);
    // It must not be a CSS var string
    for (const s of strokeStyles) {
      expect(s.startsWith('var(')).toBe(false);
    }

    _setActiveThemeInternal(THEMES.classic!);
  });

  it('E5: drawGrid uses the active theme gridLineSubunit for sub-unit lines (G=2)', () => {
    _setActiveThemeInternal(THEMES.purpleGreen!);

    const spyCtx = makeSpyCtx() as CanvasRenderingContext2D & SpyCtx;
    const strokeStyles: string[] = [];
    Object.defineProperty(spyCtx, 'strokeStyle', {
      get: () => strokeStyles[strokeStyles.length - 1] ?? '',
      set: (v: string) => { strokeStyles.push(v); },
      configurable: true,
    });

    // G=2 → two tiers (unit + half-unit)
    drawGrid(spyCtx, 4, 4, 12, 2);

    // Sub-unit color must appear (tier 1)
    expect(strokeStyles.some((s) => s === THEMES.purpleGreen!.gridLineSubunit)).toBe(true);
    // None of the strokeStyle values should be a CSS var
    for (const s of strokeStyles) {
      expect(s.startsWith('var(')).toBe(false);
    }

    _setActiveThemeInternal(THEMES.classic!);
  });
});
