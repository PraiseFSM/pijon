/**
 * SidePanel — renders the active editor's SidePanel component (Phase 9).
 *
 * The component is purely a delegation wrapper: it renders the active
 * EditorMode's SidePanel with the current EditorContext. It has no local
 * state of its own. The canvas and store are not touched here.
 *
 * The panel has a fixed width that accommodates both FurnitureEditor (160px)
 * and StudentEditor (170px) sidepanels. The inner component controls its own
 * width / styling; this wrapper only enforces height = 100%.
 *
 * LOCAL-FIRST: no network.
 */

import type { EditorContext, EditorMode } from '../editors/EditorMode.js';

export interface SidePanelProps {
  activeEditor: EditorMode;
  ctx: EditorContext;
}

export function SidePanel({ activeEditor, ctx }: SidePanelProps) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <activeEditor.SidePanel ctx={ctx} />
    </div>
  );
}
