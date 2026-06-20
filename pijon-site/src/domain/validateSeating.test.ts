// @vitest-environment node
/**
 * Tests for §13.8 — validateSeating domain helper.
 *
 * Covers:
 *   1. Exact-fit (students === seats) → no issues.
 *   2. Over-capacity (more students than assignable seats) → 'over-capacity' issue.
 *   3. Unplaced students after a partial allocation → 'unplaced' issue.
 *   4. All seated, none unplaced → no issues.
 *   5. Empty roster → no issues.
 *   6. Empty classroom (no furniture) → no issues when roster is also empty.
 *   7. Empty classroom with students → both over-capacity AND no-seats unplaced.
 *   8. Fixtures never counted as real students.
 *   9. Fixture-carrying furniture not counted as assignable seats.
 *  10. Classroom with ONLY fixtures → 0 assignable seats.
 *  11. Over-capacity and unplaced both reported simultaneously.
 *  12. Unplaced-only (enough seats exist, but arrangement is partial).
 *  13. Shortfall value is correct.
 */

import { describe, it, expect } from 'vitest';
import { validateSeating } from './validateSeating.js';
import { makeClassroom, addFurniture, fixtureId } from './classroom.js';
import type { Classroom } from './classroom.js';
import { furnitureId, studentId } from './types.js';
import { makeStudent, makeFixture } from './student.js';
import { assignOccupant } from './furniture.js';
import type { Furniture } from './furniture.js';
import type { Student } from './student.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make a fresh single desk (1 seat, no occupant). */
function makeDesk(id: string, x = 0, y = 0): Furniture {
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

/** Make a teacher_desk (capacity 0, no seats for students). */
function makeTeacherDesk(id: string, x = 0, y = 0): Furniture {
  return {
    id: furnitureId(id),
    kind: 'teacher_desk',
    pos: { x, y },
    w: 2,
    h: 1,
    rotation: 0,
    occupants: [],
  };
}

/** Seat a student on a desk (returns new Furniture). */
function seat(desk: Furniture, student: Student): Furniture {
  return assignOccupant(desk, student);
}

/** Build a classroom with the given furniture. */
function mkClassroom(furniturePieces: Furniture[]): Classroom {
  let c = makeClassroom('c1', 'Test Room', 10, 8);
  for (const f of furniturePieces) {
    c = addFurniture(c, f);
  }
  return c;
}

// ---- Reusable students ----

const alice = makeStudent(studentId('s-alice'), 'Alice');
const bob   = makeStudent(studentId('s-bob'),   'Bob');
const carol = makeStudent(studentId('s-carol'), 'Carol');
const dave  = makeStudent(studentId('s-dave'),  'Dave');

// ---- Reusable fixture occupant ----
const wbFixture = makeFixture(fixtureId('Whiteboard'), 'Whiteboard');

// ---------------------------------------------------------------------------
// 1. Exact-fit (students === seats) → no issues
// ---------------------------------------------------------------------------

describe('validateSeating — exact fit', () => {
  it('returns valid with no issues when every student has a seat', () => {
    const desk1 = seat(makeDesk('d1', 0, 0), alice);
    const desk2 = seat(makeDesk('d2', 1, 0), bob);
    const classroom = mkClassroom([desk1, desk2]);
    const roster: Student[] = [alice, bob];

    const result = validateSeating(classroom, roster);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('returns valid when there are more seats than students and all are seated', () => {
    const desk1 = seat(makeDesk('d1', 0, 0), alice);
    const desk2 = makeDesk('d2', 1, 0); // empty seat
    const classroom = mkClassroom([desk1, desk2]);
    const roster: Student[] = [alice];

    const result = validateSeating(classroom, roster);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Over-capacity: more real students than assignable seats
// ---------------------------------------------------------------------------

describe('validateSeating — over-capacity', () => {
  it('reports over-capacity when studentCount > seatCount', () => {
    // 2 desks, 3 students
    const desk1 = makeDesk('d1', 0, 0);
    const desk2 = makeDesk('d2', 1, 0);
    const classroom = mkClassroom([desk1, desk2]);
    const roster: Student[] = [alice, bob, carol];

    const result = validateSeating(classroom, roster);

    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.kind === 'over-capacity');
    expect(issue).toBeDefined();
    if (issue?.kind !== 'over-capacity') return;
    expect(issue.studentCount).toBe(3);
    expect(issue.seatCount).toBe(2);
    expect(issue.shortfall).toBe(1);
  });

  it('shortfall is studentCount − seatCount', () => {
    // 1 desk, 4 students → shortfall = 3
    const desk = makeDesk('d1', 0, 0);
    const classroom = mkClassroom([desk]);
    const roster: Student[] = [alice, bob, carol, dave];

    const result = validateSeating(classroom, roster);

    const issue = result.issues.find((i) => i.kind === 'over-capacity');
    if (issue?.kind !== 'over-capacity') throw new Error('expected over-capacity');
    expect(issue.studentCount).toBe(4);
    expect(issue.seatCount).toBe(1);
    expect(issue.shortfall).toBe(3);
  });

  it('zero desks, students present → over-capacity with seatCount=0', () => {
    const classroom = mkClassroom([]);
    const roster: Student[] = [alice, bob];

    const result = validateSeating(classroom, roster);

    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.kind === 'over-capacity');
    if (issue?.kind !== 'over-capacity') throw new Error('expected over-capacity');
    expect(issue.seatCount).toBe(0);
    expect(issue.studentCount).toBe(2);
    expect(issue.shortfall).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Unplaced students after a partial allocation
// ---------------------------------------------------------------------------

describe('validateSeating — unplaced students', () => {
  it('reports unplaced when a real student has no seat', () => {
    // 3 desks, 3 students, only alice seated
    const desk1 = seat(makeDesk('d1', 0, 0), alice);
    const desk2 = makeDesk('d2', 1, 0);
    const desk3 = makeDesk('d3', 2, 0);
    const classroom = mkClassroom([desk1, desk2, desk3]);
    const roster: Student[] = [alice, bob, carol];

    const result = validateSeating(classroom, roster);

    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.kind === 'unplaced');
    if (issue?.kind !== 'unplaced') throw new Error('expected unplaced');
    expect(issue.count).toBe(2);
    expect(issue.studentIds).toContain(bob.id);
    expect(issue.studentIds).toContain(carol.id);
    expect(issue.studentIds).not.toContain(alice.id);
  });

  it('unplaced-only (enough seats exist): includes hint that seats are available', () => {
    // 2 desks, 2 students, neither seated → unplaced with no over-capacity
    const desk1 = makeDesk('d1', 0, 0);
    const desk2 = makeDesk('d2', 1, 0);
    const classroom = mkClassroom([desk1, desk2]);
    const roster: Student[] = [alice, bob];

    const result = validateSeating(classroom, roster);

    expect(result.valid).toBe(false);
    const overCap = result.issues.find((i) => i.kind === 'over-capacity');
    expect(overCap).toBeUndefined(); // seats exist

    const unplaced = result.issues.find((i) => i.kind === 'unplaced');
    if (unplaced?.kind !== 'unplaced') throw new Error('expected unplaced');
    expect(unplaced.count).toBe(2);
    expect(unplaced.studentIds).toContain(alice.id);
    expect(unplaced.studentIds).toContain(bob.id);
  });
});

// ---------------------------------------------------------------------------
// 4. All seated — no issues
// ---------------------------------------------------------------------------

describe('validateSeating — all seated', () => {
  it('returns valid when all roster students are seated', () => {
    const desk1 = seat(makeDesk('d1', 0, 0), alice);
    const desk2 = seat(makeDesk('d2', 1, 0), bob);
    const desk3 = seat(makeDesk('d3', 2, 0), carol);
    const classroom = mkClassroom([desk1, desk2, desk3]);
    const roster: Student[] = [alice, bob, carol];

    const result = validateSeating(classroom, roster);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Empty roster → no issues
// ---------------------------------------------------------------------------

describe('validateSeating — empty roster', () => {
  it('returns valid when roster is empty (no students to seat)', () => {
    const desk = makeDesk('d1', 0, 0);
    const classroom = mkClassroom([desk]);
    const result = validateSeating(classroom, []);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Empty classroom (no furniture) + empty roster → no issues
// ---------------------------------------------------------------------------

describe('validateSeating — empty classroom + empty roster', () => {
  it('returns valid when both are empty', () => {
    const classroom = mkClassroom([]);
    const result = validateSeating(classroom, []);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Empty classroom with students → both over-capacity and unplaced
// ---------------------------------------------------------------------------

describe('validateSeating — empty classroom with students', () => {
  it('reports over-capacity AND unplaced when no desks exist', () => {
    const classroom = mkClassroom([]);
    const roster: Student[] = [alice, bob];

    const result = validateSeating(classroom, roster);

    expect(result.valid).toBe(false);

    const overCap = result.issues.find((i) => i.kind === 'over-capacity');
    expect(overCap).toBeDefined();

    const unplaced = result.issues.find((i) => i.kind === 'unplaced');
    expect(unplaced).toBeDefined();
    if (unplaced?.kind !== 'unplaced') return;
    expect(unplaced.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 8. Fixtures never counted as real students
// ---------------------------------------------------------------------------

describe('validateSeating — fixtures excluded from student count', () => {
  it('does not count fixture students as real students', () => {
    // 1 desk, 1 real student → should be exact-fit (valid), even if fixture in roster
    const desk = seat(makeDesk('d1', 0, 0), alice);
    const classroom = mkClassroom([desk]);
    const roster: Student[] = [alice, wbFixture]; // fixture is in roster

    const result = validateSeating(classroom, roster);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('fixture in roster is not reported as unplaced', () => {
    // alice seated, wbFixture in roster but never placed on a real desk
    const desk = seat(makeDesk('d1', 0, 0), alice);
    const classroom = mkClassroom([desk]);
    const roster: Student[] = [alice, wbFixture];

    const result = validateSeating(classroom, roster);

    expect(result.valid).toBe(true);
    // No unplaced issue — fixture is excluded
    expect(result.issues.find((i) => i.kind === 'unplaced')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9. Fixture-carrying furniture not counted as assignable seat
// ---------------------------------------------------------------------------

describe('validateSeating — fixture-carrying furniture excluded from seat count', () => {
  it('does not count teacher_desk with fixture occupant as an assignable seat', () => {
    // teacher_desk with a fixture occupant, plus 1 student but no real desk
    const tdDesk = makeTeacherDesk('td1', 3, 0);
    const tdWithFixture = assignOccupant(tdDesk, wbFixture); // fixture on teacher_desk
    const classroom = mkClassroom([tdWithFixture]);
    const roster: Student[] = [alice]; // 1 real student, 0 real seats

    const result = validateSeating(classroom, roster);

    expect(result.valid).toBe(false);
    const overCap = result.issues.find((i) => i.kind === 'over-capacity');
    if (overCap?.kind !== 'over-capacity') throw new Error('expected over-capacity');
    expect(overCap.seatCount).toBe(0); // teacher_desk does not count
  });

  it('teacher_desk WITHOUT fixture also has 0 seats (capacity=0)', () => {
    const td = makeTeacherDesk('td1', 3, 0); // empty teacher_desk
    const classroom = mkClassroom([td]);
    const roster: Student[] = [alice];

    const result = validateSeating(classroom, roster);

    const overCap = result.issues.find((i) => i.kind === 'over-capacity');
    if (overCap?.kind !== 'over-capacity') throw new Error('expected over-capacity');
    expect(overCap.seatCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Classroom with ONLY fixtures → 0 assignable seats
// ---------------------------------------------------------------------------

describe('validateSeating — only fixtures in classroom', () => {
  it('counts 0 assignable seats when classroom has only teacher_desks', () => {
    const td = makeTeacherDesk('td1', 0, 0);
    const classroom = mkClassroom([td]);
    const roster: Student[] = [alice, bob];

    const result = validateSeating(classroom, roster);

    expect(result.valid).toBe(false);
    const overCap = result.issues.find((i) => i.kind === 'over-capacity');
    if (overCap?.kind !== 'over-capacity') throw new Error('expected over-capacity');
    expect(overCap.seatCount).toBe(0);
    expect(overCap.studentCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 11. Over-capacity and unplaced both reported simultaneously
// ---------------------------------------------------------------------------

describe('validateSeating — both over-capacity and unplaced', () => {
  it('reports both issues when students exceed seats and some are unseated', () => {
    // 2 desks, 4 students — only alice is seated; bob, carol, dave are unplaced
    const desk1 = seat(makeDesk('d1', 0, 0), alice);
    const desk2 = makeDesk('d2', 1, 0);
    const classroom = mkClassroom([desk1, desk2]);
    const roster: Student[] = [alice, bob, carol, dave];

    const result = validateSeating(classroom, roster);

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(2);

    const overCap = result.issues.find((i) => i.kind === 'over-capacity');
    const unplaced = result.issues.find((i) => i.kind === 'unplaced');
    expect(overCap).toBeDefined();
    expect(unplaced).toBeDefined();
    if (overCap?.kind !== 'over-capacity') return;
    expect(overCap.shortfall).toBe(2); // 4 students, 2 seats
    if (unplaced?.kind !== 'unplaced') return;
    expect(unplaced.count).toBe(3); // bob, carol, dave not seated
  });
});

// ---------------------------------------------------------------------------
// 12. Mixed: fixtures in classroom don't inflate seat count
// ---------------------------------------------------------------------------

describe('validateSeating — mixed desks + fixtures in classroom', () => {
  it('counts only single_desk seats, not teacher_desk or fixture occupants', () => {
    const desk = makeDesk('d1', 0, 0);         // 1 real seat
    const td   = makeTeacherDesk('td1', 2, 0); // 0 seats (fixture kind)
    const classroom = mkClassroom([desk, td]);
    const roster: Student[] = [alice, bob]; // 2 students, 1 seat

    const result = validateSeating(classroom, roster);

    expect(result.valid).toBe(false);
    const overCap = result.issues.find((i) => i.kind === 'over-capacity');
    if (overCap?.kind !== 'over-capacity') throw new Error('expected over-capacity');
    expect(overCap.seatCount).toBe(1);
    expect(overCap.studentCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 13. Belt-and-suspenders: capacity>0 furniture with a fixture occupant is
//     NOT an assignable seat for real students.
//
// The spec says fixture-carrying furniture is excluded via the belt-and-
// suspenders double guard in validateSeating.  Because the domain model
// currently prevents assigning a fixture to capacity>0 furniture (assignOccupant
// allows it — fixtures bypass the capacity check), a hypothetical future
// furniture kind could have capacity>0 AND carry a fixture.  This test pins
// the guard so refactors can't accidentally count such a piece as a real seat.
// ---------------------------------------------------------------------------

describe('validateSeating — belt-and-suspenders: capacity>0 + fixture occupant', () => {
  it('does not count a single_desk carrying a fixture as an assignable seat', () => {
    // Construct the edge case directly: a single_desk (cap=1) occupied by a
    // fixture student.  assignOccupant allows fixtures on any furniture.
    const deskWithFixture = assignOccupant(makeDesk('d1', 0, 0), wbFixture);
    const classroom = mkClassroom([deskWithFixture]);

    // 1 real student, but the only desk has a fixture on it → seatCount must be 0
    const result = validateSeating(classroom, [alice]);

    expect(result.valid).toBe(false);
    const overCap = result.issues.find((i) => i.kind === 'over-capacity');
    if (overCap?.kind !== 'over-capacity') throw new Error('expected over-capacity');
    // The fixture-occupied single_desk must NOT be counted as an open seat
    expect(overCap.seatCount).toBe(0);
    expect(overCap.studentCount).toBe(1);
    expect(overCap.shortfall).toBe(1);
  });

  it('fixture occupant on a capacity>0 desk is NOT counted as placed (is never a real student)', () => {
    // The fixture on the desk must not end up in seatedIds for real students.
    const deskWithFixture = assignOccupant(makeDesk('d1', 0, 0), wbFixture);
    const classroom = mkClassroom([deskWithFixture]);

    // Roster has no real students — everything should be valid (no students to seat)
    const resultEmpty = validateSeating(classroom, []);
    expect(resultEmpty.valid).toBe(true);

    // Roster has only the fixture student — it should also be valid (fixture excluded)
    const resultFixtureOnly = validateSeating(classroom, [wbFixture]);
    expect(resultFixtureOnly.valid).toBe(true);
  });
});
