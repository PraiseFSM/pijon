// @vitest-environment node
/**
 * §6.B1 — Grid-line thickness hierarchy (drawGrid + gridLineTier).
 *
 * Pure-function tests: no DOM, no React, no canvas.
 * We supply a spy context object and capture every lineWidth set before each
 * stroke() call so we can assert that unit-boundary lines get a larger
 * lineWidth than sub-unit lines.
 */

import { describe, it, expect } from 'vitest';
import { drawGrid, gridLineTier } from '../ui/canvas/render.js';
import { gridLine, gridLineSubunit } from '../theme/colors.js';

// ---------------------------------------------------------------------------
// Spy context helpers
// ---------------------------------------------------------------------------

/**
 * A record of (lineWidth, strokeStyle) values captured at each stroke() call.
 */
interface StrokeCall {
  lineWidth: number;
  strokeStyle: string;
}

/**
 * Build a minimal spy context that records lineWidth + strokeStyle at each stroke().
 */
function makeSpyCtx(): {
  ctx: CanvasRenderingContext2D;
  strokeCalls: StrokeCall[];
  moveToCalls: [number, number][];
  lineToCallsPerStroke: [number, number][][];
} {
  const strokeCalls: StrokeCall[] = [];
  const moveToCalls: [number, number][] = [];
  const allLineToCalls: [number, number][] = [];
  const lineToCallsPerStroke: [number, number][][] = [];
  let pendingLineTos: [number, number][] = [];

  let currentLineWidth = 1;
  let currentStrokeStyle = '';

  const ctx = {
    save() {},
    restore() {},
    beginPath() { pendingLineTos = []; },
    moveTo(x: number, y: number) { moveToCalls.push([x, y]); },
    lineTo(x: number, y: number) {
      allLineToCalls.push([x, y]);
      pendingLineTos.push([x, y]);
    },
    stroke() {
      strokeCalls.push({ lineWidth: currentLineWidth, strokeStyle: currentStrokeStyle });
      lineToCallsPerStroke.push([...pendingLineTos]);
      pendingLineTos = [];
    },
    set lineWidth(v: number) { currentLineWidth = v; },
    get lineWidth() { return currentLineWidth; },
    set strokeStyle(v: string) { currentStrokeStyle = v; },
    get strokeStyle() { return currentStrokeStyle; },
  } as unknown as CanvasRenderingContext2D;

  return { ctx, strokeCalls, moveToCalls, lineToCallsPerStroke };
}

// ---------------------------------------------------------------------------
// §6.B1 — gridLineTier pure function
// ---------------------------------------------------------------------------

describe('§6.B1 gridLineTier — pure tier classification', () => {
  describe('G=1', () => {
    it('every index returns tier 0 (all unit boundaries)', () => {
      for (let i = 0; i <= 10; i++) {
        expect(gridLineTier(i, 1), `index ${i.toString()}`).toBe(0);
      }
    });
  });

  describe('G=2', () => {
    it('multiples of 2 are tier 0 (unit boundary)', () => {
      expect(gridLineTier(0, 2)).toBe(0);
      expect(gridLineTier(2, 2)).toBe(0);
      expect(gridLineTier(4, 2)).toBe(0);
      expect(gridLineTier(6, 2)).toBe(0);
    });

    it('odd indices are tier 1 (half-unit)', () => {
      expect(gridLineTier(1, 2)).toBe(1);
      expect(gridLineTier(3, 2)).toBe(1);
      expect(gridLineTier(5, 2)).toBe(1);
    });
  });

  describe('G=4', () => {
    it('multiples of 4 are tier 0 (unit boundary)', () => {
      expect(gridLineTier(0, 4)).toBe(0);
      expect(gridLineTier(4, 4)).toBe(0);
      expect(gridLineTier(8, 4)).toBe(0);
    });

    it('multiples of 2 (not 4) are tier 1 (half-unit)', () => {
      expect(gridLineTier(2, 4)).toBe(1);
      expect(gridLineTier(6, 4)).toBe(1);
      expect(gridLineTier(10, 4)).toBe(1);
    });

    it('odd indices (quarter-unit) are tier 2', () => {
      expect(gridLineTier(1, 4)).toBe(2);
      expect(gridLineTier(3, 4)).toBe(2);
      expect(gridLineTier(5, 4)).toBe(2);
      expect(gridLineTier(7, 4)).toBe(2);
    });

    it('tier 0 < tier 1 < tier 2 (tier number increases with fineness)', () => {
      // Structural: tiers go from coarser (0) to finer (2)
      const unit = gridLineTier(0, 4);    // 0
      const half = gridLineTier(2, 4);    // 1
      const quarter = gridLineTier(1, 4); // 2
      expect(unit).toBeLessThan(half);
      expect(half).toBeLessThan(quarter);
    });
  });
});

// ---------------------------------------------------------------------------
// §6.B1 — drawGrid line count invariant
// ---------------------------------------------------------------------------

describe('§6.B1 drawGrid — correct number of lines at each granularity', () => {
  /**
   * Count total moveTo calls (= total line segments drawn).
   * Each line is one moveTo + one lineTo.
   * For a gridW×gridH grid: (gridW+1) vertical + (gridH+1) horizontal lines.
   */
  function countLines(gridW: number, gridH: number, cellsPerUnit: number): number {
    const { ctx, moveToCalls } = makeSpyCtx();
    drawGrid(ctx, gridW, gridH, 20, cellsPerUnit);
    return moveToCalls.length;
  }

  it('G=1: (gridW+1)+(gridH+1) total lines for 4×3 grid', () => {
    expect(countLines(4, 3, 1)).toBe(5 + 4); // 9
  });

  it('G=2: same total line count as G=1 for same gridW/gridH', () => {
    // Same grid (4×3), different granularity — same number of lines
    expect(countLines(4, 3, 2)).toBe(5 + 4);
  });

  it('G=4: same total line count as G=1 for same gridW/gridH', () => {
    expect(countLines(4, 4, 4)).toBe(5 + 5);
  });

  it('G=1: 6×6 grid draws 7+7=14 lines', () => {
    expect(countLines(6, 6, 1)).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// §6.B1 — drawGrid line positions (unchanged by granularity)
// ---------------------------------------------------------------------------

describe('§6.B1 drawGrid — line positions correct', () => {
  /**
   * Strategy: each line segment is one moveTo + one lineTo.
   * Collect (moveTo, lineTo) pairs and classify:
   *   - vertical: moveTo.y === 0 AND lineTo.y === gridH * cellSize
   *   - horizontal: moveTo.x === 0 AND lineTo.x === gridW * cellSize
   */
  interface LineSeg { mx: number; my: number; lx: number; ly: number }

  function collectSegments(gridW: number, gridH: number, cellSize: number, G = 1): LineSeg[] {
    const moves: [number, number][] = [];
    const tos: [number, number][] = [];
    let currentLineWidth = 1;
    let currentStrokeStyle = '';
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      moveTo(x: number, y: number) { moves.push([x, y]); },
      lineTo(x: number, y: number) { tos.push([x, y]); },
      stroke() {},
      set lineWidth(v: number) { currentLineWidth = v; },
      get lineWidth() { return currentLineWidth; },
      set strokeStyle(v: string) { currentStrokeStyle = v; },
      get strokeStyle() { return currentStrokeStyle; },
    } as unknown as CanvasRenderingContext2D;
    drawGrid(ctx, gridW, gridH, cellSize, G);
    const segs: LineSeg[] = [];
    for (let i = 0; i < moves.length; i++) {
      const [mx, my] = moves[i]!;
      const [lx, ly] = tos[i]!;
      segs.push({ mx, my, lx, ly });
    }
    return segs;
  }

  it('vertical lines at x = col * cellSize for col = 0…gridW', () => {
    const gridW = 3;
    const gridH = 2;
    const cellSize = 10;
    const segs = collectSegments(gridW, gridH, cellSize, 1);

    // Vertical: moveTo (x, 0) → lineTo (x, gridH*cellSize)
    const vertXs = segs
      .filter((s) => s.my === 0 && s.ly === gridH * cellSize)
      .map((s) => s.mx)
      .sort((a, b) => a - b);
    expect(vertXs).toEqual([0, 10, 20, 30]);
  });

  it('horizontal lines at y = row * cellSize for row = 0…gridH', () => {
    const gridW = 2;
    const gridH = 3;
    const cellSize = 10;
    const segs = collectSegments(gridW, gridH, cellSize, 1);

    // Horizontal: moveTo (0, y) → lineTo (gridW*cellSize, y)
    const horizYs = segs
      .filter((s) => s.mx === 0 && s.lx === gridW * cellSize)
      .map((s) => s.my)
      .sort((a, b) => a - b);
    expect(horizYs).toEqual([0, 10, 20, 30]);
  });

  it('G=2 line positions are identical to G=1 line positions for the same grid', () => {
    const gridW = 4;
    const gridH = 4;
    const cellSize = 10;
    const segsG1 = collectSegments(gridW, gridH, cellSize, 1);
    const segsG2 = collectSegments(gridW, gridH, cellSize, 2);

    // Same total segment count
    expect(segsG2.length).toBe(segsG1.length);

    // Same set of (mx, my, lx, ly) tuples
    const normalize = (segs: LineSeg[]) =>
      segs.map((s) => `${s.mx.toString()},${s.my.toString()},${s.lx.toString()},${s.ly.toString()}`).sort();
    expect(normalize(segsG2)).toEqual(normalize(segsG1));
  });
});

// ---------------------------------------------------------------------------
// §6.B1 — Thickness hierarchy
// ---------------------------------------------------------------------------

describe('§6.B1 drawGrid — thickness hierarchy at G=2', () => {
  it('uses two distinct lineWidths at G=2', () => {
    const { ctx, strokeCalls } = makeSpyCtx();
    drawGrid(ctx, 4, 4, 20, 2);

    const widths = new Set(strokeCalls.map((c) => c.lineWidth));
    expect(widths.size).toBe(2); // tier 0 and tier 1
  });

  it('unit-boundary stroke has a LARGER lineWidth than sub-unit stroke at G=2', () => {
    const { ctx, strokeCalls } = makeSpyCtx();
    drawGrid(ctx, 4, 4, 20, 2);

    // strokeCalls[0] = tier 0 (unit boundaries), strokeCalls[1] = tier 1 (half-unit)
    expect(strokeCalls).toHaveLength(2);
    const [unitStroke, subStroke] = strokeCalls as [StrokeCall, StrokeCall];
    expect(unitStroke.lineWidth).toBeGreaterThan(subStroke.lineWidth);
  });

  it('unit-boundary stroke uses the main gridLine color at G=2 (no color override)', () => {
    const { ctx, strokeCalls } = makeSpyCtx();
    drawGrid(ctx, 4, 4, 20, 2);
    expect(strokeCalls[0]!.strokeStyle).toBe(gridLine);
  });

  it('sub-unit stroke uses the gridLineSubunit color at G=2', () => {
    const { ctx, strokeCalls } = makeSpyCtx();
    drawGrid(ctx, 4, 4, 20, 2);
    expect(strokeCalls[1]!.strokeStyle).toBe(gridLineSubunit);
  });

  it('color override applies only to the unit-boundary stroke, not sub-unit', () => {
    const customColor = '#ff0000';
    const { ctx, strokeCalls } = makeSpyCtx();
    drawGrid(ctx, 4, 4, 20, 2, customColor);
    expect(strokeCalls[0]!.strokeStyle).toBe(customColor);
    expect(strokeCalls[1]!.strokeStyle).toBe(gridLineSubunit);
  });
});

describe('§6.B1 drawGrid — thickness hierarchy at G=4', () => {
  it('uses three distinct lineWidths at G=4', () => {
    const { ctx, strokeCalls } = makeSpyCtx();
    drawGrid(ctx, 8, 8, 20, 4);

    const widths = new Set(strokeCalls.map((c) => c.lineWidth));
    expect(widths.size).toBe(3); // tier 0, tier 1, tier 2
  });

  it('unit > half-unit > quarter-unit lineWidth at G=4', () => {
    const { ctx, strokeCalls } = makeSpyCtx();
    drawGrid(ctx, 8, 8, 20, 4);

    expect(strokeCalls).toHaveLength(3);
    const [t0, t1, t2] = strokeCalls as [StrokeCall, StrokeCall, StrokeCall];
    expect(t0.lineWidth).toBeGreaterThan(t1.lineWidth);
    expect(t1.lineWidth).toBeGreaterThan(t2.lineWidth);
  });

  it('three calls to stroke() at G=4 (one per tier)', () => {
    const { ctx, strokeCalls } = makeSpyCtx();
    drawGrid(ctx, 8, 8, 20, 4);
    expect(strokeCalls).toHaveLength(3);
  });
});

describe('§6.B1 drawGrid — G=1 all lines use bold width', () => {
  it('only one stroke() call at G=1', () => {
    const { ctx, strokeCalls } = makeSpyCtx();
    drawGrid(ctx, 4, 4, 20, 1);
    expect(strokeCalls).toHaveLength(1);
  });

  it('the single stroke uses the bold (unit-boundary) lineWidth at G=1', () => {
    const { ctx, strokeCalls } = makeSpyCtx();
    // G=2 has two calls; get the thick one for comparison
    const { ctx: ctx2, strokeCalls: calls2 } = makeSpyCtx();
    drawGrid(ctx, 4, 4, 20, 1);
    drawGrid(ctx2, 4, 4, 20, 2);

    const g1Width = strokeCalls[0]!.lineWidth;
    const g2UnitWidth = calls2[0]!.lineWidth; // first call is tier 0
    expect(g1Width).toBe(g2UnitWidth); // same thickness as G=2 unit lines
  });

  it('G=1 stroke uses the gridLine color', () => {
    const { ctx, strokeCalls } = makeSpyCtx();
    drawGrid(ctx, 4, 4, 20, 1);
    expect(strokeCalls[0]!.strokeStyle).toBe(gridLine);
  });
});

// ---------------------------------------------------------------------------
// §6.B1 — drawGrid omits cellsPerUnit (backward-compat default = 1)
// ---------------------------------------------------------------------------

describe('§6.B1 drawGrid — backward compat: omitting cellsPerUnit defaults to G=1 behaviour', () => {
  it('one stroke() call when cellsPerUnit omitted (same as G=1)', () => {
    const { ctx, strokeCalls } = makeSpyCtx();
    // Call with only 4 args — cellsPerUnit should default to 1
    drawGrid(ctx, 4, 4, 20);
    expect(strokeCalls).toHaveLength(1);
  });

  it('correct line count when cellsPerUnit omitted', () => {
    const { ctx, moveToCalls } = makeSpyCtx();
    drawGrid(ctx, 3, 3, 20);
    expect(moveToCalls.length).toBe(4 + 4); // 4 vert + 4 horiz
  });
});

// ---------------------------------------------------------------------------
// §6.B1 — GAP: gridLineTier at the final boundary index (col/row == gridW/gridH)
// ---------------------------------------------------------------------------

describe('§6.B1 gridLineTier — final boundary index (gap: checklist item)', () => {
  it('G=4: index == gridW (e.g. 8) is tier 0 — unit boundary, not subunit', () => {
    // At G=4 a grid with gridW=8 has indices 0…8.
    // index 8 = 8%4 === 0 → tier 0.
    expect(gridLineTier(8, 4)).toBe(0);
  });

  it('G=2: index == gridW (e.g. 4) is tier 0 — unit boundary', () => {
    // index 4 = 4%2 === 0 → tier 0.
    expect(gridLineTier(4, 2)).toBe(0);
  });

  it('G=4: index == gridH (e.g. 4) is tier 0 — exact boundary', () => {
    // A 4-row grid at G=4: index 4 = 4%4 === 0 → tier 0.
    expect(gridLineTier(4, 4)).toBe(0);
  });

  it('G=4: index gridW+1 that would be tier 1 (e.g. index 6 on an 8-col grid)', () => {
    // index 6 = 6%4 !== 0, 6%2 === 0 → tier 1 (half-unit)
    expect(gridLineTier(6, 4)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §6.B1 — GAP: G=4 line positions identical to G=1 (only G=2 was tested)
// ---------------------------------------------------------------------------

describe('§6.B1 drawGrid — G=4 line positions identical to G=1 (gap: position invariance)', () => {
  interface LineSeg { mx: number; my: number; lx: number; ly: number }

  function collectSegmentsForGap(gridW: number, gridH: number, cellSize: number, G: number): LineSeg[] {
    const moves: [number, number][] = [];
    const tos: [number, number][] = [];
    let lw = 1;
    let ss = '';
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      moveTo(x: number, y: number) { moves.push([x, y]); },
      lineTo(x: number, y: number) { tos.push([x, y]); },
      stroke() {},
      set lineWidth(v: number) { lw = v; },
      get lineWidth() { return lw; },
      set strokeStyle(v: string) { ss = v; },
      get strokeStyle() { return ss; },
    } as unknown as CanvasRenderingContext2D;
    drawGrid(ctx, gridW, gridH, cellSize, G);
    const segs: LineSeg[] = [];
    for (let i = 0; i < moves.length; i++) {
      const [mx, my] = moves[i]!;
      const [lx, ly] = tos[i]!;
      segs.push({ mx, my, lx, ly });
    }
    return segs;
  }

  it('G=4 line positions are identical to G=1 line positions for the same grid', () => {
    const gridW = 8;
    const gridH = 8;
    const cellSize = 10;
    const segsG1 = collectSegmentsForGap(gridW, gridH, cellSize, 1);
    const segsG4 = collectSegmentsForGap(gridW, gridH, cellSize, 4);

    // Same total segment count
    expect(segsG4.length).toBe(segsG1.length);

    // Same set of positions (order may differ — normalize by sort)
    const norm = (segs: LineSeg[]) =>
      segs
        .map((s) => `${s.mx.toString()},${s.my.toString()},${s.lx.toString()},${s.ly.toString()}`)
        .sort();
    expect(norm(segsG4)).toEqual(norm(segsG1));
  });

  it('G=2 and G=4 line positions are identical for the same grid', () => {
    const gridW = 8;
    const gridH = 4;
    const cellSize = 10;
    const segsG2 = collectSegmentsForGap(gridW, gridH, cellSize, 2);
    const segsG4 = collectSegmentsForGap(gridW, gridH, cellSize, 4);

    expect(segsG4.length).toBe(segsG2.length);
    const norm = (segs: LineSeg[]) =>
      segs
        .map((s) => `${s.mx.toString()},${s.my.toString()},${s.lx.toString()},${s.ly.toString()}`)
        .sort();
    expect(norm(segsG4)).toEqual(norm(segsG2));
  });
});

// ---------------------------------------------------------------------------
// §6.B1 — GAP: unit-boundary tier0 is the MAXIMUM lineWidth among all tiers
// ---------------------------------------------------------------------------

describe('§6.B1 drawGrid — tier-0 is strictly the maximum lineWidth (gap: explicitness)', () => {
  it('G=4: tier-0 lineWidth is the max of all stroke lineWidths', () => {
    const { ctx, strokeCalls } = makeSpyCtx();
    drawGrid(ctx, 8, 8, 20, 4);

    const allWidths = strokeCalls.map((c) => c.lineWidth);
    const maxWidth = Math.max(...allWidths);
    // tier-0 is always the first stroke call
    expect(strokeCalls[0]!.lineWidth).toBe(maxWidth);
  });

  it('G=2: tier-0 lineWidth is the max of all stroke lineWidths', () => {
    const { ctx, strokeCalls } = makeSpyCtx();
    drawGrid(ctx, 4, 4, 20, 2);

    const allWidths = strokeCalls.map((c) => c.lineWidth);
    const maxWidth = Math.max(...allWidths);
    expect(strokeCalls[0]!.lineWidth).toBe(maxWidth);
  });
});
