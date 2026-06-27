// @vitest-environment jsdom
/**
 * Iteration 8 Cluster B — Color schemes rework
 *
 * Covers:
 *
 * A. Scheme files — glob-loaded registry
 *    A1.  SCHEME_REGISTRY contains a 'classic' entry
 *    A2.  SCHEME_REGISTRY contains a 'purpleGreen' entry
 *    A3.  purpleGreen scheme has gridBackdrop === '#939598' (exact spec hex)
 *    A4.  purpleGreen scheme has topBar === '#84659a' (exact spec hex)
 *    A5.  purpleGreen scheme has leftBar === '#48765d' (exact spec hex)
 *    A6.  every scheme has the required top-level keys: name/topBar/leftBar/gridBackdrop/text/logo
 *    A7.  THEMES registry is populated from SCHEME_REGISTRY (same keys)
 *    A8.  THEMES.classic.appBackground maps from classic.gridBackdrop
 *    A9.  THEMES.classic.toolbarBackground maps from classic.topBar
 *    A10. THEMES.classic.sidePanelBackground maps from classic.leftBar
 *    A11. THEMES.purpleGreen.appBackground === '#939598' (gridBackdrop → appBackground)
 *    A12. THEMES.purpleGreen.toolbarBackground === '#84659a' (topBar → toolbarBackground)
 *    A13. THEMES.purpleGreen.sidePanelBackground === '#48765d' (leftBar → sidePanelBackground)
 *    A14. classic scheme text is '#333'
 *    A15. purpleGreen scheme text is '#fff'
 *    A16. classic.logo === null
 *    A17. purpleGreen.logo === null
 *
 * B. applyThemeVars — includes --pj-text
 *    B1.  applyThemeVars sets --pj-text from palette.text
 *    B2.  switching to purpleGreen sets --pj-text to '#fff'
 *    B3.  switching to classic sets --pj-text to '#333'
 *    B4.  applyThemeVars still sets all pre-existing vars (regression)
 *
 * C. Store — theme state, localStorage, eraseAll
 *    C1.  themeId defaults to 'classic'
 *    C2.  setTheme('purpleGreen') updates themeId in the store
 *    C3.  setTheme persists to localStorage
 *    C4.  readPersistedTheme returns 'classic' when key is absent
 *    C5.  readPersistedTheme returns 'classic' when value is corrupt
 *    C6.  readPersistedTheme returns 'classic' when value is unknown scheme id
 *    C7.  readPersistedTheme round-trip: write 'purpleGreen', read it back
 *    C8.  eraseAll preserves themeId
 *    C9.  setTheme updates the canvas palette (getActiveThemeColors)
 *    C10. setTheme calls applyThemeVars (--pj-text set)
 *
 * D. SettingsMenu — theme picker lists all schemes from the registry
 *    D1.  theme picker renders a button for each scheme in SCHEME_REGISTRY
 *    D2.  'classic' button renders with data-testid settings-theme-classic
 *    D3.  'purpleGreen' button renders with data-testid settings-theme-purpleGreen
 *    D4.  active scheme button is aria-pressed=true; others aria-pressed=false
 *    D5.  clicking a scheme calls ctx.store.setTheme with that id
 *    D6.  clicking a scheme calls ctx.canvas.requestRepaint
 *    D7.  theme picker present when opened in Furniture mode
 *    D8.  theme picker present when opened in Students mode
 *
 * E. TopBar — logo + special-text elements
 *    E1.  when logo=null, logo-text span is visible (display not none)
 *    E2.  when logo=null, no logo-image element is rendered
 *    E3.  when logo is a path, logo-image element is rendered
 *    E4.  when logo is a path, logo-image has src matching that path
 *    E5.  logo-image has alt="Pijon" for accessibility
 *    E6.  saved-indicator has transparent background in classic scheme (§11.A4 — sits on topBarRight surface)
 *    E7.  erase-all-button has transparent background in classic scheme (§11.A4)
 *    E8.  saved-indicator has transparent background in purpleGreen scheme (§11.A4)
 *    E9.  erase-all-button has transparent background in purpleGreen scheme (§11.A4)
 *
 * F. Canvas — resolved palette switches with scheme
 *    F1.  after setTheme('purpleGreen'), getActiveThemeColors().gridBackground differs from classic
 *    F2.  after setTheme('classic'), getActiveThemeColors().gridBackground matches classic
 *    F3.  after setTheme('purpleGreen'), getActiveThemeColors().text === '#fff'
 *    F4.  after setTheme('classic'), getActiveThemeColors().text === '#333'
 *
 * LOCAL-FIRST: no network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';

import {
  THEMES,
  SCHEME_REGISTRY,
  DEFAULT_THEME_ID,
  getActiveThemeColors,
  _setActiveThemeInternal,
  applyThemeVars,
} from '../theme/themes.js';

import { usePijonStore, readPersistedTheme } from '../state/store.js';

import { SettingsMenu } from '../ui/shell/SettingsMenu.js';
import { TopBar } from '../ui/shell/TopBar.js';
import { FurnitureEditor } from '../ui/editors/FurnitureEditor.js';
import { StudentEditor } from '../ui/editors/StudentEditor.js';

import type { EditorContext, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import type { FurnitureId } from '../domain/types.js';
import type { ThemeId } from '../theme/themes.js';

// ---------------------------------------------------------------------------
// localStorage stub
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
// A. Scheme files — glob-loaded registry
// ---------------------------------------------------------------------------

describe('A. Scheme files and THEMES registry', () => {
  it('A1: SCHEME_REGISTRY contains classic', () => {
    expect('classic' in SCHEME_REGISTRY).toBe(true);
  });

  it('A2: SCHEME_REGISTRY contains purpleGreen', () => {
    expect('purpleGreen' in SCHEME_REGISTRY).toBe(true);
  });

  it('A3: purpleGreen.gridBackdrop is #939598 (exact spec hex)', () => {
    expect(SCHEME_REGISTRY.purpleGreen?.gridBackdrop).toBe('#939598');
  });

  it('A4: purpleGreen.topBar is #84659a (exact spec hex)', () => {
    expect(SCHEME_REGISTRY.purpleGreen?.topBar).toBe('#84659a');
  });

  it('A5: purpleGreen.leftBar is #48765d (exact spec hex)', () => {
    expect(SCHEME_REGISTRY.purpleGreen?.leftBar).toBe('#48765d');
  });

  it('A6: every scheme has required keys: name/topBar/leftBar/gridBackdrop/text/selectedBox/unselectedBox/logo', () => {
    // §10.A3/A4: selectedBox and unselectedBox are now required scheme fields
    const required = ['name', 'topBar', 'leftBar', 'gridBackdrop', 'text', 'selectedBox', 'unselectedBox', 'logo'] as const;
    for (const [id, scheme] of Object.entries(SCHEME_REGISTRY)) {
      for (const key of required) {
        expect(
          key in scheme,
          `SCHEME_REGISTRY[${id}] missing key "${key}"`,
        ).toBe(true);
      }
    }
  });

  it('A7: THEMES registry has the same keys as SCHEME_REGISTRY', () => {
    const schemeKeys = Object.keys(SCHEME_REGISTRY).sort();
    const themeKeys = Object.keys(THEMES).sort();
    expect(themeKeys).toEqual(schemeKeys);
  });

  it('A8: THEMES.classic.appBackground maps from classic.gridBackdrop', () => {
    const classicScheme = SCHEME_REGISTRY.classic;
    expect(classicScheme).toBeDefined();
    expect(THEMES.classic?.appBackground).toBe(classicScheme?.gridBackdrop);
  });

  it('A9: THEMES.classic.toolbarBackground maps from classic.topBar', () => {
    const classicScheme = SCHEME_REGISTRY.classic;
    expect(classicScheme).toBeDefined();
    expect(THEMES.classic?.toolbarBackground).toBe(classicScheme?.topBar);
  });

  it('A10: THEMES.classic.sidePanelBackground maps from classic.leftBar', () => {
    const classicScheme = SCHEME_REGISTRY.classic;
    expect(classicScheme).toBeDefined();
    expect(THEMES.classic?.sidePanelBackground).toBe(classicScheme?.leftBar);
  });

  it('A11: THEMES.purpleGreen.appBackground is #939598 (gridBackdrop)', () => {
    expect(THEMES.purpleGreen?.appBackground).toBe('#939598');
  });

  it('A12: THEMES.purpleGreen.toolbarBackground is #84659a (topBar)', () => {
    expect(THEMES.purpleGreen?.toolbarBackground).toBe('#84659a');
  });

  it('A13: THEMES.purpleGreen.sidePanelBackground is #48765d (leftBar)', () => {
    expect(THEMES.purpleGreen?.sidePanelBackground).toBe('#48765d');
  });

  it('A14: classic scheme text is #333', () => {
    expect(SCHEME_REGISTRY.classic?.text).toBe('#333');
  });

  it('A15: purpleGreen scheme text is #fff', () => {
    expect(SCHEME_REGISTRY.purpleGreen?.text).toBe('#fff');
  });

  it('A16: classic.logo is null', () => {
    expect(SCHEME_REGISTRY.classic?.logo).toBeNull();
  });

  it('A17: purpleGreen.logo is null', () => {
    expect(SCHEME_REGISTRY.purpleGreen?.logo).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B. applyThemeVars — includes --pj-text
// ---------------------------------------------------------------------------

describe('B. applyThemeVars sets --pj-text', () => {
  afterEach(() => {
    resetDocumentElementStyle();
    cleanup();
  });

  it('B1: applyThemeVars sets --pj-text from palette.text', () => {
    const palette = THEMES.classic;
    expect(palette).toBeDefined();
    applyThemeVars(palette!);
    expect(document.documentElement.style.getPropertyValue('--pj-text')).toBe(palette?.text ?? '');
  });

  it('B2: switching to purpleGreen sets --pj-text to #fff', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-text')).toBe('#fff');
  });

  it('B3: switching to classic sets --pj-text to #333', () => {
    applyThemeVars(THEMES.purpleGreen!);
    applyThemeVars(THEMES.classic!);
    expect(document.documentElement.style.getPropertyValue('--pj-text')).toBe('#333');
  });

  it('B4: applyThemeVars still sets pre-existing vars (regression)', () => {
    applyThemeVars(THEMES.purpleGreen!);
    expect(document.documentElement.style.getPropertyValue('--pj-appBackground')).toBe('#939598');
    expect(document.documentElement.style.getPropertyValue('--pj-toolbarBackground')).toBe('#84659a');
    expect(document.documentElement.style.getPropertyValue('--pj-sidePanelBackground')).toBe('#48765d');
    expect(document.documentElement.style.getPropertyValue('--pj-btnText')).toBeTruthy();
    expect(document.documentElement.style.getPropertyValue('--pj-logoText')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// C. Store — theme state and persistence
// ---------------------------------------------------------------------------

describe('C. Store — themeId state and persistence', () => {
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

  it('C1: themeId defaults to classic', () => {
    expect(usePijonStore.getState().themeId).toBe('classic');
  });

  it('C2: setTheme updates themeId in the store', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(usePijonStore.getState().themeId).toBe('purpleGreen');
  });

  it('C3: setTheme persists to localStorage', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(lsStub.getItem('pijon_themeId')).toBe('purpleGreen');
  });

  it('C4: readPersistedTheme returns classic when key is absent', () => {
    lsStub.removeItem('pijon_themeId');
    expect(readPersistedTheme()).toBe('classic');
  });

  it('C5: readPersistedTheme returns classic when value is corrupt', () => {
    lsStub.setItem('pijon_themeId', 'notATheme!!!');
    expect(readPersistedTheme()).toBe('classic');
  });

  it('C6: readPersistedTheme returns classic when value is unknown scheme id', () => {
    lsStub.setItem('pijon_themeId', 'unknownScheme');
    expect(readPersistedTheme()).toBe('classic');
  });

  it('C7: readPersistedTheme round-trip: write purpleGreen, read it back', () => {
    lsStub.setItem('pijon_themeId', 'purpleGreen');
    expect(readPersistedTheme()).toBe('purpleGreen');
  });

  it('C8: eraseAll preserves themeId (display pref, not class data)', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    act(() => { usePijonStore.getState().eraseAll(); });
    expect(usePijonStore.getState().themeId).toBe('purpleGreen');
  });

  it('C9: setTheme updates the canvas palette (getActiveThemeColors)', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(getActiveThemeColors().text).toBe('#fff');
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(getActiveThemeColors().text).toBe('#333');
  });

  it('C10: setTheme calls applyThemeVars (--pj-text is set)', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(document.documentElement.style.getPropertyValue('--pj-text')).toBe('#fff');
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(document.documentElement.style.getPropertyValue('--pj-text')).toBe('#333');
  });

  it('C11: DEFAULT_THEME_ID is classic', () => {
    expect(DEFAULT_THEME_ID).toBe('classic');
  });
});

// ---------------------------------------------------------------------------
// D. SettingsMenu — theme picker lists all schemes
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

  it('D1: theme picker renders a button for each scheme in SCHEME_REGISTRY', () => {
    const ctx = makeCtx({ themeId: 'classic' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    for (const id of Object.keys(SCHEME_REGISTRY)) {
      expect(screen.getByTestId(`settings-theme-${id}`)).toBeInTheDocument();
    }
  });

  it('D2: classic button renders with correct testid', () => {
    const ctx = makeCtx({ themeId: 'classic' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    expect(screen.getByTestId('settings-theme-classic')).toBeInTheDocument();
  });

  it('D3: purpleGreen button renders with correct testid', () => {
    const ctx = makeCtx({ themeId: 'classic' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    expect(screen.getByTestId('settings-theme-purpleGreen')).toBeInTheDocument();
  });

  it('D4: active scheme button is aria-pressed=true; others are false', () => {
    act(() => { usePijonStore.setState({ themeId: 'purpleGreen' }); });
    const ctx = makeCtx({ themeId: 'purpleGreen' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    expect(screen.getByTestId('settings-theme-purpleGreen').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('settings-theme-classic').getAttribute('aria-pressed')).toBe('false');
  });

  it('D5: clicking a scheme calls ctx.store.setTheme with that id', () => {
    const ctx = makeCtx({ themeId: 'classic' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    act(() => { fireEvent.click(screen.getByTestId('settings-theme-purpleGreen')); });
    expect(ctx.store.setTheme).toHaveBeenCalledWith('purpleGreen');
  });

  it('D6: clicking a scheme calls ctx.canvas.requestRepaint', () => {
    const ctx = makeCtx({ themeId: 'classic' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    act(() => { fireEvent.click(screen.getByTestId('settings-theme-purpleGreen')); });
    expect(ctx.canvas.requestRepaint).toHaveBeenCalled();
  });

  it('D7: theme picker present when opened in Furniture mode', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'furniture', themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    act(() => { fireEvent.click(screen.getByTestId('settings-gear-button')); });
    for (const id of Object.keys(SCHEME_REGISTRY)) {
      expect(screen.getByTestId(`settings-theme-${id}`)).toBeInTheDocument();
    }
  });

  it('D8: theme picker present when opened in Students mode', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'student', themeId: 'classic' }); });
    const ctx = makeCtx();
    act(() => { StudentEditor.activate(ctx); });
    render(React.createElement(TopBar, { activeEditor: StudentEditor, ctx }));
    act(() => { fireEvent.click(screen.getByTestId('settings-gear-button')); });
    for (const id of Object.keys(SCHEME_REGISTRY)) {
      expect(screen.getByTestId(`settings-theme-${id}`)).toBeInTheDocument();
    }
    act(() => { StudentEditor.deactivate(ctx); });
  });
});

// ---------------------------------------------------------------------------
// E. TopBar — logo + special-text elements
// ---------------------------------------------------------------------------

describe('E. TopBar — logo and special-text backgrounds', () => {
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

  it('E1: when logo=null (classic), logo-text span is not display:none', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const logoText = screen.getByTestId('logo-text');
    expect(logoText.style.display).not.toBe('none');
  });

  it('E2: when logo=null (classic), no logo-image element is rendered', () => {
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    expect(screen.queryByTestId('logo-image')).toBeNull();
  });

  it('E3: when logo is a path (manual override), logo-image element is rendered', () => {
    // Temporarily set the active theme to one with a logo path
    const paletteWithLogo = { ...THEMES.classic!, logo: '/assets/pijon-logo.png' };
    _setActiveThemeInternal(paletteWithLogo);
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    expect(screen.getByTestId('logo-image')).toBeInTheDocument();
  });

  it('E4: when logo is a path, logo-image has correct src', () => {
    const logoPath = '/assets/pijon-logo.png';
    const paletteWithLogo = { ...THEMES.classic!, logo: logoPath };
    _setActiveThemeInternal(paletteWithLogo);
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const img = screen.getByTestId('logo-image');
    expect(img.getAttribute('src')).toContain(logoPath);
  });

  it('E5: logo-image has alt="Pijon" for accessibility', () => {
    const paletteWithLogo = { ...THEMES.classic!, logo: '/assets/pijon-logo.png' };
    _setActiveThemeInternal(paletteWithLogo);
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    expect(screen.getByTestId('logo-image').getAttribute('alt')).toBe('Pijon');
  });

  it('E6: saved-indicator has transparent background in classic scheme (§11.A4 — sits on topBarRight surface)', () => {
    act(() => {
      _setActiveThemeInternal(THEMES.classic!);
      usePijonStore.setState({ themeId: 'classic', saveStatus: 'saved' });
    });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const indicator = screen.getByTestId('saved-indicator');
    expect(indicator.style.background).toBe('transparent');
  });

  it('E7: erase-all-button has transparent background in classic scheme (§11.A4)', () => {
    act(() => {
      _setActiveThemeInternal(THEMES.classic!);
      usePijonStore.setState({ themeId: 'classic' });
    });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const btn = screen.getByTestId('erase-all-button');
    expect(btn.style.background).toBe('transparent');
  });

  it('E8: saved-indicator has transparent background in purpleGreen scheme (§11.A4)', () => {
    act(() => {
      _setActiveThemeInternal(THEMES.purpleGreen!);
      usePijonStore.setState({ themeId: 'purpleGreen', saveStatus: 'saved' });
    });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const indicator = screen.getByTestId('saved-indicator');
    expect(indicator.style.background).toBe('transparent');
  });

  it('E9: erase-all-button has transparent background in purpleGreen scheme (§11.A4)', () => {
    act(() => {
      _setActiveThemeInternal(THEMES.purpleGreen!);
      usePijonStore.setState({ themeId: 'purpleGreen' });
    });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const btn = screen.getByTestId('erase-all-button');
    expect(btn.style.background).toBe('transparent');
  });
});

// ---------------------------------------------------------------------------
// F. Canvas — resolved palette switches with scheme
// ---------------------------------------------------------------------------

describe('F. Canvas — resolved palette switches with scheme', () => {
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

  it('F1: after setTheme(purpleGreen), getActiveThemeColors().gridBackground matches THEMES.purpleGreen (§11.A3 — scheme value)', () => {
    // §11.A3: gridBackground is now an explicit scheme value (white in both shipped schemes).
    // The resolved palette always comes from the scheme, not a derived value.
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    const activeBg = getActiveThemeColors().gridBackground;
    expect(activeBg).toBe(THEMES.purpleGreen?.gridBackground);
    expect(activeBg).toBe('#ffffff'); // both schemes set white
  });

  it('F2: after setTheme(classic), getActiveThemeColors().gridBackground matches classic', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(getActiveThemeColors().gridBackground).toBe(THEMES.classic?.gridBackground ?? '');
  });

  it('F3: after setTheme(purpleGreen), getActiveThemeColors().text is #fff', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    expect(getActiveThemeColors().text).toBe('#fff');
  });

  it('F4: after setTheme(classic), getActiveThemeColors().text is #333', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    act(() => { usePijonStore.getState().setTheme('classic'); });
    expect(getActiveThemeColors().text).toBe('#333');
  });
});

// ---------------------------------------------------------------------------
// G. Legibility — muted/secondary text follows the scheme (§8.B2 fix)
// ---------------------------------------------------------------------------

import {
  isValidThemeId,
} from '../theme/themes.js';

import {
  textMedium,
  textMuted,
  textFaint,
  textFainter,
  textPlaceholder,
  textDisabled,
} from '../theme/colors.js';

describe('G. Secondary text tokens route through the scheme (legibility fix)', () => {
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

  // G1-G6: tokens reference CSS vars (not hardcoded hex)
  it('G1: textMedium references --pj-text-muted (not a hardcoded grey hex)', () => {
    expect(textMedium).toContain('--pj-text-muted');
  });

  it('G2: textMuted references --pj-text-muted (not a hardcoded grey hex)', () => {
    expect(textMuted).toContain('--pj-text-muted');
  });

  it('G3: textFaint references --pj-text-faint (not a hardcoded grey hex)', () => {
    expect(textFaint).toContain('--pj-text-faint');
  });

  it('G4: textFainter references --pj-text-faint (not a hardcoded grey hex)', () => {
    expect(textFainter).toContain('--pj-text-faint');
  });

  it('G5: textPlaceholder references --pj-text-faint (not a hardcoded grey hex)', () => {
    expect(textPlaceholder).toContain('--pj-text-faint');
  });

  it('G6: textDisabled references --pj-text-faint (not a hardcoded grey hex)', () => {
    expect(textDisabled).toContain('--pj-text-faint');
  });

  // G7-G8: THEMES derives textMuted and textFaint for each scheme
  it('G7: THEMES.purpleGreen has textMuted derived from #fff (contains 255,255,255)', () => {
    const pg = THEMES.purpleGreen;
    expect(pg).toBeDefined();
    // purpleGreen text is #fff = rgb(255,255,255), so muted should contain 255
    expect(pg?.textMuted).toContain('255');
  });

  it('G8: THEMES.classic has textMuted derived from #333 (contains 51,51,51)', () => {
    const cl = THEMES.classic;
    expect(cl).toBeDefined();
    // classic text is #333 = rgb(51,51,51), so muted should contain 51
    expect(cl?.textMuted).toContain('51');
  });

  // G9-G10: applyThemeVars sets --pj-text-muted and --pj-text-faint
  it('G9: applyThemeVars sets --pj-text-muted for purpleGreen', () => {
    applyThemeVars(THEMES.purpleGreen!);
    const val = document.documentElement.style.getPropertyValue('--pj-text-muted');
    expect(val).toBeTruthy();
    expect(val).toContain('255'); // derived from #fff
  });

  it('G10: applyThemeVars sets --pj-text-faint for purpleGreen', () => {
    applyThemeVars(THEMES.purpleGreen!);
    const val = document.documentElement.style.getPropertyValue('--pj-text-faint');
    expect(val).toBeTruthy();
    expect(val).toContain('255'); // derived from #fff
  });

  // G11-G12: switching theme updates the muted var
  it('G11: setTheme updates --pj-text-muted for purpleGreen', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    const val = document.documentElement.style.getPropertyValue('--pj-text-muted');
    expect(val).toContain('255');
  });

  it('G12: setTheme updates --pj-text-muted for classic', () => {
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    act(() => { usePijonStore.getState().setTheme('classic'); });
    const val = document.documentElement.style.getPropertyValue('--pj-text-muted');
    // classic text is #333 = rgb(51,51,51)
    expect(val).toContain('51');
  });

  // G13: muted opacity is non-trivial (not 0 or 1)
  it('G13: textMuted for purpleGreen has fractional opacity (legibility preserved)', () => {
    const pg = THEMES.purpleGreen;
    expect(pg?.textMuted).toMatch(/rgba\(/);
    // opacity should be between 0 and 1 exclusive
    const match = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/.exec(pg?.textMuted ?? '');
    expect(match).not.toBeNull();
    const opacity = parseFloat(match?.[1] ?? '0');
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
  });

  // G14: canvas-resolved palette textMuted/textFaint differ between schemes
  it('G14: getActiveThemeColors().textMuted differs between classic and purpleGreen', () => {
    act(() => { usePijonStore.getState().setTheme('classic'); });
    const classicMuted = getActiveThemeColors().textMuted;
    act(() => { usePijonStore.getState().setTheme('purpleGreen'); });
    const pgMuted = getActiveThemeColors().textMuted;
    expect(classicMuted).not.toBe(pgMuted);
  });
});

// ---------------------------------------------------------------------------
// H. Dynamic registry + isValidThemeId
// ---------------------------------------------------------------------------

describe('H. Dynamic registry and isValidThemeId', () => {
  // H1: picker iterates SCHEME_REGISTRY (not a hardcoded list)
  it('H1: SettingsMenu theme picker buttons match exactly the SCHEME_REGISTRY keys', () => {
    const ctx = makeCtx({ themeId: 'classic' });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));
    const registryIds = Object.keys(SCHEME_REGISTRY).sort();
    // Every key in the registry must appear as a button
    for (const id of registryIds) {
      expect(screen.getByTestId(`settings-theme-${id}`)).toBeInTheDocument();
    }
    // No extra buttons beyond what the registry says (verify count by summing role=group > buttons)
    const group = document.querySelector('[aria-label="Color theme"]');
    expect(group).not.toBeNull();
    const buttons = group?.querySelectorAll('button');
    expect(buttons?.length).toBe(registryIds.length);
    cleanup();
  });

  // H2: isValidThemeId accepts registered ids
  it('H2: isValidThemeId accepts classic', () => {
    expect(isValidThemeId('classic')).toBe(true);
  });

  it('H3: isValidThemeId accepts purpleGreen', () => {
    expect(isValidThemeId('purpleGreen')).toBe(true);
  });

  it('H4: isValidThemeId rejects unknown ids', () => {
    expect(isValidThemeId('unknownScheme')).toBe(false);
  });

  it('H5: isValidThemeId rejects empty string', () => {
    expect(isValidThemeId('')).toBe(false);
  });

  it('H6: isValidThemeId rejects a scheme-like but non-existent id', () => {
    expect(isValidThemeId('darkMode')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// I. Logo onError fallback
// ---------------------------------------------------------------------------

describe('I. Logo onError fallback to text', () => {
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

  it('I1: when logo image errors, the img is hidden', () => {
    const paletteWithLogo = { ...THEMES.classic!, logo: '/assets/broken.png' };
    _setActiveThemeInternal(paletteWithLogo);
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const img = screen.getByTestId('logo-image');
    // Simulate image load error
    act(() => { fireEvent.error(img); });
    expect(img.style.display).toBe('none');
  });

  it('I2: when logo image errors, the fallback text span becomes visible', () => {
    const paletteWithLogo = { ...THEMES.classic!, logo: '/assets/broken.png' };
    _setActiveThemeInternal(paletteWithLogo);
    act(() => { usePijonStore.setState({ themeId: 'classic' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));
    const img = screen.getByTestId('logo-image');
    act(() => { fireEvent.error(img); });
    const logoTextEl = screen.getByTestId('logo-text');
    // The fallback text should no longer be display:none
    expect(logoTextEl.style.display).not.toBe('none');
  });
});
