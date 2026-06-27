/**
 * themes.ts — Color scheme registry (§8.B1).
 *
 * Schemes live as individual JSON files in `src/theme/schemes/*.json`.
 * Each file is a small, high-level named value set:
 *
 *   { name, topBar, leftBar, gridBackdrop, text, logo }
 *
 * The glob `import.meta.glob('./schemes/*.json', { eager: true })` auto-registers
 * every file in that folder — **adding a scheme = dropping in a JSON file**.
 *
 * At load time each scheme's high-level values are mapped onto the full
 * ThemePalette (DOM tokens + canvas tokens) with sensible derived defaults.
 *
 * Architecture split (unchanged from §7.C1):
 *
 *   DOM colors  — applied by setting CSS custom properties on documentElement.
 *     Components import token strings from colors.ts that reference var(--pj-…).
 *     Calling applyThemeVars(palette) injects the resolved values.
 *
 *   Canvas colors — Canvas 2D cannot resolve CSS variables, so canvas render
 *     code reads the RESOLVED palette strings via getActiveThemeColors().
 *
 * LOCAL-FIRST: no imports from React/DOM/network; pure data.
 */

// ---------------------------------------------------------------------------
// High-level scheme data shape (matches the JSON files)
// ---------------------------------------------------------------------------

/** The raw shape of a scheme JSON file. */
export interface SchemeData {
  /** Display name shown in the theme picker. */
  name: string;
  /** TopBar surface background color. */
  topBar: string;
  /** Left side-panel surface background color. */
  leftBar: string;
  /** Canvas-area wrapper background (behind the placer grid). */
  gridBackdrop: string;
  /** Ordinary (non-special) text color for all general UI text. */
  text: string;
  /**
   * §10.A3 — Selection / active accent color.
   * Applied to: selection-highlight strokes, active toggles/tabs, active WeightSelector
   * button, drag-preview valid stroke, the primary Allocate button, etc.
   * Classic = #1565c0 (Material blue 800). PurpleGreen = #793498.
   */
  selectedBox: string;
  /**
   * §10.A4 — Base / unselected box surface color.
   * Applied to: unselected button backgrounds, base box surfaces ("the white boxes").
   * Classic = #ffffff. PurpleGreen = #371e42.
   */
  unselectedBox: string;
  /**
   * §11.A1 — Button text color, configurable independently of general `text`.
   * Allows buttons to stay legible on their own backgrounds per scheme.
   * Classic = #333 (current button text, look unchanged).
   * PurpleGreen = near-white (#f0e8f5) for legibility on dark button surfaces.
   */
  buttonText: string;
  /**
   * §11.A2 — Canvas student-name color, independent of general `text`.
   * Both schemes = black (#000000) for clear readability on desk surfaces.
   */
  studentName: string;
  /**
   * §11.A3 — Fill color inside the grid (behind cells), configurable per scheme.
   * Both schemes = white (#ffffff). Distinct from gridBackdrop (the area around the grid)
   * and gridColor (the per-classroom grid LINE color override).
   */
  gridBackground: string;
  /**
   * §11.A4 — Background of the top bar's right cluster (Settings · Saved-locally · Erase all).
   * Set to each scheme's topBar value by default so it looks like the current bar,
   * but is independently configurable.
   * Classic = #f5f5f5 (= topBar). PurpleGreen = #84659a (= topBar).
   */
  topBarRight: string;
  /**
   * §11.A5 — Text color for elements inside the top-bar-right region
   * (Erase-all label, Saved-locally indicator). Must be legible on `topBarRight`.
   * Classic = #333 (dark text on light surface). PurpleGreen = #ffffff (white on purple).
   */
  topBarRightText: string;
  /**
   * Logo image path (relative to public/) rendered in the top-left
   * in place of the "Pijon" wordmark. `null` = show the literal text "Pijon".
   */
  logo: string | null;
}

// ---------------------------------------------------------------------------
// Auto-register schemes via import.meta.glob
// ---------------------------------------------------------------------------

// Each module is: { default: SchemeData }
// Supply the generic parameter M to get Record<string, M> without a type assertion.
interface _GlobModule { default: SchemeData }
const _raw = import.meta.glob<_GlobModule>('./schemes/*.json', { eager: true });

/**
 * Derive the scheme id from the file path, e.g.
 *   './schemes/purpleGreen.json' → 'purpleGreen'
 */
function pathToId(path: string): string {
  const base = path.replace(/^.*\//, '').replace(/\.json$/, '');
  return base;
}

/** All loaded scheme data, keyed by id. Populated at module load time. */
const SCHEME_DATA: Record<string, SchemeData> = {};

for (const [path, mod] of Object.entries(_raw)) {
  const id = pathToId(path);
  SCHEME_DATA[id] = mod.default;
}

// ---------------------------------------------------------------------------
// ThemeId — derived from the loaded schemes
// ---------------------------------------------------------------------------

/**
 * The set of valid theme ids (one per scheme file).
 * Callers should treat this as opaque strings; do NOT widen to `string`
 * everywhere — use the type guard `isValidThemeId` where needed.
 */
export type ThemeId = string;

// ---------------------------------------------------------------------------
// ThemePalette — the full resolved set of tokens used by DOM + canvas code
// ---------------------------------------------------------------------------

/**
 * Full resolved palette consumed by applyThemeVars (DOM) and getActiveThemeColors (canvas).
 *
 * Three categories:
 *   1. Major DOM surfaces — toolbar, side panel, app background.
 *   2. Derived DOM tokens — borders, buttons, text (legibility layer).
 *   3. Canvas resolved colors — grid and background strings.
 */
export interface ThemePalette {
  /** Human-readable display name for the theme picker. */
  label: string;

  // -- Major DOM surfaces -------------------------------------------------------

  /** Background of the canvas area wrapper (the space behind the placer grid). */
  appBackground: string;

  /** TopBar background. */
  toolbarBackground: string;

  /** Left side-panel background. */
  sidePanelBackground: string;

  // -- §8.B2 — General UI text -------------------------------------------------

  /**
   * All ordinary (non-special) text. Derived from scheme.text.
   * CSS var --pj-text is set so every component that imports the `text`
   * token from colors.ts picks it up automatically.
   */
  text: string;

  /**
   * §8.B2 — Secondary/muted text. Derived from scheme.text at ~70% opacity.
   * Applies to sub-labels, metadata, helper text. CSS var: --pj-text-muted.
   * Guaranteed legible in both light (classic) and dark-surface (purpleGreen) schemes.
   */
  textMuted: string;

  /**
   * §8.B2 — Disabled/faint text. Derived from scheme.text at ~45% opacity.
   * Applies to placeholders, disabled hints. CSS var: --pj-text-faint.
   * Guaranteed legible in both light and dark-surface schemes.
   */
  textFaint: string;

  // -- Derived DOM tokens (legibility) -----------------------------------------

  /** TopBar bottom border. */
  toolbarBorder: string;

  /** Panel / divider border color. */
  panelBorder: string;

  /** General toolbar / button text (same as text for most themes). */
  btnText: string;

  /** Side panel header text (section headers). */
  sidePanelHeaderText: string;

  /** Shell background (card surfaces). */
  shellBackground: string;

  /** Logo / branding text color. Used when scheme.logo is null. */
  logoText: string;

  // -- §10.A3 / §10.A4 — Selection accent + unselected box surface ------------

  /**
   * §10.A3 — Selection / active accent color (the scheme's "blue").
   * Used for: selection-highlight strokes, active toggle/tab borders + backgrounds,
   * active WeightSelector button, drag-preview valid strokes, primary Allocate button.
   * CSS var: --pj-selectedBox. Classic = #1565c0. PurpleGreen = #793498.
   */
  selectedBox: string;

  /**
   * §10.A4 — Base / unselected box surface color (the scheme's "white").
   * Used for: unselected button backgrounds, base box surfaces.
   * CSS var: --pj-unselectedBox. Classic = #ffffff. PurpleGreen = #371e42.
   */
  unselectedBox: string;

  // -- §11.A1 — Button text color ----------------------------------------------

  /**
   * §11.A1 — Button text color, independent of general `text`.
   * CSS var: --pj-buttonText. Classic = #333. PurpleGreen = #f0e8f5 (near-white).
   */
  buttonText: string;

  // -- §11.A4 — Top-bar right cluster background + text ------------------------

  /**
   * §11.A4 — Background of the right-end cluster of the top bar
   * (Settings · Saved-locally · Erase all), set off by a divider.
   * CSS var: --pj-topBarRight. Default = topBar value per scheme.
   */
  topBarRight: string;

  /**
   * §11.A5 — Text color for elements inside the top-bar-right region.
   * Legible on `topBarRight` in BOTH schemes.
   * Classic = #333 (dark text on #f5f5f5 surface, contrast 12.6:1).
   * PurpleGreen = #ffffff (white on #84659a, contrast 4.87:1 ≥ WCAG AA).
   * CSS var: --pj-topBarRightText.
   */
  topBarRightText: string;

  // -- §8.B3 — Logo image path -------------------------------------------------

  /**
   * Path to the logo image (relative to public/), or null to show "Pijon" text.
   * Copied verbatim from scheme data.
   */
  logo: string | null;

  // -- Canvas resolved colors --------------------------------------------------

  /**
   * §11.A2 — Canvas student-name color, independent of general `text`.
   * Resolved palette string (NOT a CSS var — canvas cannot resolve CSS vars).
   * Both schemes = #000000.
   */
  studentName: string;

  /**
   * §11.A3 — Canvas grid fill color (inside the grid, behind the cells).
   * Comes directly from the scheme value (not derived). Both schemes = #ffffff.
   * Distinct from gridBackdrop (outside the grid) and per-classroom gridColor
   * (the line color override).
   */
  gridBackground: string;

  /** Grid unit-boundary line stroke. */
  gridLine: string;

  /** Grid sub-unit line stroke (lighter than gridLine). */
  gridLineSubunit: string;
}

// ---------------------------------------------------------------------------
// Palette derivation: high-level scheme values → full ThemePalette
// ---------------------------------------------------------------------------

/**
 * Derive a slightly darker/lighter version of a color for borders.
 * Since we're working with opaque hex strings we just return a semitransparent
 * overlay that the browser will composite — this is used for derived tokens.
 *
 * In practice we use hardcoded derivations per color family to keep the code
 * simple and avoid a full color manipulation library.
 */
/**
 * Return perceived luminance [0, 255] for a hex color.
 * Uses BT.601 weights: 0.299R + 0.587G + 0.114B.
 */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length !== 6) return 255; // default to bright if unparseable
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/**
 * Returns true if the color is perceived as "light" (luminance > threshold 160).
 * Threshold is set at 160 (not the typical 128) so mid-grey surfaces like #939598
 * (luminance ~149) are classified as "not light" for the purposes of deriving
 * canvas grid colors — the canvas grid needs slightly muted tones to read against
 * them, just as it does against a genuinely dark backdrop.
 */
function isLight(hex: string): boolean {
  return luminance(hex) > 160;
}

/**
 * Parse a #rgb or #rrggbb hex string to [r, g, b] integers.
 * Returns [0, 0, 0] if the input is not a recognised hex color.
 */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    // Expand shorthand: #rgb → #rrggbb
    const r = h.slice(0, 1);
    const g = h.slice(1, 2);
    const b = h.slice(2, 3);
    return [
      parseInt(r + r, 16),
      parseInt(g + g, 16),
      parseInt(b + b, 16),
    ];
  }
  if (h.length === 6) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  return [0, 0, 0];
}

/**
 * Return the text color at reduced opacity as an rgba() CSS string.
 * Used to derive muted/faint text tiers from the scheme text color so that
 * hierarchy is preserved AND legibility holds regardless of surface darkness.
 */
function textAtAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r.toString()}, ${g.toString()}, ${b.toString()}, ${alpha.toFixed(2)})`;
}

/**
 * §10.A3 — Build an rgba() color string from a hex color and an alpha value.
 *
 * Used by canvas draw code to derive themed alpha variants of selectedBox at
 * draw time, since canvas 2D cannot read CSS variables. The hex comes from
 * `getActiveThemeColors().selectedBox` so it changes with the active scheme.
 *
 * Classic:      selectedBox = #1565c0 → blue-based strokes/fills
 * PurpleGreen:  selectedBox = #793498 → purple-based strokes/fills
 *
 * @param hex   A #rrggbb hex color string (e.g. '#1565c0').
 * @param alpha Opacity in [0, 1] (e.g. 0.9 for a solid stroke, 0.22 for a fill).
 */
export function rgbaFromHex(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r.toString()}, ${g.toString()}, ${b.toString()}, ${alpha.toFixed(2)})`;
}

/**
 * Map a high-level SchemeData onto a full ThemePalette.
 *
 * Mapping rules (§8.B1):
 *   toolbarBackground  ← topBar
 *   sidePanelBackground ← leftBar
 *   appBackground       ← gridBackdrop
 *   text                ← text (also drives btnText, sidePanelHeaderText, logoText)
 *   textMuted           ← text at 70% opacity (secondary labels, metadata)
 *   textFaint           ← text at 45% opacity (placeholders, disabled hints)
 *   logo                ← logo
 *
 * Remaining tokens are derived for legibility (borders tuned to each surface,
 * grid canvas colors kept consistent with the backdrop tone).
 */
function derivePalette(s: SchemeData): ThemePalette {
  const light = isLight(s.topBar);

  // Border colors: semi-transparent overlay on the surface
  const toolbarBorder = light ? '#ddd' : 'rgba(0,0,0,0.2)';
  const panelBorder   = light ? '#ddd' : 'rgba(0,0,0,0.2)';

  // Shell background: slightly darker/lighter than the topBar
  const shellBackground = light ? '#fff' : 'rgba(0,0,0,0.15)';

  // Side panel header text: slightly muted version of the text color
  const sidePanelHeaderText = s.text;

  // §8.B2 — Secondary text derived from the scheme text so legibility is
  // preserved in both light and dark-surface themes (purpleGreen uses #fff).
  const textMuted = textAtAlpha(s.text, 0.70);
  const textFaint = textAtAlpha(s.text, 0.45);

  // Canvas: grid line colors tuned to backdrop tone
  const backdropLight = isLight(s.gridBackdrop);
  const gridLine        = backdropLight ? '#d0d0d0' : '#c0c0c0';
  const gridLineSubunit = backdropLight ? '#e4e4e4' : '#d8d8d6';

  return {
    label:              s.name,
    appBackground:      s.gridBackdrop,
    toolbarBackground:  s.topBar,
    sidePanelBackground: s.leftBar,
    text:               s.text,
    textMuted,
    textFaint,
    toolbarBorder,
    panelBorder,
    // §11.A1 — button text is its own scheme value (not derived from text)
    btnText:            s.buttonText,
    sidePanelHeaderText,
    shellBackground,
    logoText:           s.text,
    // §10.A3 — selection/active accent
    selectedBox:        s.selectedBox,
    // §10.A4 — base/unselected box surface
    unselectedBox:      s.unselectedBox,
    // §11.A1 — configurable button text
    buttonText:         s.buttonText,
    // §11.A4 — configurable top-bar right region background
    topBarRight:        s.topBarRight,
    // §11.A5 — legible text color for elements inside the top-bar-right region
    topBarRightText:    s.topBarRightText,
    logo:               s.logo,
    // §11.A2 — student name color (black in both schemes)
    studentName:        s.studentName,
    // §11.A3 — explicit grid fill from scheme (white in both schemes)
    gridBackground:     s.gridBackground,
    gridLine,
    gridLineSubunit,
  };
}

// ---------------------------------------------------------------------------
// THEMES registry — full palettes keyed by scheme id
// ---------------------------------------------------------------------------

/**
 * All registered themes, each derived from the corresponding scheme JSON file.
 * Adding a scheme = dropping a `.json` file in `src/theme/schemes/` — no code change.
 */
export const THEMES: Record<string, ThemePalette> = Object.fromEntries(
  Object.entries(SCHEME_DATA).map(([id, data]) => [id, derivePalette(data)]),
);

/** The raw scheme data objects, keyed by id. Exposed for tests and the scheme registry. */
export const SCHEME_REGISTRY: Record<string, SchemeData> = SCHEME_DATA;

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
// Initialize to the default theme, falling back to the first registered scheme, then an empty shell.
// The nullish coalescing chain handles the case where DEFAULT_THEME_ID has not yet been loaded
// (should never happen in practice since classic.json is always present).
const _fallbackId = Object.keys(THEMES)[0] ?? DEFAULT_THEME_ID;
const _firstTheme: ThemePalette | undefined =
  THEMES[DEFAULT_THEME_ID] ?? THEMES[_fallbackId];
let _activeTheme: ThemePalette = _firstTheme ?? ({} as ThemePalette);

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
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  const set = (prop: string, value: string): void => {
    try {
      root.style.setProperty(prop, value);
    } catch {
      // Ignore — best-effort in environments that restrict style mutation
    }
  };

  set('--pj-appBackground',       palette.appBackground);
  set('--pj-toolbarBackground',   palette.toolbarBackground);
  set('--pj-sidePanelBackground', palette.sidePanelBackground);
  set('--pj-toolbarBorder',       palette.toolbarBorder);
  set('--pj-panelBorder',         palette.panelBorder);
  set('--pj-btnText',             palette.btnText);
  set('--pj-sidePanelHeaderText', palette.sidePanelHeaderText);
  set('--pj-shellBackground',     palette.shellBackground);
  set('--pj-logoText',            palette.logoText);
  // §8.B2 — text drives all ordinary text color
  set('--pj-text',                palette.text);
  // §8.B2 — muted/faint text derived from scheme text for legibility in all themes
  set('--pj-text-muted',          palette.textMuted);
  set('--pj-text-faint',          palette.textFaint);
  // §10.A3 — selection/active accent
  set('--pj-selectedBox',         palette.selectedBox);
  // §10.A4 — base/unselected box surface
  set('--pj-unselectedBox',       palette.unselectedBox);
  // §11.A1 — button text (independent of general text)
  set('--pj-buttonText',          palette.buttonText);
  // §11.A4 — top-bar right region background
  set('--pj-topBarRight',         palette.topBarRight);
  // §11.A5 — top-bar right region text (legible on topBarRight in all schemes)
  set('--pj-topBarRightText',     palette.topBarRightText);
}

// ---------------------------------------------------------------------------
// isValidThemeId — runtime guard
// ---------------------------------------------------------------------------

/** Returns true if the given string is a registered theme id. */
export function isValidThemeId(id: string): id is ThemeId {
  return id in THEMES;
}
