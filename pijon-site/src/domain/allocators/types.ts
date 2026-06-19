/**
 * Allocator interface — the algorithm template for seating allocators.
 *
 * An `Allocator` takes:
 *   - `students`  — the full roster to seat (may include students already
 *                   pre-assigned in the graph; allocators skip them).
 *   - `classroom` — the current document (geometry, furniture, fixtures).
 *   - `graph`     — a `SeatGraph` that may already be partially populated:
 *                     - `graph.occupants`: seats already assigned (pre-existing
 *                       assignments are included in the output unchanged).
 *                     - `graph.locked`: seats the allocator MUST NOT move.
 *                     - `graph.availableSeatIds()`: seats free to fill.
 *
 * It returns a `Map<FurnitureId, Student>` of the full arrangement: all
 * pre-existing occupants PLUS newly assigned ones. Locked and pre-assigned
 * seats pass through untouched. Students who cannot be placed (more students
 * than available seats) are simply omitted from the result.
 *
 * Allocator responsibilities (caller vs. allocator contract)
 * ----------------------------------------------------------
 * - **Self-targeting preferences must be filtered by allocators.** A student
 *   can technically declare a preference targeting their own StudentId (which
 *   would be nonsensical). Allocators must skip any preference whose targetId
 *   equals the placing student's own id to avoid spurious self-cost. The
 *   caller (UI / store) is not expected to sanitise these.
 * - **Duplicate FurnitureIds in `students` are caller responsibility.** If
 *   the same furniture id appears twice in the input, behaviour is undefined.
 *   The store / UI layer must ensure uniqueness before calling.
 *
 * Adding a new algorithm = implementing this interface and registering it in
 * the allocator registry (Phase 5). No UI changes required.
 *
 * No React/DOM imports.
 */

import type { FurnitureId } from '../types.js';
import type { Student } from '../student.js';
import type { Classroom } from '../classroom.js';
import type { SeatGraph } from '../seatGraph.js';

// ---------------------------------------------------------------------------
// Allocator interface
// ---------------------------------------------------------------------------

export interface Allocator {
  /**
   * Seat students and return the full arrangement.
   *
   * @param students  The full roster (including any already pre-assigned).
   * @param classroom The current classroom document.
   * @param graph     A SeatGraph, potentially pre-populated with locked seats.
   * @returns         Map of FurnitureId → seated Student (full arrangement).
   */
  allocate(
    students: readonly Student[],
    classroom: Classroom,
    graph: SeatGraph,
  ): Map<FurnitureId, Student>;
}
