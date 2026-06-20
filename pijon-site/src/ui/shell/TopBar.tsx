/**
 * TopBar — renders the active editor's Toolbar plus the global save status
 * indicator and the "Erase all" affordance (Phase 9).
 *
 * The Toolbar component is sourced from the active EditorMode; it swaps when
 * the editor changes. The save status indicator and erase button are global
 * (always visible).
 *
 * Erase all: clicking the button shows a browser confirm dialog before wiping
 * — supports the shared-computer privacy goal (PROJECT_OUTLINE § Design Goals).
 *
 * LOCAL-FIRST: no network. Reads saveStatus from the store; triggers
 * persistence.eraseAll() (IndexedDB delete + store reset) on confirm.
 */

import { usePijonStore } from '../../state/store.js';
import type { EditorContext, EditorMode } from '../editors/EditorMode.js';
import {
  toolbarBackground,
  toolbarBorder,
  panelBorder,
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
  const label = STATUS_LABEL[saveStatus] ?? `● ${saveStatus}`;
  const color = STATUS_COLOR[saveStatus] ?? '#555';

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
      style={{
        display: 'flex',
        alignItems: 'stretch',
        borderBottom: `1px solid ${toolbarBorder}`,
        background: toolbarBackground,
      }}
    >
      {/* Active editor's Toolbar — fills remaining horizontal space */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <activeEditor.Toolbar ctx={ctx} />
      </div>

      {/* Global right-side status + erase affordance */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 12px',
          borderLeft: `1px solid ${panelBorder}`,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
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
