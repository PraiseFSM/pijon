/**
 * SettingsMenu — settings popover for the Students editor toolbar (§13.3).
 *
 * Opened by a gear (⚙) button in the toolbar; click-outside closes it
 * (uses the same capture-phase window.pointerdown pattern as the context menu
 * in §12.1 — see StudentEditor.tsx StudentSidePanelWithMenu).
 *
 * Houses (§5.B4):
 *   §13.4  Nearness (units) — proximity threshold.
 *           Reads/writes classroom.thresholdUnits via store.setThreshold().
 *   §13.5  Show Violations toggle — defaults to on.
 *           Reads/writes store.showViolations via store.setShowViolations().
 *   §5.B4  Algorithm choice (Greedy / Random) — moved here from the split-button.
 *   §5.B4  Action variant (Allocate / Smart Shuffle) — moved here from the split-button.
 *   §5.B4  Show Links toggle — moved here from the old RightPanel.
 *
 * Design decisions:
 *   - Nearness is stored on the Classroom (per-project): thresholdUnits is the
 *     single source of truth — changing it rebuilds the SeatGraph used by
 *     allocate, violation overlay, and neighbor preview.
 *   - showViolations is app-level UI state (not per-project): teachers expect
 *     "I always want to see violations" without it toggling per class.
 *   - Algorithm, variant, and showLinks are callbacks passed in from the toolbar
 *     so their state lives in the toolbar (single owner).
 *   - Menu open/close is local React state; no store involvement.
 *
 * LOCAL-FIRST: no fetch(), no XHR, no WebSocket.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import type { EditorContext } from '../editors/EditorMode.js';
import { usePijonStore } from '../../state/store.js';
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
// Types for algorithm / variant (exported so StudentEditor can use them)
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

  // --- §5.B4 additions: algorithm / variant / showLinks live here now ---

  /** Currently selected algorithm id (e.g. 'greedy'). */
  algorithmId: AlgorithmId;
  /** Called when the user picks a different algorithm. */
  onChangeAlgorithm: (id: AlgorithmId) => void;

  /** Currently selected action variant. */
  variant: ActionVariant;
  /** Called when the user picks a different variant. */
  onChangeVariant: (v: ActionVariant) => void;

  /** Whether preference links are shown on the canvas. */
  showLinks: boolean;
  /** Called when the user toggles the Show Links switch. */
  onToggleShowLinks: () => void;
}

// ---------------------------------------------------------------------------
// SettingsMenu component
// ---------------------------------------------------------------------------

/**
 * The settings popover panel. Rendered into a portal-like absolutely-positioned
 * div anchored below the gear button in the toolbar. The caller controls
 * open/close state.
 */
export const SettingsMenu: React.FC<SettingsMenuProps> = ({
  ctx,
  open,
  onClose,
  algorithmId,
  onChangeAlgorithm,
  variant,
  onChangeVariant,
  showLinks,
  onToggleShowLinks,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  // Read settings from the store (reactive)
  const thresholdUnits = usePijonStore((s) => s.classroom.thresholdUnits);
  const showViolations = usePijonStore((s) => s.showViolations);

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

  const radioRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '2px 0',
    cursor: 'pointer',
    userSelect: 'none',
    fontSize: '0.8rem',
    color: textDark,
  };

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

      {/* §5.B4 — Algorithm choice */}
      <div style={{ marginBottom: 4 }}>
        <div style={sectionTitle}>Algorithm</div>
        {(['greedy', 'bogo'] as const).map((id) => (
          <label key={id} style={radioRow}>
            <input
              type="radio"
              name="settings-algorithm"
              value={id}
              checked={algorithmId === id}
              onChange={() => { onChangeAlgorithm(id); }}
              data-testid={`settings-algorithm-${id}`}
            />
            {id === 'greedy' ? 'Greedy' : 'Random'}
          </label>
        ))}
      </div>

      <div style={{ borderTop: `1px solid ${dividerLight}`, margin: '4px 0' }} />

      {/* §5.B4 — Action variant */}
      <div style={{ marginBottom: 4 }}>
        <div style={sectionTitle}>Allocate action</div>
        {(['allocate', 'smart_shuffle'] as const).map((v) => (
          <label key={v} style={radioRow}>
            <input
              type="radio"
              name="settings-variant"
              value={v}
              checked={variant === v}
              onChange={() => { onChangeVariant(v); }}
              data-testid={`settings-variant-${v}`}
            />
            {v === 'allocate' ? 'Allocate (from scratch)' : 'Smart Shuffle (keep locks)'}
          </label>
        ))}
      </div>

      <div style={{ borderTop: `1px solid ${dividerLight}`, margin: '4px 0' }} />

      {/* §5.B4 — Show Links toggle (moved from RightPanel) */}
      <div style={rowStyle}>
        <span style={labelStyle}>Show Links:</span>
        <button
          type="button"
          data-testid="settings-show-links-toggle"
          onClick={onToggleShowLinks}
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
