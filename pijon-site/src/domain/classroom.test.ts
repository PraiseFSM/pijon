// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  makeClassroom,
  assignments,
  fixtures,
  furnitureById,
  addFurniture,
  removeFurniture,
  updateFurniture,
  moveFurniture,
  fixtureId,
} from './classroom.js';
import { furnitureId, studentId } from './types.js';
import { makeStudent, makeFixture } from './student.js';
import type { Student } from './student.js';
import { assignOccupant, vacate } from './furniture.js';
import type { Furniture } from './furniture.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeskFurniture(id: string, x = 0, y = 0): Furniture {
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

const alice = makeStudent(studentId('s-alice'), 'Alice');
const bob = makeStudent(studentId('s-bob'), 'Bob');
const wbFixture = makeFixture(studentId('fix-wb'), 'Whiteboard');

// ---------------------------------------------------------------------------
// makeClassroom
// ---------------------------------------------------------------------------

describe('makeClassroom', () => {
  it('creates an empty classroom', () => {
    const c = makeClassroom('c1', 'Room 101', 10, 8);
    expect(c.id).toBe('c1');
    expect(c.name).toBe('Room 101');
    expect(c.gridW).toBe(10);
    expect(c.gridH).toBe(8);
    expect(c.furniture).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// assignments
// ---------------------------------------------------------------------------

describe('assignments', () => {
  it('returns empty map when no furniture', () => {
    const c = makeClassroom('c', 'x', 5, 5);
    expect(assignments(c).size).toBe(0);
  });

  it('returns empty map when furniture has no occupants', () => {
    const c = addFurniture(makeClassroom('c', 'x', 5, 5), makeDeskFurniture('d1'));
    expect(assignments(c).size).toBe(0);
  });

  it('includes real students', () => {
    const d = assignOccupant(makeDeskFurniture('d1'), alice);
    const c = addFurniture(makeClassroom('c', 'x', 5, 5), d);
    const map = assignments(c);
    expect(map.size).toBe(1);
    expect(map.get(furnitureId('d1'))).toBe(alice);
  });

  it('excludes fixture occupants', () => {
    const wb: Furniture = {
      id: furnitureId('wb'),
      kind: 'whiteboard',
      pos: { x: 0, y: 0 },
      w: 3,
      h: 1,
      rotation: 0,
      occupants: [wbFixture],
    };
    const c = addFurniture(makeClassroom('c', 'x', 10, 10), wb);
    expect(assignments(c).size).toBe(0);
  });

  it('includes multiple real students', () => {
    const d1 = assignOccupant(makeDeskFurniture('d1', 0, 0), alice);
    const d2 = assignOccupant(makeDeskFurniture('d2', 1, 0), bob);
    let c = makeClassroom('c', 'x', 5, 5);
    c = addFurniture(c, d1);
    c = addFurniture(c, d2);
    const map = assignments(c);
    expect(map.size).toBe(2);
    expect(map.get(furnitureId('d1'))).toBe(alice);
    expect(map.get(furnitureId('d2'))).toBe(bob);
  });
});

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

describe('fixtures', () => {
  it('returns empty map when no furniture', () => {
    const c = makeClassroom('c', 'x', 5, 5);
    expect(fixtures(c).size).toBe(0);
  });

  it('returns empty map when no fixture occupants', () => {
    const d = assignOccupant(makeDeskFurniture('d1'), alice);
    const c = addFurniture(makeClassroom('c', 'x', 5, 5), d);
    expect(fixtures(c).size).toBe(0);
  });

  it('includes fixture occupants', () => {
    const wb: Furniture = {
      id: furnitureId('wb'),
      kind: 'whiteboard',
      pos: { x: 0, y: 0 },
      w: 3,
      h: 1,
      rotation: 0,
      occupants: [wbFixture],
    };
    const c = addFurniture(makeClassroom('c', 'x', 10, 10), wb);
    const map = fixtures(c);
    expect(map.size).toBe(1);
    expect(map.get(furnitureId('wb'))).toBe(wbFixture);
  });

  it('excludes real students from fixtures view', () => {
    const d = assignOccupant(makeDeskFurniture('d1'), alice);
    const c = addFurniture(makeClassroom('c', 'x', 5, 5), d);
    expect(fixtures(c).size).toBe(0);
  });

  it('can return both real students (assignments) and fixtures simultaneously', () => {
    const d = assignOccupant(makeDeskFurniture('d1', 0, 0), alice);
    const wb: Furniture = {
      id: furnitureId('wb'),
      kind: 'whiteboard',
      pos: { x: 5, y: 0 },
      w: 3,
      h: 1,
      rotation: 0,
      occupants: [wbFixture],
    };
    let c = makeClassroom('c', 'x', 10, 5);
    c = addFurniture(c, d);
    c = addFurniture(c, wb);
    expect(assignments(c).size).toBe(1);
    expect(fixtures(c).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// furnitureById
// ---------------------------------------------------------------------------

describe('furnitureById', () => {
  it('returns the furniture with the matching id', () => {
    const d = makeDeskFurniture('d1');
    const c = addFurniture(makeClassroom('c', 'x', 5, 5), d);
    expect(furnitureById(c, furnitureId('d1'))).toBe(d);
  });

  it('returns undefined when id not found', () => {
    const c = makeClassroom('c', 'x', 5, 5);
    expect(furnitureById(c, furnitureId('nope'))).toBeUndefined();
  });

  it('returns the correct item from multiple pieces of furniture', () => {
    const d1 = makeDeskFurniture('d1');
    const d2 = makeDeskFurniture('d2');
    let c = makeClassroom('c', 'x', 5, 5);
    c = addFurniture(c, d1);
    c = addFurniture(c, d2);
    expect(furnitureById(c, furnitureId('d2'))).toBe(d2);
  });
});

// ---------------------------------------------------------------------------
// addFurniture (immutable)
// ---------------------------------------------------------------------------

describe('addFurniture', () => {
  it('returns a new classroom with the furniture added', () => {
    const c = makeClassroom('c', 'x', 5, 5);
    const d = makeDeskFurniture('d1');
    const c2 = addFurniture(c, d);
    expect(c2.furniture).toHaveLength(1);
    expect(c2.furniture[0]).toBe(d);
  });

  it('does not mutate the original classroom', () => {
    const c = makeClassroom('c', 'x', 5, 5);
    addFurniture(c, makeDeskFurniture('d1'));
    expect(c.furniture).toHaveLength(0);
  });

  it('adds multiple pieces of furniture', () => {
    let c = makeClassroom('c', 'x', 5, 5);
    c = addFurniture(c, makeDeskFurniture('d1'));
    c = addFurniture(c, makeDeskFurniture('d2'));
    expect(c.furniture).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// removeFurniture (immutable)
// ---------------------------------------------------------------------------

describe('removeFurniture', () => {
  it('removes the furniture with the given id', () => {
    let c = makeClassroom('c', 'x', 5, 5);
    c = addFurniture(c, makeDeskFurniture('d1'));
    c = addFurniture(c, makeDeskFurniture('d2'));
    const c2 = removeFurniture(c, furnitureId('d1'));
    expect(c2.furniture).toHaveLength(1);
    expect(c2.furniture[0]?.id).toBe('d2');
  });

  it('does not mutate the original classroom', () => {
    let c = makeClassroom('c', 'x', 5, 5);
    c = addFurniture(c, makeDeskFurniture('d1'));
    removeFurniture(c, furnitureId('d1'));
    expect(c.furniture).toHaveLength(1);
  });

  it('removing non-existent id is a no-op', () => {
    let c = makeClassroom('c', 'x', 5, 5);
    c = addFurniture(c, makeDeskFurniture('d1'));
    const c2 = removeFurniture(c, furnitureId('nope'));
    expect(c2.furniture).toHaveLength(1);
  });

  it('removing from empty classroom is a no-op', () => {
    const c = makeClassroom('c', 'x', 5, 5);
    const c2 = removeFurniture(c, furnitureId('d1'));
    expect(c2.furniture).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// updateFurniture (immutable)
// ---------------------------------------------------------------------------

describe('updateFurniture', () => {
  it('replaces the matching furniture', () => {
    let c = makeClassroom('c', 'x', 5, 5);
    const d = makeDeskFurniture('d1');
    c = addFurniture(c, d);
    const updated = assignOccupant(d, alice);
    const c2 = updateFurniture(c, furnitureId('d1'), updated);
    expect(c2.furniture[0]?.occupants[0]).toBe(alice);
  });

  it('does not affect other furniture', () => {
    let c = makeClassroom('c', 'x', 5, 5);
    const d1 = makeDeskFurniture('d1');
    const d2 = makeDeskFurniture('d2');
    c = addFurniture(c, d1);
    c = addFurniture(c, d2);
    const updated = assignOccupant(d1, alice);
    const c2 = updateFurniture(c, furnitureId('d1'), updated);
    expect(c2.furniture[1]?.occupants).toHaveLength(0);
  });

  it('does not mutate the original classroom', () => {
    let c = makeClassroom('c', 'x', 5, 5);
    const d = makeDeskFurniture('d1');
    c = addFurniture(c, d);
    const updated = assignOccupant(d, alice);
    updateFurniture(c, furnitureId('d1'), updated);
    expect(c.furniture[0]?.occupants).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// moveFurniture (immutable)
// ---------------------------------------------------------------------------

describe('moveFurniture', () => {
  it('moves furniture to the new position', () => {
    let c = makeClassroom('c', 'x', 10, 10);
    c = addFurniture(c, makeDeskFurniture('d1', 0, 0));
    const c2 = moveFurniture(c, furnitureId('d1'), { x: 5, y: 3 });
    expect(c2.furniture[0]?.pos).toEqual({ x: 5, y: 3 });
  });

  it('does not mutate the original classroom', () => {
    let c = makeClassroom('c', 'x', 10, 10);
    c = addFurniture(c, makeDeskFurniture('d1', 0, 0));
    moveFurniture(c, furnitureId('d1'), { x: 5, y: 3 });
    expect(c.furniture[0]?.pos).toEqual({ x: 0, y: 0 });
  });

  it('occupants travel with the moved furniture', () => {
    let c = makeClassroom('c', 'x', 10, 10);
    const d = assignOccupant(makeDeskFurniture('d1', 0, 0), alice);
    c = addFurniture(c, d);
    const c2 = moveFurniture(c, furnitureId('d1'), { x: 7, y: 2 });
    const moved = c2.furniture[0];
    expect(moved?.pos).toEqual({ x: 7, y: 2 });
    expect(moved?.occupants[0]).toBe(alice);
  });

  it('does not affect other furniture', () => {
    let c = makeClassroom('c', 'x', 10, 10);
    c = addFurniture(c, makeDeskFurniture('d1', 0, 0));
    c = addFurniture(c, makeDeskFurniture('d2', 3, 3));
    const c2 = moveFurniture(c, furnitureId('d1'), { x: 9, y: 9 });
    expect(c2.furniture[1]?.pos).toEqual({ x: 3, y: 3 });
  });
});

// ---------------------------------------------------------------------------
// vacate + assignments interaction
// ---------------------------------------------------------------------------

describe('assignments view updates after vacate', () => {
  it('vacated desk disappears from assignments', () => {
    const d = assignOccupant(makeDeskFurniture('d1'), alice);
    let c = addFurniture(makeClassroom('c', 'x', 5, 5), d);
    expect(assignments(c).size).toBe(1);
    const vacated = vacate(d);
    c = updateFurniture(c, furnitureId('d1'), vacated);
    expect(assignments(c).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fixtureId
// ---------------------------------------------------------------------------

describe('fixtureId', () => {
  it('returns a 12-character hex string', () => {
    const id = fixtureId('Whiteboard');
    expect(id).toHaveLength(12);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is deterministic — same name always yields the same id', () => {
    expect(fixtureId('Door')).toBe(fixtureId('Door'));
    expect(fixtureId('Whiteboard')).toBe(fixtureId('Whiteboard'));
  });

  it('different names yield different ids', () => {
    expect(fixtureId('Door')).not.toBe(fixtureId('Whiteboard'));
  });

  it('matches Node/Python sha256 output for "Whiteboard"', () => {
    // sha256("FIXTURE:Whiteboard").hexdigest()[:12] = "bc338ef8a470"
    expect(fixtureId('Whiteboard')).toBe('bc338ef8a470');
  });

  it('matches Node/Python sha256 output for "Door"', () => {
    // sha256("FIXTURE:Door").hexdigest()[:12] = "58e9829b03e4"
    expect(fixtureId('Door')).toBe('58e9829b03e4');
  });

  it('matches Node/Python sha256 output for "Teacher Desk"', () => {
    // sha256("FIXTURE:Teacher Desk").hexdigest()[:12] = "bc8c3ded56ce"
    expect(fixtureId('Teacher Desk')).toBe('bc8c3ded56ce');
  });

  it('handles empty string without throwing — known hash value', () => {
    // sha256("FIXTURE:").hexdigest()[:12] = "da30634dd042"
    expect(fixtureId('')).toBe('da30634dd042');
  });

  it('handles unicode input', () => {
    const id = fixtureId('黒板');
    expect(id).toHaveLength(12);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    // deterministic
    expect(fixtureId('黒板')).toBe(fixtureId('黒板'));
  });

  it('returns a StudentId — usable directly in makeFixture without casting', () => {
    // fixtureId() returns StudentId so that makeFixture(fixtureId(name), name) type-checks
    // cleanly. This test verifies the runtime plumbing works (makeFixture accepts the value)
    // and that the resulting fixture has the expected id.
    const id = fixtureId('Whiteboard');
    const fix = makeFixture(id, 'Whiteboard');
    expect(fix.id).toBe(id);
    expect(fix.isFixture).toBe(true);
  });

  it('fixture id can be used directly with assignOccupant on a teacher_desk', () => {
    // Validates the full round-trip: fixtureId -> makeFixture -> assignOccupant on cap-0 furniture.
    // All imports are static (at the top of this file) — no dynamic import needed.
    const id = fixtureId('Teacher');
    const fix = makeFixture(id, 'Teacher');
    const td: Furniture = {
      id: furnitureId('td-1'),
      kind: 'teacher_desk',
      pos: { x: 0, y: 0 },
      w: 2,
      h: 1,
      rotation: 0,
      occupants: [],
    };
    const td2 = assignOccupant(td, fix);
    expect(td2.occupants[0]?.id).toBe(id);
    expect(td2.occupants[0]?.isFixture).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deep immutability — moveTo / moveFurniture must NOT share occupants reference
// ---------------------------------------------------------------------------

describe('deep immutability — occupants array not shared after move', () => {
  it('moveFurniture: occupants array in result is a new reference', () => {
    const d = assignOccupant(makeDeskFurniture('d1', 0, 0), alice);
    const c = addFurniture(makeClassroom('c', 'x', 10, 10), d);
    const c2 = moveFurniture(c, furnitureId('d1'), { x: 5, y: 5 });
    // The result occupants array must be a different object than the original
    const origOcc = c.furniture[0]?.occupants;
    const movedOcc = c2.furniture[0]?.occupants;
    expect(movedOcc).not.toBe(origOcc);
  });

  it('moveFurniture: mutating result occupants does not affect original', () => {
    const d = assignOccupant(makeDeskFurniture('d1', 0, 0), alice);
    const c = addFurniture(makeClassroom('c', 'x', 10, 10), d);
    const c2 = moveFurniture(c, furnitureId('d1'), { x: 5, y: 5 });
    // Runtime push via cast — simulates Phase 3 code that might escape TS readonly
    (c2.furniture[0]?.occupants as unknown as Student[]).push(bob);
    // Original must be untouched
    expect(c.furniture[0]?.occupants).toHaveLength(1);
  });

  it('moveFurniture to the same cell is idempotent', () => {
    const d = assignOccupant(makeDeskFurniture('d1', 3, 3), alice);
    const c = addFurniture(makeClassroom('c', 'x', 10, 10), d);
    const c2 = moveFurniture(c, furnitureId('d1'), { x: 3, y: 3 });
    expect(c2.furniture[0]?.pos).toEqual({ x: 3, y: 3 });
    expect(c2.furniture[0]?.occupants[0]).toBe(alice);
  });
});

// ---------------------------------------------------------------------------
// Duplicate furniture ids — addFurniture does not deduplicate by design,
// but callers (Phase 7+ editors) must enforce uniqueness; document the behavior.
// ---------------------------------------------------------------------------

describe('duplicate furniture id behavior', () => {
  it('addFurniture allows duplicate ids (caller must enforce uniqueness)', () => {
    // The domain layer does not deduplicate — that is a store/editor responsibility.
    // This test documents (and pins) the current behavior so callers know what to expect.
    const c = addFurniture(
      addFurniture(makeClassroom('c', 'x', 5, 5), makeDeskFurniture('dup')),
      makeDeskFurniture('dup'),
    );
    expect(c.furniture).toHaveLength(2);
  });

  it('furnitureById returns the first match when ids are duplicated', () => {
    const d1 = { ...makeDeskFurniture('dup'), pos: { x: 0, y: 0 } };
    const d2 = { ...makeDeskFurniture('dup'), pos: { x: 1, y: 1 } };
    const c = addFurniture(addFurniture(makeClassroom('c', 'x', 5, 5), d1), d2);
    const found = furnitureById(c, furnitureId('dup'));
    expect(found?.pos).toEqual({ x: 0, y: 0 }); // first match
  });

  it('removeFurniture removes ALL furniture with that id (filter removes all matches)', () => {
    // filter() removes every match — if ids are duplicated, all copies are removed.
    const c = addFurniture(
      addFurniture(makeClassroom('c', 'x', 5, 5), makeDeskFurniture('dup')),
      makeDeskFurniture('dup'),
    );
    const c2 = removeFurniture(c, furnitureId('dup'));
    expect(c2.furniture).toHaveLength(0);
  });
});
