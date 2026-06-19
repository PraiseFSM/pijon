/**
 * EditorMode — the Editor template (Phase 6).
 *
 * An EditorMode is a pluggable "tool" the teacher uses to interact with the
 * shared ClassroomCanvas. Three concrete editors are planned (Furniture,
 * Student, Preference); this interface is the contract they all fulfill.
 *
 * Design rule: the canvas renders only one base pass (grid + furniture +
 * occupant names). Everything mode-specific is drawn via paintOverlay() and
 * handled through the event hooks. Switching modes calls deactivate/activate
 * so no transient drag/preview state leaks between tools.
 *
 * LOCAL-FIRST: no network in any implementation — that is enforced at the
 * ESLint level, but note it here for clarity.
 */

import type React from 'react';
import type { Furniture } from '../../domain/furniture.js';
import type { Vec2 } from '../../domain/types.js';
import type { Store } from '../../state/store.js';
import type { PersistenceHandle } from '../../state/persistence.js';

// ---------------------------------------------------------------------------
// CanvasView — geometry + coordinate helpers exposed to editors
// ---------------------------------------------------------------------------

/**
 * A snapshot of the canvas geometry at render time.
 * Passed to every editor hook so implementations never need to reach into the
 * DOM or store for grid measurements.
 */
export interface CanvasView {
  /** Width of one grid cell in CSS pixels. */
  readonly cellSize: number;

  /** Number of grid columns (from classroom.gridW). */
  readonly gridW: number;

  /** Number of grid rows (from classroom.gridH). */
  readonly gridH: number;

  /**
   * Convert a client-space point (e.g. MouseEvent.clientX/Y after
   * getBoundingClientRect) to a grid cell (floored, clamped to grid bounds).
   * Returns undefined when the point is outside the grid.
   */
  cellAt(clientX: number, clientY: number): Vec2 | undefined;

  /**
   * Return the first Furniture whose occupiedCells contains the given cell,
   * checking the list from last to first so the topmost (later-painted)
   * furniture wins on overlap.
   * Returns undefined when no furniture covers the cell.
   */
  furnitureAt(cell: Vec2): Furniture | undefined;

  /**
   * Return the CSS-pixel bounding rect of a grid cell (top-left origin,
   * relative to the canvas element's top-left corner).
   */
  cellRect(cell: Vec2): { x: number; y: number; w: number; h: number };

  /**
   * Signal ClassroomCanvas that a repaint is needed (e.g. after updating
   * editor-local drag state that isn't tracked in the Zustand store).
   * No-op if a paint is already queued.
   */
  requestRepaint(): void;
}

// ---------------------------------------------------------------------------
// EditorContext — everything an editor needs during an event
// ---------------------------------------------------------------------------

/**
 * Passed to every editor lifecycle/event method.
 * Editors read classroom state through store.getState() and dispatch mutations
 * through the store actions. They never call setState directly.
 *
 * Surgical Phase 9 addition: `persistence` gives editor Toolbars access to
 * saveToFile / openFromFile / resaveToHandle so their Save/Load buttons work.
 * Null until the shell initialises persistence on mount.
 */
export interface EditorContext {
  /** Full Zustand store — access state and dispatch actions. */
  store: Store;

  /** Current canvas geometry and coordinate helpers. */
  canvas: CanvasView;

  /**
   * Persistence handle — wired by App shell on mount.
   * Editors must guard against null (initPersistence is async).
   */
  persistence: PersistenceHandle | null;
}

// ---------------------------------------------------------------------------
// EditorMode — the interface every editor tool implements
// ---------------------------------------------------------------------------

/**
 * EditorMode is the single contract for all editor tools.
 *
 * Implementation guide (Phases 7, 8, 10):
 *  - Keep the EditorMode object plain (not a class) — a literal object or a
 *    factory function works best. React components live inside it but the mode
 *    itself does not extend any React class.
 *  - Transient drag/preview state belongs in module-level refs or React state
 *    inside the component — NOT in the store.
 *  - deactivate() MUST clear any transient state (in-progress drag, marker,
 *    ghost preview) so switching tools never leaves an artifact behind.
 *  - paintOverlay is called on every animation frame after the base pass.
 *    Keep it fast — only draw delta state (highlight, ghost, marker lines).
 *    Do NOT clear the canvas inside paintOverlay.
 *
 * For Phase 7 (FurnitureEditor):
 *  - Track drag target in a module ref; clear in deactivate.
 *  - Highlight hovered cell in paintOverlay.
 *  - SidePanel renders the furniture palette.
 *
 * For Phase 8 (StudentEditor):
 *  - Track drag source furniture in a module ref.
 *  - paintOverlay draws a drag ghost and neighbor highlight.
 *  - onPointerUp commits manualReassign via ctx.store.
 *
 * For Phase 10 (PreferenceEditor):
 *  - Track first-click occupant; second click completes a preference pair.
 *  - paintOverlay draws connecting lines between paired occupants.
 */
export interface EditorMode {
  /** Stable identifier — used by EditorSwitcher and the store (activeEditorId). */
  readonly id: string;

  /** Human-readable label shown in the EditorSwitcher tab. */
  readonly label: string;

  /**
   * React component rendered into the TopBar when this editor is active.
   * Receives the current EditorContext so it can dispatch store actions.
   */
  readonly Toolbar: React.FC<{ ctx: EditorContext }>;

  /**
   * React component rendered into the SidePanel when this editor is active.
   * Receives the current EditorContext.
   */
  readonly SidePanel: React.FC<{ ctx: EditorContext }>;

  /**
   * Called once when this editor becomes the active tool.
   * Use to reset internal state, start animations, etc.
   */
  activate(ctx: EditorContext): void;

  /**
   * Called when this editor is being replaced by another tool (or on unmount).
   * MUST cancel any in-progress drag/marker/preview so switching tools is safe.
   */
  deactivate(ctx: EditorContext): void;

  // -- Pointer events --
  // All receive the raw DOM event plus the current EditorContext.
  // Editors may call ctx.canvas.cellAt(e.clientX, e.clientY) to hit-test cells
  // and ctx.store.moveFurniture() / manualReassign() etc. to mutate state.

  onPointerDown(e: PointerEvent, ctx: EditorContext): void;
  onPointerMove(e: PointerEvent, ctx: EditorContext): void;
  onPointerUp(e: PointerEvent, ctx: EditorContext): void;

  /** Keyboard input forwarded from the canvas element (must be focused). */
  onKeyDown(e: KeyboardEvent, ctx: EditorContext): void;

  /**
   * Drop event for drag-and-drop from outside (e.g. roster panel dragging a
   * student name onto a desk). Call e.preventDefault() to accept.
   */
  onDrop(e: DragEvent, ctx: EditorContext): void;

  /** Right-click / long-press context menu on the canvas. */
  onContextMenu(e: MouseEvent, ctx: EditorContext): void;

  /**
   * Draw mode-specific decorations over the base render pass.
   * ctx2d is the canvas 2D context (already scaled for devicePixelRatio).
   * view is the current CanvasView (same object passed to event hooks).
   *
   * Rules:
   *  - Do NOT clear the canvas.
   *  - Do NOT call ctx2d.save()/restore() across frames.
   *  - MUST save/restore your own transform/fill/stroke state.
   *  - Called synchronously inside requestAnimationFrame.
   */
  paintOverlay(ctx2d: CanvasRenderingContext2D, view: CanvasView): void;
}
