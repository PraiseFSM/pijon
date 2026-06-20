/**
 * validateSeating — §13.8
 *
 * Pure domain helper that inspects a Classroom + roster for seating problems
 * and returns a structured list of typed issues. The domain returns DATA only;
 * messages / i18n strings belong in the UI layer.
 *
 * Defined issues
 * --------------
 * over-capacity   — more real students in the roster than assignable seats.
 *                   Assignable = furniture with capacity > 0. Fixtures and
 *                   fixture-carrying furniture are excluded from all counts.
 * unplaced        — real roster students who are not seated anywhere in the
 *                   current classroom arrangement (regardless of capacity).
 *
 * Fixtures are excluded from every count:
 *   - Fixture students (isFixture === true) are never counted as "real" students.
 *   - Furniture whose occupant is a fixture (teacher_desk + faux student) has
 *     capacity 0 anyway and is therefore not counted as an assignable seat.
 *     The two exclusions are redundant by design — belt-and-suspenders, so that
 *     future furniture kinds cannot sneak fixtures into the seat count.
 *
 * No React/DOM imports. No `any`. Immutable. Branded ids.
 */

import type { Classroom } from './classroom.js';
import type { Student } from './student.js';
import { capacity, occupant } from './furniture.js';
import type { StudentId } from './types.js';

// ---------------------------------------------------------------------------
// Issue types (discriminated union)
// ---------------------------------------------------------------------------

/**
 * More real students in the roster than total assignable seats.
 * The allocator cannot seat everyone — some will be left out.
 */
export interface OverCapacityIssue {
  readonly kind: 'over-capacity';
  /** Number of real (non-fixture) students in the roster. */
  readonly studentCount: number;
  /** Number of assignable seats across all furniture (capacity > 0, non-fixture). */
  readonly seatCount: number;
  /** Shortfall: studentCount − seatCount (always > 0 when this issue is present). */
  readonly shortfall: number;
}

/**
 * One or more real roster students are not seated anywhere in the current
 * classroom arrangement. This can happen when:
 *   (a) the classroom has fewer desks than students (subset of over-capacity), or
 *   (b) the arrangement was partially set and some students were never placed.
 *
 * When both over-capacity AND unplaced are present at the same time, the UI
 * should surface both — over-capacity explains *why*, unplaced shows *who*.
 * The validator intentionally reports them as separate issues.
 */
export interface UnplacedStudentsIssue {
  readonly kind: 'unplaced';
  /** Ids of the unplaced students. */
  readonly studentIds: readonly StudentId[];
  /** Convenience: studentIds.length */
  readonly count: number;
}

/** Discriminated union of all possible seating issues. */
export type SeatingIssue = OverCapacityIssue | UnplacedStudentsIssue;

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface SeatingValidationResult {
  /** true when issues is empty — seating is valid. */
  readonly valid: boolean;
  /** Ordered list of issues found. Empty when valid. */
  readonly issues: readonly SeatingIssue[];
}

// ---------------------------------------------------------------------------
// validateSeating
// ---------------------------------------------------------------------------

/**
 * Validate the current seating arrangement.
 *
 * @param classroom - The live classroom (furniture + their occupants).
 * @param roster    - All students (real + fixture). Source of truth for who
 *                    should be seated.
 * @returns A SeatingValidationResult: valid flag + list of typed issues.
 */
export function validateSeating(
  classroom: Classroom,
  roster: readonly Student[],
): SeatingValidationResult {
  // ---- 1. Partition roster into real students vs. fixtures -------------------
  const realStudents = roster.filter((s) => !s.isFixture);

  // ---- 2. Count assignable seats --------------------------------------------
  // Assignable = furniture with capacity > 0.
  // Fixture-carrying furniture has capacity 0 (teacher_desk / whiteboard), so
  // it is automatically excluded. The extra isFixture guard is belt-and-suspenders.
  let seatCount = 0;
  for (const f of classroom.furniture) {
    const cap = capacity(f);
    if (cap > 0) {
      // Double-check: if somehow a capacity->0 piece has a fixture occupant,
      // it is NOT an assignable seat for real students.
      const occ = occupant(f);
      if (occ?.isFixture !== true) {
        seatCount += cap;
      }
    }
  }

  // ---- 3. Build the set of seated real-student ids from current arrangement --
  const seatedIds = new Set<StudentId>();
  for (const f of classroom.furniture) {
    const occ = occupant(f);
    if (occ !== undefined && !occ.isFixture) {
      seatedIds.add(occ.id);
    }
  }

  // ---- 4. Check issues -------------------------------------------------------
  const issues: SeatingIssue[] = [];

  // (a) Over-capacity: more real students than assignable seats
  const studentCount = realStudents.length;
  if (studentCount > seatCount) {
    issues.push({
      kind: 'over-capacity',
      studentCount,
      seatCount,
      shortfall: studentCount - seatCount,
    });
  }

  // (b) Unplaced: real roster students not in the current arrangement
  const unplacedIds = realStudents
    .filter((s) => !seatedIds.has(s.id))
    .map((s) => s.id);

  if (unplacedIds.length > 0) {
    issues.push({
      kind: 'unplaced',
      studentIds: unplacedIds,
      count: unplacedIds.length,
    });
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
