/**
 * ClassroomCanvas — the one shared classroom grid (Phase 6).
 *
 * Owns the <canvas> element. On every render/store-change frame:
 *   1. Runs renderBasePass() (grid lines + furniture + occupant names).
 *   2. Calls the active editor's paintOverlay() for mode-specific decorations.
 *
 * Forwards pointer / keyboard / drop / contextmenu DOM events to the active
 * editor's hooks with a constructed EditorContext + CanvasView. The shell
 * (Phase 9) supplies the active editor as a prop; if none is given, the
 * NoopEditor is used so the canvas works standalone.
 *
 * devicePixelRatio handling: the canvas backing store is sized at
 *   cssW * dpr  ×  cssH * dpr
 * and the context is scaled by dpr once so all drawing code works in CSS pixels.
 *
 * LOCAL-FIRST: no network calls. All data from the Zustand store.
 */

import { useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { usePijonStore } from '../../state/store.js';
import { renderBasePass } from './render.js';
import { registerRepaintCallback, primeImage } from './imageCache.js';
import { furnitureAssetUrl } from '../../assets/paths.js';
import { ASSET } from '../../assets/paths.js';
import { clientToCell, furnitureAtCell, cellToPixelRect } from './hitTest.js';
import type { EditorContext, EditorMode, CanvasView } from '../editors/EditorMode.js';
import { NoopEditor } from '../editors/NoopEditor.js';
import type { Vec2 } from '../../domain/types.js';
import type { Furniture } from '../../domain/furniture.js';
import { effectiveCellSize } from './cellSizeHelper.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ClassroomCanvasProps {
  /**
   * The active editor tool. Defaults to NoopEditor when not provided.
   * The shell (Phase 9) will pass the currently selected EditorMode here.
   */
  editor?: EditorMode;

  /**
   * CSS pixels per grid cell. Defaults to 48.
   * Future zoom support: pass a different value or allow it to come from
   * a zoom control in the toolbar.
   */
  cellSize?: number;

  /**
   * §14.7 — Ghost-margin cell count on each side of the grid.
   * When non-zero (Furniture editor active), the canvas is expanded by
   * `ghostMargin` cells on all four sides so PLUS resize buttons can be
   * drawn outside the grid boundary.  The grid itself is drawn at pixel
   * offset `(ghostMargin * cellSize, ghostMargin * cellSize)`.
   *
   * Defaults to 0 (StudentEditor and all other modes — no extra space).
   */
  ghostMargin?: number;

  /**
   * Phase 9 — called once the canvas is mounted and a CanvasView is available.
   * The shell uses this to obtain a CanvasView to build EditorContext for
   * Toolbar / SidePanel components (they need canvas.requestRepaint etc.).
   *
   * Surgical addition: a stable callback ref so the shell can hold the latest
   * CanvasView without causing re-renders.
   */
  onViewReady?: (view: CanvasView) => void;
}

// ---------------------------------------------------------------------------
// ClassroomCanvas
// ---------------------------------------------------------------------------

export function ClassroomCanvas({ editor, cellSize = 48, ghostMargin = 0, onViewReady }: ClassroomCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // RAF handle stored in a ref (not state) so scheduling never triggers re-renders.
  const rafRef = useRef<number | null>(null);

  // Subscribe to the parts of store state the canvas needs to render.
  const classroom = usePijonStore((s) => s.classroom);
  const locks = usePijonStore((s) => s.locks);

  const activeEditor = editor ?? NoopEditor;

  // §14.6 — Derive effective cell size from base unit and granularity.
  // cellSize prop is the base unit in CSS pixels (one physical "unit").
  // ecs is the CSS pixels per fine grid cell: baseUnitPx / cellsPerUnit.
  // At G=1: ecs = cellSize (identical to today's behaviour).
  // At G=2: ecs = cellSize/2, so 2 fine cells × ecs = cellSize (board size constant).
  const ecs = effectiveCellSize(cellSize, classroom.cellsPerUnit);

  // ---------------------------------------------------------------------------
  // Stable refs — synced in useLayoutEffect so they're never mutated during
  // render.  Accessing .current inside rAF callbacks and event handlers is
  // always safe because useLayoutEffect runs synchronously after every commit,
  // before the browser paints, so the rAF body always reads committed values.
  // ---------------------------------------------------------------------------

  const editorRef = useRef<EditorMode>(activeEditor);
  const classroomRef = useRef(classroom);
  const locksRef = useRef(locks);
  // cellSizeRef now stores the effectiveCellSize (ecs) so all rAF/event-handler
  // consumers get the already-derived per-cell pixel size.
  const cellSizeRef = useRef(ecs);
  const ghostMarginRef = useRef(ghostMargin);

  useLayoutEffect(() => {
    editorRef.current = activeEditor;
    classroomRef.current = classroom;
    locksRef.current = locks;
    cellSizeRef.current = ecs;
    ghostMarginRef.current = ghostMargin;
  });

  // -------------------------------------------------------------------------
  // scheduleRepaint
  //
  // We store the scheduler in a ref so it can be passed to buildCanvasView
  // (which itself is called inside the rAF body) without a circular useCallback
  // dependency.  The ref is populated once in useEffect below.
  // -------------------------------------------------------------------------

  const scheduleRepaintRef = useRef<() => void>(() => undefined);

  // The actual scheduler function is stable across renders (no deps change it).
  // We define it with useCallback so it is only created once, then write it into
  // the ref so buildCanvasView can always read the current version.
  const scheduleRepaint = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      if (canvas === null) return;

      const ctx = canvas.getContext('2d');
      if (ctx === null) return;

      const cs = cellSizeRef.current;
      const cl = classroomRef.current;
      const lk = locksRef.current;
      const gm = ghostMarginRef.current;

      // Base render pass (grid + furniture + occupant names)
      // §14.5: pass classroom.gridColor (null = use theme default)
      // §14.7: pass originOffset so base pass draws grid at the right position
      renderBasePass(ctx, cl, cs, lk, cl.gridColor ?? undefined, gm);

      // Editor overlay — uses the ref so we always call the current editor's method
      const view = buildCanvasView(
        canvas,
        cs,
        cl.gridW,
        cl.gridH,
        cl.furniture,
        scheduleRepaintRef,
        gm,
      );
      editorRef.current.paintOverlay(ctx, view);
    });
  }, []); // stable; refs supply current values

  // Populate the ref once (and whenever scheduleRepaint identity changes, though it won't).
  useLayoutEffect(() => {
    scheduleRepaintRef.current = scheduleRepaint;
  }, [scheduleRepaint]);

  // Phase 9 — keep onViewReady callback in a ref so it is never a useEffect dep.
  const onViewReadyRef = useRef(onViewReady);
  useLayoutEffect(() => {
    onViewReadyRef.current = onViewReady;
  });

  // Notify the shell once the canvas is mounted so it can build an EditorContext.
  // We call this after the first resize, so the CanvasView geometry is valid.
  // The callback is also re-invoked whenever classroom dims, ecs, or ghostMargin change (new CanvasView).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const cl = classroomRef.current;
    const cs = cellSizeRef.current;
    const gm = ghostMarginRef.current;
    const view = buildCanvasView(canvas, cs, cl.gridW, cl.gridH, cl.furniture, scheduleRepaintRef, gm);
    onViewReadyRef.current?.(view);
  }, [classroom.gridW, classroom.gridH, ecs, ghostMargin]);

  // -------------------------------------------------------------------------
  // DPR-aware canvas resize
  // -------------------------------------------------------------------------

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const cl = classroomRef.current;
    const cs = cellSizeRef.current;
    const gm = ghostMarginRef.current;
    const dpr = window.devicePixelRatio || 1;

    // §14.7: when ghostMargin > 0 the canvas is wider/taller by 2*ghostMargin
    // cells on each axis (one cell on each side).
    const cssW = (cl.gridW + 2 * gm) * cs;
    const cssH = (cl.gridH + 2 * gm) * cs;

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW.toString()}px`;
    canvas.style.height = `${cssH.toString()}px`;

    const ctx = canvas.getContext('2d');
    if (ctx !== null) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    scheduleRepaint();
  }, [scheduleRepaint]);

  // Resize whenever grid dims, ecs (effective cell size), or ghostMargin change
  useEffect(() => {
    resizeCanvas();
  }, [resizeCanvas, classroom.gridW, classroom.gridH, ecs, ghostMargin]);

  // Repaint whenever classroom contents or locks change (grid dims handled above)
  useEffect(() => {
    scheduleRepaint();
  }, [scheduleRepaint, classroom, locks]);

  // Cancel any pending rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  // -------------------------------------------------------------------------
  // §14.3 — Image cache: prime furniture assets on mount and register a
  // repaint callback so the canvas redraws once images finish loading.
  // The color fallback is shown on the first paint; images replace it seamlessly.
  // -------------------------------------------------------------------------

  useEffect(() => {
    // Prime all known furniture kind images so they start loading immediately
    const kinds = ['single_desk', 'table', 'teacher_desk', 'whiteboard'] as const;
    for (const kind of kinds) {
      const url = furnitureAssetUrl(kind);
      if (url !== undefined) primeImage(url);
    }
    // Also prime the background asset (may be used if teacher enables it later)
    primeImage(ASSET.background);

    // Register the canvas scheduleRepaint so the canvas redraws when images load
    const unregister = registerRepaintCallback(scheduleRepaint);
    return unregister;
  }, [scheduleRepaint]);

  // -------------------------------------------------------------------------
  // Editor lifecycle: deactivate old, activate new when the active editor changes
  // -------------------------------------------------------------------------

  const prevEditorObjRef = useRef<EditorMode>(activeEditor);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const prev = prevEditorObjRef.current;

    if (prev.id !== activeEditor.id) {
      const cl = classroomRef.current;
      const cs = cellSizeRef.current;
      const gm = ghostMarginRef.current;

      const deactivateView = buildCanvasView(
        canvas, cs, cl.gridW, cl.gridH, cl.furniture, scheduleRepaintRef, gm,
      );
      prev.deactivate({ store: usePijonStore.getState(), canvas: deactivateView, persistence: null });

      const activateView = buildCanvasView(
        canvas, cs, cl.gridW, cl.gridH, cl.furniture, scheduleRepaintRef, gm,
      );
      activeEditor.activate({ store: usePijonStore.getState(), canvas: activateView, persistence: null });
    }

    prevEditorObjRef.current = activeEditor;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEditor.id]); // react only to id changes — object identity may differ

  // -------------------------------------------------------------------------
  // buildEventCtx — called inside every event handler
  // -------------------------------------------------------------------------

  const buildEventCtx = useCallback((): EditorContext | null => {
    const canvas = canvasRef.current;
    if (canvas === null) return null;
    const cl = classroomRef.current;
    const cs = cellSizeRef.current;
    const gm = ghostMarginRef.current;
    const view = buildCanvasView(canvas, cs, cl.gridW, cl.gridH, cl.furniture, scheduleRepaintRef, gm);
    return { store: usePijonStore.getState(), canvas: view, persistence: null };
  }, []); // stable; reads from refs

  // -------------------------------------------------------------------------
  // DOM event handlers — forward to active editor
  // -------------------------------------------------------------------------

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = buildEventCtx();
    if (ctx === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    editorRef.current.onPointerDown(e.nativeEvent, ctx);
  }, [buildEventCtx]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = buildEventCtx();
    if (ctx === null) return;
    editorRef.current.onPointerMove(e.nativeEvent, ctx);
  }, [buildEventCtx]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = buildEventCtx();
    if (ctx === null) return;
    editorRef.current.onPointerUp(e.nativeEvent, ctx);
  }, [buildEventCtx]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const ctx = buildEventCtx();
    if (ctx === null) return;
    editorRef.current.onKeyDown(e.nativeEvent, ctx);
  }, [buildEventCtx]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLCanvasElement>) => {
    const ctx = buildEventCtx();
    if (ctx === null) return;
    editorRef.current.onDrop(e.nativeEvent, ctx);
  }, [buildEventCtx]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault(); // allow drop
    const ctx = buildEventCtx();
    if (ctx === null) return;
    editorRef.current.onDragOver?.(e.nativeEvent, ctx);
  }, [buildEventCtx]);

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLCanvasElement>) => {
    const ctx = buildEventCtx();
    if (ctx === null) return;
    editorRef.current.onDragEnd?.(e.nativeEvent, ctx);
  }, [buildEventCtx]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const ctx = buildEventCtx();
    if (ctx === null) return;
    e.preventDefault();
    editorRef.current.onContextMenu(e.nativeEvent, ctx);
  }, [buildEventCtx]);

  // -------------------------------------------------------------------------
  // Render — initial width/height attrs; resizeCanvas overwrites with DPR values
  // -------------------------------------------------------------------------

  // §14.7: account for ghost margin when computing initial canvas dimensions.
  // Use ecs (effective cell size) so the board pixel size is constant across granularity.
  const cssW = (classroom.gridW + 2 * ghostMargin) * ecs;
  const cssH = (classroom.gridH + 2 * ghostMargin) * ecs;

  const canvasStyle = useMemo<React.CSSProperties>(
    () => ({ display: 'block', cursor: 'crosshair', outline: 'none' }),
    [],
  );

  return (
    <canvas
      ref={canvasRef}
      width={cssW}
      height={cssH}
      style={canvasStyle}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onContextMenu={handleContextMenu}
      aria-label="Classroom grid"
      role="img"
    />
  );
}

// ---------------------------------------------------------------------------
// buildCanvasView
// ---------------------------------------------------------------------------

/**
 * Build a CanvasView for a given canvas + geometry snapshot.
 * The repaintRef indirection breaks the circular dependency between
 * scheduleRepaint (useCallback) and buildCanvasView (plain function).
 *
 * §14.7: `originOffset` cells shifts the grid within the canvas (for the
 * ghost-margin in Furniture mode).  cellAt() subtracts the pixel offset so
 * coordinates map to logical grid cells (0…gridW-1 / 0…gridH-1) as always.
 * cellRect() adds the offset back so drawing code produces canvas-pixel coords.
 */
function buildCanvasView(
  canvas: HTMLCanvasElement,
  cellSize: number,
  gridW: number,
  gridH: number,
  furniture: readonly Furniture[],
  repaintRef: React.MutableRefObject<() => void>,
  originOffset = 0,
): CanvasView {
  // Cache the bounding rect for one event cycle to avoid repeated layout reads.
  let cachedRect: DOMRect | null = null;
  const getRect = (): DOMRect => {
    cachedRect ??= canvas.getBoundingClientRect();
    return cachedRect;
  };

  // Pixel offset from canvas top-left to grid top-left (accounts for ghost margin)
  const originPx = originOffset * cellSize;

  return {
    cellSize,
    gridW,
    gridH,
    originOffset,

    cellAt(clientX: number, clientY: number): Vec2 | undefined {
      const r = getRect();
      // Subtract the ghost-margin pixel offset so the coord maps to grid-cell space
      return clientToCell(
        clientX,
        clientY,
        r.left + originPx,
        r.top + originPx,
        cellSize,
        gridW,
        gridH,
      );
    },

    furnitureAt(cell: Vec2): Furniture | undefined {
      return furnitureAtCell(cell, furniture);
    },

    cellRect(cell: Vec2): { x: number; y: number; w: number; h: number } {
      // Add the ghost-margin offset so the returned pixel rect is in canvas space
      const base = cellToPixelRect(cell, cellSize);
      return { x: base.x + originPx, y: base.y + originPx, w: base.w, h: base.h };
    },

    requestRepaint(): void {
      repaintRef.current();
    },
  };
}
