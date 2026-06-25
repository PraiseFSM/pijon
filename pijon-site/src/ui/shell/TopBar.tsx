/**
 * TopBar — §7.A1/7.A2/7.A3 unified single top bar.
 *
 * Layout (left → right):
 *   Logo · Furniture/Students lever · [editor Toolbar] · [flex gap] · Settings gear · saved-status · Erase all
 *
 * The Furniture/Students lever (§7.A1) replaces the separate EditorSwitcher row.
 * The editor Toolbar fills the middle section (mode-specific controls).
 * The trailing group (Settings, save status, Erase all) is identical in both modes.
 *
 * §7.A3: Settings gear lives here (not inside the editor toolbar), so Settings is
 * shared across modes. The SettingsMenu is rendered by this component.
 *
 * Erase all: clicking the button shows a browser confirm dialog before wiping
 * — supports the shared-computer privacy goal (PROJECT_OUTLINE § Design Goals).
 *
 * LOCAL-FIRST: no network. Reads saveStatus from the store; triggers
 * persistence.eraseAll() (IndexedDB delete + store reset) on confirm.
 */

import { useState, useCallback } from 'react';
import { usePijonStore } from '../../state/store.js';
import type { EditorContext, EditorMode } from '../editors/EditorMode.js';
import { EDITOR_REGISTRY } from '../editors/registry.js';
import { SettingsMenu, GearButton } from './SettingsMenu.js';
import { ToggleLever } from '../components/ToggleLever.js';
import {
  toolbarBackground,
  toolbarBorder,
  panelBorder,
  logoText,
  tabActiveBackground,
  tabActiveBorder,
  tabActiveText,
  saveStatusSaved,
  saveStatusSaving,
  saveStatusDirty,
  saveStatusError,
  eraseButtonBorder,
  eraseButtonText,
} from '../../theme/colors.js';

// Inject a tiny keyframe for the "saving…" pulse — done once, idempotent
if (typeof document !== 'undefined') {
  const STYLE_ID = '__pijon-saving-pulse';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
@keyframes pijon-saving-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
.pijon-saving-pulse {
  animation: pijon-saving-pulse 1.2s ease-in-out infinite;
}
    `.trim();
    document.head.appendChild(style);
  }
}

// ---------------------------------------------------------------------------
// Save status label / colour map
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  saved: '● Saved locally',
  saving: '● Saving…',
  dirty: '● Unsaved changes',
  error: '● Save error',
};

const STATUS_COLOR: Record<string, string> = {
  saved: saveStatusSaved,
  saving: saveStatusSaving,
  dirty: saveStatusDirty,
  error: saveStatusError,
};

// ---------------------------------------------------------------------------
// TopBar
// ---------------------------------------------------------------------------

export interface TopBarProps {
  activeEditor: EditorMode;
  ctx: EditorContext;
}

export function TopBar({ activeEditor, ctx }: TopBarProps) {
  const saveStatus = usePijonStore((s) => s.saveStatus);
  const activeEditorId = usePijonStore((s) => s.activeEditorId);
  const label = STATUS_LABEL[saveStatus] ?? `● ${saveStatus}`;
  const color = STATUS_COLOR[saveStatus] ?? '#555';

  // §7.A3 — Settings menu state lives here (shared across modes)
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const handleEraseAll = () => {
    const ok = window.confirm(
      'Erase all class data from this device?\n\n' +
        'This will delete the saved classroom, roster, and seating arrangement ' +
        'from local storage. This cannot be undone.\n\n' +
        'Use "Save…" first if you want to keep a copy.',
    );
    if (!ok) return;

    if (ctx.persistence !== null) {
      void ctx.persistence.eraseAll();
    } else {
      // persistence not yet initialised — still reset the store
      ctx.store.eraseAll();
    }
  };

  return (
    <div
      data-testid="top-bar"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        borderBottom: `1px solid ${toolbarBorder}`,
        background: toolbarBackground,
        minHeight: 40,
      }}
    >
      {/* Logo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          borderRight: `1px solid ${panelBorder}`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontWeight: 700,
            fontSize: '0.9rem',
            color: logoText,
            letterSpacing: '-0.01em',
          }}
        >
          Pijon
        </span>
      </div>

      {/* §7.A1 — Furniture / Students lever (2-state toggle, not tabs) */}
      <div
        role="group"
        aria-label="Editor mode"
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          borderRight: `1px solid ${panelBorder}`,
          flexShrink: 0,
        }}
      >
        <ToggleLever
          labelOff={EDITOR_REGISTRY[0]?.label ?? 'Furniture'}
          labelOn={EDITOR_REGISTRY[1]?.label ?? 'Students'}
          on={activeEditorId === (EDITOR_REGISTRY[1]?.id ?? 'student')}
          onToggle={() => {
            const current = usePijonStore.getState().activeEditorId;
            const next =
              current === (EDITOR_REGISTRY[0]?.id ?? 'furniture')
                ? (EDITOR_REGISTRY[1]?.id ?? 'student')
                : (EDITOR_REGISTRY[0]?.id ?? 'furniture');
            usePijonStore.getState().setActiveEditorId(next);
          }}
          activeBackground={tabActiveBackground}
          activeColor={tabActiveText}
          activeBorderColor={tabActiveBorder}
          testId="editor-mode-lever"
          ariaPressed={activeEditorId === (EDITOR_REGISTRY[1]?.id ?? 'student')}
          title={
            activeEditorId === (EDITOR_REGISTRY[1]?.id ?? 'student')
              ? `Switch to ${EDITOR_REGISTRY[0]?.label ?? 'Furniture'} editor`
              : `Switch to ${EDITOR_REGISTRY[1]?.label ?? 'Students'} editor`
          }
        />
      </div>

      {/* Active editor's Toolbar — fills remaining horizontal space */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <activeEditor.Toolbar ctx={ctx} />
      </div>

      {/* Global right-side trailing group: Settings · saved-status · Erase all */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 12px',
          borderLeft: `1px solid ${panelBorder}`,
          flexShrink: 0,
          whiteSpace: 'nowrap',
          position: 'relative',
        }}
      >
        {/* §7.A3 — Settings gear (shared, always visible) */}
        <div style={{ position: 'relative' }}>
          <GearButton
            open={settingsOpen}
            onClick={() => { setSettingsOpen((prev) => !prev); }}
          />
          <SettingsMenu
            ctx={ctx}
            open={settingsOpen}
            onClose={handleCloseSettings}
          />
        </div>

        {/* "Saved locally" indicator — pulses subtly while saving */}
        <span
          className={saveStatus === 'saving' ? 'pijon-saving-pulse' : undefined}
          style={{
            fontSize: '0.78rem',
            color,
            fontWeight: 500,
          }}
          title="All data is saved only on this device — nothing is uploaded"
        >
          {label}
        </span>

        {/* Erase all — unobtrusive, clearly labelled */}
        <button
          type="button"
          onClick={handleEraseAll}
          title="Erase all class data from this device (for shared computers)"
          style={{
            padding: '2px 8px',
            fontSize: '0.72rem',
            color: eraseButtonText,
            background: 'transparent',
            border: `1px solid ${eraseButtonBorder}`,
            borderRadius: 3,
            cursor: 'pointer',
            opacity: 0.75,
          }}
        >
          Erase all
        </button>
      </div>
    </div>
  );
}
