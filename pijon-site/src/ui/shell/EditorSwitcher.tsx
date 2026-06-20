/**
 * EditorSwitcher — the segmented control / tabs that picks the active editor (Phase 9).
 *
 * Reads activeEditorId from the Zustand store and writes it back when the
 * teacher clicks a tab. The shell keeps ONE ClassroomCanvas mounted; only the
 * top bar and side panel swap. This component does not touch the canvas.
 *
 * LOCAL-FIRST: no network. Pure UI over the Zustand store.
 */

import { usePijonStore } from '../../state/store.js';
import type { EditorMode } from '../editors/EditorMode.js';
import {
  shellBackground,
  panelBorder,
  logoText,
  tabActiveBackground,
  tabActiveBorder,
  tabActiveText,
  tabInactiveBackground,
  tabInactiveBorder,
  tabInactiveText,
} from '../../theme/colors.js';

export interface EditorSwitcherProps {
  /** Ordered list of available editors from registry.ts. */
  editors: readonly EditorMode[];
}

export function EditorSwitcher({ editors }: EditorSwitcherProps) {
  const activeEditorId = usePijonStore((s) => s.activeEditorId);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '6px 10px',
        background: shellBackground,
        borderBottom: `1px solid ${panelBorder}`,
      }}
      role="tablist"
      aria-label="Editor tools"
    >
      <span
        style={{
          fontWeight: 700,
          fontSize: '0.9rem',
          color: logoText,
          marginRight: 10,
          letterSpacing: '-0.01em',
        }}
      >
        Pijon
      </span>

      {editors.map((ed) => {
        const isActive = ed.id === activeEditorId;
        return (
          <button
            key={ed.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => { usePijonStore.getState().setActiveEditorId(ed.id); }}
            style={{
              padding: '5px 16px',
              borderRadius: 5,
              border: isActive ? `2px solid ${tabActiveBorder}` : `1px solid ${tabInactiveBorder}`,
              background: isActive ? tabActiveBackground : tabInactiveBackground,
              color: isActive ? tabActiveText : tabInactiveText,
              fontWeight: isActive ? 700 : 400,
              cursor: 'pointer',
              fontSize: '0.875rem',
              transition: 'background 0.1s',
            }}
          >
            {ed.label}
          </button>
        );
      })}
    </div>
  );
}
