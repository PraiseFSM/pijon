// @vitest-environment node
/**
 * Allocator tests — port and expansion of the Python prototype's
 * tests/test_allocator.py.
 *
 * Uses injectable RNG for all deterministic assertions. Covers:
 * - BogoAllocator: basic placement, partial fill, empty cases, locked seats,
 *   randomness (non-determinism), pre-assigned pass-through
 * - GreedyAllocator: basic placement, partial fill, empty cases, locked seats,
 *   avoid/prefer adjacency, most-constrained-first ordering, fixture preferences,
 *   bidirectional preferences, self-targeting preferences are ignored
 * - marginal cost unit tests (avoid/prefer/bidirectional/zero)
 * - Edge cases: more students than seats, no assignable seats
 */

import { describe, it, expect } from 'vitest';
import { BogoAllocator } from './bogo.js';
import { GreedyAllocator } from './greedy.js';
import { SeatGraph } from '../seatGraph.js';
import { furnitureId, studentId } from '../types.js';
import { makeStudent, makeFixture, addPreference } from '../student.js';
import { preferStudent, avoidStudent, preferFurniture } from '../preference.js';
import { assignOccupant } from '../furniture.js';
import { fixtureId } from '../classroom.js';
import type { Furniture } from '../furniture.js';
import type { Classroom } from '../classroom.js';
import type { FurnitureId } from '../types.js';
import type { Student } from '../student.js';

// ---------------------------------------------------------------------------
// Seeded RNG — simple LCG for deterministic tests
// ---------------------------------------------------------------------------

/** Linear congruential generator — deterministic for tests. */
function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// Test helpers
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

function mkClassroom(...furniture: Furniture[]): Classroom {
  return {
    id: 'test-classroom',
    name: 'Test Room',
    gridW: 20,
    gridH: 20,
    furniture,
  };
}

function fid(id: string): FurnitureId {
  return furnitureId(id);
}

function mkStudent(id: string, name: string): Student {
  return makeStudent(studentId(id), name);
}

/** Count real (non-fixture) students in the result. */
function countReal(result: Map<FurnitureId, Student>): number {
  return Array.from(result.values()).filter((s) => !s.isFixture).length;
}

// ---------------------------------------------------------------------------
// BogoAllocator
// ---------------------------------------------------------------------------

describe('BogoAllocator', () => {
  it('places all students when seats ≥ students', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0), mkDesk('c', 2, 0));
    const students = [mkStudent('s1', 'Alice'), mkStudent('s2', 'Bob'), mkStudent('s3', 'Carol')];
    const result = new BogoAllocator(seededRng(42)).allocate(students, c, new SeatGraph(c));
    expect(countReal(result)).toBe(3);
  });

  it('partial fill when more students than seats', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const students = Array.from({ length: 5 }, (_, i) => mkStudent(String(i), `S${String(i)}`));
    const result = new BogoAllocator(seededRng(42)).allocate(students, c, new SeatGraph(c));
    expect(countReal(result)).toBe(2);
  });

  it('empty student list → empty result', () => {
    const c = mkClassroom(mkDesk('a', 0, 0));
    const result = new BogoAllocator(seededRng(1)).allocate([], c, new SeatGraph(c));
    expect(result.size).toBe(0);
  });

  it('empty classroom → empty result', () => {
    const c = mkClassroom();
    const result = new BogoAllocator(seededRng(1)).allocate(
      [mkStudent('s1', 'Alice')],
      c,
      new SeatGraph(c),
    );
    expect(result.size).toBe(0);
  });

  it('locked seat is preserved untouched', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const alice = mkStudent('s1', 'Alice');
    const bob = mkStudent('s2', 'Bob');
    const g = new SeatGraph(c);
    g.assign(fid('a'), alice);
    g.lock(fid('a'));
    const result = new BogoAllocator(seededRng(42)).allocate([alice, bob], c, g);
    expect(result.get(fid('a'))?.id).toBe('s1');
  });

  it('pre-assigned student is not placed twice', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const alice = mkStudent('s1', 'Alice');
    const bob = mkStudent('s2', 'Bob');
    const g = new SeatGraph(c);
    g.assign(fid('a'), alice);
    g.lock(fid('a'));
    const result = new BogoAllocator(seededRng(42)).allocate([alice, bob], c, g);
    const placed = Array.from(result.values()).filter((s) => s.id === 's1');
    expect(placed).toHaveLength(1);
  });

  it('randomness produces different orderings across runs', () => {
    const c = mkClassroom(...Array.from({ length: 5 }, (_, i) => mkDesk(`d${String(i)}`, i, 0)));
    const students = Array.from({ length: 5 }, (_, i) => mkStudent(`s${String(i)}`, `S${String(i)}`));
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const result = new BogoAllocator(seededRng(seed)).allocate(students, c, new SeatGraph(c));
      const key = Array.from(result.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([f, s]) => `${f}:${s.id}`)
        .join(',');
      seen.add(key);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('deterministic with same seed', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const students = [mkStudent('s1', 'Alice'), mkStudent('s2', 'Bob')];
    const r1 = new BogoAllocator(seededRng(99)).allocate(students, c, new SeatGraph(c));
    const r2 = new BogoAllocator(seededRng(99)).allocate(students, c, new SeatGraph(c));
    const key = (m: Map<FurnitureId, Student>) =>
      Array.from(m.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([f, s]) => `${f}:${s.id}`)
        .join(',');
    expect(key(r1)).toBe(key(r2));
  });

  it('pre-assigned occupants are included in result', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const alice = mkStudent('s1', 'Alice');
    const g = new SeatGraph(c);
    g.assign(fid('a'), alice);
    g.lock(fid('a'));
    const result = new BogoAllocator(seededRng(1)).allocate([], c, g);
    expect(result.get(fid('a'))?.id).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// GreedyAllocator — basic
// ---------------------------------------------------------------------------

describe('GreedyAllocator — basic', () => {
  it('places all students when seats ≥ students', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const students = [mkStudent('s1', 'Alice'), mkStudent('s2', 'Bob')];
    const result = new GreedyAllocator(seededRng(1)).allocate(students, c, new SeatGraph(c));
    expect(countReal(result)).toBe(2);
  });

  it('partial fill when more students than seats', () => {
    const c = mkClassroom(mkDesk('a', 0, 0));
    const students = [mkStudent('s1', 'Alice'), mkStudent('s2', 'Bob')];
    const result = new GreedyAllocator(seededRng(1)).allocate(students, c, new SeatGraph(c));
    expect(countReal(result)).toBe(1);
  });

  it('empty student list → empty result', () => {
    const c = mkClassroom(mkDesk('a', 0, 0));
    const result = new GreedyAllocator(seededRng(1)).allocate([], c, new SeatGraph(c));
    expect(result.size).toBe(0);
  });

  it('empty classroom → empty result', () => {
    const c = mkClassroom();
    const result = new GreedyAllocator(seededRng(1)).allocate(
      [mkStudent('s1', 'Alice')],
      c,
      new SeatGraph(c),
    );
    expect(result.size).toBe(0);
  });

  it('no assignable seats → no students placed', () => {
    const c = mkClassroom(mkTeacherDesk('td', 0, 0));
    const students = [mkStudent('s1', 'Alice')];
    const result = new GreedyAllocator(seededRng(1)).allocate(students, c, new SeatGraph(c));
    expect(countReal(result)).toBe(0);
  });

  it('locked seat is preserved untouched', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const alice = mkStudent('s1', 'Alice');
    const bob = mkStudent('s2', 'Bob');
    const g = new SeatGraph(c);
    g.assign(fid('a'), alice);
    g.lock(fid('a'));
    const result = new GreedyAllocator(seededRng(1)).allocate([alice, bob], c, g);
    expect(result.get(fid('a'))?.id).toBe('s1');
    expect(result.get(fid('b'))?.id).toBe('s2');
  });

  it('pre-assigned student is not placed twice', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const alice = mkStudent('s1', 'Alice');
    const bob = mkStudent('s2', 'Bob');
    const g = new SeatGraph(c);
    g.assign(fid('a'), alice);
    g.lock(fid('a'));
    const result = new GreedyAllocator(seededRng(1)).allocate([alice, bob], c, g);
    const placed = Array.from(result.values()).filter((s) => s.id === 's1');
    expect(placed).toHaveLength(1);
  });

  it('deterministic with same seed', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0), mkDesk('c', 2, 0));
    const alice = addPreference(mkStudent('s1', 'Alice'), preferStudent(studentId('s2'), 1));
    const bob = addPreference(mkStudent('s2', 'Bob'), avoidStudent(studentId('s3'), 1));
    const carol = mkStudent('s3', 'Carol');
    const students = [alice, bob, carol];
    const r1 = new GreedyAllocator(seededRng(7)).allocate(students, c, new SeatGraph(c));
    const r2 = new GreedyAllocator(seededRng(7)).allocate(students, c, new SeatGraph(c));
    const key = (m: Map<FurnitureId, Student>) =>
      Array.from(m.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([f, s]) => `${f}:${s.id}`)
        .join(',');
    expect(key(r1)).toBe(key(r2));
  });
});

// ---------------------------------------------------------------------------
// GreedyAllocator — constraint satisfaction
// ---------------------------------------------------------------------------

describe('GreedyAllocator — constraints', () => {
  it('avoid pair NOT placed adjacent when separated seats exist', () => {
    // 4 desks: a-b adjacent, c-d adjacent but far from a-b
    const c = mkClassroom(
      mkDesk('a', 0, 0),
      mkDesk('b', 1, 0), // neighbors: a
      mkDesk('c', 10, 0),
      mkDesk('d', 11, 0), // neighbors: c
    );
    const alice = addPreference(mkStudent('s1', 'Alice'), avoidStudent(studentId('s2'), 10));
    const bob = addPreference(mkStudent('s2', 'Bob'), avoidStudent(studentId('s1'), 10));
    const g = new SeatGraph(c);
    const result = new GreedyAllocator(seededRng(42)).allocate([alice, bob], c, g);
    const aliceSeat = Array.from(result.entries()).find(([, s]) => s.id === 's1')![0];
    const bobSeat = Array.from(result.entries()).find(([, s]) => s.id === 's2')![0];
    expect(g.areNeighbors(aliceSeat, bobSeat)).toBe(false);
  });

  it('prefer pair placed adjacent', () => {
    // desk 'a' is pre-locked; Bob prefers Alice; 'b' is adjacent to 'a', 'c' is far
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0), mkDesk('c', 10, 0));
    const alice = mkStudent('s1', 'Alice');
    const bob = addPreference(mkStudent('s2', 'Bob'), preferStudent(studentId('s1'), 10));
    const g = new SeatGraph(c);
    g.assign(fid('a'), alice);
    g.lock(fid('a'));
    const result = new GreedyAllocator(seededRng(1)).allocate([alice, bob], c, g);
    expect(result.get(fid('b'))?.id).toBe('s2');
  });

  it('most constrained student placed first gets preferred seat', () => {
    // Alice has a strong fixture preference → most constrained → placed first
    // Bob has no preferences → placed second
    //
    // Geometry (teacher_desk w=2 h=2 at (2,0)):
    //   td center: (2 + 1.0, 0 + 1.0) = (3.0, 1.0)
    //   deskA at (3,1) → center (3.5, 1.5) → dist ≈ 0.707 → NEIGHBOR of td
    //   deskB at (10,10) → far from td
    const td = mkTeacherDesk('td', 2, 0); // center (3.0, 1.0)
    const deskA = mkDesk('a', 3, 1);      // center (3.5, 1.5), dist ≈ 0.707 → neighbor
    const deskB = mkDesk('b', 10, 10);    // far from td
    const c = mkClassroom(td, deskA, deskB);
    const g = new SeatGraph(c);
    // Verify geometry assumption
    expect(g.areNeighbors(fid('td'), fid('a'))).toBe(true);
    expect(g.areNeighbors(fid('td'), fid('b'))).toBe(false);
    const tdFixtureId = g.fixtures.get(fid('td'))!.id;
    const alice = addPreference(
      mkStudent('s1', 'Alice'),
      preferFurniture(tdFixtureId, 10),
    );
    const bob = mkStudent('s2', 'Bob');
    const result = new GreedyAllocator(seededRng(1)).allocate([alice, bob], c, g);
    const aliceSeat = Array.from(result.entries()).find(([, s]) => s.id === 's1')![0];
    expect(g.areNeighbors(aliceSeat, fid('td'))).toBe(true);
  });

  it('bidirectional avoid: placing student near avoider incurs cost', () => {
    // Bob avoids Alice, but Alice has no preferences.
    // Greedy should still separate them (reverse pref picked up).
    const c = mkClassroom(
      mkDesk('a', 0, 0),
      mkDesk('b', 1, 0), // adjacent to a
      mkDesk('c', 10, 0),
    );
    const alice = mkStudent('s1', 'Alice');
    const bob = addPreference(mkStudent('s2', 'Bob'), avoidStudent(studentId('s1'), 10));
    // Place Bob first (more constrained) in 'a'; then Alice should prefer 'c' over 'b'
    const g = new SeatGraph(c);
    g.assign(fid('a'), bob);
    g.lock(fid('a'));
    const result = new GreedyAllocator(seededRng(1)).allocate([alice, bob], c, g);
    const aliceSeat = Array.from(result.entries()).find(([, s]) => s.id === 's1')![0];
    expect(g.areNeighbors(aliceSeat, fid('a'))).toBe(false);
  });

  it('fixture preference scores adjacency correctly', () => {
    // Alice prefers the teacher desk; that desk is at (0,0), desk 'a' at (2,0), desk 'b' at (10,0)
    // teacher_desk 2×2 at (0,0) → center (1.0, 1.0)
    // deskA at (2,0) 1×1 → center (2.5, 0.5) → dist ≈ 1.80 → NOT neighbor
    // deskA at (1,0) 1×1 → center (1.5, 0.5) → dist ≈ 0.71 → neighbor!
    const td = mkTeacherDesk('td', 0, 0); // center (1.0, 1.0)
    const deskA = mkDesk('a', 1, 0);      // center (1.5, 0.5), dist ≈ 0.71 → adjacent
    const deskB = mkDesk('b', 10, 0);     // far
    const c = mkClassroom(td, deskA, deskB);
    const g = new SeatGraph(c);
    const tdFixtureId = g.fixtures.get(fid('td'))!.id;
    const alice = addPreference(
      mkStudent('s1', 'Alice'),
      preferFurniture(tdFixtureId, 5),
    );
    const bob = mkStudent('s2', 'Bob');
    const result = new GreedyAllocator(seededRng(1)).allocate([alice, bob], c, g);
    const aliceSeat = Array.from(result.entries()).find(([, s]) => s.id === 's1')![0];
    expect(g.areNeighbors(aliceSeat, fid('td'))).toBe(true);
  });

  it('self-targeting preference is ignored (no self-cost)', () => {
    // Alice has a strong prefer-self pref (absurd, but must not crash or inflate cost)
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const alice = addPreference(mkStudent('s1', 'Alice'), preferStudent(studentId('s1'), 99));
    const result = new GreedyAllocator(seededRng(1)).allocate([alice], c, new SeatGraph(c));
    // Should still place Alice somewhere without error
    expect(countReal(result)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GreedyAllocator — marginal cost unit tests
// ---------------------------------------------------------------------------

describe('GreedyAllocator — marginal cost', () => {
  function setup() {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0), mkDesk('c', 10, 0));
    const g = new SeatGraph(c);
    return { c, g };
  }

  it('avoid neighbor → positive cost (penalty)', () => {
    const { g } = setup();
    const alice = addPreference(mkStudent('s1', 'Alice'), avoidStudent(studentId('s2'), 2));
    const bob = mkStudent('s2', 'Bob');
    const assignments = new Map([[fid('b'), bob]]);
    const studentToSeat = new Map([['s2', fid('b')]]);
    const allocator = new GreedyAllocator();
    const costNext = allocator._marginalCost(alice, fid('a'), assignments, studentToSeat, g);
    const costFar = allocator._marginalCost(alice, fid('c'), assignments, studentToSeat, g);
    expect(costNext).toBeGreaterThan(costFar);
  });

  it('prefer neighbor → negative cost (reward)', () => {
    const { g } = setup();
    const alice = addPreference(mkStudent('s1', 'Alice'), preferStudent(studentId('s2'), 2));
    const bob = mkStudent('s2', 'Bob');
    const assignments = new Map([[fid('b'), bob]]);
    const studentToSeat = new Map([['s2', fid('b')]]);
    const allocator = new GreedyAllocator();
    const costNext = allocator._marginalCost(alice, fid('a'), assignments, studentToSeat, g);
    const costFar = allocator._marginalCost(alice, fid('c'), assignments, studentToSeat, g);
    expect(costNext).toBeLessThan(costFar);
  });

  it('bidirectional cost: Bob avoids Alice, placing Alice near Bob incurs cost', () => {
    const { g } = setup();
    const alice = mkStudent('s1', 'Alice');
    const bob = addPreference(mkStudent('s2', 'Bob'), avoidStudent(studentId('s1'), 5));
    const assignments = new Map([[fid('b'), bob]]);
    const studentToSeat = new Map([['s2', fid('b')]]);
    const allocator = new GreedyAllocator();
    const costNext = allocator._marginalCost(alice, fid('a'), assignments, studentToSeat, g);
    const costFar = allocator._marginalCost(alice, fid('c'), assignments, studentToSeat, g);
    expect(costNext).toBeGreaterThan(costFar);
  });

  it('no preferences → zero cost', () => {
    const { g } = setup();
    const alice = mkStudent('s1', 'Alice');
    const allocator = new GreedyAllocator();
    const cost = allocator._marginalCost(alice, fid('a'), new Map(), new Map(), g);
    expect(cost).toBe(0.0);
  });

  it('self-targeting preference contributes 0 cost', () => {
    const { g } = setup();
    // Alice prefers herself — should be filtered out, contributing zero cost
    const alice = addPreference(mkStudent('s1', 'Alice'), preferStudent(studentId('s1'), 99));
    const allocator = new GreedyAllocator();
    // Even though seat 'a' would "neighbor itself" (trivially), self-pref is skipped
    const cost = allocator._marginalCost(alice, fid('a'), new Map(), new Map([['s1', fid('a')]]), g);
    expect(cost).toBe(0.0);
  });

  it('fixture preference: adjacent → negative cost (reward)', () => {
    const td = mkTeacherDesk('td', 0, 0); // center (1.0, 1.0)
    const deskA = mkDesk('a', 1, 0);      // center (1.5, 0.5) → neighbor
    const deskB = mkDesk('b', 10, 0);     // far
    const c = mkClassroom(td, deskA, deskB);
    const g = new SeatGraph(c);
    const tdFixId = g.fixtures.get(fid('td'))!.id;
    const alice = addPreference(mkStudent('s1', 'Alice'), preferFurniture(tdFixId, 3));
    const allocator = new GreedyAllocator();
    const costNear = allocator._marginalCost(alice, fid('a'), new Map(), new Map(), g);
    const costFar = allocator._marginalCost(alice, fid('b'), new Map(), new Map(), g);
    expect(costNear).toBeLessThan(costFar);
  });

  it('avoid fixture: adjacent → positive cost (penalty)', () => {
    const td = mkTeacherDesk('td', 0, 0); // center (1.0, 1.0)
    const deskA = mkDesk('a', 1, 0);      // neighbor of td
    const deskB = mkDesk('b', 10, 0);     // far
    const c = mkClassroom(td, deskA, deskB);
    const g = new SeatGraph(c);
    const tdFixId = g.fixtures.get(fid('td'))!.id;
    const alice = addPreference(
      mkStudent('s1', 'Alice'),
      { kind: 'furniture', targetId: tdFixId, weight: -3 },
    );
    const allocator = new GreedyAllocator();
    const costNear = allocator._marginalCost(alice, fid('a'), new Map(), new Map(), g);
    const costFar = allocator._marginalCost(alice, fid('b'), new Map(), new Map(), g);
    expect(costNear).toBeGreaterThan(costFar);
  });
});

// ---------------------------------------------------------------------------
// GreedyAllocator — hand-computed cost scenario
// ---------------------------------------------------------------------------

describe('GreedyAllocator — hand-computed cost', () => {
  /**
   * Setup: 3 desks a=(0,0), b=(1,0), c=(10,0).
   *   a↔b are neighbors (dist=1.0 ≤ 1.5).
   *   b↔c and a↔c are NOT neighbors (dist=9.0).
   *
   * Placed: Bob at b.
   *   Bob has: avoid Alice (weight = -2).
   *
   * Alice has: prefer Bob (weight = +3).
   *
   * Expected marginal cost of placing Alice at seat a:
   *   a) Alice's own pref — prefer Bob (weight +3), a↔b are neighbors → cost += -(+3) = -3
   *   b) Reverse pref — Bob avoids Alice (weight -2), a↔b are neighbors → cost += -(-2) = +2
   *   Total at a = -1
   *
   * Expected marginal cost of placing Alice at seat c:
   *   a) prefer Bob → c↔b NOT neighbors → no contribution
   *   b) Bob avoids Alice → c↔b NOT neighbors → no contribution
   *   Total at c = 0
   *
   * Lower cost is better → Alice is placed at a (cost -1 < 0).
   */
  it('hand-computed: mixed prefer+avoid gives correct signed cost', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0), mkDesk('c', 10, 0));
    const g = new SeatGraph(c);

    // Verify geometry assumptions
    expect(g.areNeighbors(fid('a'), fid('b'))).toBe(true);
    expect(g.areNeighbors(fid('b'), fid('c'))).toBe(false);
    expect(g.areNeighbors(fid('a'), fid('c'))).toBe(false);

    const alice = addPreference(mkStudent('s1', 'Alice'), preferStudent(studentId('s2'), 3));
    const bob = addPreference(mkStudent('s2', 'Bob'), avoidStudent(studentId('s1'), 2));

    const assignments = new Map([[fid('b'), bob]]);
    const studentToSeat = new Map([['s2', fid('b')]]);
    const allocator = new GreedyAllocator();

    const costAtA = allocator._marginalCost(alice, fid('a'), assignments, studentToSeat, g);
    const costAtC = allocator._marginalCost(alice, fid('c'), assignments, studentToSeat, g);

    // Hand-computed values
    expect(costAtA).toBe(-1); // -3 (prefer neighbor) + 2 (reverse avoid neighbor) = -1
    expect(costAtC).toBe(0);  // no neighbors → no contribution

    // Full allocator picks the lower-cost seat (a)
    g.assign(fid('b'), bob);
    g.lock(fid('b'));
    const result = new GreedyAllocator(seededRng(1)).allocate([alice, bob], c, g);
    expect(result.get(fid('a'))?.id).toBe('s1');
  });

  it('hand-computed: pure avoid — alice avoids bob, only penalty at neighbor seat', () => {
    // a=(0,0), b=(1,0) neighbors; c=(10,0) not.
    // Alice avoids Bob (weight=-5). Bob at b.
    // cost at a: -(−5) = +5 (penalty). cost at c: 0.
    // Alice should land at c.
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0), mkDesk('c', 10, 0));
    const g = new SeatGraph(c);
    const alice = addPreference(mkStudent('s1', 'Alice'), avoidStudent(studentId('s2'), 5));
    const bob = mkStudent('s2', 'Bob');

    const assignments = new Map([[fid('b'), bob]]);
    const studentToSeat = new Map([['s2', fid('b')]]);
    const allocator = new GreedyAllocator();

    const costAtA = allocator._marginalCost(alice, fid('a'), assignments, studentToSeat, g);
    const costAtC = allocator._marginalCost(alice, fid('c'), assignments, studentToSeat, g);
    expect(costAtA).toBe(5);
    expect(costAtC).toBe(0);
  });

  it('location preference in reverse loop is silently skipped', () => {
    // A placed student with a location preference targeting nothing by id —
    // the reverse loop must skip it (kind === location) without error.
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const g = new SeatGraph(c);

    // Bob has a location preference (not a student/furniture pref)
    const bob = addPreference(
      mkStudent('s2', 'Bob'),
      { kind: 'location', target: 'front', weight: 1 },
    );
    const alice = mkStudent('s1', 'Alice');
    const assignments = new Map([[fid('b'), bob]]);
    const studentToSeat = new Map([['s2', fid('b')]]);
    const allocator = new GreedyAllocator();

    // Should not throw; location pref has no targetId, reverse loop must skip it
    const costAtA = allocator._marginalCost(alice, fid('a'), assignments, studentToSeat, g);
    expect(costAtA).toBe(0); // No student/furniture pref → zero cost
  });
});

// ---------------------------------------------------------------------------
// Lock / pre-assign invariant — adversarial inputs
// ---------------------------------------------------------------------------

describe('Lock invariants — adversarial', () => {
  it('locked student in roster is not moved or duplicated', () => {
    // Alice is pre-assigned to seat a AND locked; she appears in the roster.
    // After allocation Alice must still be exactly at a and nowhere else.
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0), mkDesk('c', 10, 0));
    const alice = mkStudent('s1', 'Alice');
    const bob = mkStudent('s2', 'Bob');
    const g = new SeatGraph(c);
    g.assign(fid('a'), alice);
    g.lock(fid('a'));

    const result = new GreedyAllocator(seededRng(1)).allocate([alice, bob], c, g);

    // Alice is still at a
    expect(result.get(fid('a'))?.id).toBe('s1');
    // Alice appears exactly once in the result
    const alicePlacements = Array.from(result.values()).filter((s) => s.id === 's1');
    expect(alicePlacements).toHaveLength(1);
  });

  it('locked seat that is also the preferred target is not moved', () => {
    // Bob prefers sitting near Alice; Alice is locked at a.
    // Bob should end up at b (adjacent to a) but Alice must NOT be moved.
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0), mkDesk('c', 10, 0));
    const alice = mkStudent('s1', 'Alice');
    const bob = addPreference(mkStudent('s2', 'Bob'), preferStudent(studentId('s1'), 10));
    const g = new SeatGraph(c);
    g.assign(fid('a'), alice);
    g.lock(fid('a'));

    const result = new GreedyAllocator(seededRng(1)).allocate([alice, bob], c, g);

    // Alice still at locked seat
    expect(result.get(fid('a'))?.id).toBe('s1');
    // Bob gravitates to b (adjacent to Alice) for the prefer reward
    expect(result.get(fid('b'))?.id).toBe('s2');
  });

  it('more students than seats: extras unplaced, locked seats untouched', () => {
    // 2 seats (a locked, b free), 4 students. Only 1 non-locked seat → at most 1 extra placed.
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const alice = mkStudent('s1', 'Alice');
    const extras = ['s2', 's3', 's4'].map((id) => mkStudent(id, `S${id}`));
    const g = new SeatGraph(c);
    g.assign(fid('a'), alice);
    g.lock(fid('a'));

    const result = new GreedyAllocator(seededRng(1)).allocate([alice, ...extras], c, g);

    // Alice still at a
    expect(result.get(fid('a'))?.id).toBe('s1');
    // Only 2 seats total, so at most 2 students (Alice + 1 from extras)
    expect(result.size).toBeLessThanOrEqual(2);
    // At least Alice is there
    expect(result.size).toBeGreaterThanOrEqual(1);
    // Alice appears exactly once
    const alicePlacements = Array.from(result.values()).filter((s) => s.id === 's1');
    expect(alicePlacements).toHaveLength(1);
  });

  it('bogo: locked student in roster is not duplicated', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0), mkDesk('c', 10, 0));
    const alice = mkStudent('s1', 'Alice');
    const bob = mkStudent('s2', 'Bob');
    const g = new SeatGraph(c);
    g.assign(fid('a'), alice);
    g.lock(fid('a'));

    const result = new BogoAllocator(seededRng(1)).allocate([alice, bob], c, g);

    expect(result.get(fid('a'))?.id).toBe('s1');
    const alicePlacements = Array.from(result.values()).filter((s) => s.id === 's1');
    expect(alicePlacements).toHaveLength(1);
  });

  it('greedy: locked seat not in assignable is untouched even under pressure', () => {
    // teacher_desk is locked (capacity 0 / non-assignable) — allocator must not touch it
    const td = mkTeacherDesk('td', 0, 0);
    const c = mkClassroom(td, mkDesk('a', 1, 0), mkDesk('b', 5, 0));
    const g = new SeatGraph(c);
    // Lock the teacher_desk (even though it has no assignable capacity)
    g.lock(fid('td'));

    const students = ['s1', 's2', 's3'].map((id) => mkStudent(id, `S${id}`));
    const result = new GreedyAllocator(seededRng(1)).allocate(students, c, g);

    // teacher_desk must not appear in result
    expect(result.has(fid('td'))).toBe(false);
    // Only the 2 desks can be filled
    expect(countReal(result)).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('Determinism', () => {
  it('greedy: same seed produces identical Map for complex scenario', () => {
    const c = mkClassroom(
      mkDesk('a', 0, 0), mkDesk('b', 1, 0), mkDesk('c', 2, 0),
      mkDesk('d', 3, 0), mkDesk('e', 4, 0),
    );
    const alice = addPreference(mkStudent('s1', 'Alice'), preferStudent(studentId('s2'), 5));
    const bob = addPreference(mkStudent('s2', 'Bob'), avoidStudent(studentId('s3'), 3));
    const carol = addPreference(mkStudent('s3', 'Carol'), preferStudent(studentId('s4'), 2));
    const dave = mkStudent('s4', 'Dave');
    const eve = mkStudent('s5', 'Eve');
    const students = [alice, bob, carol, dave, eve];

    const key = (m: Map<FurnitureId, Student>) =>
      Array.from(m.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([f, s]) => `${f}:${s.id}`)
        .join(',');

    const r1 = new GreedyAllocator(seededRng(42)).allocate(students, c, new SeatGraph(c));
    const r2 = new GreedyAllocator(seededRng(42)).allocate(students, c, new SeatGraph(c));
    expect(key(r1)).toBe(key(r2));
  });

  it('greedy: different seeds can produce different arrangements (tie-breaking uses injected rng)', () => {
    // All students have equal constraint weight (no preferences) — greedy picks
    // among all seats as ties. Different seeds should break ties differently.
    const c = mkClassroom(
      mkDesk('a', 0, 0), mkDesk('b', 1, 0), mkDesk('c', 2, 0),
      mkDesk('d', 3, 0), mkDesk('e', 4, 0),
    );
    const students = Array.from({ length: 5 }, (_, i) => mkStudent(`s${String(i)}`, `S${String(i)}`));
    const key = (m: Map<FurnitureId, Student>) =>
      Array.from(m.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([f, s]) => `${f}:${s.id}`)
        .join(',');

    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const r = new GreedyAllocator(seededRng(seed)).allocate(students, c, new SeatGraph(c));
      seen.add(key(r));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('zero assignable seats: no students placed, no crash', () => {
    // Classroom with only fixtures (no desks)
    const c = mkClassroom(mkTeacherDesk('td1', 0, 0), mkTeacherDesk('td2', 5, 0));
    const students = [mkStudent('s1', 'Alice'), mkStudent('s2', 'Bob')];
    const g = new SeatGraph(c);
    const bogo = new BogoAllocator(seededRng(1)).allocate(students, c, g);
    const greedy = new GreedyAllocator(seededRng(1)).allocate(students, c, g);
    expect(countReal(bogo)).toBe(0);
    expect(countReal(greedy)).toBe(0);
  });

  it('roster larger than seats: extras silently unplaced in both allocators', () => {
    const c = mkClassroom(mkDesk('a', 0, 0), mkDesk('b', 1, 0));
    const students = Array.from({ length: 10 }, (_, i) => mkStudent(`s${String(i)}`, `S${String(i)}`));
    const bogoResult = new BogoAllocator(seededRng(1)).allocate(students, c, new SeatGraph(c));
    const greedyResult = new GreedyAllocator(seededRng(1)).allocate(students, c, new SeatGraph(c));
    expect(countReal(bogoResult)).toBe(2);
    expect(countReal(greedyResult)).toBe(2);
    // No student placed twice
    const bogoIds = Array.from(bogoResult.values()).map((s) => s.id);
    const greedyIds = Array.from(greedyResult.values()).map((s) => s.id);
    expect(new Set(bogoIds).size).toBe(bogoIds.length);
    expect(new Set(greedyIds).size).toBe(greedyIds.length);
  });

  it('student id equal to fixtureId: roster student not mistaken for fixture in cost scoring', () => {
    // Construct a student whose id happens to match the fixture id for "Teacher Desk"
    // This is adversarial but possible if ids collide. The allocator should seat them normally
    // (they're real students, not fixtures).
    const td = mkTeacherDesk('td', 0, 0);
    const deskA = mkDesk('a', 3, 3); // Far from td
    const c = mkClassroom(td, deskA);
    const g = new SeatGraph(c);
    const tdFixId = g.fixtures.get(fid('td'))!.id;
    // Create a real student whose id happens to equal the fixture id
    const clashStudent = makeStudent(tdFixId, 'Clash');
    // Also a normal student with a furniture pref targeting the td fixture
    const normalStudent = addPreference(mkStudent('s2', 'Normal'), preferFurniture(tdFixId, 5));
    const result = new GreedyAllocator(seededRng(1)).allocate([clashStudent, normalStudent], c, g);
    // Only deskA is assignable; exactly one student can be placed
    expect(countReal(result)).toBe(1);
    // Must not crash
  });

  it('greedy no-op: single student, single seat, no preferences → placed', () => {
    const c = mkClassroom(mkDesk('a', 0, 0));
    const alice = mkStudent('s1', 'Alice');
    const result = new GreedyAllocator(seededRng(1)).allocate([alice], c, new SeatGraph(c));
    expect(result.get(fid('a'))?.id).toBe('s1');
  });
});
