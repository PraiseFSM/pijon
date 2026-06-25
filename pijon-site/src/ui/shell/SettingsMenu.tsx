/**
 * SettingsMenu — §7.A3 unified settings popover shared across ALL editor modes.
 *
 * Opened by a gear (⚙) button in the TopBar trailing group; click-outside closes it.
 * Rendered ONCE by TopBar so it is visible and functional in BOTH Furniture and
 * Students modes.
 *
 * Houses:
 *   §13.4  Nearness (units) — proximity threshold.
 *           Reads/writes classroom.thresholdUnits via store.setThreshold().
 *   §13.5  Show Violations toggle — defaults to on.
 *           Reads/writes store.showViolations via store.setShowViolations().
 *   §5.B4  Show Links toggle — now shared; drives the module-level showLinks var
 *           in StudentEditor via store.setShowLinks().
 *   §7.A3  Background image toggle (moved from FurnitureEditor toolbar).
 *   §7.A3  Grid color picker (moved from FurnitureEditor toolbar).
 *
 * Algorithm and variant controls REMOVED (§7.A4) — they now live in the
 * Allocate split-button dropdown in the Students toolbar.
 *
 * Design decisions:
 *   - Nearness is stored on the Classroom (per-project): thresholdUnits is the
 *     single source of truth.
 *   - showViolations and showLinks are app-level UI state in the store.
 *   - BG image and grid color are per-classroom, stored on the classroom.
 *   - Menu open/close is controlled by TopBar (caller).
 *
 * LOCAL-FIRST: no fetch(), no XHR, no WebSocket.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { EditorContext } from '../editors/EditorMode.js';
import { usePijonStore } from '../../state/store.js';
import { GridColorButton, GridColorPickerPopover } from '../editors/GridColorPicker.js';
import { ASSET } from '../../assets/paths.js';
import { THEMES } from '../../theme/themes.js';
import type { ThemeId } from '../../theme/themes.js';
import {
  settingsPopoverBackground,
  settingsPopoverBorder,
  settingsPopoverShadow,
  settingsHeaderText,
  settingsLabelText,
  dividerLight,
  activeButtonBackground,
  activeButtonBorder,
  activeButtonText,
  btnBackground,
  btnBorder,
  textDark,
  gearButtonBorder,
  gearButtonBorderActive,
  gearButtonBackground,
  gearButtonBackgroundActive,
  gearButtonText,
  gearButtonTextActive,
} from '../../theme/colors.js';

// ---------------------------------------------------------------------------
// Types exported for callers that need them
// ---------------------------------------------------------------------------

/** Identifies a registered seating algorithm. */
export type AlgorithmId = string;

/** The two action variants: seat from scratch vs. respect locks. */
export type ActionVariant = 'allocate' | 'smart_shuffle';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SettingsMenuProps {
  ctx: EditorContext;
  /** Whether the popover is currently open. */
  open: boolean;
  /** Called when the popover requests to close (click-outside or user action). */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// SettingsMenu component
// ---------------------------------------------------------------------------

/**
 * The settings popover panel. Rendered into a portal-like absolutely-positioned
 * div anchored below the gear button in the TopBar. The caller controls
 * open/close state.
 */
export const SettingsMenu: React.FC<SettingsMenuProps> = ({
  ctx,
  open,
  onClose,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  // Read settings from the store (reactive)
  const thresholdUnits = usePijonStore((s) => s.classroom.thresholdUnits);
  const showViolations = usePijonStore((s) => s.showViolations);
  const showLinks = usePijonStore((s) => s.showLinks);
  const classroom = usePijonStore((s) => s.classroom);
  const uiScale = usePijonStore((s) => s.uiScale);
  const themeId = usePijonStore((s) => s.themeId);

  // ---- Click-outside close (§12.1 pattern) ---------------------------------

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) {
        return; // click inside the panel — keep open
      }
      onClose();
    };

    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
    };
  }, [open, onClose]);

  // ---- Nearness change -----------------------------------------------------

  const handleNearnessChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      if (!Number.isFinite(val) || val <= 0) return;
      ctx.store.setThreshold(val);
      ctx.canvas.requestRepaint();
    },
    [ctx.store, ctx.canvas],
  );

  // ---- Show violations toggle ----------------------------------------------

  const handleToggleViolations = useCallback(() => {
    ctx.store.setShowViolations(!showViolations);
    ctx.canvas.requestRepaint();
  }, [ctx.store, ctx.canvas, showViolations]);

  // ---- Show Links toggle ---------------------------------------------------

  const handleToggleShowLinks = useCallback(() => {
    ctx.store.setShowLinks(!showLinks);
    ctx.canvas.requestRepaint();
  }, [ctx.store, ctx.canvas, showLinks]);

  // ---- §7.A3 Background image toggle --------------------------------------

  const handleToggleBg = useCallback(() => {
    ctx.store.setBackgroundImage(
      classroom.backgroundImage ? null : ASSET.background,
    );
    ctx.canvas.requestRepaint();
  }, [ctx.store, ctx.canvas, classroom.backgroundImage]);

  // ---- §7.A3 Grid color change --------------------------------------------

  const handleGridColorChange = useCallback(
    (color: string | null) => {
      ctx.store.setGridColor(color);
      ctx.canvas.requestRepaint();
    },
    [ctx.store, ctx.canvas],
  );

  const handleColorPickerClose = useCallback(() => {
    setColorPickerOpen(false);
  }, []);

  // ---- §7.B1 UI scale change -----------------------------------------------

  const handleUiScale = useCallback(
    (scale: number) => {
      ctx.store.setUiScale(scale);
      // Canvas geometry changes — trigger a repaint so the grid redraws at
      // the new size (ClassroomCanvas will resize and repaint on re-render;
      // requestRepaint here ensures any overlay is also redrawn).
      ctx.canvas.requestRepaint();
    },
    [ctx.store, ctx.canvas],
  );

  // ---- §7.C1 Theme change --------------------------------------------------

  const handleSetTheme = useCallback(
    (id: ThemeId) => {
      ctx.store.setTheme(id);
      // Canvas uses getActiveThemeColors() which setTheme already updated;
      // request a repaint so the grid redraws with the new background/lines.
      ctx.canvas.requestRepaint();
    },
    [ctx.store, ctx.canvas],
  );

  // ---- Styles --------------------------------------------------------------

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '6px 0',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '0.82rem',
    color: settingsLabelText,
    flexShrink: 0,
  };

  const toggleStyle = (on: boolean): React.CSSProperties => ({
    padding: '3px 10px',
    borderRadius: 4,
    border: '1px solid',
    borderColor: on ? activeButtonBorder : btnBorder,
    background: on ? activeButtonBackground : btnBackground,
    color: on ? activeButtonText : textDark,
    cursor: 'pointer',
    fontSize: '0.8rem',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  });

  const sectionTitle: React.CSSProperties = {
    fontSize: '0.7rem',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: settingsHeaderText,
    marginBottom: 4,
    marginTop: 4,
  };

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      data-testid="settings-menu"
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        zIndex: 1200,
        background: settingsPopoverBackground,
        border: `1px solid ${settingsPopoverBorder}`,
        borderRadius: 6,
        boxShadow: `0 4px 16px ${settingsPopoverShadow}`,
        minWidth: 260,
        padding: '10px 14px 12px',
        marginTop: 2,
      }}
    >
      {/* Header */}
      <div
        style={{
          fontWeight: 700,
          fontSize: '0.8rem',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: settingsHeaderText,
          marginBottom: 8,
          paddingBottom: 6,
          borderBottom: `1px solid ${dividerLight}`,
        }}
      >
        Settings
      </div>

      {/* §7.B1 — UI scale preset buttons */}
      <div style={rowStyle}>
        <span style={labelStyle}>UI Scale:</span>
        <div
          role="group"
          aria-label="UI scale presets"
          style={{ display: 'flex', gap: 4, flexShrink: 0 }}
        >
          {([
            { label: '80%', value: 0.8 },
            { label: '100%', value: 1.0 },
            { label: '120%', value: 1.2 },
            { label: '150%', value: 1.5 },
          ] as const).map(({ label, value }) => {
            const active = Math.abs(uiScale - value) < 0.01;
            return (
              <button
                key={label}
                type="button"
                data-testid={`settings-ui-scale-${value.toString()}`}
                onClick={() => { handleUiScale(value); }}
                style={{
                  ...toggleStyle(active),
                  minWidth: 38,
                }}
                aria-pressed={active}
                title={`Set UI scale to ${label}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${dividerLight}`, margin: '4px 0' }} />

      {/* §7.C2 — Theme picker */}
      <div style={rowStyle}>
        <span style={labelStyle}>Theme:</span>
        <div
          role="group"
          aria-label="Color theme"
          style={{ display: 'flex', gap: 4, flexShrink: 0 }}
        >
          {(Object.keys(THEMES) as ThemeId[]).map((id) => {
            const active = themeId === id;
            return (
              <button
                key={id}
                type="button"
                data-testid={`settings-theme-${id}`}
                onClick={() => { handleSetTheme(id); }}
                style={{
                  ...toggleStyle(active),
                  minWidth: 60,
                }}
                aria-pressed={active}
                title={`Switch to ${THEMES[id].label} theme`}
              >
                {THEMES[id].label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${dividerLight}`, margin: '4px 0' }} />

      {/* §7.A3 — Background image toggle (moved from FurnitureEditor toolbar) */}
      <div style={rowStyle}>
        <span style={labelStyle}>Classroom BG:</span>
        <button
          type="button"
          data-testid="settings-bg-toggle"
          onClick={handleToggleBg}
          style={toggleStyle(!!classroom.backgroundImage)}
          title={
            classroom.backgroundImage
              ? 'Disable the classroom background image'
              : 'Enable the classroom background image (classroom-background.png)'
          }
          aria-pressed={!!classroom.backgroundImage}
        >
          {classroom.backgroundImage ? 'ON' : 'OFF'}
        </button>
      </div>

      <div style={{ borderTop: `1px solid ${dividerLight}`, margin: '4px 0' }} />

      {/* §7.A3 — Grid color picker (moved from FurnitureEditor toolbar) */}
      <div style={rowStyle}>
        <span style={labelStyle}>Grid Color:</span>
        <div style={{ position: 'relative' }}>
          <GridColorButton
            open={colorPickerOpen}
            currentColor={classroom.gridColor ?? null}
            onClick={() => { setColorPickerOpen((v) => !v); }}
          />
          <GridColorPickerPopover
            open={colorPickerOpen}
            currentColor={classroom.gridColor ?? null}
            onChange={handleGridColorChange}
            onClose={handleColorPickerClose}
          />
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${dividerLight}`, margin: '4px 0' }} />

      {/* §5.B4 — Show Links toggle */}
      <div style={rowStyle}>
        <span style={labelStyle}>Show Links:</span>
        <button
          type="button"
          data-testid="settings-show-links-toggle"
          onClick={handleToggleShowLinks}
          style={toggleStyle(showLinks)}
          title="Draw preference links between currently seated students"
          aria-pressed={showLinks}
        >
          {showLinks ? 'ON' : 'OFF'}
        </button>
      </div>

      <div style={{ borderTop: `1px solid ${dividerLight}`, margin: '4px 0' }} />

      {/* Nearness (units) */}
      <div style={rowStyle}>
        <span style={labelStyle}>Nearness (units):</span>
        <input
          type="number"
          data-testid="settings-nearness-input"
          min="0.5"
          max="10"
          step="0.5"
          value={thresholdUnits}
          onChange={handleNearnessChange}
          style={{
            width: 62,
            padding: '2px 4px',
            borderRadius: 4,
            border: `1px solid ${btnBorder}`,
            fontSize: '0.8rem',
            textAlign: 'right',
          }}
          title="Proximity threshold in real units (independent of grid granularity). 1.5 = orthogonal + diagonal neighbors."
        />
      </div>

      <div style={{ borderTop: `1px solid ${dividerLight}`, margin: '4px 0' }} />

      {/* Show violations toggle */}
      <div style={rowStyle}>
        <span style={labelStyle}>Show Violations:</span>
        <button
          type="button"
          data-testid="settings-violations-toggle"
          onClick={handleToggleViolations}
          style={toggleStyle(showViolations)}
          title="Highlight desks with avoid-preference violations"
          aria-pressed={showViolations}
        >
          {showViolations ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* §7.A3 — Grid Color section label for clarity */}
      <div style={{ marginTop: 4 }}>
        <div style={sectionTitle}>Classroom</div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// GearButton — the trigger button that opens/closes the SettingsMenu
// ---------------------------------------------------------------------------

interface GearButtonProps {
  open: boolean;
  onClick: () => void;
}

export const GearButton: React.FC<GearButtonProps> = ({ open, onClick }) => (
  <button
    type="button"
    data-testid="settings-gear-button"
    onClick={onClick}
    title="Settings"
    aria-expanded={open}
    aria-label="Settings"
    style={{
      padding: '4px 8px',
      borderRadius: 4,
      border: '1px solid',
      borderColor: open ? gearButtonBorderActive : gearButtonBorder,
      background: open ? gearButtonBackgroundActive : gearButtonBackground,
      color: open ? gearButtonTextActive : gearButtonText,
      cursor: 'pointer',
      fontSize: '1rem',
      lineHeight: 1,
      display: 'flex',
      alignItems: 'center',
    }}
  >
    ⚙
  </button>
);
