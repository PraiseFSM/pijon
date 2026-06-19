/**
 * hitTest.ts — pure coordinate-conversion helpers for the ClassroomCanvas.
 *
 * All functions are side-effect-free and take plain values (no DOM, no store).
 * This keeps them unit-testable in isolation (Vitest, no jsdom needed).
 *
 * Coordinate systems used in this file:
 *
 *   client   — browser viewport coordinates (MouseEvent.clientX/Y).
 *   canvas   — CSS-pixel offset from the canvas element's top-left corner.
 *   cell     — integer grid position, (0,0) = top-left, x grows right, y down.
 *   pixel    — CSS-pixel offset from the canvas element's top-left corner,
 *               used for drawing (matches canvas coordinates before DPR scaling).
 *
 * The caller (ClassroomCanvas) keeps a stable `origin` — the canvas element's
 * top-left corner in client space — so all helpers only do arithmetic.
 */

import type { Furniture } from '../../domain/furniture.js';
import { occupiedCells } from '../../domain/furniture.js';
import type { Vec2 } from '../../domain/types.js';

// ---------------------------------------------------------------------------
// Client → cell
// ---------------------------------------------------------------------------

/**
 * Convert a client-space point to a grid cell.
 *
 * @param clientX  MouseEvent.clientX (or PointerEvent.clientX, etc.)
 * @param clientY  MouseEvent.clientY
 * @param originX  canvas element's left edge in client space (from getBoundingClientRect)
 * @param originY  canvas element's top edge in client space
 * @param cellSize CSS pixels per cell
 * @param gridW    number of columns
 * @param gridH    number of rows
 * @returns        grid cell, or undefined when the point is outside the grid
 */
export function clientToCell(
  clientX: number,
  clientY: number,
  originX: number,
  originY: number,
  cellSize: number,
  gridW: number,
  gridH: number,
): Vec2 | undefined {
  const cx = clientX - originX;
  const cy = clientY - originY;
  const col = Math.floor(cx / cellSize);
  const row = Math.floor(cy / cellSize);
  if (col < 0 || row < 0 || col >= gridW || row >= gridH) return undefined;
  return { x: col, y: row };
}

// ---------------------------------------------------------------------------
// Cell → pixel rect
// ---------------------------------------------------------------------------

/**
 * Return the CSS-pixel bounding rect of a grid cell, relative to the canvas
 * element's top-left corner.
 *
 * @param cell     grid cell position
 * @param cellSize CSS pixels per cell
 * @returns        { x, y, w, h } in canvas-pixel space
 */
export function cellToPixelRect(
  cell: Vec2,
  cellSize: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: cell.x * cellSize,
    y: cell.y * cellSize,
    w: cellSize,
    h: cellSize,
  };
}

/**
 * Return the CSS-pixel bounding rect of a furniture's full bounding box,
 * relative to the canvas element's top-left corner.
 *
 * @param f        furniture record
 * @param cellSize CSS pixels per cell
 */
export function furnitureToPixelRect(
  f: Furniture,
  cellSize: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: f.pos.x * cellSize,
    y: f.pos.y * cellSize,
    w: f.w * cellSize,
    h: f.h * cellSize,
  };
}

// ---------------------------------------------------------------------------
// Cell → furniture
// ---------------------------------------------------------------------------

/**
 * Return the topmost furniture whose bounding box covers the given cell.
 *
 * "Topmost" = the last entry in the furniture list that covers the cell,
 * matching the painter's order (last-drawn = top of the visual stack).
 * Mirrors the prototype's hit-detection approach in classroom_builder.py.
 *
 * Returns undefined when no furniture covers the cell.
 *
 * @param cell      grid cell to test
 * @param furniture the classroom's furniture array (in paint order)
 */
export function furnitureAtCell(cell: Vec2, furniture: readonly Furniture[]): Furniture | undefined {
  let result: Furniture | undefined;
  for (const f of furniture) {
    const cells = occupiedCells(f);
    for (const c of cells) {
      if (c.x === cell.x && c.y === cell.y) {
        result = f; // keep iterating — last match is topmost
        break;
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Vec2 equality helper (used by callers, exported for reuse)
// ---------------------------------------------------------------------------

/** True when two cells refer to the same grid position. */
export function cellsEqual(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}
