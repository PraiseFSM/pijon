// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  capacity,
  seatCells,
  occupiedCells,
  occupant,
  isFixture,
  assignOccupant,
  vacate,
  moveTo,
} from './furniture.js';
import type { Furniture } from './furniture.js';
import { furnitureId } from './types.js';
import { makeStudent, makeFixture } from './student.js';
import type { Student } from './student.js';
import { studentId } from './types.js';

// ---------------------------------------------------------------------------
// Helpers to build test fixtures quickly
// ---------------------------------------------------------------------------

function desk(overrides?: Partial<Furniture>): Furniture {
  return {
    id: furnitureId('desk-1'),
    kind: 'single_desk',
    pos: { x: 0, y: 0 },
    w: 1,
    h: 1,
    rotation: 0,
    occupants: [],
    ...overrides,
  };
}

function table(
  w: number,
  h: number,
  numSeats: number,
  overrides?: Partial<Furniture>,
): Furniture {
  return {
    id: furnitureId('table-1'),
    kind: 'table',
    pos: { x: 0, y: 0 },
    w,
    h,
    rotation: 0,
    occupants: [],
    numSeats,
    ...overrides,
  };
}

function teacherDesk(overrides?: Partial<Furniture>): Furniture {
  return {
    id: furnitureId('td-1'),
    kind: 'teacher_desk',
    pos: { x: 0, y: 0 },
    w: 2,
    h: 1,
    rotation: 0,
    occupants: [],
    ...overrides,
  };
}

function whiteboard(overrides?: Partial<Furniture>): Furniture {
  return {
    id: furnitureId('wb-1'),
    kind: 'whiteboard',
    pos: { x: 0, y: 0 },
    w: 3,
    h: 1,
    rotation: 0,
    occupants: [],
    ...overrides,
  };
}

const student = makeStudent(studentId('s-1'), 'Alice');
const fixture = makeFixture(studentId('fix-1'), 'Whiteboard');

// ---------------------------------------------------------------------------
// capacity
// ---------------------------------------------------------------------------

describe('capacity', () => {
  it('single_desk has capacity 1', () => {
    expect(capacity(desk())).toBe(1);
  });

  it('table capacity equals numSeats', () => {
    expect(capacity(table(2, 2, 4))).toBe(4);
    expect(capacity(table(3, 2, 6))).toBe(6);
    expect(capacity(table(2, 1, 2))).toBe(2);
  });

  it('table without numSeats defaults to 4', () => {
    const t: Furniture = {
      id: furnitureId('t'),
      kind: 'table',
      pos: { x: 0, y: 0 },
      w: 2,
      h: 2,
      rotation: 0,
      occupants: [],
    };
    expect(capacity(t)).toBe(4);
  });

  it('teacher_desk has capacity 0', () => {
    expect(capacity(teacherDesk())).toBe(0);
  });

  it('whiteboard has capacity 0', () => {
    expect(capacity(whiteboard())).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// occupiedCells
// ---------------------------------------------------------------------------

describe('occupiedCells', () => {
  it('1×1 desk at origin occupies one cell', () => {
    const cells = occupiedCells(desk());
    expect(cells).toHaveLength(1);
    expect(cells[0]).toEqual({ x: 0, y: 0 });
  });

  it('2×1 teacher_desk at (3,2) occupies 2 cells', () => {
    const cells = occupiedCells(teacherDesk({ pos: { x: 3, y: 2 } }));
    expect(cells).toHaveLength(2);
    expect(cells).toContainEqual({ x: 3, y: 2 });
    expect(cells).toContainEqual({ x: 4, y: 2 });
  });

  it('2×2 table occupies 4 cells', () => {
    const cells = occupiedCells(table(2, 2, 4));
    expect(cells).toHaveLength(4);
  });

  it('3×2 table at (1,1) occupies 6 cells with correct coords', () => {
    const cells = occupiedCells(table(3, 2, 6, { pos: { x: 1, y: 1 } }));
    expect(cells).toHaveLength(6);
    // Check corners
    expect(cells).toContainEqual({ x: 1, y: 1 });
    expect(cells).toContainEqual({ x: 3, y: 2 });
  });

  it('3×1 whiteboard occupies 3 cells', () => {
    const cells = occupiedCells(whiteboard());
    expect(cells).toHaveLength(3);
  });

  it('desk at (5,7) reports correct cell', () => {
    const cells = occupiedCells(desk({ pos: { x: 5, y: 7 } }));
    expect(cells[0]).toEqual({ x: 5, y: 7 });
  });
});

// ---------------------------------------------------------------------------
// seatCells
// ---------------------------------------------------------------------------

describe('seatCells', () => {
  it('single_desk returns one seat at its pos', () => {
    const cells = seatCells(desk({ pos: { x: 3, y: 4 } }));
    expect(cells).toHaveLength(1);
    expect(cells[0]).toEqual({ x: 3, y: 4 });
  });

  it('single_desk at origin returns [{x:0,y:0}]', () => {
    expect(seatCells(desk())).toEqual([{ x: 0, y: 0 }]);
  });

  it('teacher_desk returns no seats', () => {
    expect(seatCells(teacherDesk())).toHaveLength(0);
  });

  it('whiteboard returns no seats', () => {
    expect(seatCells(whiteboard())).toHaveLength(0);
  });

  describe('table with 2 seats', () => {
    it('places seats at left and right of top row', () => {
      const cells = seatCells(table(4, 2, 2, { pos: { x: 0, y: 0 } }));
      expect(cells).toHaveLength(2);
      expect(cells).toContainEqual({ x: 0, y: 0 });
      expect(cells).toContainEqual({ x: 3, y: 0 });
    });
  });

  describe('table with 4 seats', () => {
    it('places seats at four corners', () => {
      const cells = seatCells(table(3, 2, 4, { pos: { x: 1, y: 2 } }));
      expect(cells).toHaveLength(4);
      expect(cells).toContainEqual({ x: 1, y: 2 });   // top-left
      expect(cells).toContainEqual({ x: 3, y: 2 });   // top-right
      expect(cells).toContainEqual({ x: 1, y: 3 });   // bottom-left
      expect(cells).toContainEqual({ x: 3, y: 3 });   // bottom-right
    });
  });

  describe('table with 6 seats', () => {
    it('places seats on top and bottom rows with midpoints', () => {
      const cells = seatCells(table(4, 2, 6, { pos: { x: 0, y: 0 } }));
      expect(cells).toHaveLength(6);
      // top row: x=0, x=2(mid), x=3(right)
      expect(cells).toContainEqual({ x: 0, y: 0 });
      expect(cells).toContainEqual({ x: 2, y: 0 });
      expect(cells).toContainEqual({ x: 3, y: 0 });
      // bottom row
      expect(cells).toContainEqual({ x: 0, y: 1 });
      expect(cells).toContainEqual({ x: 2, y: 1 });
      expect(cells).toContainEqual({ x: 3, y: 1 });
    });
  });

  describe('table with unusual seat count (fallback)', () => {
    it('distributes seats in row-order within bounding box', () => {
      const cells = seatCells(table(3, 2, 3, { pos: { x: 0, y: 0 } }));
      expect(cells).toHaveLength(3);
      expect(cells[0]).toEqual({ x: 0, y: 0 });
      expect(cells[1]).toEqual({ x: 1, y: 0 });
      expect(cells[2]).toEqual({ x: 2, y: 0 });
    });

    it('wraps to next row when seats exceed width', () => {
      const cells = seatCells(table(2, 2, 5, { pos: { x: 0, y: 0 } }));
      expect(cells).toHaveLength(5);
      expect(cells[0]).toEqual({ x: 0, y: 0 });
      expect(cells[1]).toEqual({ x: 1, y: 0 });
      expect(cells[2]).toEqual({ x: 0, y: 1 });
    });
  });

  it('table with 0 seats returns empty array', () => {
    const cells = seatCells(table(2, 2, 0));
    expect(cells).toHaveLength(0);
  });

  it('table without numSeats defaults to 4 seats in seatCells', () => {
    const t: Furniture = {
      id: furnitureId('t-no-seats'),
      kind: 'table',
      pos: { x: 0, y: 0 },
      w: 3,
      h: 2,
      rotation: 0,
      occupants: [],
      // numSeats intentionally omitted to test the ?? 4 fallback
    };
    expect(seatCells(t)).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// occupant / isFixture
// ---------------------------------------------------------------------------

describe('occupant', () => {
  it('returns undefined for empty furniture', () => {
    expect(occupant(desk())).toBeUndefined();
  });

  it('returns the first occupant', () => {
    const d = { ...desk(), occupants: [student] };
    expect(occupant(d)).toBe(student);
  });
});

describe('isFixture', () => {
  it('returns false when no occupant', () => {
    expect(isFixture(desk())).toBe(false);
  });

  it('returns false when occupant is a real student', () => {
    const d = { ...desk(), occupants: [student] };
    expect(isFixture(d)).toBe(false);
  });

  it('returns true when occupant is a fixture', () => {
    const d = { ...desk(), occupants: [fixture] };
    expect(isFixture(d)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// assignOccupant (immutable)
// ---------------------------------------------------------------------------

describe('assignOccupant', () => {
  it('assigns a student to a desk', () => {
    const d = desk();
    const d2 = assignOccupant(d, student);
    expect(d2.occupants[0]).toBe(student);
  });

  it('does not mutate the original furniture', () => {
    const d = desk();
    assignOccupant(d, student);
    expect(d.occupants).toHaveLength(0);
  });

  it('throws when assigning a real student to teacher_desk (capacity 0)', () => {
    expect(() => assignOccupant(teacherDesk(), student)).toThrow(
      /capacity 0.*real student/i,
    );
  });

  it('throws when assigning a real student to whiteboard (capacity 0)', () => {
    expect(() => assignOccupant(whiteboard(), student)).toThrow(
      /capacity 0.*real student/i,
    );
  });

  it('throws when desk is already at capacity', () => {
    const d = assignOccupant(desk(), student);
    const student2 = makeStudent(studentId('s-2'), 'Bob');
    expect(() => assignOccupant(d, student2)).toThrow();
  });

  it('can assign a fixture occupant to a regular desk', () => {
    const d = desk();
    const d2 = assignOccupant(d, fixture);
    expect(d2.occupants[0]).toBe(fixture);
    expect(isFixture(d2)).toBe(true);
  });

  it('can assign a fixture occupant to a teacher_desk (capacity 0)', () => {
    // This is the primary use case: a teacher_desk carrying a faux "Teacher" occupant
    // so preferences and the seat graph can reference the room feature.
    const td = teacherDesk();
    const teacherFixture = makeFixture(studentId('fix-teacher'), 'Teacher');
    const td2 = assignOccupant(td, teacherFixture);
    expect(td2.occupants[0]).toBe(teacherFixture);
    expect(isFixture(td2)).toBe(true);
  });

  it('can assign a fixture occupant to a whiteboard (capacity 0)', () => {
    const wb = whiteboard();
    const wbFixtureOccupant = makeFixture(studentId('fix-wb2'), 'Whiteboard');
    const wb2 = assignOccupant(wb, wbFixtureOccupant);
    expect(wb2.occupants[0]).toBe(wbFixtureOccupant);
    expect(isFixture(wb2)).toBe(true);
  });

  it('throws when assigning a second fixture to already-occupied teacher_desk', () => {
    // "at most one occupant" applies to fixtures too
    const td = teacherDesk();
    const f1 = makeFixture(studentId('f1'), 'Teacher');
    const f2 = makeFixture(studentId('f2'), 'Another');
    const td2 = assignOccupant(td, f1);
    expect(() => assignOccupant(td2, f2)).toThrow(/already has an occupant/i);
  });

  it('throws when assigning a second student to a table (at-most-one-for-now rule)', () => {
    // The domain spec says "at most one occupant for now" — even for tables with numSeats > 1.
    // Multi-occupant tables are reserved for a later phase.
    const t = table(2, 2, 2);
    const s1 = makeStudent(studentId('a'), 'A');
    const s2 = makeStudent(studentId('b'), 'B');
    const t1 = assignOccupant(t, s1);
    expect(() => assignOccupant(t1, s2)).toThrow();
  });

  it('throws when table is already occupied (one-occupant rule fires before capacity check)', () => {
    const t = table(2, 2, 1, { numSeats: 1 });
    const s1 = makeStudent(studentId('a'), 'A');
    const s2 = makeStudent(studentId('b'), 'B');
    const t1 = assignOccupant(t, s1);
    expect(() => assignOccupant(t1, s2)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// vacate (immutable)
// ---------------------------------------------------------------------------

describe('vacate', () => {
  it('removes all occupants', () => {
    const d = assignOccupant(desk(), student);
    const d2 = vacate(d);
    expect(d2.occupants).toHaveLength(0);
  });

  it('does not mutate the original', () => {
    const d = assignOccupant(desk(), student);
    vacate(d);
    expect(d.occupants).toHaveLength(1);
  });

  it('vacating already-empty furniture is a no-op', () => {
    const d = desk();
    const d2 = vacate(d);
    expect(d2.occupants).toHaveLength(0);
  });

  it('preserves all other fields', () => {
    const d = assignOccupant(desk({ pos: { x: 5, y: 3 } }), student);
    const d2 = vacate(d);
    expect(d2.pos).toEqual({ x: 5, y: 3 });
    expect(d2.kind).toBe('single_desk');
  });
});

// ---------------------------------------------------------------------------
// moveTo (immutable)
// ---------------------------------------------------------------------------

describe('moveTo', () => {
  it('returns furniture at the new position', () => {
    const d = desk({ pos: { x: 0, y: 0 } });
    const d2 = moveTo(d, { x: 5, y: 3 });
    expect(d2.pos).toEqual({ x: 5, y: 3 });
  });

  it('does not mutate the original', () => {
    const d = desk({ pos: { x: 0, y: 0 } });
    moveTo(d, { x: 5, y: 3 });
    expect(d.pos).toEqual({ x: 0, y: 0 });
  });

  it('occupants travel with the furniture (embedded in record)', () => {
    const d = assignOccupant(desk({ pos: { x: 0, y: 0 } }), student);
    const d2 = moveTo(d, { x: 4, y: 4 });
    expect(d2.occupants[0]).toBe(student);
    expect(d2.pos).toEqual({ x: 4, y: 4 });
  });

  it('preserves all other fields', () => {
    const d = desk({ id: furnitureId('my-desk'), kind: 'single_desk' });
    const d2 = moveTo(d, { x: 2, y: 2 });
    expect(d2.id).toBe('my-desk');
    expect(d2.kind).toBe('single_desk');
  });

  it('occupants array in result is a new reference (no shared mutable state)', () => {
    const d = assignOccupant(desk({ pos: { x: 0, y: 0 } }), student);
    const d2 = moveTo(d, { x: 5, y: 5 });
    // Must be a different array instance even though the contents are the same
    expect(d2.occupants).not.toBe(d.occupants);
  });

  it('mutating result occupants does not affect original (runtime proof)', () => {
    const d = assignOccupant(desk({ pos: { x: 0, y: 0 } }), student);
    const d2 = moveTo(d, { x: 3, y: 3 });
    // Cast through unknown to bypass readonly — simulates a Phase 3 escape hatch
    (d2.occupants as unknown as Student[]).push(
      makeStudent(studentId('s-extra'), 'Extra'),
    );
    // Original occupants must be untouched
    expect(d.occupants).toHaveLength(1);
  });

  it('moving to the same position is idempotent', () => {
    const d = assignOccupant(desk({ pos: { x: 4, y: 7 } }), student);
    const d2 = moveTo(d, { x: 4, y: 7 });
    expect(d2.pos).toEqual({ x: 4, y: 7 });
    expect(d2.occupants[0]).toBe(student);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — zero/negative dimensions and unusual numSeats
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('seatCells on a 1×1 table with numSeats=1 returns one seat (fallback path)', () => {
    // numSeats=1 is not in {2,4,6} so it goes through the fallback row-order branch
    const t = table(1, 1, 1, { pos: { x: 2, y: 3 } });
    const cells = seatCells(t);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toEqual({ x: 2, y: 3 });
  });

  it('occupiedCells on a 1×1 desk returns exactly one cell', () => {
    // Minimum valid furniture: 1×1
    const cells = occupiedCells(desk({ pos: { x: 0, y: 0 }, w: 1, h: 1 }));
    expect(cells).toHaveLength(1);
  });

  it('capacity for a table with numSeats=0 is 0', () => {
    expect(capacity(table(2, 2, 0))).toBe(0);
  });

  it('seatCells for a table with numSeats=0 is empty', () => {
    expect(seatCells(table(2, 2, 0))).toHaveLength(0);
  });

  it('assignOccupant throws when assigning real student to table with numSeats=0', () => {
    // A table with 0 seats is treated like a fixture kind for assignment purposes
    const t = table(2, 2, 0);
    expect(() => assignOccupant(t, student)).toThrow(/capacity/i);
  });

  it('table with numSeats > width*height: fallback generates seats that may overlap occupied cells', () => {
    // This is a known limitation of the fallback — documented, not considered a bug
    // since numSeats > w*h is invalid furniture configuration
    // Just verifies no exception is thrown and count matches numSeats
    const t = table(1, 1, 3, { pos: { x: 0, y: 0 } });
    const cells = seatCells(t);
    expect(cells).toHaveLength(3);
  });
});
