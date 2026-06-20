// @vitest-environment node
/**
 * SeatGraph tests — port and expansion of the Python prototype's
 * tests/test_seat_graph.py.
 *
 * Key TS vs Python difference: in TS, fixtures live in the model as
 * furniture.occupants[0] with isFixture === true, rather than being
 * synthesised automatically by SeatGraph._build(). Test helpers therefore
 * pre-populate fixture occupants using makeFixture + assignOccupant, matching
 * the design decision documented in seatGraph.ts and the TS Implementation Plan.
 */

import { describe, it, expect } from 'vitest';
import { SeatGraph, PROXIMITY_THRESHOLD } from './seatGraph.js';
import { furnitureId, studentId } from './types.js';
import { makeStudent, makeFixture } from './student.js';
import { assignOccupant } from './furniture.js';
import { fixtureId, DEFAULT_THRESHOLD_UNITS, DEFAULT_CELLS_PER_UNIT } from './classroom.js';
import type { Furniture } from './furniture.js';
import type { Classroom } from './classroom.js';
import type { FurnitureId } from './types.js';

// ---------------------------------------------------------------------------
// Tiny helpers — mirror the Python conftest (desk / teacher_desk / student)
// ---------------------------------------------------------------------------

function mkDesk(id: string, x: number, y: number): Furniture {
  return {
    id: furnitureId(id),
    kind: 'single_desk',
    pos: { x, y },
    w: 1,
    h: 1,
    rotation: 0,
    occupants: [],
  };
}

/**
 * Teacher desk with a fixture occupant pre-loaded (TS model requires fixtures
 * to live in the model, not be synthesised by SeatGraph).
 */
function mkTeacherDesk(id: string, x: number, y: number): Furniture {
  const name = 'Teacher Desk';
  const fixId = fixtureId(name);
  const base: Furniture = {
    id: furnitureId(id),
    kind: 'teacher_desk',
    pos: { x, y },
    w: 2,
    h: 2,
    rotation: 0,
    occupants: [],
  };
  return assignOccupant(base, makeFixture(fixId, name));
}

/** Whiteboard with a fixture occupant pre-loaded. */
function mkWhiteboard(id: string, x: number, y: number): Furniture {
  const name = 'Whiteboard';
  const fixId = fixtureId(name);
  const base: Furniture = {
    id: furnitureId(id),
    kind: 'whiteboard',
    pos: { x, y },
    w: 2,
    h: 1,
    rotation: 0,
    occupants: [],
  };
  return assignOccupant(base, makeFixture(fixId, name));
}

function mkClassroom(...furniture: Furniture[]): Classroom {
  return {
    id: 'test-classroom',
    name: 'Test Room',
    gridW: 20,
    gridH: 20,
    furniture,
    cellsPerUnit: DEFAULT_CELLS_PER_UNIT,
    thresholdUnits: DEFAULT_THRESHOLD_UNITS,
  };
}

function fid(id: string): FurnitureId {
  return furnitureId(id);
}

// ---------------------------------------------------------------------------
// Proximity / edge-building tests
// ---------------------------------------------------------------------------

describe('SeatGraph — proximity', () => {
  it('adjacent desks (distance = 1.0) are neighbors', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const g = new SeatGraph(c);
    expect(g.areNeighbors(fid('a'), fid('b'))).toBe(true);
    expect(g.areNeighbors(fid('b'), fid('a'))).toBe(true);
  });

  it('diagonal desks (distance = √2 ≈ 1.414 < 1.5) are neighbors', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 1));
    const g = new SeatGraph(c);
    expect(g.areNeighbors(fid('a'), fid('b'))).toBe(true);
  });

  it('desks two cells apart (distance = 2.0 > 1.5) are NOT neighbors', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 2, 0));
    const g = new SeatGraph(c);
    expect(g.areNeighbors(fid('a'), fid('b'))).toBe(false);
  });

  it('far desks (distance >> 1.5) are NOT neighbors', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 5, 0));
    const g = new SeatGraph(c);
    expect(g.areNeighbors(fid('a'), fid('b'))).toBe(false);
  });

  it('edges are symmetric (neighbors of A include B iff neighbors of B include A)', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0), mkDesk('c', 2, 0));
    const g = new SeatGraph(c);
    for (const id of ['a', 'b', 'c'] as const) {
      for (const nbr of g.neighbors(fid(id))) {
        expect(g.neighbors(nbr)).toContain(fid(id));
      }
    }
  });

  it('just-at-threshold (distance = 1.5) → still a neighbor', () => {
    // Two desks separated so their centers are exactly 1.5 apart:
    // center of (0,0) 1×1 = (0.5, 0.5); center of (2,0) 1×1 = (2.0, 0.5)
    // distance = 1.5 exactly → ≤ threshold → neighbor
    // We need center-to-center = 1.5: offset x by 1 (centers differ by 1.0), so 1×2 at x=1
    // Actually easier: use fractional-position desks via furniture.w/h
    // Use desk at x=0 w=1 h=1: center (0.5, 0.5); desk at x=2 w=2 h=1: center (3.0, 0.5)
    // Distance = 2.5 — not 1.5. Let's do: desk(0,0) w=1 h=1 → center (0.5,0.5)
    // desk(1,0) w=2 h=1 → center (2.0, 0.5) → distance = 1.5 exactly!
    const deskA: Furniture = { ...mkDesk('a', 0, 0), w: 1, h: 1 };
    const deskB: Furniture = { ...mkDesk('b', 1, 0), w: 2, h: 1 };
    const c = mkClassroom(deskA, deskB);
    const g = new SeatGraph(c);
    expect(g.areNeighbors(fid('a'), fid('b'))).toBe(true);
  });

  it('just-over-threshold (distance = 1.5 + ε) → NOT a neighbor', () => {
    // Use custom threshold to precisely test the boundary
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 2, 0));
    // centers: (0.5, 0.5) and (2.5, 0.5) → distance = 2.0
    // With threshold 1.999 they should NOT be neighbors
    const g = new SeatGraph(c, 1.999);
    expect(g.areNeighbors(fid('a'), fid('b'))).toBe(false);
  });

  it('custom proximity threshold widens the neighborhood', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 2, 0));
    const gDefault = new SeatGraph(c);
    const gWide = new SeatGraph(c, 3.0);
    expect(gDefault.areNeighbors(fid('a'), fid('b'))).toBe(false);
    expect(gWide.areNeighbors(fid('a'), fid('b'))).toBe(true);
  });

  it('PROXIMITY_THRESHOLD constant is 1.5', () => {
    expect(PROXIMITY_THRESHOLD).toBe(1.5);
  });

  it('nodes map contains all furniture', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const g = new SeatGraph(c);
    expect(g.nodes.has(fid('a'))).toBe(true);
    expect(g.nodes.has(fid('b'))).toBe(true);
    expect(g.nodes.size).toBe(2);
  });

  it('single-node graph has no neighbors', () => {
    const c = mkClassroom(mkDesk('a', 0, 0));
    const g = new SeatGraph(c);
    expect(g.neighbors(fid('a'))).toHaveLength(0);
  });

  it('unknown fid returns empty neighbors', () => {
    const c = mkClassroom(mkDesk('a', 0, 0));
    const g = new SeatGraph(c);
    expect(g.neighbors(fid('unknown'))).toHaveLength(0);
    expect(g.areNeighbors(fid('unknown'), fid('a'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Assignable seats
// ---------------------------------------------------------------------------

describe('SeatGraph — assignable', () => {
  it('single_desk is assignable', () => {
    const c = mkClassroom(mkDesk('d', 0, 0));
    const g = new SeatGraph(c);
    expect(g.assignable.has(fid('d'))).toBe(true);
  });

  it('teacher_desk is NOT assignable (capacity 0)', () => {
    const c = mkClassroom(mkTeacherDesk('td', 0, 0));
    const g = new SeatGraph(c);
    expect(g.assignable.has(fid('td'))).toBe(false);
  });

  it('whiteboard is NOT assignable (capacity 0)', () => {
    const c = mkClassroom(mkWhiteboard('wb', 0, 0));
    const g = new SeatGraph(c);
    expect(g.assignable.has(fid('wb'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// availableSeatIds
// ---------------------------------------------------------------------------

describe('SeatGraph — availableSeatIds', () => {
  it('all desks are available initially', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const g = new SeatGraph(c);
    const avail = g.availableSeatIds();
    expect(avail).toContain(fid('a'));
    expect(avail).toContain(fid('b'));
    expect(avail).toHaveLength(2);
  });

  it('availableSeatIds excludes occupied seats', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const g = new SeatGraph(c);
    g.assign(fid('a'), makeStudent(studentId('s1'), 'Alice'));
    expect(g.availableSeatIds()).not.toContain(fid('a'));
    expect(g.availableSeatIds()).toContain(fid('b'));
  });

  it('availableSeatIds excludes locked seats', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const g = new SeatGraph(c);
    g.lock(fid('a'));
    expect(g.availableSeatIds()).not.toContain(fid('a'));
    expect(g.availableSeatIds()).toContain(fid('b'));
  });

  it('unlock restores availability', () => {
    const c = mkClassroom(mkDesk('a', 0, 0));
    const g = new SeatGraph(c);
    g.lock(fid('a'));
    expect(g.availableSeatIds()).not.toContain(fid('a'));
    g.unlock(fid('a'));
    expect(g.availableSeatIds()).toContain(fid('a'));
  });

  it('seat occupied AND locked is excluded once', () => {
    const c = mkClassroom(mkDesk('a', 0, 0));
    const g = new SeatGraph(c);
    g.assign(fid('a'), makeStudent(studentId('s1'), 'Alice'));
    g.lock(fid('a'));
    expect(g.availableSeatIds()).not.toContain(fid('a'));
    expect(g.availableSeatIds()).toHaveLength(0);
  });

  it('no assignable seats → empty list', () => {
    const c = mkClassroom(mkTeacherDesk('td', 0, 0));
    const g = new SeatGraph(c);
    expect(g.availableSeatIds()).toHaveLength(0);
  });

  it('empty classroom → empty available list', () => {
    const c = mkClassroom();
    const g = new SeatGraph(c);
    expect(g.availableSeatIds()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fixture nodes
// ---------------------------------------------------------------------------

describe('SeatGraph — fixtures', () => {
  it('teacher_desk with fixture occupant appears in fixtures map', () => {
    const c = mkClassroom(mkTeacherDesk('td', 0, 0));
    const g = new SeatGraph(c);
    expect(g.fixtures.has(fid('td'))).toBe(true);
  });

  it('fixture occupant is isFixture === true', () => {
    const c = mkClassroom(mkTeacherDesk('td', 0, 0));
    const g = new SeatGraph(c);
    const sentinel = g.fixtures.get(fid('td'));
    expect(sentinel).toBeDefined();
    expect(sentinel!.isFixture).toBe(true);
  });

  it('fixtureIdToFid maps fixture student id back to furniture id', () => {
    const c = mkClassroom(mkTeacherDesk('td', 0, 0));
    const g = new SeatGraph(c);
    const sentinel = g.fixtures.get(fid('td'))!;
    expect(g.fixtureIdToFid.get(sentinel.id)).toBe(fid('td'));
  });

  it('fixture sentinel id matches fixtureId("Teacher Desk")', () => {
    const c = mkClassroom(mkTeacherDesk('td', 0, 0));
    const g = new SeatGraph(c);
    const sentinel = g.fixtures.get(fid('td'))!;
    expect(sentinel.id).toBe(fixtureId('Teacher Desk'));
  });

  it('fixture node neighbors a nearby desk', () => {
    // teacher_desk at (0,0) size 2×2 → center (1.0, 1.0)
    // desk at (3,0) size 1×1 → center (3.5, 0.5) → distance ≈ 2.55 → not neighbors
    // desk at (2,0) → center (2.5, 0.5) → distance ≈ 1.58 → not (just over)
    // desk at (1,0) → center (1.5, 0.5) → dist = √(0.25+0.25) ≈ 0.71 → neighbors!
    const c = mkClassroom(mkTeacherDesk('td', 0, 0), mkDesk('d', 1, 0));
    const g = new SeatGraph(c);
    // teacher_desk center: (0 + 2/2, 0 + 2/2) = (1.0, 1.0)
    // desk center: (1 + 0.5, 0 + 0.5) = (1.5, 0.5), dist = √(0.25+0.25) ≈ 0.707
    expect(g.areNeighbors(fid('td'), fid('d'))).toBe(true);
  });

  it('fixture not in assignable', () => {
    const c = mkClassroom(mkTeacherDesk('td', 0, 0));
    const g = new SeatGraph(c);
    expect(g.assignable.has(fid('td'))).toBe(false);
  });

  it('whiteboard fixture appears in fixtures map', () => {
    const c = mkClassroom(mkWhiteboard('wb', 0, 0));
    const g = new SeatGraph(c);
    expect(g.fixtures.has(fid('wb'))).toBe(true);
    const sentinel = g.fixtures.get(fid('wb'))!;
    expect(sentinel.id).toBe(fixtureId('Whiteboard'));
  });

  it('desk without isFixture occupant does NOT appear in fixtures', () => {
    const desk = assignOccupant(
      mkDesk('d', 0, 0),
      makeStudent(studentId('s1'), 'Alice'),
    );
    const c = mkClassroom(desk);
    const g = new SeatGraph(c);
    expect(g.fixtures.has(fid('d'))).toBe(false);
  });

  it('multiple fixtures each get their own fixtureIdToFid entry', () => {
    const c = mkClassroom(mkTeacherDesk('td', 0, 0), mkWhiteboard('wb', 10, 0));
    const g = new SeatGraph(c);
    expect(g.fixtures.size).toBe(2);
    expect(g.fixtureIdToFid.size).toBe(2);
    const tdSentinel = g.fixtures.get(fid('td'))!;
    const wbSentinel = g.fixtures.get(fid('wb'))!;
    expect(g.fixtureIdToFid.get(tdSentinel.id)).toBe(fid('td'));
    expect(g.fixtureIdToFid.get(wbSentinel.id)).toBe(fid('wb'));
  });
});

// ---------------------------------------------------------------------------
// assign / lock / unlock mutation
// ---------------------------------------------------------------------------

describe('SeatGraph — assign / lock / unlock', () => {
  it('assign adds to occupants map', () => {
    const c = mkClassroom(mkDesk('a', 0, 0));
    const g = new SeatGraph(c);
    const alice = makeStudent(studentId('s1'), 'Alice');
    g.assign(fid('a'), alice);
    expect(g.occupants.get(fid('a'))).toBe(alice);
  });

  it('assign overwrites a previous occupant', () => {
    const c = mkClassroom(mkDesk('a', 0, 0));
    const g = new SeatGraph(c);
    const alice = makeStudent(studentId('s1'), 'Alice');
    const bob = makeStudent(studentId('s2'), 'Bob');
    g.assign(fid('a'), alice);
    g.assign(fid('a'), bob);
    expect(g.occupants.get(fid('a'))).toBe(bob);
  });

  it('lock adds to locked set', () => {
    const c = mkClassroom(mkDesk('a', 0, 0));
    const g = new SeatGraph(c);
    g.lock(fid('a'));
    expect(g.locked.has(fid('a'))).toBe(true);
  });

  it('unlock removes from locked set', () => {
    const c = mkClassroom(mkDesk('a', 0, 0));
    const g = new SeatGraph(c);
    g.lock(fid('a'));
    g.unlock(fid('a'));
    expect(g.locked.has(fid('a'))).toBe(false);
  });

  it('unlock on non-locked seat is a no-op', () => {
    const c = mkClassroom(mkDesk('a', 0, 0));
    const g = new SeatGraph(c);
    expect(() => { g.unlock(fid('a')); }).not.toThrow();
    expect(g.locked.has(fid('a'))).toBe(false);
  });
});
