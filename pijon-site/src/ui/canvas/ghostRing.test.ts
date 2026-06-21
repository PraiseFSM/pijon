// @vitest-environment node
/**
 * Tests for §14.7 ghost-ring pure helpers (ghostRing.ts).
 *
 * No DOM, no React, no network — pure geometry.
 *
 * Coverage:
 *   A. resizeButtonRects — counts, positions, edge/sign semantics.
 *   B. hitButton — pixel point → ResizeButton or undefined.
 *   C. ghostRingCells — count and layout.
 */

import { describe, it, expect } from 'vitest';
import { resizeButtonRects, hitButton, ghostRingCells, MIN_BUTTON_SIZE_PX } from './ghostRing.js';

// ---------------------------------------------------------------------------
// A. resizeButtonRects
// ---------------------------------------------------------------------------

describe('resizeButtonRects', () => {
  // ---- Count ----------------------------------------------------------------

  it('always returns exactly 8 buttons (2 per edge × 4 edges)', () => {
    const btns = resizeButtonRects(3, 3, 48, 1);
    expect(btns).toHaveLength(8);
  });

  it('returns 8 buttons for a 1×1 grid', () => {
    const btns = resizeButtonRects(1, 1, 48, 1);
    expect(btns).toHaveLength(8);
  });

  it('returns 8 buttons for a 10×8 grid', () => {
    const btns = resizeButtonRects(10, 8, 48, 1);
    expect(btns).toHaveLength(8);
  });

  // ---- Sign semantics: 4 PLUS + 4 MINUS ------------------------------------

  it('has 4 PLUS buttons (sign=+1) and 4 MINUS buttons (sign=-1)', () => {
    const btns = resizeButtonRects(5, 5, 48, 1);
    const plus  = btns.filter((b) => b.sign === 1);
    const minus = btns.filter((b) => b.sign === -1);
    expect(plus).toHaveLength(4);
    expect(minus).toHaveLength(4);
  });

  // ---- Each edge appears exactly twice (one PLUS, one MINUS) ---------------

  it('each of the 4 edges appears exactly twice', () => {
    const btns = resizeButtonRects(4, 6, 48, 1);
    for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
      expect(btns.filter((b) => b.edge === edge)).toHaveLength(2);
    }
  });

  // ---- Button size: cellSize when ≥ minButtonSize, else clamped to min ------

  it('every button is exactly cellSize × cellSize when cellSize ≥ MIN_BUTTON_SIZE_PX', () => {
    const cs = 40; // 40 >= 16
    const btns = resizeButtonRects(3, 3, cs, 1);
    for (const btn of btns) {
      expect(btn.w).toBe(cs);
      expect(btn.h).toBe(cs);
    }
  });

  it('buttons are clamped to MIN_BUTTON_SIZE_PX when cellSize < MIN_BUTTON_SIZE_PX', () => {
    // cellSize=1 is well below the minimum of 16 px
    const btns = resizeButtonRects(5, 5, 1, 1);
    for (const btn of btns) {
      expect(btn.w).toBe(MIN_BUTTON_SIZE_PX);
      expect(btn.h).toBe(MIN_BUTTON_SIZE_PX);
    }
  });

  it('buttons are not clamped when cellSize exactly equals MIN_BUTTON_SIZE_PX', () => {
    const btns = resizeButtonRects(5, 5, MIN_BUTTON_SIZE_PX, 1);
    for (const btn of btns) {
      expect(btn.w).toBe(MIN_BUTTON_SIZE_PX);
      expect(btn.h).toBe(MIN_BUTTON_SIZE_PX);
    }
  });

  // ---- PLUS buttons lie OUTSIDE the grid -----------------------------------

  describe('PLUS buttons are outside the grid (originOffset=1)', () => {
    // With gridW=3, gridH=3, cellSize=48, originOffset=1:
    //   Grid top-left in canvas pixels = (48, 48)
    //   Grid bottom-right              = (48 + 3*48, 48 + 3*48) = (192, 192)

    const cs = 48;
    const gW = 3;
    const gH = 3;
    const op = 1;
    const gridLeft   = op * cs;          // 48
    const gridTop    = op * cs;          // 48
    const gridRight  = gridLeft + gW * cs;  // 192
    const gridBottom = gridTop  + gH * cs;  // 192

    const btns = resizeButtonRects(gW, gH, cs, op);
    const plusBtns = btns.filter((b) => b.sign === 1);

    it('top PLUS button is above the grid (y < gridTop)', () => {
      const b = plusBtns.find((btn) => btn.edge === 'top');
      expect(b).toBeDefined();
      expect(b!.y + b!.h).toBeLessThanOrEqual(gridTop);
    });

    it('bottom PLUS button is below the grid (y >= gridBottom)', () => {
      const b = plusBtns.find((btn) => btn.edge === 'bottom');
      expect(b).toBeDefined();
      expect(b!.y).toBeGreaterThanOrEqual(gridBottom);
    });

    it('left PLUS button is left of the grid (x + w <= gridLeft)', () => {
      const b = plusBtns.find((btn) => btn.edge === 'left');
      expect(b).toBeDefined();
      expect(b!.x + b!.w).toBeLessThanOrEqual(gridLeft);
    });

    it('right PLUS button is right of the grid (x >= gridRight)', () => {
      const b = plusBtns.find((btn) => btn.edge === 'right');
      expect(b).toBeDefined();
      expect(b!.x).toBeGreaterThanOrEqual(gridRight);
    });
  });

  // ---- MINUS buttons lie INSIDE the grid -----------------------------------

  describe('MINUS buttons are inside the grid (originOffset=1)', () => {
    const cs = 48;
    const gW = 3;
    const gH = 3;
    const op = 1;
    const gridLeft   = op * cs;
    const gridTop    = op * cs;
    const gridRight  = gridLeft + gW * cs;
    const gridBottom = gridTop  + gH * cs;

    const btns = resizeButtonRects(gW, gH, cs, op);
    const minusBtns = btns.filter((b) => b.sign === -1);

    it('top MINUS button is in the first row of the grid', () => {
      const b = minusBtns.find((btn) => btn.edge === 'top');
      expect(b).toBeDefined();
      expect(b!.y).toBe(gridTop);
    });

    it('bottom MINUS button is in the last row of the grid', () => {
      const b = minusBtns.find((btn) => btn.edge === 'bottom');
      expect(b).toBeDefined();
      expect(b!.y).toBe(gridBottom - cs);
    });

    it('left MINUS button is in the first column of the grid', () => {
      const b = minusBtns.find((btn) => btn.edge === 'left');
      expect(b).toBeDefined();
      expect(b!.x).toBe(gridLeft);
    });

    it('right MINUS button is in the last column of the grid', () => {
      const b = minusBtns.find((btn) => btn.edge === 'right');
      expect(b).toBeDefined();
      expect(b!.x).toBe(gridRight - cs);
    });
  });

  // ---- Concrete 3×3, cellSize=48, originOffset=1 positions ----------------

  describe('concrete 3×3 grid, cellSize=48, originOffset=1', () => {
    // Grid origin at canvas pixel (48, 48).
    // hCenterCol = floor(3/2) = 1 → center col pixel within grid = 1*48 = 48
    // vCenterRow = floor(3/2) = 1 → center row pixel within grid = 1*48 = 48
    // So buttons at column hCenterCol are at canvas x = 48 + 1*48 = 96
    //              row vCenterRow are at canvas y = 48 + 1*48 = 96

    const btns = resizeButtonRects(3, 3, 48, 1);

    it('top PLUS: x=96, y=0 (one cell above grid, centered)', () => {
      const b = btns.find((btn) => btn.edge === 'top' && btn.sign === 1);
      expect(b?.x).toBe(96);   // gridLeft(48) + hCenterCol(1)*48
      expect(b?.y).toBe(0);    // gridTop(48) - 1*48
    });

    it('top MINUS: x=96, y=48 (top row of grid, centered)', () => {
      const b = btns.find((btn) => btn.edge === 'top' && btn.sign === -1);
      expect(b?.x).toBe(96);
      expect(b?.y).toBe(48);   // gridTop(48) + row 0 = 48
    });

    it('bottom PLUS: x=96, y=192 (one cell below grid)', () => {
      const b = btns.find((btn) => btn.edge === 'bottom' && btn.sign === 1);
      // gridBottom = 48 + 3*48 = 192
      expect(b?.x).toBe(96);
      expect(b?.y).toBe(192);
    });

    it('bottom MINUS: x=96, y=144 (last row of grid)', () => {
      const b = btns.find((btn) => btn.edge === 'bottom' && btn.sign === -1);
      // gridBottom - cs = 192 - 48 = 144
      expect(b?.x).toBe(96);
      expect(b?.y).toBe(144);
    });

    it('left PLUS: x=0, y=96 (one cell left of grid, centered)', () => {
      const b = btns.find((btn) => btn.edge === 'left' && btn.sign === 1);
      // gridLeft - cs = 48 - 48 = 0
      expect(b?.x).toBe(0);
      expect(b?.y).toBe(96);   // gridTop(48) + vCenterRow(1)*48
    });

    it('left MINUS: x=48, y=96 (first col of grid, centered)', () => {
      const b = btns.find((btn) => btn.edge === 'left' && btn.sign === -1);
      expect(b?.x).toBe(48);   // gridLeft = 48
      expect(b?.y).toBe(96);
    });

    it('right PLUS: x=192, y=96 (one cell right of grid, centered)', () => {
      const b = btns.find((btn) => btn.edge === 'right' && btn.sign === 1);
      // gridRight = 48 + 3*48 = 192
      expect(b?.x).toBe(192);
      expect(b?.y).toBe(96);
    });

    it('right MINUS: x=144, y=96 (last col of grid, centered)', () => {
      const b = btns.find((btn) => btn.edge === 'right' && btn.sign === -1);
      // gridRight - cs = 192 - 48 = 144
      expect(b?.x).toBe(144);
      expect(b?.y).toBe(96);
    });
  });

  // ---- originOffset=0 (no ghost margin — degenerate case used in tests) ----

  describe('originOffset=0 (no ghost margin)', () => {
    const btns = resizeButtonRects(3, 3, 48, 0);

    it('still returns 8 buttons', () => {
      expect(btns).toHaveLength(8);
    });

    it('top PLUS button is at y=-48 (above canvas)', () => {
      const b = btns.find((btn) => btn.edge === 'top' && btn.sign === 1);
      expect(b?.y).toBe(-48);
    });

    it('top MINUS button is at y=0 (canvas top edge)', () => {
      const b = btns.find((btn) => btn.edge === 'top' && btn.sign === -1);
      expect(b?.y).toBe(0);
    });
  });

  // ---- Varying cellSize ----------------------------------------------------

  it('scales correctly with cellSize=1 (unit grid) — buttons clamped to MIN_BUTTON_SIZE_PX and centered', () => {
    // gridW=4, gridH=4, cellSize=1, originOffset=1
    // hCenterCol = floor(4/2) = 2, vCenterRow = floor(4/2) = 2
    // gridLeft = 1, gridTop = 1, gridRight = 5, gridBottom = 5
    //
    // Cell center for topPlus (naturalX=3, naturalY=0):
    //   cx = 3 + 0.5 = 3.5, cy = 0 + 0.5 = 0.5
    //   x = 3.5 - MIN/2 = 3.5 - 8 = -4.5, y = 0.5 - 8 = -7.5
    // Cell center for topMinus (naturalX=3, naturalY=1):
    //   cx = 3.5, cy = 1 + 0.5 = 1.5
    //   x = 3.5 - 8 = -4.5, y = 1.5 - 8 = -6.5
    const min = MIN_BUTTON_SIZE_PX;
    const btns = resizeButtonRects(4, 4, 1, 1);
    const topPlus  = btns.find((b) => b.edge === 'top'  && b.sign === 1);
    const topMinus = btns.find((b) => b.edge === 'top'  && b.sign === -1);
    // Centers must be on the natural cell center points
    expect(topPlus?.x).toBeCloseTo(3.5 - min / 2);
    expect(topPlus?.y).toBeCloseTo(0.5 - min / 2);
    expect(topMinus?.x).toBeCloseTo(3.5 - min / 2);
    expect(topMinus?.y).toBeCloseTo(1.5 - min / 2);
  });

  // ---- Centering for even vs. odd grid widths ------------------------------

  it('hCenterCol = floor(gridW/2) for even gridW (no exact center)', () => {
    // gridW=4 → hCenterCol = 2 (left of center pair)
    // Use cellSize=20 (≥ MIN_BUTTON_SIZE_PX=16) so clamping does not activate
    const cs = 20;
    const op = 1;
    const gridLeft = op * cs;
    const btns = resizeButtonRects(4, 1, cs, op);
    const topPlus = btns.find((b) => b.edge === 'top' && b.sign === 1);
    expect(topPlus?.x).toBe(gridLeft + 2 * cs);
  });

  it('hCenterCol = floor(gridW/2) for odd gridW (exact center)', () => {
    // gridW=3 → hCenterCol = 1 (center cell)
    // Use cellSize=20 (≥ MIN_BUTTON_SIZE_PX=16) so clamping does not activate
    const cs = 20;
    const op = 1;
    const gridLeft = op * cs;
    const btns = resizeButtonRects(3, 1, cs, op);
    const topPlus = btns.find((b) => b.edge === 'top' && b.sign === 1);
    expect(topPlus?.x).toBe(gridLeft + 1 * cs);
  });

  it('vCenterRow = floor(gridH/2) for gridH=6 (3)', () => {
    // Use cellSize=20 (≥ MIN_BUTTON_SIZE_PX=16) so clamping does not activate
    const cs = 20;
    const op = 1;
    const gridTop = op * cs;
    const btns = resizeButtonRects(1, 6, cs, op);
    const leftPlus = btns.find((b) => b.edge === 'left' && b.sign === 1);
    expect(leftPlus?.y).toBe(gridTop + 3 * cs);
  });

  it('vCenterRow = floor(gridH/2) for gridH=1 (0)', () => {
    // Use cellSize=20 (≥ MIN_BUTTON_SIZE_PX=16) so clamping does not activate
    const cs = 20;
    const op = 1;
    const gridTop = op * cs;
    const btns = resizeButtonRects(1, 1, cs, op);
    const leftPlus = btns.find((b) => b.edge === 'left' && b.sign === 1);
    // vCenterRow = floor(1/2) = 0
    expect(leftPlus?.y).toBe(gridTop + 0 * cs);
  });

  // ---- Minimum button size (fix §polish — ghost-ring buttons at high G) ----

  it('at high granularity (cellSize=4) all buttons are ≥ MIN_BUTTON_SIZE_PX', () => {
    // Simulate G=12 on a 10-unit grid: fine cells = 120, cellSize shrinks.
    // Use cellSize=4 < MIN_BUTTON_SIZE_PX=16
    const btns = resizeButtonRects(20, 20, 4, 1);
    for (const btn of btns) {
      expect(btn.w).toBeGreaterThanOrEqual(MIN_BUTTON_SIZE_PX);
      expect(btn.h).toBeGreaterThanOrEqual(MIN_BUTTON_SIZE_PX);
    }
  });

  it('at high granularity buttons are centered on their natural cell center', () => {
    // cellSize=4, gridW=10, gridH=10, originOffset=1
    // hCenterCol = 5, vCenterRow = 5
    // gridLeft = 4, gridTop = 4
    // top PLUS naturalX = 4 + 5*4 = 24, naturalY = 4 - 4 = 0
    //   cellCenter cx = 24 + 2 = 26, cy = 0 + 2 = 2
    //   expected x = 26 - 8 = 18, y = 2 - 8 = -6
    const cs = 4;
    const min = MIN_BUTTON_SIZE_PX; // 16, half=8
    const op = 1;
    const gridLeft = op * cs;
    const hCenter = Math.floor(10 / 2); // 5
    const naturalX = gridLeft + hCenter * cs; // 4 + 20 = 24
    const naturalY_plus = op * cs - cs; // 4 - 4 = 0
    const btns = resizeButtonRects(10, 10, cs, op);
    const topPlus = btns.find((b) => b.edge === 'top' && b.sign === 1);
    const expectedCx = naturalX + cs / 2; // 26
    const expectedCy = naturalY_plus + cs / 2; // 2
    expect(topPlus?.x).toBeCloseTo(expectedCx - min / 2);
    expect(topPlus?.y).toBeCloseTo(expectedCy - min / 2);
    expect(topPlus?.w).toBe(min);
    expect(topPlus?.h).toBe(min);
  });

  it('at G=1 (cellSize=48) button positions are unchanged — no clamping', () => {
    // At typical G=1 size (48px), clamping must not activate.
    const cs = 48;
    const op = 1;
    const gridLeft = op * cs;
    const hCenter = Math.floor(3 / 2); // 1
    const btns = resizeButtonRects(3, 3, cs, op);
    const topPlus = btns.find((b) => b.edge === 'top' && b.sign === 1);
    // No clamping: btnSize=48, cell center = (gridLeft + hCenter*cs + cs/2, gridTop - cs + cs/2)
    //   = (48 + 48 + 24, 48 - 48 + 24) = (120, 24)
    // x = 120 - 24 = 96, y = 24 - 24 = 0
    expect(topPlus?.x).toBe(gridLeft + hCenter * cs);
    expect(topPlus?.y).toBe(op * cs - cs);
    expect(topPlus?.w).toBe(cs);
    expect(topPlus?.h).toBe(cs);
  });

  it('custom minButtonSize overrides the default', () => {
    // Pass minButtonSize=32: cellSize=20 < 32 → buttons should be 32×32
    const btns = resizeButtonRects(5, 5, 20, 1, 32);
    for (const btn of btns) {
      expect(btn.w).toBe(32);
      expect(btn.h).toBe(32);
    }
  });

  it('PLUS stays outside grid even when clamped (center is outside)', () => {
    // At high granularity the plus button center should still be in the ghost ring.
    // We check that the center of the plus button is outside the grid bounds.
    // gridW=10, gridH=10, cellSize=4, originOffset=1
    const cs = 4;
    const op = 1;
    const gridLeft = op * cs; // 4
    const gridTop  = op * cs; // 4
    const gridRight  = gridLeft + 10 * cs; // 44
    const gridBottom = gridTop  + 10 * cs; // 44
    const btns = resizeButtonRects(10, 10, cs, op);
    // Top PLUS center y < gridTop
    const topPlus = btns.find((b) => b.edge === 'top' && b.sign === 1);
    expect(topPlus).toBeDefined();
    const topPlusCenterY = topPlus!.y + topPlus!.h / 2;
    expect(topPlusCenterY).toBeLessThan(gridTop);
    // Bottom PLUS center y > gridBottom
    const botPlus = btns.find((b) => b.edge === 'bottom' && b.sign === 1);
    expect(botPlus).toBeDefined();
    const botPlusCenterY = botPlus!.y + botPlus!.h / 2;
    expect(botPlusCenterY).toBeGreaterThan(gridBottom);
    // Left PLUS center x < gridLeft
    const leftPlus = btns.find((b) => b.edge === 'left' && b.sign === 1);
    expect(leftPlus).toBeDefined();
    const leftPlusCenterX = leftPlus!.x + leftPlus!.w / 2;
    expect(leftPlusCenterX).toBeLessThan(gridLeft);
    // Right PLUS center x > gridRight
    const rightPlus = btns.find((b) => b.edge === 'right' && b.sign === 1);
    expect(rightPlus).toBeDefined();
    const rightPlusCenterX = rightPlus!.x + rightPlus!.w / 2;
    expect(rightPlusCenterX).toBeGreaterThan(gridRight);
  });

  it('hitButton at high granularity routes clicks to correct edge/sign', () => {
    // At cellSize=4, buttons are clamped to 16px — verify hit-testing still works.
    // Note: at very small cellSize, adjacent buttons may overlap (PLUS/MINUS are
    // only 1 cell apart = 4px, but both are expanded to 16px).  hitButton returns
    // the FIRST match in the array, which is the PLUS button for each edge.
    // We verify the PLUS buttons are hit at their centers.
    const cs = 4;
    const btns = resizeButtonRects(10, 10, cs, 1);

    // Top PLUS button center
    const topPlus = btns.find((b) => b.edge === 'top' && b.sign === 1);
    expect(topPlus).toBeDefined();
    const cx = topPlus!.x + topPlus!.w / 2;
    const cy = topPlus!.y + topPlus!.h / 2;
    const hit = hitButton(cx, cy, btns);
    expect(hit?.edge).toBe('top');
    expect(hit?.sign).toBe(1);

    // Left PLUS button center — PLUS buttons are outside the grid, so they
    // should not overlap with their MINUS counterpart's center.
    const leftPlus = btns.find((b) => b.edge === 'left' && b.sign === 1);
    expect(leftPlus).toBeDefined();
    const lx = leftPlus!.x + leftPlus!.w / 2;
    const ly = leftPlus!.y + leftPlus!.h / 2;
    const hitL = hitButton(lx, ly, btns);
    expect(hitL?.edge).toBe('left');
    expect(hitL?.sign).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B. hitButton
// ---------------------------------------------------------------------------

describe('hitButton', () => {
  // Use a simple 2-button list for hit-testing
  const buttons = resizeButtonRects(3, 3, 48, 1);

  it('returns undefined when the point is far outside all buttons', () => {
    expect(hitButton(9999, 9999, buttons)).toBeUndefined();
  });

  it('returns undefined for point at (-1, -1)', () => {
    expect(hitButton(-1, -1, buttons)).toBeUndefined();
  });

  it('hits the top PLUS button when the point is inside it', () => {
    // top PLUS: x=96, y=0, w=48, h=48
    // point at center = (96 + 24, 0 + 24) = (120, 24)
    const hit = hitButton(120, 24, buttons);
    expect(hit?.edge).toBe('top');
    expect(hit?.sign).toBe(1);
  });

  it('hits the top MINUS button when the point is inside it', () => {
    // top MINUS: x=96, y=48, w=48, h=48
    const hit = hitButton(120, 72, buttons);
    expect(hit?.edge).toBe('top');
    expect(hit?.sign).toBe(-1);
  });

  it('hits the left PLUS button at its left edge', () => {
    // left PLUS: x=0, y=96
    const hit = hitButton(0, 96, buttons);
    expect(hit?.edge).toBe('left');
    expect(hit?.sign).toBe(1);
  });

  it('does not hit when point is exactly at x = button.x + button.w (exclusive right edge)', () => {
    // top PLUS: x=96, w=48 → right exclusive edge at x=144
    const hit = hitButton(144, 24, buttons);
    // Should NOT hit top PLUS
    expect(hit?.edge !== 'top' || hit.sign !== 1).toBe(true);
  });

  it('returns undefined for empty button list', () => {
    expect(hitButton(100, 100, [])).toBeUndefined();
  });

  it('returns the first matching button when multiple overlap', () => {
    // Create two identical buttons — hitButton should return the first
    const b1 = { edge: 'top' as const, sign: 1 as const, x: 0, y: 0, w: 10, h: 10 };
    const b2 = { edge: 'bottom' as const, sign: -1 as const, x: 0, y: 0, w: 10, h: 10 };
    const hit = hitButton(5, 5, [b1, b2]);
    expect(hit).toBe(b1);
  });

  it('hits the bottom PLUS button', () => {
    // bottom PLUS: x=96, y=192
    const hit = hitButton(100, 192, buttons);
    expect(hit?.edge).toBe('bottom');
    expect(hit?.sign).toBe(1);
  });

  it('hits the right MINUS button at its center', () => {
    // right MINUS: x=144, y=96
    const hit = hitButton(144 + 24, 96 + 24, buttons);
    expect(hit?.edge).toBe('right');
    expect(hit?.sign).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// C. ghostRingCells
// ---------------------------------------------------------------------------

describe('ghostRingCells', () => {
  it('returns empty array when originOffset=0', () => {
    expect(ghostRingCells(3, 3, 0)).toHaveLength(0);
  });

  it('returns empty array when originOffset negative', () => {
    expect(ghostRingCells(3, 3, -1)).toHaveLength(0);
  });

  describe('3×3 grid, originOffset=1', () => {
    // Total canvas cells: (3+2)×(3+2) = 5×5 = 25
    // Grid cells: 3×3 = 9
    // Ghost cells: 25 - 9 = 16
    const cells = ghostRingCells(3, 3, 1);

    it('returns 16 ghost-ring cells for a 3×3 grid', () => {
      expect(cells).toHaveLength(16);
    });

    it('no ghost cell lands at the grid-content area (col 1..3, row 1..3)', () => {
      for (const { col, row } of cells) {
        const inGrid = col >= 1 && col <= 3 && row >= 1 && row <= 3;
        expect(inGrid).toBe(false);
      }
    });

    it('all cells are within total canvas bounds (0..4 × 0..4)', () => {
      for (const { col, row } of cells) {
        expect(col).toBeGreaterThanOrEqual(0);
        expect(col).toBeLessThan(5);
        expect(row).toBeGreaterThanOrEqual(0);
        expect(row).toBeLessThan(5);
      }
    });

    it('no duplicate cells', () => {
      const keys = cells.map(({ col, row }) => `${col},${row}`);
      const unique = new Set(keys);
      expect(unique.size).toBe(cells.length);
    });
  });

  describe('1×1 grid, originOffset=1', () => {
    // Total canvas cells: 3×3 = 9, grid = 1, ghost = 8
    const cells = ghostRingCells(1, 1, 1);

    it('returns 8 ghost-ring cells for a 1×1 grid', () => {
      expect(cells).toHaveLength(8);
    });
  });

  describe('2×4 grid, originOffset=1', () => {
    // Total canvas cells: (2+2)×(4+2) = 4×6 = 24, grid = 2×4 = 8, ghost = 16
    const cells = ghostRingCells(2, 4, 1);

    it('returns 16 ghost-ring cells', () => {
      expect(cells).toHaveLength(16);
    });
  });
});
