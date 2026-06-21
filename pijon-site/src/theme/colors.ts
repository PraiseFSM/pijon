/**
 * colors.ts — central color token module (§14.2).
 *
 * THE single non-image color source for the entire Pijon UI.
 * Every hex/rgba color used in any component or canvas draw call is defined
 * here as a named token. To re-theme Pijon, edit this file only.
 *
 * Location decision: `src/theme/colors.ts` (TypeScript, not in `public/assets/`)
 * because colors are *code* that must be imported and type-checked — they are
 * not static files served by the web server. The outline says "in the assets
 * folder, have a colors file"; `src/theme/` is the idiomatic TS equivalent,
 * and this file is cross-referenced from `public/assets/ASSETS.md`.
 *
 * Rules:
 *   - No imports from React / DOM / domain layer — this is pure data.
 *   - No `any`. `as const` ensures literal narrowing.
 *   - Add new tokens here when any new color is introduced in the UI;
 *     never add a raw literal to a component.
 *   - Pulse/animation expressions that interpolate alpha at runtime are the
 *     only exception — they reference BASE tokens from this file.
 *
 * Groups (scroll down):
 *   1. App shell & layout
 *   2. Canvas — grid & background
 *   3. Canvas — furniture fills & strokes
 *   4. Canvas — occupant text
 *   5. Canvas — lock tint
 *   6. Student editor overlays (drag, violations, neighbors, assigner)
 *   7. Preference links overlay
 *   8. Furniture editor overlays (selection, drag preview, collision flash)
 *   9. Toolbar & button shared styles
 *   10. Panel & sidebar backgrounds
 *   11. Banners (error/warning/info)
 *   12. Typography & dividers
 */

// ---------------------------------------------------------------------------
// 1. App shell & layout
// ---------------------------------------------------------------------------

export const appBackground = '#f0f0f0' as const;         // canvas area wrapper background
export const shellBackground = '#fff' as const;           // EditorSwitcher row background
export const toolbarBackground = '#f5f5f5' as const;      // TopBar / toolbar rows background
export const toolbarBorder = '#ddd' as const;             // TopBar / toolbar bottom border
export const panelBorder = '#ddd' as const;               // panel / divider borders (shared)
export const canvasCardBackground = '#fff' as const;      // inline-block card around canvas
export const canvasCardBorder = '#ccc' as const;          // card border
export const canvasCardShadow = 'rgba(0,0,0,0.1)' as const; // card drop-shadow

// ---------------------------------------------------------------------------
// 2. Canvas — grid & background
// ---------------------------------------------------------------------------

export const gridLine = '#d0d0d0' as const;              // grid line stroke
export const gridBackground = '#f8f8f8' as const;        // canvas clear-fill (background)

// ---------------------------------------------------------------------------
// 3. Canvas — furniture fills by kind
// ---------------------------------------------------------------------------

export const furnitureFillSingleDesk = '#e3f2fd' as const;  // light blue
export const furnitureFillTable = '#e8f5e9' as const;        // light green
export const furnitureFillTeacherDesk = '#fff3e0' as const;  // light orange
export const furnitureFillWhiteboard = '#f3e5f5' as const;   // light purple

/** All furniture fills indexed by FurnitureKind string — convenient for lookups. */
export const furnitureFillByKind: Record<string, string> = {
  single_desk: furnitureFillSingleDesk,
  table: furnitureFillTable,
  teacher_desk: furnitureFillTeacherDesk,
  whiteboard: furnitureFillWhiteboard,
} as const;

// Furniture strokes
export const furnitureStroke = '#90a4ae' as const;          // blue-grey — standard desks/tables
export const furnitureStrokeFixture = '#b39ddb' as const;   // purple-grey — teacher desk / whiteboard

// ---------------------------------------------------------------------------
// 4. Canvas — occupant text
// ---------------------------------------------------------------------------

export const occupantNameStudent = '#1a237e' as const;   // dark blue — real student name
export const occupantNameFixture = '#4a148c' as const;   // dark purple — fixture label (italic)

// ---------------------------------------------------------------------------
// 5. Canvas — lock tint
// ---------------------------------------------------------------------------

export const lockTint = 'rgba(255, 152, 0, 0.18)' as const;   // orange tint over locked desks

// ---------------------------------------------------------------------------
// 6. Student editor overlays
// ---------------------------------------------------------------------------

// Drag-between-desks
export const dragTargetFill = 'rgba(21, 101, 192, 0.22)' as const;
export const dragTargetStroke = 'rgba(21, 101, 192, 0.9)' as const;
export const dragSourceFade = 'rgba(200, 200, 200, 0.5)' as const;
export const dragGhostFill = 'rgba(21, 101, 192, 0.88)' as const;
export const dragGhostStroke = 'rgba(255,255,255,0.5)' as const;  // ghost label border stroke
export const dragGhostText = '#fff' as const;

// Roster-drag drop target (§13.7)
export const rosterDropTargetFill = 'rgba(46, 125, 50, 0.18)' as const;
export const rosterDropTargetStroke = 'rgba(46, 125, 50, 0.85)' as const;

// Violation tint
export const violationFill = 'rgba(211, 47, 47, 0.22)' as const;
export const violationStroke = 'rgba(211, 47, 47, 0.8)' as const;

// Neighbor preview (right-click)
export const neighborSourceStroke = 'rgba(81, 45, 168, 0.9)' as const;
export const neighborSourceFill = 'rgba(81, 45, 168, 0.12)' as const;
export const neighborFill = 'rgba(123, 31, 162, 0.08)' as const;
export const neighborStroke = 'rgba(123, 31, 162, 0.55)' as const;

// Lock badge (in overlay)
export const lockBadgeFill = 'rgba(245, 124, 0, 0.92)' as const;
export const lockBadgeText = '#fff' as const;

// Assigner mode pulse base colors (alpha is animated — use these as RGB bases)
// The full rgba strings are assembled at runtime; these are the opaque versions.
export const assignerPulseOrange = '#e65100' as const;   // inner ring base
export const assignerPulseAmber = '#ff9800' as const;    // outer ring base
export const assignerPulseGlowBase = '#ff6f00' as const; // fill glow base (also hint banner bg)

// Assigner hint banner (§13.6 toolbar hint strip)
export const assignerHintBackground = '#ff6f00' as const;
export const assignerHintText = '#fff' as const;

// ---------------------------------------------------------------------------
// 7. Preference links overlay
// ---------------------------------------------------------------------------

export const prefLinkPrefer = 'rgba(46, 125, 50, 0.55)' as const;   // green — prefer
export const prefLinkAvoid = 'rgba(183, 28, 28, 0.55)' as const;    // red — avoid

// ---------------------------------------------------------------------------
// 8. Furniture editor overlays
// ---------------------------------------------------------------------------

// Selection dashed ring
export const selectionStroke = 'rgba(25, 118, 210, 0.9)' as const;

// Drag preview — valid vs. invalid
export const dragPreviewValidStroke = 'rgba(25, 118, 210, 0.85)' as const;
export const dragPreviewInvalidFill = 'rgba(211, 47, 47, 0.28)' as const;
export const dragPreviewInvalidStroke = 'rgba(211, 47, 47, 0.85)' as const;

// Grid-drag (existing furniture) — valid vs. invalid
export const gridDragValidStroke = 'rgba(25, 118, 210, 0.9)' as const;  // same as selection
export const gridDragInvalidFill = 'rgba(211, 47, 47, 0.30)' as const;
export const gridDragInvalidStroke = 'rgba(211, 47, 47, 0.9)' as const;

// Original position ghost during grid-drag
export const gridDragOriginFade = 'rgba(240, 240, 240, 0.65)' as const;

// Drop collision flash
export const dropCollisionFlashFill = 'rgba(211, 47, 47, 0.25)' as const;

// Palette item in FurnitureSidePanel (mirrors furniture fills)
export const paletteItemBorder = '#ccc' as const;

// ---------------------------------------------------------------------------
// 9. Toolbar & button shared styles
// ---------------------------------------------------------------------------

export const btnBackground = '#fff' as const;
export const btnBorder = '#bbb' as const;
export const btnText = '#333' as const;   // default button text (also general dark text)

// Primary / action buttons (Allocate, Smart Shuffle, Import CSV, etc.)
export const primaryButtonBackground = '#1565c0' as const;
export const primaryButtonBorder = '#1565c0' as const;
export const primaryButtonText = '#fff' as const;

// Active/toggled button
export const activeButtonBackground = '#1565c0' as const;
export const activeButtonBorder = '#1565c0' as const;
export const activeButtonText = '#fff' as const;

// Danger / remove buttons (× remove, Erase all)
export const dangerButtonBackground = '#ffebee' as const;
export const dangerButtonBorder = '#ffcdd2' as const;
export const dangerButtonText = '#c62828' as const;

// Erase-all in TopBar (transparent background, just a border)
export const eraseButtonBorder = '#e57373' as const;
export const eraseButtonText = '#b71c1c' as const;

// Gear / settings button
export const gearButtonBorder = '#bbb' as const;
export const gearButtonBorderActive = '#1565c0' as const;
export const gearButtonBackground = '#fff' as const;
export const gearButtonBackgroundActive = '#e3f2fd' as const;
export const gearButtonText = '#555' as const;
export const gearButtonTextActive = '#1565c0' as const;

// Split-button (§13.2) caret divider
export const splitButtonCaretDivider = 'rgba(255,255,255,0.35)' as const;
export const splitButtonDropdownBorder = '#c5cae9' as const;
export const splitButtonDropdownShadow = 'rgba(0,0,0,0.15)' as const;
export const splitButtonDropdownBackground = '#fff' as const;
export const splitButtonSectionLabel = '#888' as const;

// Disabled button
export const disabledButtonBorder = '#bbb' as const;
export const disabledButtonBackground = '#eee' as const;

// Roster item — selected highlight
export const rosterSelectedBackground = '#e3f2fd' as const;
export const rosterSelectedBorder = '#1565c0' as const;

// Roster item — preference count badge
export const prefCountBadgeBackground = '#f0f0f0' as const;
export const prefCountBadgeText = '#888' as const;

// Add-student form button
export const addStudentButtonBorder = '#90caf9' as const;
export const addStudentButtonBackground = '#e3f2fd' as const;
export const addStudentButtonText = '#1565c0' as const;

// ---------------------------------------------------------------------------
// 10. Panel & sidebar backgrounds
// ---------------------------------------------------------------------------

export const sidePanelBackground = '#fafafa' as const;   // left/right side panels
export const sidePanelHeaderText = '#555' as const;       // uppercase section headers

// EditorSwitcher tab — active
export const tabActiveBackground = '#e3f2fd' as const;
export const tabActiveBorder = '#1565c0' as const;
export const tabActiveText = '#0d47a1' as const;
// EditorSwitcher tab — inactive
export const tabInactiveBackground = '#fff' as const;
export const tabInactiveBorder = '#ccc' as const;
export const tabInactiveText = '#444' as const;

// Pijon logo word-mark in EditorSwitcher
export const logoText = '#1565c0' as const;

// Settings popover
export const settingsPopoverBackground = '#fff' as const;
export const settingsPopoverBorder = '#ccc' as const;
export const settingsPopoverShadow = 'rgba(0,0,0,0.15)' as const;
export const settingsHeaderText = '#555' as const;
export const settingsLabelText = '#333' as const;

// Context menu (StudentEditor)
export const contextMenuBackground = '#fff' as const;
export const contextMenuBorder = '#ccc' as const;
export const contextMenuShadow = 'rgba(0,0,0,0.15)' as const;
export const contextMenuHeaderText = '#333' as const;
export const contextMenuMutedText = '#888' as const;
export const contextMenuLockText = '#e65100' as const;
export const contextMenuUnlockText = '#1565c0' as const;

// Preference direction colors (preference list in right panel)
export const prefPreferText = '#2e7d32' as const;   // green — prefer
export const prefAvoidText = '#c62828' as const;    // red — avoid

// Selected student header in right panel
export const selectedStudentHeaderBackground = '#e3f2fd' as const;
export const selectedStudentHeaderText = '#1565c0' as const;

// Preference panel border highlight
export const prefPanelAddBorder = '#e3f2fd' as const;

// ---------------------------------------------------------------------------
// 11. Banners (error / warning / info)
// ---------------------------------------------------------------------------

// Error banner (over-capacity seating — §13.8)
export const bannerErrorBackground = '#ffebee' as const;
export const bannerErrorBorder = '#ef9a9a' as const;
export const bannerErrorText = '#b71c1c' as const;

// Warning banner (unplaced students — §13.8; also furniture resize blocked)
export const bannerWarningBackground = '#fff3e0' as const;
export const bannerWarningBorder = '#ffe0b2' as const;
export const bannerWarningText = '#e65100' as const;

// Info banner (import status success — StudentRosterPanel)
export const bannerInfoText = '#2e7d32' as const;

// Import CSV warnings sub-panel
export const bannerWarningButtonBorder = '#ffb74d' as const;  // dismiss button border in warning banner

export const importWarningsBackground = '#fff3e0' as const;
export const importWarningsText = '#e65100' as const;

// Seating issues banner: amber/warning variant
export const bannerAmberBackground = '#fff8e1' as const;
export const bannerAmberBorder = '#ffe082' as const;
export const bannerAmberText = '#e65100' as const;

// ---------------------------------------------------------------------------
// 12. Typography & dividers
// ---------------------------------------------------------------------------

export const textDark = '#333' as const;
export const textMedium = '#555' as const;
export const textMuted = '#666' as const;
export const textFaint = '#777' as const;
export const textFainter = '#888' as const;
export const textPlaceholder = '#999' as const;
export const textDisabled = '#aaa' as const;

// Fixture item in roster (italic purple)
export const fixtureItemText = '#9c27b0' as const;

// Save-status indicator colors (TopBar)
export const saveStatusSaved = '#2e7d32' as const;
export const saveStatusSaving = '#1565c0' as const;
export const saveStatusDirty = '#e65100' as const;
export const saveStatusError = '#b71c1c' as const;

export const divider = '#ddd' as const;   // most horizontal/vertical rule lines
export const dividerLight = '#eee' as const;  // finer dividers inside panels

// ---------------------------------------------------------------------------
// 13. Grid color picker (§14.5)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 14. Ghost ring / in-grid resize buttons (§14.7)
// ---------------------------------------------------------------------------

/**
 * Ghost-ring cell fill: a very light, translucent square rendered outside the
 * grid where PLUS buttons live.  Lighter than the grid background so it looks
 * like a "suggested" extension of the room.
 */
export const ghostRingCellFill = 'rgba(200, 220, 255, 0.18)' as const;
export const ghostRingCellStroke = 'rgba(130, 160, 220, 0.35)' as const;

/** PLUS button (outside the grid — clicking adds a row/col). */
export const ghostRingPlusButtonFill = 'rgba(25, 118, 210, 0.12)' as const;
export const ghostRingPlusButtonStroke = 'rgba(25, 118, 210, 0.55)' as const;
export const ghostRingPlusButtonText = 'rgba(25, 118, 210, 0.85)' as const;
/** PLUS button hover state. */
export const ghostRingPlusButtonHoverFill = 'rgba(25, 118, 210, 0.22)' as const;

/** MINUS button (inside the grid — clicking removes a row/col). */
export const ghostRingMinusButtonFill = 'rgba(180, 60, 60, 0.10)' as const;
export const ghostRingMinusButtonStroke = 'rgba(180, 60, 60, 0.45)' as const;
export const ghostRingMinusButtonText = 'rgba(180, 60, 60, 0.80)' as const;
/** MINUS button hover state. */
export const ghostRingMinusButtonHoverFill = 'rgba(180, 60, 60, 0.20)' as const;

/** Popover chrome that wraps the <input type="color"> + swatch palette. */
export const colorPickerPopoverBackground = '#fff' as const;
export const colorPickerPopoverBorder = '#ccc' as const;
export const colorPickerPopoverShadow = 'rgba(0,0,0,0.18)' as const;
export const colorPickerHeaderText = '#555' as const;

/** Reset-to-default button (grid color picker). */
export const colorPickerResetBorder = '#bbb' as const;
export const colorPickerResetBackground = '#f5f5f5' as const;
export const colorPickerResetText = '#555' as const;

/** Swatch item border and selected-ring. */
export const colorPickerSwatchBorder = 'rgba(0,0,0,0.18)' as const;
export const colorPickerSwatchSelectedRing = '#1565c0' as const;
