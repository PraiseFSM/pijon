/**
 * GridColorPicker — §14.5: Adjustable grid color + live color picker.
 *
 * A toolbar button whose icon is the `grid-color-button.png` asset opens a
 * color picker popover. The grid recolors **live as the user drags** within
 * the native color wheel (the browser's `input` event fires continuously on
 * every drag step — distinct from `change` which fires only on commit).
 *
 * Design:
 *   - The trigger button shows the `gridColorButton` asset icon so the icon
 *     is data-driven via the asset path helper (§14.1), not a hard-coded URL.
 *   - The popover contains:
 *       1. A <input type="color"> native picker — guaranteed live-drag via `onInput`.
 *       2. A palette of on-brand swatches for quick picks.
 *       3. A "Reset to default" link that restores null (theme default).
 *   - Click-outside closes the popover (same capture-phase window.pointerdown
 *     pattern as SettingsMenu and the StudentEditor context menu — §12.1).
 *
 * Color update flow:
 *   onInput (continuous) → store.setGridColor(hex) → classroom.gridColor
 *   → renderBasePass receives it as the optional `gridColor` arg → drawGrid
 *   uses it → grid repaints live on every drag step.
 *
 * Persistence:
 *   The classroom.gridColor field is persisted in the project file (§14.5 Zod
 *   schema). Autosave kicks in after each onInput (marks dirty); IndexedDB
 *   debounce absorbs the rapid fire.
 *
 * LOCAL-FIRST: no fetch(), no network, no analytics. Palette colors are
 *   plain string literals — no external palette library.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { ASSET } from '../../assets/paths.js';
import { gridLine } from '../../theme/colors.js';
import {
  colorPickerPopoverBackground,
  colorPickerPopoverBorder,
  colorPickerPopoverShadow,
  colorPickerHeaderText,
  colorPickerResetBorder,
  colorPickerResetBackground,
  colorPickerResetText,
  colorPickerSwatchBorder,
  colorPickerSwatchSelectedRing,
  dividerLight,
} from '../../theme/colors.js';

// ---------------------------------------------------------------------------
// On-brand swatch palette
// ---------------------------------------------------------------------------

/**
 * A curated palette of on-brand colors for quick grid-line picks.
 * Ordered light → dark within each hue family.
 * The theme default (`gridLine`) is included as the first swatch so it is
 * always one click away.
 */
const SWATCHES: readonly string[] = [
  gridLine,       // theme default — light grey
  '#b0b0b0',      // medium grey
  '#808080',      // dark grey
  '#1565c0',      // primary blue (matches toolbar accents)
  '#0288d1',      // sky blue
  '#0097a7',      // teal
  '#2e7d32',      // forest green
  '#558b2f',      // olive green
  '#f57f17',      // amber
  '#e65100',      // deep orange
  '#c62828',      // deep red
  '#6a1b9a',      // deep purple
  '#4a148c',      // indigo purple (matches fixture text)
  '#000000',      // black
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GridColorPickerProps {
  /** The current grid color (null = use theme default). */
  currentColor: string | null;
  /** Called on every color change (continuous while dragging). */
  onChange: (color: string | null) => void;
  /** Whether the popover is open. */
  open: boolean;
  /** Called when the popover should close. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// GridColorPickerPopover
// ---------------------------------------------------------------------------

/**
 * The popover panel.  Rendered absolutely below the trigger button.
 * Caller controls open/closed state.
 */
export const GridColorPickerPopover: React.FC<GridColorPickerProps> = ({
  currentColor,
  onChange,
  open,
  onClose,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  // ---- Click-outside close (§12.1 pattern) --------------------------------

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) {
        return; // click inside panel — keep open
      }
      onClose();
    };

    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
    };
  }, [open, onClose]);

  // ---- Color input handlers -----------------------------------------------

  /**
   * onInput fires CONTINUOUSLY while the user drags inside the native color
   * wheel — this is what gives live grid recoloring while dragging.
   * It is distinct from onChange which only fires when the picker commits.
   */
  const handleColorInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      const hex = (e.target as HTMLInputElement).value;
      onChange(hex);
    },
    [onChange],
  );

  const handleSwatchClick = useCallback(
    (color: string) => {
      onChange(color === gridLine ? null : color);
    },
    [onChange],
  );

  const handleReset = useCallback(() => {
    onChange(null);
  }, [onChange]);

  // The native color input requires a hex value; fall back to the theme default.
  const hexValue = currentColor ?? gridLine;

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      data-testid="grid-color-picker-popover"
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        zIndex: 1200,
        background: colorPickerPopoverBackground,
        border: `1px solid ${colorPickerPopoverBorder}`,
        borderRadius: 8,
        boxShadow: `0 6px 20px ${colorPickerPopoverShadow}`,
        minWidth: 200,
        padding: '10px 12px 12px',
        marginTop: 4,
      }}
    >
      {/* Header */}
      <div
        style={{
          fontWeight: 700,
          fontSize: '0.78rem',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: colorPickerHeaderText,
          marginBottom: 8,
          paddingBottom: 6,
          borderBottom: `1px solid ${dividerLight}`,
        }}
      >
        Grid Color
      </div>

      {/* Native color picker — live via onInput */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 10,
        }}
      >
        <input
          type="color"
          data-testid="grid-color-input"
          value={hexValue}
          onInput={handleColorInput}
          onChange={handleColorInput} // also handle onChange for keyboard entry
          style={{
            width: 44,
            height: 44,
            padding: 2,
            border: `1px solid ${colorPickerPopoverBorder}`,
            borderRadius: 6,
            cursor: 'pointer',
            background: 'none',
          }}
          title="Pick any grid line color"
          aria-label="Grid line color"
        />
        <div style={{ fontSize: '0.78rem', color: colorPickerHeaderText }}>
          <div style={{ fontWeight: 600 }}>Custom</div>
          <div style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{hexValue}</div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop: `1px solid ${dividerLight}`, margin: '6px 0 8px' }} />

      {/* Swatch palette */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 5,
          marginBottom: 10,
        }}
      >
        {SWATCHES.map((color) => {
          const effectiveColor = currentColor ?? gridLine;
          const isSelected = effectiveColor.toLowerCase() === color.toLowerCase();
          return (
            <button
              key={color}
              type="button"
              data-testid={`grid-color-swatch-${color}`}
              onClick={() => { handleSwatchClick(color); }}
              title={color}
              aria-label={`Set grid color to ${color}`}
              aria-pressed={isSelected}
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                border: isSelected
                  ? `2.5px solid ${colorPickerSwatchSelectedRing}`
                  : `1.5px solid ${colorPickerSwatchBorder}`,
                background: color,
                cursor: 'pointer',
                padding: 0,
                outline: isSelected ? `2px solid ${colorPickerSwatchSelectedRing}` : 'none',
                outlineOffset: 1,
                boxSizing: 'border-box',
              }}
            />
          );
        })}
      </div>

      {/* Reset to default */}
      <button
        type="button"
        data-testid="grid-color-reset"
        onClick={handleReset}
        disabled={currentColor === null}
        style={{
          width: '100%',
          padding: '4px 0',
          border: `1px solid ${colorPickerResetBorder}`,
          borderRadius: 4,
          background: colorPickerResetBackground,
          color: colorPickerResetText,
          fontSize: '0.76rem',
          cursor: currentColor === null ? 'default' : 'pointer',
          opacity: currentColor === null ? 0.5 : 1,
        }}
        title="Reset grid color to the theme default"
      >
        Reset to default
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// GridColorButton — the trigger button in the toolbar
// ---------------------------------------------------------------------------

export interface GridColorButtonProps {
  /** Whether the popover is currently open. */
  open: boolean;
  /** Current grid color (null = theme default). */
  currentColor: string | null;
  /** Toggle the open state. */
  onClick: () => void;
}

/**
 * The icon button that opens the grid color picker popover.
 * Icon is the `gridColorButton` asset (§14.1); a live color dot badge
 * overlays the icon when a custom color is active.
 */
export const GridColorButton: React.FC<GridColorButtonProps> = ({ open, currentColor, onClick }) => (
  <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
    <button
      type="button"
      data-testid="grid-color-button"
      onClick={onClick}
      title={
        currentColor
          ? `Grid color: ${currentColor} (click to change)`
          : 'Grid color (click to change)'
      }
      aria-expanded={open}
      aria-label="Grid color picker"
      style={{
        padding: 3,
        borderRadius: 5,
        border: `1.5px solid ${open ? '#1565c0' : '#bbb'}`,
        background: open ? '#e3f2fd' : '#fff',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        position: 'relative',
        overflow: 'visible',
      }}
    >
      <img
        src={ASSET.gridColorButton}
        alt="Grid color"
        style={{ width: 22, height: 22, display: 'block' }}
        draggable={false}
      />
      {/* Live color badge — shown when a custom color is active */}
      {currentColor !== null && (
        <span
          style={{
            position: 'absolute',
            bottom: -3,
            right: -3,
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: currentColor,
            border: '1.5px solid #fff',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
            pointerEvents: 'none',
          }}
          aria-hidden
        />
      )}
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// SWATCHES export — used by tests
// ---------------------------------------------------------------------------

export { SWATCHES };
