/**
 * BogoAllocator — random-baseline seating allocator.
 *
 * Shuffles students and available seats independently, then pairs them up
 * one-to-one. Pre-assigned occupants and locked seats are preserved unchanged.
 * If there are more students than available seats, the extras are unplaced.
 *
 * Port of `algorithm/allocator.py BogoAllocator`.
 *
 * RNG injection
 * -------------
 * Accepts an optional `rng: () => number` (defaults to `Math.random`) so
 * tests can supply a seeded PRNG and assert deterministic outcomes:
 *
 *   const bogo = new BogoAllocator(seededRng);
 *   const result = bogo.allocate(students, classroom, graph);
 *   // result is fully deterministic
 *
 * No React/DOM imports.
 */

import type { FurnitureId } from '../types.js';
import type { Student } from '../student.js';
import type { Classroom } from '../classroom.js';
import type { SeatGraph } from '../seatGraph.js';
import type { Allocator } from './types.js';

// ---------------------------------------------------------------------------
// Fisher-Yates shuffle (uses injected RNG)
// ---------------------------------------------------------------------------

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    // noUncheckedIndexedAccess guard — i is always a valid index (i < a.length
    // throughout the loop); this branch is never reachable at runtime.
    if (tmp === undefined) continue;
    const src = a[j];
    // noUncheckedIndexedAccess guard — j = floor(rng() * (i+1)) is in [0, i];
    // always a valid index. Unreachable at runtime.
    if (src === undefined) continue;
    a[i] = src;
    a[j] = tmp;
  }
  return a;
}

// ---------------------------------------------------------------------------
// BogoAllocator
// ---------------------------------------------------------------------------

export class BogoAllocator implements Allocator {
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

    // Students already placed (via pre-assignment in the graph)
    const placedIds = new Set(Array.from(result.values()).map((s) => s.id));

    // Remaining students to place (preserve order before shuffle)
    const remaining = shuffle(
      students.filter((s) => !placedIds.has(s.id)),
      this.rng,
    );

    // Available seats to fill
    const available = shuffle(graph.availableSeatIds(), this.rng);

    for (let i = 0; i < remaining.length && i < available.length; i++) {
      const student = remaining[i];
      const seat = available[i];
      // noUncheckedIndexedAccess guards — the loop condition guarantees
      // i < remaining.length and i < available.length, so neither element
      // is ever undefined at runtime. Unreachable in practice.
      if (student === undefined || seat === undefined) continue;
      result.set(seat, student);
    }

    return result;
  }
}
