/**
 * GreedyAllocator — cost-based seating allocator (most-constrained-first).
 *
 * Algorithm
 * ---------
 * 1. Carry forward pre-assigned occupants from `graph.occupants`.
 * 2. Sort remaining students descending by total constraint weight
 *    (sum of |weight| across all preferences) — most constrained first,
 *    so they get the widest pick of available seats.
 * 3. For each student, score every available seat by marginal cost and pick
 *    the lowest-cost seat. Ties are broken uniformly at random.
 *
 * Marginal cost for student S placed at seat X
 * --------------------------------------------
 * a) S's own preferences targeting already-placed students or fixtures:
 *      if S would neighbor the target → cost += -weight
 *      (avoid: -(-w) = +w penalty; prefer: -(+w) = -w reward)
 *
 * b) Reverse preferences — already-placed student T has a preference
 *    targeting S:
 *      if T's seat neighbors X → cost += -weight
 *      (makes the relationship bidirectional even when only one side
 *      declared the preference)
 *
 * c) Self-targeting preferences (S targets its own id) are silently
 *    skipped — see the Allocator interface contract.
 *
 * Fixture scoring
 * ---------------
 * Preferences of `kind: 'furniture'` use `graph.fixtureIdToFid` to look up
 * the FurnitureId of the target fixture, then score adjacency against that.
 *
 * RNG injection
 * -------------
 * Accepts an optional `rng: () => number` (defaults to `Math.random`) for
 * deterministic testing:
 *
 *   const greedy = new GreedyAllocator(seededRng);
 *   const result = greedy.allocate(students, classroom, graph);
 *
 * Port of `algorithm/allocator.py GreedyAllocator`.
 * No React/DOM imports.
 */

import type { FurnitureId } from '../types.js';
import type { Student } from '../student.js';
import type { Classroom } from '../classroom.js';
import type { SeatGraph } from '../seatGraph.js';
import type { Allocator } from './types.js';

// ---------------------------------------------------------------------------
// Random pick from an array (uses injected RNG)
// ---------------------------------------------------------------------------

function randomChoice<T>(arr: T[], rng: () => number): T | undefined {
  // The empty-array guard below is a safety net; callers always pass a non-empty
  // array (allocate() checks available.length === 0 before building bestSeats).
  // It is unreachable in practice but required for a well-typed return type.
  if (arr.length === 0) return undefined;
  return arr[Math.floor(rng() * arr.length)];
}

// ---------------------------------------------------------------------------
// GreedyAllocator
// ---------------------------------------------------------------------------

export class GreedyAllocator implements Allocator {
  private readonly rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  allocate(
    students: readonly Student[],
    _classroom: Classroom,
    graph: SeatGraph,
  ): Map<FurnitureId, Student> {
    const result = new Map<FurnitureId, Student>(graph.occupants);

    // student id → furniture id, for quick "where is this student sitting?" lookups
    const studentToSeat = new Map<string, FurnitureId>(
      Array.from(result.entries()).map(([fid, s]) => [s.id, fid]),
    );

    // Seats already taken (occupied + locked)
    const taken = new Set<FurnitureId>([...graph.occupants.keys(), ...graph.locked]);

    // Students left to place
    const placedIds = new Set(studentToSeat.keys());
    const remaining = students.filter((s) => !placedIds.has(s.id));

    // Most constrained first
    remaining.sort(
      (a, b) =>
        b.preferences.reduce((sum, p) => sum + Math.abs(p.weight), 0) -
        a.preferences.reduce((sum, p) => sum + Math.abs(p.weight), 0),
    );

    for (const student of remaining) {
      const available = Array.from(graph.assignable).filter((fid) => !taken.has(fid));
      if (available.length === 0) break;

      let bestCost = Infinity;
      let bestSeats: FurnitureId[] = [];

      for (const fid of available) {
        const cost = this._marginalCost(student, fid, result, studentToSeat, graph);
        if (cost < bestCost) {
          bestCost = cost;
          bestSeats = [fid];
        } else if (cost === bestCost) {
          bestSeats.push(fid);
        }
      }

      const chosen = randomChoice(bestSeats, this.rng);
      // `chosen` is only undefined when bestSeats is empty. Because the loop
      // above breaks on `available.length === 0` and every available seat is
      // scored, bestSeats always has ≥ 1 entry here. Unreachable in practice.
      if (chosen === undefined) break;

      result.set(chosen, student);
      studentToSeat.set(student.id, chosen);
      taken.add(chosen);
    }

    return result;
  }

  /**
   * Marginal cost of placing `student` at `seatFid` given the current partial
   * assignment. Lower is better (prefer) — higher is worse (avoid).
   *
   * Exposed as a named method (not private) so tests can unit-test cost logic
   * directly, mirroring the Python prototype's `_marginal_cost` test suite.
   */
  _marginalCost(
    student: Student,
    seatFid: FurnitureId,
    assignments: ReadonlyMap<FurnitureId, Student>,
    studentToSeat: ReadonlyMap<string, FurnitureId>,
    graph: SeatGraph,
  ): number {
    let cost = 0;

    // a) This student's own preferences toward placed students / fixtures
    for (const pref of student.preferences) {
      // Skip self-targeting preferences (see Allocator interface contract)
      if (pref.kind !== 'location' && pref.targetId === student.id) continue;

      if (pref.kind === 'student') {
        const targetSeat = studentToSeat.get(pref.targetId);
        if (targetSeat !== undefined && graph.areNeighbors(seatFid, targetSeat)) {
          cost -= pref.weight;
        }
      } else if (pref.kind === 'furniture') {
        const fixtureFid = graph.fixtureIdToFid.get(
          pref.targetId as import('../types.js').StudentId,
        );
        if (fixtureFid !== undefined && graph.areNeighbors(seatFid, fixtureFid)) {
          cost -= pref.weight;
        }
      }
      // 'location' preferences are not handled by graph-based scoring (Phase 3 scope)
    }

    // b) Reverse preferences — already-placed students that target this student
    for (const [placedFid, placedStudent] of assignments) {
      for (const pref of placedStudent.preferences) {
        if (pref.kind === 'location') continue;
        if (pref.targetId === student.id && graph.areNeighbors(seatFid, placedFid)) {
          cost -= pref.weight;
        }
      }
    }

    return cost;
  }
}
