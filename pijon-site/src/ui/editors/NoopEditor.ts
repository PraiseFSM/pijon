/**
 * NoopEditor — a do-nothing EditorMode used as the default when no tool is
 * active, and for testing ClassroomCanvas in isolation (Phase 6).
 *
 * All event hooks are no-ops. paintOverlay draws nothing.
 * The Toolbar and SidePanel render nothing (null components).
 *
 * Phases 7, 8, 10 replace this with real editor instances.
 */

import React from 'react';
import type { EditorContext, EditorMode, CanvasView } from './EditorMode.js';

// Empty React component — renders nothing.
// The `ctx` prop is part of the EditorMode contract but unused in the no-op.
const EmptyComponent: React.FC<{ ctx: EditorContext }> = () => null;

// No-op for lifecycle methods (no args used).
function noopLifecycle(): void {
  // intentional no-op
}

// No-op for pointer/keyboard/drop/context events (two args, both unused).
function noopEvent(): void {
  // intentional no-op
}

// No-op overlay — signature satisfies EditorMode.paintOverlay; no drawing needed.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function noopOverlay(_ctx2d: CanvasRenderingContext2D, _view: CanvasView): void {
  // intentional no-op
}

export const NoopEditor: EditorMode = {
  id: 'noop',
  label: 'None',

  Toolbar: EmptyComponent,
  SidePanel: EmptyComponent,

  activate: noopLifecycle,
  deactivate: noopLifecycle,

  onPointerDown: noopEvent,
  onPointerMove: noopEvent,
  onPointerUp: noopEvent,
  onKeyDown: noopEvent,
  onDrop: noopEvent,
  onContextMenu: noopEvent,

  paintOverlay: noopOverlay,
};
