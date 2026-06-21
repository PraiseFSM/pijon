// @vitest-environment node
/**
 * §14.6 — Granularity render density + center-based nearness
 *
 * Tests:
 * 1. effectiveCellSize derivation — pure math helper
 * 2. Center-based distance — furnitureDistance for odd/even/mixed sizes
 *    (tested indirectly via SeatGraph.areNeighbors)
 * 3. Granularity invariance — neighbor sets identical across G=1/2/3
 * 4. Allocator invariance — greedy allocation identical across G change
 * 5. Board size constant — gridW * effectiveCellSize stays constant
 *
 * No DOM, No React, No network.
 */

import { describe, it, expect } from 'vitest';
import { effectiveCellSize, boardWidthPx } from '../ui/canvas/cellSizeHelper.js';
import { SeatGraph } from '../domain/seatGraph.js';
import { makeClassroom, setGranularity } from '../domain/classroom.js';
import { furnitureId } from '../domain/types.js';
import { makeStudent } from '../domain/student.js';
import { studentId as makeStudentId } from '../domain/types.js';
import { GreedyAllocator } from '../domain/allocators/greedy.js';
import type { Furniture } from '../domain/furniture.js';
import type { Classroom } from '../domain/classroom.js';

// ---------------------------------------------------------------------------
// Seeded RNG — deterministic allocator testing
// ---------------------------------------------------------------------------

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// Helpers — build furniture records
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

// ---------------------------------------------------------------------------
// 1. effectiveCellSize derivation — pure math, no DOM
// ---------------------------------------------------------------------------

describe('§14.6 effectiveCellSize derivation', () => {
  it('G=1: effectiveCellSize(48, 1) === 48', () => {
    expect(effectiveCellSize(48, 1)).toBe(48);
  });

  it('G=2: effectiveCellSize(48, 2) === 24', () => {
    expect(effectiveCellSize(48, 2)).toBe(24);
  });

  it('G=4: effectiveCellSize(48, 4) === 12', () => {
    expect(effectiveCellSize(48, 4)).toBe(12);
  });

  it('boardWidthPx at G=1: 10 fine cells × 48px = 480px', () => {
    expect(boardWidthPx(10, 48, 1)).toBe(480);
  });

  it('boardWidthPx at G=2: 20 fine cells × 24px = 480px (same physical size)', () => {
    expect(boardWidthPx(20, 48, 2)).toBe(480);
  });

  it('boardWidthPx at G=3: 30 fine cells × 16px = 480px (same physical size)', () => {
    expect(boardWidthPx(30, 48, 3)).toBe(480);
  });
});

// ---------------------------------------------------------------------------
// 2. Center-based distance (via SeatGraph.areNeighbors)
// ---------------------------------------------------------------------------

describe('§14.6 center-based nearness — SeatGraph.areNeighbors', () => {
  /**
   * Helper: build a one-off classroom with exactly the given furniture pieces,
   * build a SeatGraph, and check whether two furniture ids are neighbors.
   */
  function neighborsAt(
    pieces: Furniture[],
    aId: string,
    bId: string,
    threshold = 1.5,
  ): boolean {
    const c: Classroom = {
      ...makeClassroom('test', 'test', 20, 20),
      furniture: pieces,
    };
    const g = new SeatGraph(c, threshold);
    return g.areNeighbors(furnitureId(aId), furnitureId(bId));
  }

  it('two 1×1 desks adjacent (dist=1.0) → neighbors at threshold 1.5', () => {
    const pieces = [makeDesk('a', 0, 0, 1, 1), makeDesk('b', 1, 0, 1, 1)];
    // centers: (0.5,0.5) and (1.5,0.5), dist=1.0
    expect(neighborsAt(pieces, 'a', 'b')).toBe(true);
  });

  it('two 2×2 tables at (0,0) and (2,0): dist=2.0 → NOT neighbors at threshold 1.5', () => {
    const pieces = [makeDesk('a', 0, 0, 2, 2), makeDesk('b', 2, 0, 2, 2)];
    // centers: (1,1) and (3,1), dist=2.0
    expect(neighborsAt(pieces, 'a', 'b', 1.5)).toBe(false);
  });

  it('two 2×2 tables at (0,0) and (2,0): dist=2.0 → neighbors at threshold 2.0', () => {
    const pieces = [makeDesk('a', 0, 0, 2, 2), makeDesk('b', 2, 0, 2, 2)];
    expect(neighborsAt(pieces, 'a', 'b', 2.0)).toBe(true);
  });

  it('mixed: 1×1 desk at (0,0) and 2×2 table at (1,0): dist≈1.58 → NOT neighbors at 1.5', () => {
    const pieces = [makeDesk('a', 0, 0, 1, 1), makeDesk('b', 1, 0, 2, 2)];
    // desk center (0.5,0.5), table center (2,1), dist=√((2-0.5)²+(1-0.5)²)=√(2.25+0.25)=√2.5≈1.581
    expect(neighborsAt(pieces, 'a', 'b', 1.5)).toBe(false);
  });

  it('mixed: 1×1 desk at (0,0) and 2×2 table at (1,0): dist≈1.58 → neighbors at 2.0', () => {
    const pieces = [makeDesk('a', 0, 0, 1, 1), makeDesk('b', 1, 0, 2, 2)];
    expect(neighborsAt(pieces, 'a', 'b', 2.0)).toBe(true);
  });

  it('symmetry: distance(a,b) === distance(b,a)', () => {
    const pieces = [makeDesk('a', 0, 0, 1, 1), makeDesk('b', 1, 0, 2, 2)];
    const ab = neighborsAt(pieces, 'a', 'b', 2.0);
    const ba = neighborsAt(pieces, 'b', 'a', 2.0);
    expect(ab).toBe(ba);
  });

  it('odd sizes: 3×3 at (0,0) and 1×1 at (3,0): dist=√5≈2.24 → NOT at threshold 1.5', () => {
    const pieces = [makeDesk('a', 0, 0, 3, 3), makeDesk('b', 3, 0, 1, 1)];
    // centers: (1.5,1.5) and (3.5,0.5), dist=√((3.5-1.5)²+(0.5-1.5)²)=√(4+1)=√5≈2.236
    expect(neighborsAt(pieces, 'a', 'b', 1.5)).toBe(false);
  });

  it('just-at-threshold: 1×1 at (0,0) and 2×1 at (1,0): dist=1.5 exactly → neighbor (≤ threshold)', () => {
    const pieces = [makeDesk('a', 0, 0, 1, 1), makeDesk('b', 1, 0, 2, 1)];
    // desk center (0.5,0.5), 2×1 center (2,0.5), dist=√((2-0.5)²+(0.5-0.5)²)=1.5
    expect(neighborsAt(pieces, 'a', 'b', 1.5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Granularity invariance — neighbor sets identical across G=1/2/3
// ---------------------------------------------------------------------------

describe('§14.6 granularity invariance — SeatGraph neighbors', () => {
  /**
   * Build a realistic 4-desk classroom at G=1.
   * Layout (units): 3 student desks in a row + 1 teacher desk nearby.
   *
   *   [d1][d2][d3]
   *   [teacher]
   */
  function baseClassroomG1(): Classroom {
    const d1 = makeDesk('d1', 0, 0, 1, 1);
    const d2 = makeDesk('d2', 1, 0, 1, 1);
    const d3 = makeDesk('d3', 2, 0, 1, 1);
    // Teacher desk is 2 units wide, placed below the row at (0,1)
    const teacher = makeDesk('teacher', 0, 1, 2, 1);
    return {
      ...makeClassroom('g1', 'test', 6, 4, 1, 1.5),
      furniture: [d1, d2, d3, teacher],
    };
  }

  /**
   * Collect all neighbor pairs as a Set of sorted "a:b" strings.
   * This is order-independent so we can compare across granularities.
   */
  function neighborSet(c: Classroom): Set<string> {
    const g = new SeatGraph(c, c.thresholdUnits);
    const pairs = new Set<string>();
    for (const [fid] of g.nodes) {
      for (const nbr of g.neighbors(fid)) {
        const key = [fid, nbr].sort().join(':');
        pairs.add(key);
      }
    }
    return pairs;
  }

  it('G=1 and G=2 have identical neighbor sets', () => {
    const classG1 = baseClassroomG1();
    const classG2 = setGranularity(classG1, 2);

    const setG1 = neighborSet(classG1);
    const setG2 = neighborSet(classG2);

    expect(setG1.size).toBeGreaterThan(0); // sanity: there are some neighbors
    expect(setG2.size).toBe(setG1.size);
    for (const pair of setG1) {
      expect(setG2.has(pair)).toBe(true);
    }
  });

  it('G=1 and G=3 have identical neighbor sets', () => {
    const classG1 = baseClassroomG1();
    const classG3 = setGranularity(classG1, 3);

    const setG1 = neighborSet(classG1);
    const setG3 = neighborSet(classG3);

    expect(setG3.size).toBe(setG1.size);
    for (const pair of setG1) {
      expect(setG3.has(pair)).toBe(true);
    }
  });

  it('G=2 → back to G=1 gives identical neighbor sets as original G=1', () => {
    const classG1 = baseClassroomG1();
    const classG2 = setGranularity(classG1, 2);
    const classBackToG1 = setGranularity(classG2, 1);

    const setOriginal = neighborSet(classG1);
    const setRestored = neighborSet(classBackToG1);

    expect(setRestored.size).toBe(setOriginal.size);
    for (const pair of setOriginal) {
      expect(setRestored.has(pair)).toBe(true);
    }
  });

  it('G=1 and G=2: for every furniture pair, areNeighbors returns same value', () => {
    const classG1 = baseClassroomG1();
    const classG2 = setGranularity(classG1, 2);
    const g1 = new SeatGraph(classG1, classG1.thresholdUnits);
    const g2 = new SeatGraph(classG2, classG2.thresholdUnits);

    const fids = Array.from(g1.nodes.keys());
    for (let i = 0; i < fids.length; i++) {
      for (let j = i + 1; j < fids.length; j++) {
        const a = fids[i]!;
        const b = fids[j]!;
        expect(g1.areNeighbors(a, b)).toBe(g2.areNeighbors(a, b));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Allocator invariance — greedy allocation identical across G change
// ---------------------------------------------------------------------------

describe('§14.6 allocator invariance — GreedyAllocator across granularity', () => {
  /**
   * Build a classroom with 3 student desks in a row.
   * Students: Alice, Bob, Carol (no preferences — only tie-breaking by RNG).
   */
  function buildClassroomAndStudents(G: number): {
    classroom: Classroom;
    students: ReturnType<typeof makeStudent>[];
  } {
    const baseG1: Classroom = {
      ...makeClassroom('alloc', 'test', 6, 4, 1, 1.5),
      furniture: [
        makeDesk('d1', 0, 0, 1, 1),
        makeDesk('d2', 1, 0, 1, 1),
        makeDesk('d3', 2, 0, 1, 1),
      ],
    };
    const classroom = G === 1 ? baseG1 : setGranularity(baseG1, G);
    const students = [
      makeStudent(makeStudentId('alice'), 'Alice'),
      makeStudent(makeStudentId('bob'), 'Bob'),
      makeStudent(makeStudentId('carol'), 'Carol'),
    ];
    return { classroom, students };
  }

  it('allocation result is the same at G=1, G=2, G=3 (same RNG seed)', () => {
    const runAlloc = (G: number) => {
      const { classroom, students } = buildClassroomAndStudents(G);
      const graph = new SeatGraph(classroom, classroom.thresholdUnits);
      const allocator = new GreedyAllocator(seededRng(42));
      return allocator.allocate(students, classroom, graph);
    };

    const resultG1 = runAlloc(1);
    const resultG2 = runAlloc(2);
    const resultG3 = runAlloc(3);

    // All results should seat the same 3 students
    expect(resultG1.size).toBe(3);
    expect(resultG2.size).toBe(3);
    expect(resultG3.size).toBe(3);

    // Build student-name → furniture-id maps (FurnitureIds are preserved across setGranularity)
    const nameToFid = (result: Map<ReturnType<typeof furnitureId>, ReturnType<typeof makeStudent>>) => {
      const m = new Map<string, string>();
      for (const [fid, student] of result) {
        m.set(student.name, fid);
      }
      return m;
    };

    const mapG1 = nameToFid(resultG1);
    const mapG2 = nameToFid(resultG2);
    const mapG3 = nameToFid(resultG3);

    // Each student should be assigned to the same desk id at all granularities
    for (const name of ['Alice', 'Bob', 'Carol']) {
      expect(mapG2.get(name)).toBe(mapG1.get(name));
      expect(mapG3.get(name)).toBe(mapG1.get(name));
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Regression: board size constant (pure math, no DOM)
// ---------------------------------------------------------------------------

describe('§14.6 board size constant — gridW × effectiveCellSize', () => {
  const BASE_UNIT_PX = 48;
  const BASE_GRID_UNITS = 10; // 10 units wide at G=1

  it('at G=1: gridW=10 fine cells × 48px = 480px', () => {
    const G = 1;
    const gridW = BASE_GRID_UNITS * G; // 10
    const ecs = effectiveCellSize(BASE_UNIT_PX, G); // 48
    expect(gridW * ecs).toBe(480);
  });

  it('after setGranularity to G=2: gridW=20 fine cells × 24px = 480px (unchanged)', () => {
    const G = 2;
    const gridW = BASE_GRID_UNITS * G; // 20
    const ecs = effectiveCellSize(BASE_UNIT_PX, G); // 24
    expect(gridW * ecs).toBe(480);
  });

  it('after setGranularity to G=3: gridW=30 fine cells × 16px = 480px (unchanged)', () => {
    const G = 3;
    const gridW = BASE_GRID_UNITS * G; // 30
    const ecs = effectiveCellSize(BASE_UNIT_PX, G); // 16
    expect(gridW * ecs).toBe(480);
  });

  it('setGranularity scales gridW correctly and effectiveCellSize compensates', () => {
    const baseClassroom = makeClassroom('c1', 'test', 10, 8, 1);
    expect(baseClassroom.gridW).toBe(10);

    const classG2 = setGranularity(baseClassroom, 2);
    expect(classG2.gridW).toBe(20); // gridW doubled

    const classG3 = setGranularity(baseClassroom, 3);
    expect(classG3.gridW).toBe(30); // gridW tripled

    // Board pixel width stays constant
    const boardG1 = classG2.gridW / 2 /* undo the doubling */ * effectiveCellSize(BASE_UNIT_PX, classG2.cellsPerUnit);
    void boardG1; // not the right way — let's just check the direct formula:

    // Direct: gridW_at_G × ecs_at_G = BASE_UNIT_PX × BASE_GRID_UNITS for all G
    for (const cls of [baseClassroom, classG2, classG3]) {
      const ecs = effectiveCellSize(BASE_UNIT_PX, cls.cellsPerUnit);
      expect(cls.gridW * ecs).toBe(BASE_UNIT_PX * BASE_GRID_UNITS); // 480
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Palette furniture placement scaling — new desks placed at G>1 must have
//    correct fine-cell dimensions so physical size is unchanged.
// ---------------------------------------------------------------------------

import { makeFurnitureForPalette } from '../ui/editors/FurnitureEditor.js';

describe('§14.6 palette furniture scaling — new placement at G>1', () => {
  /**
   * makeFurnitureForPalette is the exported wrapper that applies cellsPerUnit
   * scaling.  Tests verify that placing a desk at G=2 produces 2×2 fine cells
   * (not 1×1), and that the single_desk physical footprint is constant across G.
   */

  it('single_desk at G=1 has w=1, h=1 (baseline)', () => {
    const f = makeFurnitureForPalette('single_desk', { x: 0, y: 0 }, 1);
    expect(f.w).toBe(1);
    expect(f.h).toBe(1);
  });

  it('single_desk at G=2 has w=2, h=2 (scaled to fine cells)', () => {
    const f = makeFurnitureForPalette('single_desk', { x: 0, y: 0 }, 2);
    expect(f.w).toBe(2);
    expect(f.h).toBe(2);
  });

  it('single_desk at G=3 has w=3, h=3', () => {
    const f = makeFurnitureForPalette('single_desk', { x: 0, y: 0 }, 3);
    expect(f.w).toBe(3);
    expect(f.h).toBe(3);
  });

  it('table (2×2 units) at G=2 has w=4, h=4 fine cells', () => {
    const f = makeFurnitureForPalette('table', { x: 0, y: 0 }, 2);
    expect(f.w).toBe(4);
    expect(f.h).toBe(4);
  });

  it('whiteboard (4×1 units) at G=2 has w=8, h=2 fine cells', () => {
    const f = makeFurnitureForPalette('whiteboard', { x: 0, y: 0 }, 2);
    expect(f.w).toBe(8);
    expect(f.h).toBe(2);
  });

  it('physical pixel size is constant: (w/G) × baseUnitPx is the same at G=1 and G=2', () => {
    const BASE = 48;
    const g1 = makeFurnitureForPalette('single_desk', { x: 0, y: 0 }, 1);
    const g2 = makeFurnitureForPalette('single_desk', { x: 0, y: 0 }, 2);

    // Physical width in pixels = (w_fine_cells) * ecs = w * (BASE/G)
    const physG1 = g1.w * effectiveCellSize(BASE, 1); // 1 * 48 = 48
    const physG2 = g2.w * effectiveCellSize(BASE, 2); // 2 * 24 = 48
    expect(physG1).toBe(physG2);
    expect(physG1).toBe(BASE); // 48px — one unit
  });

  it('new desk at G=2 placed via SeatGraph has correct center distance to neighbor', () => {
    // Build classroom at G=2, place two single_desks adjacent (as would be placed from palette)
    const classroom = makeClassroom('c', 'test', 20, 20, 2, 1.5);
    const d1 = makeFurnitureForPalette('single_desk', { x: 0, y: 0 }, 2); // w=2, h=2
    const d2 = makeFurnitureForPalette('single_desk', { x: 2, y: 0 }, 2); // w=2, h=2 at fine-cell (2,0)
    const cl = { ...classroom, furniture: [d1, d2] };

    // At G=2, d1 center = (1,1), d2 center = (3,1), dist=2.0
    // threshold = 1.5 units * G=2 = 3.0 cells → they ARE neighbors
    const g = new SeatGraph(cl, cl.thresholdUnits);
    expect(g.areNeighbors(d1.id, d2.id)).toBe(true);
  });
});
