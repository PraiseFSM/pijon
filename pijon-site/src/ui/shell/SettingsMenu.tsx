/**
 * SettingsMenu — settings popover for the Students editor toolbar (§13.3).
 *
 * Opened by a gear (⚙) button in the toolbar; click-outside closes it
 * (uses the same capture-phase window.pointerdown pattern as the context menu
 * in §12.1 — see StudentEditor.tsx StudentSidePanelWithMenu).
 *
 * Houses:
 *   §13.4  Nearness (units) — moves here from the main toolbar.
 *           Reads/writes classroom.thresholdUnits via store.setThreshold().
 *   §13.5  Show Violations toggle — moves here from the main toolbar.
 *           Reads/writes store.showViolations via store.setShowViolations().
 *
 * Design decisions:
 *   - Nearness is stored on the Classroom (per-project): thresholdUnits is the
 *     single source of truth — changing it rebuilds the SeatGraph used by
 *     allocate, violation overlay, and neighbor preview.
 *   - showViolations is app-level UI state (not per-project): teachers expect
 *     "I always want to see violations" without it toggling per class.
 *   - Menu open/close is local React state; no store involvement.
 *
 * LOCAL-FIRST: no fetch(), no XHR, no WebSocket.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import type { EditorContext } from '../editors/EditorMode.js';
import { usePijonStore } from '../../state/store.js';

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
 * div anchored below the gear button in the toolbar. The caller controls
 * open/close state.
 */
export const SettingsMenu: React.FC<SettingsMenuProps> = ({ ctx, open, onClose }) => {
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
    color: '#333',
    flexShrink: 0,
  };

  const toggleStyle = (on: boolean): React.CSSProperties => ({
    padding: '3px 10px',
    borderRadius: 4,
    border: '1px solid',
    borderColor: on ? '#1565c0' : '#bbb',
    background: on ? '#1565c0' : '#fff',
    color: on ? '#fff' : '#333',
    cursor: 'pointer',
    fontSize: '0.8rem',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  });

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
        background: '#fff',
        border: '1px solid #ccc',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        minWidth: 240,
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
          color: '#555',
          marginBottom: 8,
          paddingBottom: 6,
          borderBottom: '1px solid #eee',
        }}
      >
        Settings
      </div>

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
            border: '1px solid #bbb',
            fontSize: '0.8rem',
            textAlign: 'right',
          }}
          title="Proximity threshold in real units (independent of grid granularity). 1.5 = orthogonal + diagonal neighbors."
        />
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1px solid #eee', margin: '4px 0' }} />

      {/* Show violations toggle */}
      <div style={rowStyle}>
        <span style={labelStyle}>Show Violations:</span>
        <button
          type="button"
          data-testid="settings-violations-toggle"
          onClick={handleToggleViolations}
          style={toggleStyle(showViolations)}
          title="Highlight desks with avoid-preference violations"
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
      borderColor: open ? '#1565c0' : '#bbb',
      background: open ? '#e3f2fd' : '#fff',
      color: open ? '#1565c0' : '#555',
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
