// @vitest-environment node
/**
 * ghostRing.ts — §14.7 pure geometry helpers for the ghost-ring resize UI.
 *
 * The ghost ring is a one-cell border drawn OUTSIDE the classroom grid in
 * Furniture editor mode.  It contains PLUS buttons for adding rows/columns.
 * A matching set of MINUS buttons sits INSIDE the grid at the edge row/column
 * that would be removed.
 *
 * All helpers in this file are:
 *   - Pure (no DOM, no React, no store).
 *   - Side-effect-free.
 *   - Unit-testable in isolation (see ghostRing.test.ts).
 *
 * Coordinate systems
 * ------------------
 * All pixel coordinates are in **canvas pixel space** (same coordinate system
 * used by `CanvasRenderingContext2D`).  When originOffset > 0 (ghost margin is
 * active), the grid itself starts at pixel `(originOffset * cellSize, originOffset * cellSize)`
 * in the canvas.  This offset is baked into the computed rects here so callers
 * can draw directly onto the canvas without further translation.
 *
 * Button definitions
 * ------------------
 * Each of the 4 edges has:
 *   - PLUS button (sign = +1): drawn OUTSIDE the grid, in the ghost ring cell
 *     centered on the edge.  Clicking adds a row/col.
 *   - MINUS button (sign = -1): drawn INSIDE the grid, in the first row/col of
 *     the respective edge.  Clicking removes that row/col.
 *
 * Button rect layout (example, top edge, 3×3 grid, cellSize=48, originOffset=1):
 *
 *   Plus  button  center: col = gridW/2 (= 1.5 → left-aligned to col 1), row = -1 (ghost cell above grid)
 *   Minus button  center: col = 1 (top-center of interior), row = 0 (top row of grid)
 *
 * For a 3×3 grid:
 *   PLUS top  → pixel rect at canvas (originOffset + floor(gridW/2)) * cellSize, (originOffset - 1) * cellSize
 *   MINUS top → pixel rect at canvas (originOffset + floor(gridW/2)) * cellSize, (originOffset + 0) * cellSize
 *
 * Button size (5.A4)
 * ------------------
 * Each button is exactly ONE UNIT square: `cellSize * cellsPerUnit`. Since
 * effectiveCellSize = baseUnitPx / cellsPerUnit, this equals baseUnitPx — a
 * constant physical size regardless of granularity, just like furniture keeps
 * its real size as the grid densifies. Buttons sit flush to the grid boundary
 * (PLUS outside in the one-unit ghost ring, MINUS just inside the edge).
 *
 * LOCAL-FIRST: no network calls.
 */

import type { GridEdge } from '../../domain/classroom.js';

// ---------------------------------------------------------------------------
// ResizeButton — the output type of resizeButtonRects
// ---------------------------------------------------------------------------

/**
 * A single resize button's pixel bounding rect and semantics.
 *
 * `edge`   — which edge this button controls.
 * `sign`   — +1 = add a row/col (PLUS button, outside grid);
 *            -1 = remove a row/col (MINUS button, inside grid).
 * `x/y/w/h` — pixel bounding rect in canvas space (ready for drawing).
 */
export interface ResizeButton {
  readonly edge: GridEdge;
  readonly sign: 1 | -1;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// ---------------------------------------------------------------------------
// resizeButtonRects — the pure math helper
// ---------------------------------------------------------------------------

/**
 * Compute the 8 resize button pixel rects for a given grid and cell size.
 *
 * Returns one PLUS + one MINUS button for each of the 4 edges (8 total).
 *
 * Each button is ONE UNIT square (`cellSize * cellsPerUnit` = baseUnitPx), a
 * constant physical size across granularity (5.A4). Buttons are centered on the
 * midpoint of their edge and flush to the grid boundary: PLUS entirely outside
 * the grid (in the one-unit ghost ring), MINUS entirely inside the edge. The
 * same rect is used for drawing and hit-testing.
 *
 * @param gridW          classroom column count
 * @param gridH          classroom row count
 * @param cellSize       effective (fine) pixels per cell
 * @param originOffset   ghost-margin offset in cells (the grid content starts at
 *                       `(originOffset * cellSize, originOffset * cellSize)`).
 *                       In Furniture mode this is one unit (= cellsPerUnit cells)
 *                       so the ring contains a one-unit PLUS button. Pass 0 for
 *                       no ghost margin (tests only).
 * @param cellsPerUnit   grid granularity G (default 1); button size = cellSize × G.
 */
export function resizeButtonRects(
  gridW: number,
  gridH: number,
  cellSize: number,
  originOffset: number,
  cellsPerUnit = 1,
): readonly ResizeButton[] {
  const op = originOffset; // alias for clarity

  // Grid origin in canvas pixels
  const gridLeft   = op * cellSize;
  const gridTop    = op * cellSize;
  const gridRight  = gridLeft + gridW * cellSize;
  const gridBottom = gridTop  + gridH * cellSize;

  // 5.A4 — a button is exactly ONE UNIT square (cellSize × cellsPerUnit). Because
  // effectiveCellSize = baseUnitPx / cellsPerUnit, this equals baseUnitPx — a
  // constant physical size across granularity, just like furniture. Buttons sit
  // FLUSH to the grid boundary, centered on the edge: PLUS entirely OUTSIDE (in
  // the one-unit ghost ring), MINUS entirely INSIDE the edge.
  const btn = cellSize * cellsPerUnit;

  // Edge midpoints (center of the grid span on each axis), in canvas pixels.
  const midX = gridLeft + (gridW * cellSize) / 2;
  const midY = gridTop  + (gridH * cellSize) / 2;
  const hx = midX - btn / 2; // left of a top/bottom button
  const vy = midY - btn / 2; // top of a left/right button

  function rect(x: number, y: number, edge: GridEdge, sign: 1 | -1): ResizeButton {
    return { edge, sign, x, y, w: btn, h: btn };
  }

  return [
    // TOP — PLUS just above the grid (inner edge flush to gridTop); MINUS just inside
    rect(hx, gridTop - btn, 'top', 1),
    rect(hx, gridTop, 'top', -1),
    // BOTTOM — PLUS just below the grid; MINUS just inside the bottom edge
    rect(hx, gridBottom, 'bottom', 1),
    rect(hx, gridBottom - btn, 'bottom', -1),
    // LEFT — PLUS just left of the grid; MINUS just inside the left edge
    rect(gridLeft - btn, vy, 'left', 1),
    rect(gridLeft, vy, 'left', -1),
    // RIGHT — PLUS just right of the grid; MINUS just inside the right edge
    rect(gridRight, vy, 'right', 1),
    rect(gridRight - btn, vy, 'right', -1),
  ];
}

// ---------------------------------------------------------------------------
// hitButton — check if a canvas-pixel point is inside any resize button
// ---------------------------------------------------------------------------

/**
 * Return the first `ResizeButton` whose pixel rect contains the given
 * canvas-pixel point `(px, py)`, or `undefined` if no button was hit.
 *
 * Used by FurnitureEditor.onPointerDown before normal place/select handling.
 *
 * @param px         canvas-pixel X of the pointer (NOT client X)
 * @param py         canvas-pixel Y of the pointer
 * @param buttons    array returned by resizeButtonRects
 */
export function hitButton(
  px: number,
  py: number,
  buttons: readonly ResizeButton[],
): ResizeButton | undefined {
  for (const btn of buttons) {
    if (px >= btn.x && px < btn.x + btn.w && py >= btn.y && py < btn.y + btn.h) {
      return btn;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// ghostRingCells — all OUTSIDE cells that form the ghost ring border
// ---------------------------------------------------------------------------

/**
 * Return an array of `{ col, row }` pairs for every ghost-ring cell:
 * the one-cell-wide border that surrounds the grid, drawn in the canvas
 * area between the grid and the canvas edge.
 *
 * col, row are in **canvas cell space** (i.e. include originOffset).
 * col 0 is the leftmost ghost cell; col `originOffset` is the first real
 * grid cell.
 *
 * Used by paintOverlay to draw the ghost-ring fill squares.
 *
 * @param gridW        classroom column count
 * @param gridH        classroom row count
 * @param originOffset ghost-margin cell count (typically 1 in Furniture mode)
 */
export function ghostRingCells(
  gridW: number,
  gridH: number,
  originOffset: number,
): readonly { col: number; row: number }[] {
  const cells: { col: number; row: number }[] = [];
  if (originOffset <= 0) return cells;

  // Ghost margin is one cell wide (originOffset = 1, so one ring around the grid)
  const o = originOffset; // 1

  // Total canvas width in cells = gridW + 2*o
  const totalW = gridW + 2 * o;
  const totalH = gridH + 2 * o;

  // Top ghost row(s)
  for (let c = 0; c < totalW; c++) {
    for (let r = 0; r < o; r++) {
      cells.push({ col: c, row: r });
    }
  }
  // Bottom ghost row(s)
  for (let c = 0; c < totalW; c++) {
    for (let r = o + gridH; r < totalH; r++) {
      cells.push({ col: c, row: r });
    }
  }
  // Left ghost column(s) — exclude corners (already covered above)
  for (let c = 0; c < o; c++) {
    for (let r = o; r < o + gridH; r++) {
      cells.push({ col: c, row: r });
    }
  }
  // Right ghost column(s) — exclude corners
  for (let c = o + gridW; c < totalW; c++) {
    for (let r = o; r < o + gridH; r++) {
      cells.push({ col: c, row: r });
    }
  }

  return cells;
}
