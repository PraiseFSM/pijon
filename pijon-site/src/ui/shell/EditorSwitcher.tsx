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
        background: '#fff',
        borderBottom: '1px solid #ddd',
      }}
      role="tablist"
      aria-label="Editor tools"
    >
      <span
        style={{
          fontWeight: 700,
          fontSize: '0.9rem',
          color: '#1565c0',
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
              border: isActive ? '2px solid #1565c0' : '1px solid #ccc',
              background: isActive ? '#e3f2fd' : '#fff',
              color: isActive ? '#0d47a1' : '#444',
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
