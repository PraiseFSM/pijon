// @vitest-environment node
/**
 * Tests for §12.3 — Adjustable grid and finer granularity.
 *
 * Covers:
 *   (a) resizeGrid: add/remove at each edge; shift behaviour at top/left;
 *       blocked when occupied; allowed when clear; bounds guards.
 *   (b) setGranularity: physical layout unchanged; G=1 identity;
 *       round-trip G up then down; gridW/H scale.
 *   (c) Nearness invariance: same physical layout → same SeatGraph neighbours
 *       at G=1 and G=2; threshold-in-units changes neighbours as expected.
 *   (d) Allocator regression: greedy result identical at G=1 and G=2 with
 *       same physical layout and fixed RNG seed.
 *   (e) projectFile v1→v2 migration round-trip.
 */

import { describe, it, expect } from 'vitest';
import {
  makeClassroom,
  resizeGrid,
  setGranularity,
  DEFAULT_THRESHOLD_UNITS,
  DEFAULT_CELLS_PER_UNIT,
} from './classroom.js';
import { SeatGraph, PROXIMITY_THRESHOLD } from './seatGraph.js';
import { furnitureId, studentId } from './types.js';
import { makeStudent } from './student.js';
import { GreedyAllocator } from './allocators/greedy.js';
import {
  parseProject,
  serializeProject,
  extractProject,
  composeClassroom,
  importLegacyClassroom,
  CURRENT_VERSION,
} from './io/projectFile.js';
import type { Furniture } from './furniture.js';
import type { Classroom } from './classroom.js';
import type { FurnitureId } from './types.js';
import type { Student } from './student.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkDesk(id: string, x: number, y: number, w = 1, h = 1): Furniture {
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

function mkStudent(id: string, name: string): Student {
  return makeStudent(studentId(id), name);
}

function mkClassroom(
  gridW: number,
  gridH: number,
  ...furniture: Furniture[]
): Classroom {
  return {
    id: 'test',
    name: 'Test',
    gridW,
    gridH,
    furniture,
    cellsPerUnit: DEFAULT_CELLS_PER_UNIT,
    thresholdUnits: DEFAULT_THRESHOLD_UNITS,
  };
}

/** Simple LCG — deterministic for tests. */
function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// (a) resizeGrid
// ---------------------------------------------------------------------------

describe('resizeGrid — add rows/columns', () => {
  it('delta=0 returns the same classroom reference', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 0, 0));
    const r = resizeGrid(c, 'bottom', 0);
    expect(r).toEqual({ ok: true, classroom: c });
    if (r.ok) expect(r.classroom).toBe(c); // same reference
  });

  it('add row at bottom increases gridH, furniture unchanged', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 0, 0));
    const r = resizeGrid(c, 'bottom', 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classroom.gridH).toBe(9);
    expect(r.classroom.gridW).toBe(10);
    expect(r.classroom.furniture[0]?.pos).toEqual({ x: 0, y: 0 });
  });

  it('add column at right increases gridW, furniture unchanged', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 0, 0));
    const r = resizeGrid(c, 'right', 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classroom.gridW).toBe(11);
    expect(r.classroom.gridH).toBe(8);
    expect(r.classroom.furniture[0]?.pos).toEqual({ x: 0, y: 0 });
  });

  it('add row at TOP shifts all furniture down by 1', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 2, 3));
    const r = resizeGrid(c, 'top', 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classroom.gridH).toBe(9);
    // Desk should have shifted from y=3 to y=4
    expect(r.classroom.furniture[0]?.pos).toEqual({ x: 2, y: 4 });
  });

  it('add column at LEFT shifts all furniture right by 1', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 2, 3));
    const r = resizeGrid(c, 'left', 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classroom.gridW).toBe(11);
    // Desk should have shifted from x=2 to x=3
    expect(r.classroom.furniture[0]?.pos).toEqual({ x: 3, y: 3 });
  });

  it('add 3 rows at top shifts furniture by 3', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 0, 0));
    const r = resizeGrid(c, 'top', 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classroom.gridH).toBe(11);
    expect(r.classroom.furniture[0]?.pos).toEqual({ x: 0, y: 3 });
  });

  it('cellsPerUnit and thresholdUnits are preserved after resize', () => {
    const c = { ...mkClassroom(10, 8), cellsPerUnit: 2, thresholdUnits: 2.0 };
    const r = resizeGrid(c, 'bottom', 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classroom.cellsPerUnit).toBe(2);
    expect(r.classroom.thresholdUnits).toBe(2.0);
  });
});

describe('resizeGrid — remove rows/columns (allowed)', () => {
  it('remove bottom row when no furniture touches it', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 0, 0));
    const r = resizeGrid(c, 'bottom', -1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classroom.gridH).toBe(7);
    // Desk at (0,0) is fine
    expect(r.classroom.furniture[0]?.pos).toEqual({ x: 0, y: 0 });
  });

  it('remove right column when no furniture touches it', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 0, 0));
    const r = resizeGrid(c, 'right', -1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classroom.gridW).toBe(9);
  });

  it('remove top row when no furniture in top row (shifts furniture up)', () => {
    // Desk at (0, 2) — removing the top row shifts it to y=1
    const c = mkClassroom(10, 8, mkDesk('d', 0, 2));
    const r = resizeGrid(c, 'top', -1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classroom.gridH).toBe(7);
    expect(r.classroom.furniture[0]?.pos).toEqual({ x: 0, y: 1 });
  });

  it('remove left column when no furniture in left col (shifts furniture left)', () => {
    // Desk at (2, 0) — removing the left col shifts it to x=1
    const c = mkClassroom(10, 8, mkDesk('d', 2, 0));
    const r = resizeGrid(c, 'left', -1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classroom.gridW).toBe(9);
    expect(r.classroom.furniture[0]?.pos).toEqual({ x: 1, y: 0 });
  });
});

describe('resizeGrid — blocked when furniture is in the way', () => {
  it('blocked: remove bottom row occupied by furniture', () => {
    // 10×8 grid, desk at row 7 (last row) → removing bottom blocks
    const c = mkClassroom(10, 8, mkDesk('d', 0, 7));
    const r = resizeGrid(c, 'bottom', -1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/cannot resize/i);
  });

  it('blocked: remove right column occupied by furniture', () => {
    // 10×8 grid, desk at col 9 (last col)
    const c = mkClassroom(10, 8, mkDesk('d', 9, 0));
    const r = resizeGrid(c, 'right', -1);
    expect(r.ok).toBe(false);
  });

  it('blocked: remove top row when furniture is IN the top row (shift would make pos negative)', () => {
    // Desk at y=0 → removing top shifts to y=-1 → out of bounds
    const c = mkClassroom(10, 8, mkDesk('d', 0, 0));
    const r = resizeGrid(c, 'top', -1);
    expect(r.ok).toBe(false);
  });

  it('blocked: remove left column when furniture is IN the left column', () => {
    // Desk at x=0 → removing left shifts to x=-1 → out of bounds
    const c = mkClassroom(10, 8, mkDesk('d', 0, 0));
    const r = resizeGrid(c, 'left', -1);
    expect(r.ok).toBe(false);
  });

  it('blocked: removing 2 rows when furniture is 1 row from the bottom', () => {
    // 10×8 grid, desk at (0,6) with h=2 → occupies rows 6 and 7
    // Removing 2 from bottom: newH=6 → desk would span to row 7 (out of bounds at 6)
    const c = mkClassroom(10, 8, mkDesk('d', 0, 6, 1, 2));
    const r = resizeGrid(c, 'bottom', -2);
    expect(r.ok).toBe(false);
  });

  it('blocked: remove more columns than grid width allows (minimum 1)', () => {
    const c = mkClassroom(1, 8);
    const r = resizeGrid(c, 'right', -1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/too narrow|minimum/i);
  });

  it('blocked: remove more rows than grid height allows (minimum 1)', () => {
    const c = mkClassroom(10, 1);
    const r = resizeGrid(c, 'bottom', -1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/too short|minimum/i);
  });
});

describe('resizeGrid — no furniture edge cases', () => {
  it('empty grid can add and remove freely', () => {
    const c = mkClassroom(5, 5);
    const r1 = resizeGrid(c, 'top', 3);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.classroom.gridH).toBe(8);

    const r2 = resizeGrid(r1.classroom, 'top', -3);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.classroom.gridH).toBe(5);
  });

  it('multiple desks — all shift on top-add', () => {
    const c = mkClassroom(10, 8, mkDesk('a', 0, 0), mkDesk('b', 5, 5));
    const r = resizeGrid(c, 'top', 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classroom.furniture[0]?.pos).toEqual({ x: 0, y: 2 });
    expect(r.classroom.furniture[1]?.pos).toEqual({ x: 5, y: 7 });
  });

  it('furniture right at the new boundary is allowed (not over)', () => {
    // 10×8, desk at (0,7), remove from bottom would fail.
    // But desk at (0,6), remove bottom (newH=7) → desk still fits at y=6 < 7
    const c = mkClassroom(10, 8, mkDesk('d', 0, 6));
    const r = resizeGrid(c, 'bottom', -1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classroom.gridH).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// (b) setGranularity
// ---------------------------------------------------------------------------

describe('setGranularity — basic scaling', () => {
  it('G=1 (no change) returns the same classroom reference', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 2, 3));
    const c2 = setGranularity(c, 1);
    expect(c2).toBe(c); // same reference
  });

  it('gridW and gridH scale by G2/G1', () => {
    const c = mkClassroom(10, 8); // G=1
    const c2 = setGranularity(c, 2);
    expect(c2.gridW).toBe(20);
    expect(c2.gridH).toBe(16);
    expect(c2.cellsPerUnit).toBe(2);
  });

  it('furniture position scales by G2/G1', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 3, 4));
    const c2 = setGranularity(c, 2);
    expect(c2.furniture[0]?.pos).toEqual({ x: 6, y: 8 });
  });

  it('furniture size (w, h) scales by G2/G1', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 0, 0, 2, 3));
    const c2 = setGranularity(c, 2);
    expect(c2.furniture[0]?.w).toBe(4);
    expect(c2.furniture[0]?.h).toBe(6);
  });

  it('thresholdUnits is NOT changed (stays in real-world units)', () => {
    const c = mkClassroom(10, 8);
    const c2 = setGranularity(c, 2);
    expect(c2.thresholdUnits).toBe(c.thresholdUnits);
  });

  it('round-trip G=1 → G=2 → G=1 preserves original layout', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 3, 4, 2, 2));
    const c2 = setGranularity(c, 2);
    const c3 = setGranularity(c2, 1);
    expect(c3.gridW).toBe(c.gridW);
    expect(c3.gridH).toBe(c.gridH);
    expect(c3.furniture[0]?.pos).toEqual(c.furniture[0]?.pos);
    expect(c3.furniture[0]?.w).toEqual(c.furniture[0]?.w);
    expect(c3.furniture[0]?.h).toEqual(c.furniture[0]?.h);
    expect(c3.cellsPerUnit).toBe(1);
  });

  it('round-trip G=2 → G=4 → G=2 preserves intermediate layout', () => {
    // Start with G=2
    const c2 = { ...mkClassroom(20, 16, mkDesk('d', 6, 8)), cellsPerUnit: 2 };
    const c4 = setGranularity(c2, 4);
    expect(c4.gridW).toBe(40);
    expect(c4.furniture[0]?.pos).toEqual({ x: 12, y: 16 });
    const back = setGranularity(c4, 2);
    expect(back.gridW).toBe(20);
    expect(back.furniture[0]?.pos).toEqual({ x: 6, y: 8 });
  });

  it('increasing G with multiple desks scales all uniformly', () => {
    const c = mkClassroom(10, 8, mkDesk('a', 0, 0), mkDesk('b', 5, 3));
    const c2 = setGranularity(c, 3);
    expect(c2.furniture[0]?.pos).toEqual({ x: 0, y: 0 });
    expect(c2.furniture[1]?.pos).toEqual({ x: 15, y: 9 });
    expect(c2.gridW).toBe(30);
    expect(c2.gridH).toBe(24);
  });

  it('throws on G < 1', () => {
    const c = mkClassroom(10, 8);
    expect(() => setGranularity(c, 0)).toThrow(TypeError);
  });

  it('throws on non-integer G', () => {
    const c = mkClassroom(10, 8);
    expect(() => setGranularity(c, 1.5)).toThrow(TypeError);
  });

  it('throws when grid or furniture value would not scale to integer', () => {
    // G=1 → G=3: gridW=10 → 10*3/1=30 (fine); but G=2 → G=3: 10*3/2=15 fine
    // Try something that fails: G=3 → G=2: 10*2/3=6.66... (not integer)
    const c = { ...mkClassroom(10, 8, mkDesk('d', 3, 0)), cellsPerUnit: 3 };
    // 3*2/3=2 for desk x — wait, that's fine. Try G=3 → G=2 with a value not divisible:
    // gridW=10, 10*2/3 = 6.666... → should throw
    expect(() => setGranularity(c, 2)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// (c) Nearness / proximity invariance
// ---------------------------------------------------------------------------

describe('SeatGraph — nearness invariance across granularity', () => {
  /**
   * Helper: build a 3-desk classroom at G=1, then scale to G=2.
   * Verify the neighbour sets are identical.
   *
   * Physical layout (G=1):
   *   desk A at (0,0) 1×1 → center (0.5, 0.5)
   *   desk B at (1,0) 1×1 → center (1.5, 0.5)   distance=1.0
   *   desk C at (3,0) 1×1 → center (3.5, 0.5)   distance=3.0 (not neighbor)
   *
   * Default threshold = 1.5 units → A↔B neighbors, A↔C not.
   */
  function buildPhysicalClassroom(cellsPerUnit: number) {
    const G = cellsPerUnit;
    return {
      id: 'test',
      name: 'Test',
      gridW: 10 * G,
      gridH: 8 * G,
      cellsPerUnit: G,
      thresholdUnits: DEFAULT_THRESHOLD_UNITS,
      furniture: [
        mkDesk('a', 0 * G, 0 * G, G, G),
        mkDesk('b', 1 * G, 0 * G, G, G),
        mkDesk('c', 3 * G, 0 * G, G, G),
      ] as Furniture[],
    };
  }

  it('A and B are neighbors at G=1 (distance=1.0 < 1.5 units)', () => {
    const c = buildPhysicalClassroom(1);
    const g = new SeatGraph(c);
    expect(g.areNeighbors(furnitureId('a'), furnitureId('b'))).toBe(true);
  });

  it('A and B are neighbors at G=2 (same physical layout, distance=1.0 unit)', () => {
    const c = buildPhysicalClassroom(2);
    const g = new SeatGraph(c);
    expect(g.areNeighbors(furnitureId('a'), furnitureId('b'))).toBe(true);
  });

  it('A and C are NOT neighbors at G=1 (distance=3.0 > 1.5 units)', () => {
    const c = buildPhysicalClassroom(1);
    const g = new SeatGraph(c);
    expect(g.areNeighbors(furnitureId('a'), furnitureId('c'))).toBe(false);
  });

  it('A and C are NOT neighbors at G=2 (same physical layout, distance=3.0 units)', () => {
    const c = buildPhysicalClassroom(2);
    const g = new SeatGraph(c);
    expect(g.areNeighbors(furnitureId('a'), furnitureId('c'))).toBe(false);
  });

  it('neighbor count for A is identical at G=1 and G=2', () => {
    const g1 = new SeatGraph(buildPhysicalClassroom(1));
    const g2 = new SeatGraph(buildPhysicalClassroom(2));
    const n1 = g1.neighbors(furnitureId('a')).length;
    const n2 = g2.neighbors(furnitureId('a')).length;
    expect(n1).toBe(n2);
  });

  it('neighbor sets match: setGranularity-produced classroom gives same graph as hand-built G=2', () => {
    const c1 = buildPhysicalClassroom(1);
    const c2 = setGranularity(c1, 2);

    const g1 = new SeatGraph(c1);
    const g2 = new SeatGraph(c2);

    // Same number of nodes
    expect(g2.nodes.size).toBe(g1.nodes.size);

    // A↔B neighbor in both
    expect(g2.areNeighbors(furnitureId('a'), furnitureId('b'))).toBe(
      g1.areNeighbors(furnitureId('a'), furnitureId('b')),
    );
    // A↔C not neighbor in both
    expect(g2.areNeighbors(furnitureId('a'), furnitureId('c'))).toBe(
      g1.areNeighbors(furnitureId('a'), furnitureId('c')),
    );
  });

  it('diagonal desks are neighbors at G=1 and G=2 (distance=√2 ≈ 1.414 < 1.5)', () => {
    function diagClassroom(G: number) {
      return {
        id: 't', name: 'T', gridW: 10 * G, gridH: 10 * G,
        cellsPerUnit: G, thresholdUnits: DEFAULT_THRESHOLD_UNITS,
        furniture: [mkDesk('x', 0 * G, 0 * G, G, G), mkDesk('y', 1 * G, 1 * G, G, G)],
      };
    }
    const g1 = new SeatGraph(diagClassroom(1));
    const g2 = new SeatGraph(diagClassroom(2));
    expect(g1.areNeighbors(furnitureId('x'), furnitureId('y'))).toBe(true);
    expect(g2.areNeighbors(furnitureId('x'), furnitureId('y'))).toBe(true);
  });

  it('threshold-in-units change widens neighbours as expected', () => {
    // A is at (0,0) 1×1, C is at (3,0) 1×1 — 3 units apart.
    // Raising threshold to 4 units should make A↔C neighbors.
    const c = buildPhysicalClassroom(1);
    const gNarrow = new SeatGraph(c, DEFAULT_THRESHOLD_UNITS);  // 1.5 units
    const gWide = new SeatGraph(c, 4.0);                        // 4 units
    expect(gNarrow.areNeighbors(furnitureId('a'), furnitureId('c'))).toBe(false);
    expect(gWide.areNeighbors(furnitureId('a'), furnitureId('c'))).toBe(true);
  });

  it('threshold change at G=2 works correctly in units', () => {
    // Same physical layout at G=2: A and C are 3 units apart.
    const c = buildPhysicalClassroom(2);
    const gNarrow = new SeatGraph(c, DEFAULT_THRESHOLD_UNITS);
    const gWide = new SeatGraph(c, 4.0);
    expect(gNarrow.areNeighbors(furnitureId('a'), furnitureId('c'))).toBe(false);
    expect(gWide.areNeighbors(furnitureId('a'), furnitureId('c'))).toBe(true);
  });

  it('PROXIMITY_THRESHOLD constant is 1.5 (same as DEFAULT_THRESHOLD_UNITS)', () => {
    expect(PROXIMITY_THRESHOLD).toBe(DEFAULT_THRESHOLD_UNITS);
    expect(PROXIMITY_THRESHOLD).toBe(1.5);
  });
});

// ---------------------------------------------------------------------------
// (d) Allocator regression: same physical layout → same greedy result
// ---------------------------------------------------------------------------

describe('GreedyAllocator — granularity regression', () => {
  /**
   * Build a small 3-desk classroom with 3 students, run the Greedy allocator
   * at G=1 and G=2, and verify the per-seat assignment patterns are equivalent.
   *
   * "Equivalent" means: the set of (studentName, deskId) pairs is the same
   * after mapping fine-cell ids back through the G=1 desk layout. Because the
   * GreedyAllocator uses marginal costs that derive from the SeatGraph (which
   * in turn derives neighbour sets from the physical layout), a pure granularity
   * change must not alter the allocation.
   *
   * We use the same seeded RNG for both runs.
   */

  function buildClassroomAtG(G: number): Classroom {
    // Three desks at (0,0), (1,0), (2,0) in unit space — linearly arranged.
    return {
      id: 'test', name: 'T',
      gridW: 10 * G, gridH: 8 * G,
      cellsPerUnit: G, thresholdUnits: DEFAULT_THRESHOLD_UNITS,
      furniture: [
        mkDesk('a', 0 * G, 0 * G, G, G),
        mkDesk('b', 1 * G, 0 * G, G, G),
        mkDesk('c', 2 * G, 0 * G, G, G),
      ],
    };
  }

  it('greedy result is equivalent at G=1 and G=2 (same physical layout + RNG seed)', () => {
    const SEED = 42;
    const students = [
      mkStudent('s1', 'Alice'),
      mkStudent('s2', 'Bob'),
      mkStudent('s3', 'Carol'),
    ];

    const c1 = buildClassroomAtG(1);
    const c2 = buildClassroomAtG(2);

    const graph1 = new SeatGraph(c1);
    const graph2 = new SeatGraph(c2);

    const result1 = new GreedyAllocator(seededRng(SEED)).allocate(students, c1, graph1);
    const result2 = new GreedyAllocator(seededRng(SEED)).allocate(students, c2, graph2);

    // Build canonical (studentName, deskId) pair sets, normalised to the desk letter
    // (furnitureId is the same string 'a', 'b', 'c' in both classrooms).
    function normalize(m: Map<FurnitureId, Student>): Set<string> {
      const pairs = new Set<string>();
      for (const [fid, student] of m) {
        pairs.add(`${fid}:${student.name}`);
      }
      return pairs;
    }

    const n1 = normalize(result1);
    const n2 = normalize(result2);

    expect(n1.size).toBe(n2.size);
    for (const p of n1) {
      expect(n2.has(p)).toBe(true);
    }
  });

  it('setGranularity then greedy gives same result as original (end-to-end)', () => {
    const SEED = 7;
    const students = [mkStudent('s1', 'Alice'), mkStudent('s2', 'Bob')];

    const c1 = buildClassroomAtG(1);
    const c2 = setGranularity(c1, 2); // physically identical

    const r1 = new GreedyAllocator(seededRng(SEED)).allocate(students, c1, new SeatGraph(c1));
    const r2 = new GreedyAllocator(seededRng(SEED)).allocate(students, c2, new SeatGraph(c2));

    // Same number of seated students
    expect(r1.size).toBe(r2.size);

    // Each student should be at the same named seat
    const names1 = new Set([...r1.values()].map((s) => s.name));
    const names2 = new Set([...r2.values()].map((s) => s.name));
    for (const n of names1) expect(names2.has(n)).toBe(true);

    // Same seat-letter → student mappings
    for (const [fid, student] of r1) {
      expect(r2.get(fid)?.name).toBe(student.name);
    }
  });
});

// ---------------------------------------------------------------------------
// (e) projectFile v1 → v2 migration
// ---------------------------------------------------------------------------

describe('projectFile — v1 → v2 migration', () => {
  /**
   * A minimal v1 project JSON (no cellsPerUnit or thresholdUnits fields).
   */
  const V1_JSON = JSON.stringify({
    version: 1,
    classroom: {
      id: 'cls1',
      name: 'My Class',
      gridW: 10,
      gridH: 8,
      furniture: [],
    },
    roster: [],
    arrangement: {},
    locks: [],
  });

  it('parses a v1 file and migrates it to v2', () => {
    const pf = parseProject(V1_JSON);
    expect(pf.version).toBe(2);
    expect(pf.classroom.cellsPerUnit).toBe(DEFAULT_CELLS_PER_UNIT);
    expect(pf.classroom.thresholdUnits).toBe(DEFAULT_THRESHOLD_UNITS);
  });

  it('migrated v1 file produces a valid Classroom with correct defaults', () => {
    const pf = parseProject(V1_JSON);
    const { classroom } = composeClassroom(pf);
    expect(classroom.cellsPerUnit).toBe(1);
    expect(classroom.thresholdUnits).toBe(1.5);
    expect(classroom.gridW).toBe(10);
    expect(classroom.gridH).toBe(8);
  });

  it('CURRENT_VERSION is 2', () => {
    expect(CURRENT_VERSION).toBe(2);
  });

  it('v2 file parses without migration', () => {
    const c = makeClassroom('cls2', 'Room', 10, 8, 2, 2.0);
    const pf = extractProject({ classroom: c, roster: [], locks: [] });
    const json = serializeProject(pf);
    const parsed = parseProject(json);
    expect(parsed.version).toBe(2);
    expect(parsed.classroom.cellsPerUnit).toBe(2);
    expect(parsed.classroom.thresholdUnits).toBe(2.0);
  });

  it('round-trip: extractProject → serializeProject → parseProject → composeClassroom preserves all fields', () => {
    const c = makeClassroom('cls3', 'Round Trip', 20, 16, 2, 3.0);
    const pf = extractProject({ classroom: c, roster: [], locks: [] });
    const json = serializeProject(pf);
    const parsed = parseProject(json);
    const { classroom } = composeClassroom(parsed);

    expect(classroom.id).toBe('cls3');
    expect(classroom.name).toBe('Round Trip');
    expect(classroom.gridW).toBe(20);
    expect(classroom.gridH).toBe(16);
    expect(classroom.cellsPerUnit).toBe(2);
    expect(classroom.thresholdUnits).toBe(3.0);
  });

  it('v1 file with furniture loads correctly after migration', () => {
    const v1WithFurniture = JSON.stringify({
      version: 1,
      classroom: {
        id: 'cls-f',
        name: 'With Furniture',
        gridW: 10,
        gridH: 8,
        furniture: [{
          id: 'desk-1',
          kind: 'single_desk',
          pos: { x: 2, y: 3 },
          w: 1,
          h: 1,
          rotation: 0,
        }],
      },
      roster: [],
      arrangement: {},
      locks: [],
    });

    const pf = parseProject(v1WithFurniture);
    expect(pf.version).toBe(2);
    const { classroom } = composeClassroom(pf);
    expect(classroom.furniture).toHaveLength(1);
    expect(classroom.furniture[0]?.pos).toEqual({ x: 2, y: 3 });
    expect(classroom.cellsPerUnit).toBe(1);
    expect(classroom.thresholdUnits).toBe(1.5);
  });

  it('v1 file: cells still work as units when migrated (SeatGraph built correctly)', () => {
    // Two desks 1 unit apart in the v1 file → they should be neighbors after migration
    const v1 = JSON.stringify({
      version: 1,
      classroom: {
        id: 'cls-sg',
        name: 'SG Test',
        gridW: 10,
        gridH: 8,
        furniture: [
          { id: 'a', kind: 'single_desk', pos: { x: 0, y: 0 }, w: 1, h: 1, rotation: 0 },
          { id: 'b', kind: 'single_desk', pos: { x: 1, y: 0 }, w: 1, h: 1, rotation: 0 },
        ],
      },
      roster: [],
      arrangement: {},
      locks: [],
    });
    const pf = parseProject(v1);
    const { classroom } = composeClassroom(pf);
    const graph = new SeatGraph(classroom);
    expect(graph.areNeighbors(furnitureId('a'), furnitureId('b'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Misc / edge cases
// ---------------------------------------------------------------------------

describe('makeClassroom defaults', () => {
  it('makeClassroom without extra args has cellsPerUnit=1 and thresholdUnits=1.5', () => {
    const c = makeClassroom('c', 'n', 10, 8);
    expect(c.cellsPerUnit).toBe(DEFAULT_CELLS_PER_UNIT);
    expect(c.thresholdUnits).toBe(DEFAULT_THRESHOLD_UNITS);
  });

  it('makeClassroom with explicit G=2 and threshold=2.0', () => {
    const c = makeClassroom('c', 'n', 10, 8, 2, 2.0);
    expect(c.cellsPerUnit).toBe(2);
    expect(c.thresholdUnits).toBe(2.0);
  });
});

// ---------------------------------------------------------------------------
// resizeGrid — NaN / float delta guard (fixes: NaN bypasses all range checks)
// ---------------------------------------------------------------------------

describe('resizeGrid — input validation for delta', () => {
  it('delta=NaN returns ok:false (not ok:true with corrupted state)', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 0, 0));
    const r = resizeGrid(c, 'top', NaN);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/finite integer/i);
  });

  it('delta=Infinity returns ok:false', () => {
    const c = mkClassroom(10, 8);
    const r = resizeGrid(c, 'bottom', Infinity);
    expect(r.ok).toBe(false);
  });

  it('delta=-Infinity returns ok:false', () => {
    const c = mkClassroom(10, 8);
    const r = resizeGrid(c, 'bottom', -Infinity);
    expect(r.ok).toBe(false);
  });

  it('delta=1.5 (float) returns ok:false', () => {
    const c = mkClassroom(10, 8);
    const r = resizeGrid(c, 'right', 1.5);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/finite integer/i);
  });

  it('delta=-0.5 (float) returns ok:false', () => {
    const c = mkClassroom(10, 8);
    const r = resizeGrid(c, 'left', -0.5);
    expect(r.ok).toBe(false);
  });

  it('delta=2 (valid integer) still succeeds', () => {
    const c = mkClassroom(10, 8);
    const r = resizeGrid(c, 'bottom', 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classroom.gridH).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// resizeGrid — multi-desk where only one is in the way
// ---------------------------------------------------------------------------

describe('resizeGrid — multi-desk partial block', () => {
  it('blocked when one of two desks is in the removed region', () => {
    // Desk A at (0,0) is in the top row; desk B at (0,3) is safe.
    // Removing 1 row from top: desk A shifts to y=-1 → BLOCKED.
    const c = mkClassroom(10, 8, mkDesk('a', 0, 0), mkDesk('b', 0, 3));
    const r = resizeGrid(c, 'top', -1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The reason should mention desk 'a' (the first one found to be out of bounds).
    expect(r.reason).toMatch(/cannot resize/i);
  });

  it('succeeds when none of multiple desks is in the removed region', () => {
    // Desk A at (0,2), desk B at (5,4): both safely above row 0.
    const c = mkClassroom(10, 8, mkDesk('a', 0, 2), mkDesk('b', 5, 4));
    const r = resizeGrid(c, 'top', -1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classroom.furniture[0]?.pos).toEqual({ x: 0, y: 1 });
    expect(r.classroom.furniture[1]?.pos).toEqual({ x: 5, y: 3 });
  });
});

// ---------------------------------------------------------------------------
// resizeGrid — furniture flush against each edge
// ---------------------------------------------------------------------------

describe('resizeGrid — furniture flush against edges', () => {
  it('desk flush against bottom (y=gridH-1) blocks bottom removal', () => {
    // 10×8 grid, desk at y=7 (last row). Remove bottom: should block.
    const c = mkClassroom(10, 8, mkDesk('d', 0, 7));
    expect(resizeGrid(c, 'bottom', -1).ok).toBe(false);
  });

  it('desk one row above bottom (y=gridH-2) allows bottom removal', () => {
    // 10×8 grid, desk at y=6. Remove bottom: newH=7, desk at y=6 < 7 → ok.
    const c = mkClassroom(10, 8, mkDesk('d', 0, 6));
    const r = resizeGrid(c, 'bottom', -1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classroom.furniture[0]?.pos).toEqual({ x: 0, y: 6 });
  });

  it('desk flush against right (x=gridW-1) blocks right removal', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 9, 0));
    expect(resizeGrid(c, 'right', -1).ok).toBe(false);
  });

  it('desk one column from right (x=gridW-2) allows right removal', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 8, 0));
    const r = resizeGrid(c, 'right', -1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classroom.furniture[0]?.pos).toEqual({ x: 8, y: 0 });
  });

  it('desk flush against top (y=0) blocks top removal', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 0, 0));
    expect(resizeGrid(c, 'top', -1).ok).toBe(false);
  });

  it('desk flush against left (x=0) blocks left removal', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 0, 0));
    expect(resizeGrid(c, 'left', -1).ok).toBe(false);
  });

  it('add-then-remove round-trip returns to exact original position', () => {
    const c = mkClassroom(10, 8, mkDesk('d', 3, 5));
    const after_add = resizeGrid(c, 'top', 1);
    expect(after_add.ok).toBe(true);
    if (!after_add.ok) return;
    // Desk shifted to y=6
    expect(after_add.classroom.furniture[0]?.pos.y).toBe(6);

    const after_remove = resizeGrid(after_add.classroom, 'top', -1);
    expect(after_remove.ok).toBe(true);
    if (!after_remove.ok) return;
    // Desk back to y=5
    expect(after_remove.classroom.furniture[0]?.pos).toEqual({ x: 3, y: 5 });
    expect(after_remove.classroom.gridH).toBe(8);
    expect(after_remove.classroom.gridW).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// setGranularity — occupied furniture
// ---------------------------------------------------------------------------

describe('setGranularity — furniture with occupant', () => {
  it('scales occupied furniture; occupant Student object is preserved', () => {
    const student = mkStudent('s1', 'Alice');
    const deskWithOccupant: Furniture = {
      ...mkDesk('d', 2, 3),
      occupants: [student],
    };
    const c = mkClassroom(10, 8, deskWithOccupant);
    const c2 = setGranularity(c, 2);

    const scaledDesk = c2.furniture[0];
    expect(scaledDesk?.pos).toEqual({ x: 4, y: 6 });
    expect(scaledDesk?.w).toBe(2);
    expect(scaledDesk?.h).toBe(2);
    // Occupant is preserved (same student object reference)
    expect(scaledDesk?.occupants[0]).toBe(student);
  });

  it('setGranularity does not mutate the original classroom or its furniture', () => {
    const deskOrig: Furniture = mkDesk('d', 2, 3);
    const c = mkClassroom(10, 8, deskOrig);
    setGranularity(c, 2);
    // Original classroom is unchanged
    expect(c.gridW).toBe(10);
    expect(c.gridH).toBe(8);
    expect(c.furniture[0]?.pos).toEqual({ x: 2, y: 3 });
    expect(c.furniture[0]?.w).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Nearness invariance — G=3 + all 3 pairs
// ---------------------------------------------------------------------------

describe('SeatGraph — nearness invariance at G=3 and all pairs', () => {
  function buildLayout(G: number) {
    return {
      id: 't', name: 'T',
      gridW: 10 * G, gridH: 8 * G,
      cellsPerUnit: G, thresholdUnits: DEFAULT_THRESHOLD_UNITS,
      furniture: [
        mkDesk('a', 0 * G, 0 * G, G, G),  // center at (G/2, G/2)
        mkDesk('b', 1 * G, 0 * G, G, G),  // center at (3G/2, G/2) — 1 unit right of A
        mkDesk('c', 3 * G, 0 * G, G, G),  // center at (7G/2, G/2) — 3 units right of A
      ] as Furniture[],
    };
  }

  for (const G of [1, 2, 3]) {
    it(`G=${String(G)}: A↔B neighbor, B↔C not neighbor, A↔C not neighbor`, () => {
      const c = buildLayout(G);
      const g = new SeatGraph(c);
      // A↔B: 1 unit apart → neighbor (1.0 ≤ 1.5)
      expect(g.areNeighbors(furnitureId('a'), furnitureId('b'))).toBe(true);
      // B↔C: 2 units apart → neighbor (2.0 ≤ 1.5 is FALSE — wait: 2 > 1.5)
      // Actually B is at 1*G, C is at 3*G. Centers: B at 1.5G, C at 3.5G → dist = 2*G cells
      // In units: 2.0 > 1.5 threshold → NOT neighbors
      expect(g.areNeighbors(furnitureId('b'), furnitureId('c'))).toBe(false);
      // A↔C: 3 units apart → not neighbor
      expect(g.areNeighbors(furnitureId('a'), furnitureId('c'))).toBe(false);
    });
  }

  it('all three G values (1, 2, 3) produce identical neighbor sets', () => {
    const g1 = new SeatGraph(buildLayout(1));
    const g2 = new SeatGraph(buildLayout(2));
    const g3 = new SeatGraph(buildLayout(3));

    for (const [x, y] of [
      ['a', 'b'] as const,
      ['a', 'c'] as const,
      ['b', 'c'] as const,
    ]) {
      const v1 = g1.areNeighbors(furnitureId(x), furnitureId(y));
      const v2 = g2.areNeighbors(furnitureId(x), furnitureId(y));
      const v3 = g3.areNeighbors(furnitureId(x), furnitureId(y));
      expect(v2).toBe(v1);
      expect(v3).toBe(v1);
    }
  });
});

// ---------------------------------------------------------------------------
// projectFile — invalid v2 rejected, legacy import defaults
// ---------------------------------------------------------------------------

describe('projectFile — error cases and legacy import', () => {
  it('invalid v2 JSON (wrong type for gridW) throws ProjectParseError', () => {
    const bad = JSON.stringify({
      version: 2,
      classroom: {
        id: 'c', name: 'C',
        gridW: 'not-a-number',   // should be integer
        gridH: 8,
        furniture: [],
        cellsPerUnit: 1,
        thresholdUnits: 1.5,
      },
      roster: [],
      arrangement: {},
      locks: [],
    });
    expect(() => parseProject(bad)).toThrow();
  });

  it('JSON with unknown version (3) throws ProjectParseError', () => {
    const unknown = JSON.stringify({
      version: 3,
      classroom: { id: 'c', name: 'C', gridW: 10, gridH: 8, furniture: [], cellsPerUnit: 1, thresholdUnits: 1.5 },
      roster: [], arrangement: {}, locks: [],
    });
    expect(() => parseProject(unknown)).toThrow();
  });

  it('importLegacyClassroom sets cellsPerUnit=1 and thresholdUnits=1.5', () => {
    const legacy = JSON.stringify({
      name: 'Legacy Room',
      grid_width: 12,
      grid_height: 9,
      furniture: [],
    });
    const pf = importLegacyClassroom(legacy);
    expect(pf.classroom.cellsPerUnit).toBe(1);
    expect(pf.classroom.thresholdUnits).toBe(1.5);
    expect(pf.version).toBe(2);
  });

  it('importLegacyClassroom with furniture produces valid SeatGraph', () => {
    const legacy = JSON.stringify({
      name: 'Legacy Room',
      grid_width: 10,
      grid_height: 8,
      furniture: [
        { furniture_id: 'f1', furniture_type: 'single_desk', position: [0, 0], width: 1, height: 1 },
        { furniture_id: 'f2', furniture_type: 'single_desk', position: [1, 0], width: 1, height: 1 },
      ],
    });
    const pf = importLegacyClassroom(legacy);
    const { classroom } = composeClassroom(pf);
    const graph = new SeatGraph(classroom);
    expect(graph.areNeighbors(furnitureId('f1'), furnitureId('f2'))).toBe(true);
  });
});
