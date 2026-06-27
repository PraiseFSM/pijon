/**
 * SidePanel — renders the active editor's SidePanel component (Phase 9).
 *
 * The component is purely a delegation wrapper: it renders the active
 * EditorMode's SidePanel with the current EditorContext. It has no local
 * state of its own. The canvas and store are not touched here.
 *
 * §8.A2 — The wrapper enforces a single CONSTANT width (SIDE_PANEL_WIDTH)
 * across all editor modes. Inner components must NOT set their own width or
 * override the column width; they should use width:'100%' or omit width so
 * the shell wrapper is the single source of truth. This prevents the layout
 * from jumping when the user switches between Furniture and Students editors.
 *
 * §8.A1 — The wrapper also enforces height:100% with display:flex /
 * flex-direction:column so inner components can stretch to fill the full
 * column (background covers the entire left column down to the bottom).
 *
 * LOCAL-FIRST: no network.
 */

import type { EditorContext, EditorMode } from '../editors/EditorMode.js';

/**
 * §8.A2 — Constant left-panel width (pixels).
 *
 * Both FurnitureEditor (palette) and StudentEditor (roster) use this width.
 * Changing it here adjusts all editor side panels simultaneously.
 * Inner panel components must use width:'100%' (or omit width) and not
 * override this value with their own px widths.
 */
export const SIDE_PANEL_WIDTH = 220;

export interface SidePanelProps {
  activeEditor: EditorMode;
  ctx: EditorContext;
}

export function SidePanel({ activeEditor, ctx }: SidePanelProps) {
  return (
    <div
      data-testid="shell-side-panel"
      style={{
        width: SIDE_PANEL_WIDTH,
        minWidth: SIDE_PANEL_WIDTH,
        maxWidth: SIDE_PANEL_WIDTH,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <activeEditor.SidePanel ctx={ctx} />
    </div>
  );
}
