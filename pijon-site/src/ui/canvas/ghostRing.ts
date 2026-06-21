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
 * Minimum button size
 * -------------------
 * At high granularity G the effective cell size shrinks to baseUnitPx/G, making
 * buttons as small as 3–6 px and nearly unclickable.  resizeButtonRects accepts
 * a `minButtonSize` parameter (default: MIN_BUTTON_SIZE_PX = 16).  When the cell
 * size is smaller than this minimum the button rect is clamped to minButtonSize and
 * CENTERED on the cell's center point (option (a) — visual rect = hit rect).
 * At G=1 the cell is already ≥ min so behavior is unchanged.
 *
 * LOCAL-FIRST: no network calls.
 */

import type { GridEdge } from '../../domain/classroom.js';

// ---------------------------------------------------------------------------
// Minimum button size — ensures buttons remain clickable at high granularity
// ---------------------------------------------------------------------------

/**
 * Minimum hit/render size for ghost-ring resize buttons, in canvas pixels.
 * When `cellSize` is smaller than this value the button rect is clamped to
 * this size and centered on the cell center.  At G=1 (default) cellSize is
 * always ≥ this value so the clamping never activates.
 */
export const MIN_BUTTON_SIZE_PX = 16;

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
 * Each button nominally occupies ONE full cell.  When `cellSize` is smaller
 * than `minButtonSize` (default: MIN_BUTTON_SIZE_PX = 16) the button rect is
 * clamped to `minButtonSize × minButtonSize` and **centered** on the cell's
 * center point so it remains visible and clickable at high granularity.
 * Both the visual rect and the hit-test rect use the same clamped dimensions
 * (option (a)) so callers need only one set of rects for both purposes.
 *
 * At G=1 the cell size is always ≥ minButtonSize so clamping never activates
 * and behavior is identical to previous implementations.
 *
 * Buttons are centered on the edge:
 *   - For top/bottom (horizontal) edges: centered at column floor(gridW / 2).
 *   - For left/right (vertical) edges: centered at row floor(gridH / 2).
 *
 * @param gridW          classroom column count
 * @param gridH          classroom row count
 * @param cellSize       CSS pixels per cell
 * @param originOffset   ghost-margin offset in cells (number of ghost cells on
 *                       each side); the grid content starts at
 *                       `(originOffset * cellSize, originOffset * cellSize)`.
 *                       Pass 0 for no ghost margin (buttons would be on the
 *                       canvas edge — only used in tests; in production this is
 *                       always ≥ 1 in Furniture mode).
 * @param minButtonSize  minimum rendered/hit size in pixels (default: MIN_BUTTON_SIZE_PX).
 *                       When cellSize < minButtonSize the button rect is clamped
 *                       to this size and centered on the cell center.
 */
export function resizeButtonRects(
  gridW: number,
  gridH: number,
  cellSize: number,
  originOffset: number,
  minButtonSize: number = MIN_BUTTON_SIZE_PX,
): readonly ResizeButton[] {
  const op = originOffset; // alias for clarity

  // Grid origin in canvas pixels
  const gridLeft   = op * cellSize;
  const gridTop    = op * cellSize;
  const gridRight  = gridLeft + gridW * cellSize;
  const gridBottom = gridTop  + gridH * cellSize;

  // Center column index for horizontal (top/bottom) buttons
  const hCenterCol = Math.floor(gridW / 2);
  // Center row index for vertical (left/right) buttons
  const vCenterRow = Math.floor(gridH / 2);

  // Effective button size: at least minButtonSize, at most cellSize.
  const btnSize = Math.max(cellSize, minButtonSize);

  /**
   * Build a clamped, centered button rect given the cell's top-left corner
   * (the "natural" x,y the button would occupy if it were exactly cellSize).
   * When cellSize >= minButtonSize: w=h=cellSize, x/y unchanged.
   * When cellSize <  minButtonSize: w=h=btnSize, x/y shifted to center on cell.
   */
  function makeRect(
    naturalX: number,
    naturalY: number,
    edge: GridEdge,
    sign: 1 | -1,
  ): ResizeButton {
    // Cell center in canvas pixels
    const cx = naturalX + cellSize / 2;
    const cy = naturalY + cellSize / 2;
    return {
      edge,
      sign,
      x: cx - btnSize / 2,
      y: cy - btnSize / 2,
      w: btnSize,
      h: btnSize,
    };
  }

  const buttons: ResizeButton[] = [];

  // ---- TOP edge ----------------------------------------------------------
  // PLUS: one cell ABOVE the grid (in the ghost ring)
  buttons.push(makeRect(
    gridLeft + hCenterCol * cellSize,
    gridTop - cellSize,           // one cell above the grid
    'top', 1,
  ));
  // MINUS: first row of the grid (top-center interior cell)
  buttons.push(makeRect(
    gridLeft + hCenterCol * cellSize,
    gridTop,                      // row 0 of the grid
    'top', -1,
  ));

  // ---- BOTTOM edge -------------------------------------------------------
  // PLUS: one cell BELOW the grid
  buttons.push(makeRect(
    gridLeft + hCenterCol * cellSize,
    gridBottom,                   // just below the last row
    'bottom', 1,
  ));
  // MINUS: last row of the grid (bottom-center interior cell)
  buttons.push(makeRect(
    gridLeft + hCenterCol * cellSize,
    gridBottom - cellSize,        // row gridH-1
    'bottom', -1,
  ));

  // ---- LEFT edge ---------------------------------------------------------
  // PLUS: one cell to the LEFT of the grid
  buttons.push(makeRect(
    gridLeft - cellSize,          // one cell left of the grid
    gridTop + vCenterRow * cellSize,
    'left', 1,
  ));
  // MINUS: first column of the grid (left-center interior cell)
  buttons.push(makeRect(
    gridLeft,                     // col 0 of the grid
    gridTop + vCenterRow * cellSize,
    'left', -1,
  ));

  // ---- RIGHT edge --------------------------------------------------------
  // PLUS: one cell to the RIGHT of the grid
  buttons.push(makeRect(
    gridRight,                    // just right of the last column
    gridTop + vCenterRow * cellSize,
    'right', 1,
  ));
  // MINUS: last column of the grid (right-center interior cell)
  buttons.push(makeRect(
    gridRight - cellSize,         // col gridW-1
    gridTop + vCenterRow * cellSize,
    'right', -1,
  ));

  return buttons;
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
