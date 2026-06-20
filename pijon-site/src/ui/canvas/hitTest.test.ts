// @vitest-environment node
/**
 * Tests for src/ui/canvas/hitTest.ts
 *
 * Pure geometry — no DOM, no network, no React.
 */

import { describe, it, expect } from 'vitest';
import {
  clientToCell,
  cellToPixelRect,
  furnitureToPixelRect,
  furnitureAtCell,
  cellsEqual,
} from './hitTest.js';
import type { Furniture } from '../../domain/furniture.js';
import { furnitureId } from '../../domain/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDesk(id: string, x: number, y: number, w = 1, h = 1): Furniture {
  return {
    id: furnitureId(id),
    kind: 'single_desk',
    pos: { x, y },
    w,
    h,
    rotation: 0,
    occupants: [],
  };
}

function makeTable(id: string, x: number, y: number, w: number, h: number): Furniture {
  return {
    id: furnitureId(id),
    kind: 'table',
    pos: { x, y },
    w,
    h,
    rotation: 0,
    occupants: [],
    numSeats: 4,
  };
}

// ---------------------------------------------------------------------------
// clientToCell
// ---------------------------------------------------------------------------

describe('clientToCell', () => {
  // Grid: 10×8, cellSize=40, origin at (100, 200)
  const originX = 100;
  const originY = 200;
  const cellSize = 40;
  const gridW = 10;
  const gridH = 8;

  it('converts an in-bounds client point to the correct cell', () => {
    // Click at client (140, 240) → canvas (40, 40) → cell (1, 1)
    const cell = clientToCell(140, 240, originX, originY, cellSize, gridW, gridH);
    expect(cell).toEqual({ x: 1, y: 1 });
  });

  it('top-left corner of the grid → cell (0, 0)', () => {
    // Exactly at origin
    const cell = clientToCell(100, 200, originX, originY, cellSize, gridW, gridH);
    expect(cell).toEqual({ x: 0, y: 0 });
  });

  it('floors fractional positions correctly', () => {
    // Canvas position (1.5, 1.5) → floor → cell (0, 0)
    const cell = clientToCell(101.5, 201.5, originX, originY, cellSize, gridW, gridH);
    expect(cell).toEqual({ x: 0, y: 0 });
  });

  it('point just inside the right edge of cell (0,0) still maps to (0,0)', () => {
    // Canvas (39.99, 0) → floor → col=0
    const cell = clientToCell(100 + 39.99, 200, originX, originY, cellSize, gridW, gridH);
    expect(cell).toEqual({ x: 0, y: 0 });
  });

  it('point exactly on the vertical grid-line between col 0 and col 1 → cell (1, 0)', () => {
    // Canvas x = 40 → Math.floor(40/40) = 1
    const cell = clientToCell(100 + 40, 200, originX, originY, cellSize, gridW, gridH);
    expect(cell).toEqual({ x: 1, y: 0 });
  });

  it('point exactly on the horizontal grid-line between row 0 and row 1 → cell (0, 1)', () => {
    const cell = clientToCell(100, 200 + 40, originX, originY, cellSize, gridW, gridH);
    expect(cell).toEqual({ x: 0, y: 1 });
  });

  it('point in the last cell (gridW-1, gridH-1)', () => {
    // Canvas position just inside last cell: ((gridW-1)*cellSize+1, (gridH-1)*cellSize+1)
    const cell = clientToCell(
      originX + (gridW - 1) * cellSize + 1,
      originY + (gridH - 1) * cellSize + 1,
      originX,
      originY,
      cellSize,
      gridW,
      gridH,
    );
    expect(cell).toEqual({ x: gridW - 1, y: gridH - 1 });
  });

  it('returns undefined when client point is to the left of the grid', () => {
    const cell = clientToCell(99, 200, originX, originY, cellSize, gridW, gridH);
    expect(cell).toBeUndefined();
  });

  it('returns undefined when client point is above the grid', () => {
    const cell = clientToCell(100, 199, originX, originY, cellSize, gridW, gridH);
    expect(cell).toBeUndefined();
  });

  it('returns undefined when client point is exactly at col = gridW (off the right edge)', () => {
    // Canvas x = gridW * cellSize → col = gridW → out of bounds
    const cell = clientToCell(originX + gridW * cellSize, originY, originX, originY, cellSize, gridW, gridH);
    expect(cell).toBeUndefined();
  });

  it('returns undefined when client point is exactly at row = gridH (off the bottom edge)', () => {
    const cell = clientToCell(originX, originY + gridH * cellSize, originX, originY, cellSize, gridW, gridH);
    expect(cell).toBeUndefined();
  });

  it('returns undefined for a point far to the right', () => {
    const cell = clientToCell(9999, 200, originX, originY, cellSize, gridW, gridH);
    expect(cell).toBeUndefined();
  });

  it('returns undefined for a point far below the grid', () => {
    const cell = clientToCell(100, 9999, originX, originY, cellSize, gridW, gridH);
    expect(cell).toBeUndefined();
  });

  it('works with origin at (0, 0)', () => {
    const cell = clientToCell(55, 85, 0, 0, 40, 10, 8);
    // floor(55/40)=1, floor(85/40)=2
    expect(cell).toEqual({ x: 1, y: 2 });
  });

  it('works with cellSize=1', () => {
    const cell = clientToCell(5, 3, 0, 0, 1, 10, 8);
    expect(cell).toEqual({ x: 5, y: 3 });
  });

  it('returns undefined for negative clientX (left of origin)', () => {
    const cell = clientToCell(-10, 200, 0, 200, 40, 10, 8);
    expect(cell).toBeUndefined();
  });

  it('returns undefined for negative clientY (above origin)', () => {
    const cell = clientToCell(100, -10, 100, 0, 40, 10, 8);
    expect(cell).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// cellToPixelRect
// ---------------------------------------------------------------------------

describe('cellToPixelRect', () => {
  it('returns correct rect for cell (0,0)', () => {
    const rect = cellToPixelRect({ x: 0, y: 0 }, 40);
    expect(rect).toEqual({ x: 0, y: 0, w: 40, h: 40 });
  });

  it('returns correct rect for cell (1,0)', () => {
    const rect = cellToPixelRect({ x: 1, y: 0 }, 40);
    expect(rect).toEqual({ x: 40, y: 0, w: 40, h: 40 });
  });

  it('returns correct rect for cell (0,1)', () => {
    const rect = cellToPixelRect({ x: 0, y: 1 }, 40);
    expect(rect).toEqual({ x: 0, y: 40, w: 40, h: 40 });
  });

  it('returns correct rect for cell (3,2)', () => {
    const rect = cellToPixelRect({ x: 3, y: 2 }, 40);
    expect(rect).toEqual({ x: 120, y: 80, w: 40, h: 40 });
  });

  it('uses cellSize for both w and h', () => {
    const rect = cellToPixelRect({ x: 0, y: 0 }, 60);
    expect(rect.w).toBe(60);
    expect(rect.h).toBe(60);
  });

  it('works with cellSize=1', () => {
    const rect = cellToPixelRect({ x: 5, y: 7 }, 1);
    expect(rect).toEqual({ x: 5, y: 7, w: 1, h: 1 });
  });

  it('does not mutate input cell', () => {
    const cell = { x: 2, y: 3 };
    cellToPixelRect(cell, 40);
    expect(cell).toEqual({ x: 2, y: 3 });
  });
});

// ---------------------------------------------------------------------------
// furnitureToPixelRect
// ---------------------------------------------------------------------------

describe('furnitureToPixelRect', () => {
  it('returns correct rect for 1×1 furniture at origin', () => {
    const f = makeDesk('d1', 0, 0);
    expect(furnitureToPixelRect(f, 40)).toEqual({ x: 0, y: 0, w: 40, h: 40 });
  });

  it('returns correct rect for 1×1 furniture at (2, 3)', () => {
    const f = makeDesk('d1', 2, 3);
    expect(furnitureToPixelRect(f, 40)).toEqual({ x: 80, y: 120, w: 40, h: 40 });
  });

  it('returns correct rect for 2×1 furniture', () => {
    const f = makeDesk('d1', 1, 0, 2, 1);
    expect(furnitureToPixelRect(f, 40)).toEqual({ x: 40, y: 0, w: 80, h: 40 });
  });

  it('returns correct rect for 1×2 furniture', () => {
    const f = makeDesk('d1', 0, 2, 1, 2);
    expect(furnitureToPixelRect(f, 40)).toEqual({ x: 0, y: 80, w: 40, h: 80 });
  });

  it('returns correct rect for a 3×2 table', () => {
    const f = makeTable('t1', 2, 1, 3, 2);
    expect(furnitureToPixelRect(f, 40)).toEqual({ x: 80, y: 40, w: 120, h: 80 });
  });

  it('works with cellSize=60', () => {
    const f = makeDesk('d1', 1, 1);
    expect(furnitureToPixelRect(f, 60)).toEqual({ x: 60, y: 60, w: 60, h: 60 });
  });

  it('width scales with furniture w', () => {
    const f = makeTable('t1', 0, 0, 4, 2);
    const rect = furnitureToPixelRect(f, 10);
    expect(rect.w).toBe(40);
    expect(rect.h).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// furnitureAtCell
// ---------------------------------------------------------------------------

describe('furnitureAtCell', () => {
  it('returns undefined for an empty furniture array', () => {
    const result = furnitureAtCell({ x: 0, y: 0 }, []);
    expect(result).toBeUndefined();
  });

  it('returns undefined when no furniture covers the cell', () => {
    const furniture = [makeDesk('d1', 3, 3)];
    const result = furnitureAtCell({ x: 0, y: 0 }, furniture);
    expect(result).toBeUndefined();
  });

  it('returns the matching furniture for a 1×1 desk', () => {
    const desk = makeDesk('d1', 2, 3);
    const result = furnitureAtCell({ x: 2, y: 3 }, [desk]);
    expect(result?.id).toBe(furnitureId('d1'));
  });

  it('returns the furniture for any cell within a multi-cell footprint', () => {
    const table = makeTable('t1', 1, 1, 3, 2); // occupies (1,1),(2,1),(3,1),(1,2),(2,2),(3,2)
    const furniture = [table];
    // Check all 6 cells
    expect(furnitureAtCell({ x: 1, y: 1 }, furniture)?.id).toBe(furnitureId('t1'));
    expect(furnitureAtCell({ x: 2, y: 1 }, furniture)?.id).toBe(furnitureId('t1'));
    expect(furnitureAtCell({ x: 3, y: 1 }, furniture)?.id).toBe(furnitureId('t1'));
    expect(furnitureAtCell({ x: 1, y: 2 }, furniture)?.id).toBe(furnitureId('t1'));
    expect(furnitureAtCell({ x: 2, y: 2 }, furniture)?.id).toBe(furnitureId('t1'));
    expect(furnitureAtCell({ x: 3, y: 2 }, furniture)?.id).toBe(furnitureId('t1'));
  });

  it('returns undefined for a cell just outside a multi-cell footprint', () => {
    const table = makeTable('t1', 1, 1, 3, 2);
    // Cell (0,1) is just left; (4,1) is just right; (1,0) is just above; (1,3) just below
    expect(furnitureAtCell({ x: 0, y: 1 }, [table])).toBeUndefined();
    expect(furnitureAtCell({ x: 4, y: 1 }, [table])).toBeUndefined();
    expect(furnitureAtCell({ x: 1, y: 0 }, [table])).toBeUndefined();
    expect(furnitureAtCell({ x: 1, y: 3 }, [table])).toBeUndefined();
  });

  it('returns the LAST (topmost) furniture when multiple overlap the same cell', () => {
    // Two desks at the same cell — last one in array wins (painter order)
    const desk1 = makeDesk('d1', 2, 2);
    const desk2 = makeDesk('d2', 2, 2);
    const result = furnitureAtCell({ x: 2, y: 2 }, [desk1, desk2]);
    expect(result?.id).toBe(furnitureId('d2'));
  });

  it('returns the topmost across a large overlap (5 furniture at same cell)', () => {
    const pieces = ['d1', 'd2', 'd3', 'd4', 'd5'].map((id) => makeDesk(id, 0, 0));
    const result = furnitureAtCell({ x: 0, y: 0 }, pieces);
    expect(result?.id).toBe(furnitureId('d5'));
  });

  it('returns only the first furniture when only the first covers the cell', () => {
    const desk1 = makeDesk('d1', 0, 0);
    const desk2 = makeDesk('d2', 5, 5);
    const result = furnitureAtCell({ x: 0, y: 0 }, [desk1, desk2]);
    expect(result?.id).toBe(furnitureId('d1'));
  });

  it('returns only the second furniture when only the second covers the cell', () => {
    const desk1 = makeDesk('d1', 0, 0);
    const desk2 = makeDesk('d2', 5, 5);
    const result = furnitureAtCell({ x: 5, y: 5 }, [desk1, desk2]);
    expect(result?.id).toBe(furnitureId('d2'));
  });

  it('handles furniture with w=1, h=2 correctly (two rows)', () => {
    const tall = makeDesk('t', 3, 3, 1, 2); // occupies (3,3) and (3,4)
    expect(furnitureAtCell({ x: 3, y: 3 }, [tall])?.id).toBe(furnitureId('t'));
    expect(furnitureAtCell({ x: 3, y: 4 }, [tall])?.id).toBe(furnitureId('t'));
    expect(furnitureAtCell({ x: 3, y: 5 }, [tall])).toBeUndefined();
  });

  it('handles furniture with w=2, h=1 correctly (two columns)', () => {
    const wide = makeDesk('w', 3, 3, 2, 1); // occupies (3,3) and (4,3)
    expect(furnitureAtCell({ x: 3, y: 3 }, [wide])?.id).toBe(furnitureId('w'));
    expect(furnitureAtCell({ x: 4, y: 3 }, [wide])?.id).toBe(furnitureId('w'));
    expect(furnitureAtCell({ x: 5, y: 3 }, [wide])).toBeUndefined();
  });

  it('does not mutate the furniture array', () => {
    const furniture = [makeDesk('d1', 0, 0)];
    const original = [...furniture];
    furnitureAtCell({ x: 0, y: 0 }, furniture);
    expect(furniture).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// cellsEqual
// ---------------------------------------------------------------------------

describe('cellsEqual', () => {
  it('returns true for two identical cells', () => {
    expect(cellsEqual({ x: 3, y: 5 }, { x: 3, y: 5 })).toBe(true);
  });

  it('returns true for (0,0) compared to (0,0)', () => {
    expect(cellsEqual({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(true);
  });

  it('returns false when x differs', () => {
    expect(cellsEqual({ x: 1, y: 5 }, { x: 2, y: 5 })).toBe(false);
  });

  it('returns false when y differs', () => {
    expect(cellsEqual({ x: 3, y: 4 }, { x: 3, y: 5 })).toBe(false);
  });

  it('returns false when both x and y differ', () => {
    expect(cellsEqual({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false);
  });

  it('is symmetric: cellsEqual(a, b) === cellsEqual(b, a)', () => {
    const a = { x: 2, y: 7 };
    const b = { x: 2, y: 7 };
    expect(cellsEqual(a, b)).toBe(cellsEqual(b, a));
  });

  it('is reflexive: cellsEqual(a, a) is always true', () => {
    const a = { x: 99, y: 42 };
    expect(cellsEqual(a, a)).toBe(true);
  });

  it('returns false for cells with same coordinates but different sign (negative)', () => {
    // Note: negative coordinates are not normally valid grid positions, but the
    // function should still handle them correctly by comparing raw values.
    expect(cellsEqual({ x: -1, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });
});
