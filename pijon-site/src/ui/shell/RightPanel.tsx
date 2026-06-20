/**
 * RightPanel — renders the active editor's optional RightPanel component (§12.4).
 *
 * Mirrors the left SidePanel delegation pattern. When the active editor has no
 * RightPanel (e.g. FurnitureEditor), this component renders nothing (null) and
 * takes up no space — callers should guard on `activeEditor.RightPanel` before
 * mounting this component, or simply let it render null.
 *
 * LOCAL-FIRST: no network.
 */

import type { EditorContext, EditorMode } from '../editors/EditorMode.js';

export interface RightPanelProps {
  activeEditor: EditorMode;
  ctx: EditorContext;
}

export function RightPanel({ activeEditor, ctx }: RightPanelProps) {
  if (activeEditor.RightPanel === undefined) return null;

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <activeEditor.RightPanel ctx={ctx} />
    </div>
  );
}
