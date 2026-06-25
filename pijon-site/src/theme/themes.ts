/**
 * themes.ts — Color theme registry (§7.C1 + §7.C2).
 *
 * A Theme is a named record of resolved color values for the surfaces that
 * participate in theming. Adding a new theme = one more entry in THEMES.
 *
 * Architecture split:
 *
 *   DOM colors  — applied by setting CSS custom properties on documentElement.
 *     Components keep importing the same token names from colors.ts which now
 *     reference var(--pj-…, <classic-fallback>). Calling applyThemeVars(theme)
 *     injects the resolved values. Works perfectly with React.
 *
 *   Canvas colors — Canvas 2D cannot resolve CSS variables
 *     (ctx.fillStyle = 'var(--pj-…)' always renders as black). So the canvas
 *     render pass reads the RESOLVED palette strings from the active theme via
 *     getActiveThemeColors(). The store/setTheme action keeps this in sync.
 *
 * Extending the system:
 *   1. Add a new entry to THEMES (a ThemeId key + a ThemePalette object).
 *   2. That theme automatically appears in the registry — the picker and
 *      applyThemeVars work without any further changes.
 *
 * LOCAL-FIRST: no imports from React/DOM/network; pure data.
 */

// ---------------------------------------------------------------------------
// ThemeId
// ---------------------------------------------------------------------------

/** Literal union of all registered theme ids. Extend with new ids as added. */
export type ThemeId = 'classic' | 'purpleGreen';

// ---------------------------------------------------------------------------
// ThemePalette — the set of surfaces each theme MUST specify
// ---------------------------------------------------------------------------

/**
 * The surfaces that can vary between themes.
 *
 * Principle of least exposure: only surfaces that ACTUALLY differ between themes
 * are mandatory here. Canvas background + grid tokens are included because canvas
 * code reads them as resolved strings. DOM-only tokens use CSS vars in colors.ts
 * and are read from the palette via applyThemeVars.
 *
 * Adding a new themed token:
 *   1. Add it here (required in every palette).
 *   2. Set values in both `classic` and `purpleGreen` (and any future themes).
 *   3. In colors.ts, reference var(--pj-<tokenName>, <classicValue>).
 *   4. In applyThemeVars, call setProperty('--pj-<tokenName>', palette.<tokenName>).
 */
export interface ThemePalette {
  /** Human-readable display name for the theme picker. */
  label: string;

  // -- Major DOM surfaces (3 named surfaces for Theme 2) ---------------------

  /** Background of the canvas area wrapper (the space behind the placer grid). */
  appBackground: string;

  /** TopBar background. */
  toolbarBackground: string;

  /** Left side-panel background. */
  sidePanelBackground: string;

  // -- Derived DOM tokens (legibility across both themes) --------------------

  /** TopBar bottom border. */
  toolbarBorder: string;

  /** Panel / divider border color. */
  panelBorder: string;

  /** General toolbar / button text. */
  btnText: string;

  /** Side panel header text (section headers). */
  sidePanelHeaderText: string;

  /** Shell background (EditorSwitcher row background / card surfaces). */
  shellBackground: string;

  /** Logo / branding text color. */
  logoText: string;

  // -- Canvas resolved colors -----------------------------------------------

  /** Canvas background clear-fill (inside the grid, NOT the wrapper). */
  gridBackground: string;

  /** Grid unit-boundary line stroke. */
  gridLine: string;

  /** Grid sub-unit line stroke (lighter than gridLine). */
  gridLineSubunit: string;
}

// ---------------------------------------------------------------------------
// THEMES registry
// ---------------------------------------------------------------------------

/**
 * All registered themes. Each entry is a ThemePalette.
 * Adding a 3rd theme = one new record here.
 */
export const THEMES: Record<ThemeId, ThemePalette> = {
  /**
   * Classic — the original light look (all values match the hardcoded tokens
   * that existed before theming was introduced, so Classic is visually
   * unchanged from the pre-theming state).
   */
  classic: {
    label: 'Classic',

    // DOM surfaces
    appBackground: '#f0f0f0',
    toolbarBackground: '#f5f5f5',
    sidePanelBackground: '#fafafa',

    // Derived DOM
    toolbarBorder: '#ddd',
    panelBorder: '#ddd',
    btnText: '#333',
    sidePanelHeaderText: '#555',
    shellBackground: '#fff',
    logoText: '#1565c0',

    // Canvas
    gridBackground: '#f8f8f8',
    gridLine: '#d0d0d0',
    gridLineSubunit: '#e4e4e4',
  },

  /**
   * Purple/Green — warm accent theme.
   *
   * The three NAMED surfaces from the spec:
   *   appBackground (behind the placer grid): #939598
   *   toolbarBackground (top bar):             #84659a
   *   sidePanelBackground (left panel):        #48765d
   *
   * Remaining tokens derived for legibility: light text on dark surfaces,
   * borders tuned to match the accent palette.
   */
  purpleGreen: {
    label: 'Purple/Green',

    // DOM surfaces — the three exact hex values from the spec
    appBackground: '#939598',
    toolbarBackground: '#84659a',
    sidePanelBackground: '#48765d',

    // Derived DOM — light text + borders for legibility on dark surfaces
    toolbarBorder: '#6b4f82',
    panelBorder: '#3a6048',
    btnText: '#fff',
    sidePanelHeaderText: '#d4e8db',
    shellBackground: '#5a3e6b',
    logoText: '#e8d5f5',

    // Canvas — slightly off-white grid sits inside the muted-grey wrapper
    gridBackground: '#f2f2f0',
    gridLine: '#c0c0c0',
    gridLineSubunit: '#d8d8d6',
  },
};

// ---------------------------------------------------------------------------
// Default theme
// ---------------------------------------------------------------------------

export const DEFAULT_THEME_ID: ThemeId = 'classic';

// ---------------------------------------------------------------------------
// Active theme palette — module-level cache kept in sync by the store
// ---------------------------------------------------------------------------

/**
 * The resolved palette of the currently active theme.
 * Canvas render code (render.ts clearCanvas, drawGrid) reads from this
 * directly so it always has resolved color strings — not CSS variables.
 *
 * Kept as a module-level let so it is trivially readable without React context
 * or Zustand subscription overhead in hot canvas paint paths.
 *
 * IMPORTANT: this must be updated whenever the active theme changes.
 * The store's setTheme action is the ONLY writer.
 */
let _activeTheme: ThemePalette = THEMES[DEFAULT_THEME_ID];

/** Read the currently active theme's resolved palette. Used by canvas code. */
export function getActiveThemeColors(): ThemePalette {
  return _activeTheme;
}

/**
 * Update the module-level active-theme cache.
 * Called exclusively by the store's setTheme action so the cache stays in sync.
 */
export function _setActiveThemeInternal(palette: ThemePalette): void {
  _activeTheme = palette;
}

// ---------------------------------------------------------------------------
// applyThemeVars — DOM CSS custom property injection
// ---------------------------------------------------------------------------

/**
 * Inject the theme's resolved values as CSS custom properties on
 * `document.documentElement` so all components that reference `var(--pj-…)`
 * pick up the new values immediately.
 *
 * Must be called:
 *   - Once on app mount (so the initial theme is applied before first paint).
 *   - Every time the active theme changes (the store's setTheme action does this).
 *
 * Safe to call in environments without a DOM (e.g. SSR / vitest jsdom with
 * a minimal documentElement stub) — each setProperty call is guarded.
 */
export function applyThemeVars(palette: ThemePalette): void {
  const root = document.documentElement;
  if (root === null || root === undefined) return;

  const set = (prop: string, value: string): void => {
    try {
      root.style.setProperty(prop, value);
    } catch {
      // Ignore — best-effort in environments that restrict style mutation
    }
  };

  set('--pj-appBackground', palette.appBackground);
  set('--pj-toolbarBackground', palette.toolbarBackground);
  set('--pj-sidePanelBackground', palette.sidePanelBackground);
  set('--pj-toolbarBorder', palette.toolbarBorder);
  set('--pj-panelBorder', palette.panelBorder);
  set('--pj-btnText', palette.btnText);
  set('--pj-sidePanelHeaderText', palette.sidePanelHeaderText);
  set('--pj-shellBackground', palette.shellBackground);
  set('--pj-logoText', palette.logoText);
}
