// @vitest-environment node
/**
 * §12.2 — "Show Violations" freshness tests.
 *
 * These tests prove that violation highlighting stays live as preferences
 * change, using the same predicate (`hasViolation`) and cache-busting logic
 * (`getSeatGraph` keyed on classroom reference + threshold) that
 * `StudentEditor.tsx` uses at paint time.
 *
 * The mechanism relies on §12.5's `syncRosterToClassroom`: every roster
 * mutation in the store calls `syncRosterToClassroom(classroom, newRoster)`,
 * which returns a NEW classroom reference when any occupant copy changed.
 * That new reference busts the SeatGraph cache, so the next `paintOverlay`
 * call sees fresh occupants and re-checks violations correctly.
 *
 * Test coverage (per §12.2 spec):
 *   (a) Adding an avoid-pref between two adjacent seated students makes BOTH
 *       show a violation (tests the forward case and the bidirectional check).
 *   (b) Removing the pref clears the violation for both students.
 *   (c) Changing the nearness threshold changes which pairs count as violations.
 *   (d) Mutual nature: the violation shows on BOTH students, not just the one
 *       who "owns" the preference that was most recently written.
 *
 * Additional tests for the cache invalidation contract:
 *   (e) `syncRosterToClassroom` produces a new reference after a pref edit
 *       (the cache must see a miss, not a hit).
 *   (f) The classroom reference is unchanged when no occupant copy changed
 *       (short-circuit path — no spurious cache busts).
 *   (g) A threshold change with the same classroom reference still busts the
 *       cache.
 *
 * No React / DOM / Zustand imports — pure domain layer only.
 */

import { describe, it, expect } from 'vitest';
import { furnitureId, studentId } from './types.js';
import { makeStudent } from './student.js';
import { setMutualPreference, clearMutualPreference } from './preference.js';
import { assignOccupant } from './furniture.js';
import {
  makeClassroom,
  syncRosterToClassroom,
  assignments as classroomAssignments,
} from './classroom.js';
import { SeatGraph, PROXIMITY_THRESHOLD } from './seatGraph.js';
import type { Student } from './student.js';
import type { Furniture } from './furniture.js';
import type { Classroom } from './classroom.js';
import type { FurnitureId, StudentId } from './types.js';

// ---------------------------------------------------------------------------
// Helpers — mirrors StudentEditor.tsx and seatGraph.test.ts
// ---------------------------------------------------------------------------

function sid(raw: string): StudentId { return studentId(raw); }
function fid(raw: string): FurnitureId { return furnitureId(raw); }

function mkStudent(id: string, name: string): Student {
  return makeStudent(sid(id), name);
}

function mkDesk(id: string, x: number, y: number): Furniture {
  return {
    id: fid(id),
    kind: 'single_desk',
    pos: { x, y },
    w: 1,
    h: 1,
    rotation: 0,
    occupants: [],
  };
}

function mkClassroom(...furniture: Furniture[]): Classroom {
  return { ...makeClassroom('test', 'Test Room', 20, 20), furniture };
}

/**
 * Exact port of `hasViolation` from `StudentEditor.tsx`.
 *
 * True when student S at desk `occupantFid` violates any avoid-preference
 * (bidirectionally), given the current arrangement and SeatGraph.
 *
 * a) S avoids someone who is currently a neighbor of occupantFid.
 * b) Someone who avoids S is seated at a neighbor of occupantFid.
 *
 * Positive-weight prefs are deliberately NOT flagged.
 */
function hasViolation(
  student: Student,
  occupantFid: FurnitureId,
  arrangement: Map<FurnitureId, Student>,
  graph: SeatGraph,
): boolean {
  const sidToFid = new Map<string, FurnitureId>();
  for (const [f, s] of arrangement) {
    if (!s.isFixture && f !== occupantFid) sidToFid.set(s.id, f);
  }

  // a) S's own avoid-preferences
  for (const pref of student.preferences) {
    if (pref.weight >= 0) continue;
    if (pref.kind === 'student') {
      const targetFid = sidToFid.get(pref.targetId);
      if (targetFid !== undefined && graph.areNeighbors(occupantFid, targetFid)) return true;
    }
  }

  // b) Bidirectional: other placed students who avoid S
  for (const [placedFid, placedStudent] of arrangement) {
    if (placedFid === occupantFid || placedStudent.isFixture) continue;
    for (const pref of placedStudent.preferences) {
      if (
        pref.weight < 0 &&
        pref.kind === 'student' &&
        pref.targetId === student.id &&
        graph.areNeighbors(occupantFid, placedFid)
      ) return true;
    }
  }

  return false;
}

/**
 * Mirror of the `getSeatGraph` cache helper in `StudentEditor.tsx`.
 * Returns the cached graph when classroom reference AND threshold match;
 * rebuilds otherwise. Used here to test the invalidation contract.
 */
function makeSeatGraphCache(): {
  get: (classroom: Classroom, threshold: number) => SeatGraph;
  clear: () => void;
  buildCount: () => number;
} {
  let cachedGraph: SeatGraph | null = null;
  let cachedClassroom: Classroom | null = null;
  let cachedThreshold: number = PROXIMITY_THRESHOLD;
  let builds = 0;

  return {
    get(classroom: Classroom, threshold: number): SeatGraph {
      if (cachedGraph !== null && cachedClassroom === classroom && cachedThreshold === threshold) {
        return cachedGraph;
      }
      const g = new SeatGraph(classroom, threshold);
      cachedGraph = g;
      cachedClassroom = classroom;
      cachedThreshold = threshold;
      builds++;
      return g;
    },
    clear() {
      cachedGraph = null;
      cachedClassroom = null;
    },
    buildCount() { return builds; },
  };
}

// ---------------------------------------------------------------------------
// (a) Adding an avoid-pref between two adjacent seated students makes BOTH
//     show a violation.
// ---------------------------------------------------------------------------

describe('§12.2 (a) — adding avoid-pref makes both adjacent students show a violation', () => {
  it('neither student has a violation before the pref is added', () => {
    const alice = mkStudent('a', 'Alice');
    const bob   = mkStudent('b', 'Bob');

    // Desks at (0,0) and (1,0) — distance = 1.0 < 1.5, so they are neighbors.
    const classroom = mkClassroom(
      assignOccupant(mkDesk('da', 0, 0), alice),
      assignOccupant(mkDesk('db', 1, 0), bob),
    );
    const graph = new SeatGraph(classroom);
    const arr = classroomAssignments(classroom);

    // Confirm they ARE neighbors
    expect(graph.areNeighbors(fid('da'), fid('db'))).toBe(true);

    const aliceOcc = classroom.furniture.find((f) => f.id === fid('da'))?.occupants[0];
    const bobOcc   = classroom.furniture.find((f) => f.id === fid('db'))?.occupants[0];
    expect(aliceOcc).toBeDefined();
    expect(bobOcc).toBeDefined();

    expect(hasViolation(aliceOcc!, fid('da'), arr, graph)).toBe(false);
    expect(hasViolation(bobOcc!,   fid('db'), arr, graph)).toBe(false);
  });

  it('adding avoid-pref and syncing classroom makes BOTH seats show a violation', () => {
    const alice = mkStudent('a', 'Alice');
    const bob   = mkStudent('b', 'Bob');

    let classroom = mkClassroom(
      assignOccupant(mkDesk('da', 0, 0), alice),
      assignOccupant(mkDesk('db', 1, 0), bob),
    );

    // Add mutual avoid pref (simulates store.setMutualPreference)
    const roster = setMutualPreference([alice, bob], alice.id, bob.id, -5);
    // Simulates the store calling syncRosterToClassroom after a pref mutation
    classroom = syncRosterToClassroom(classroom, roster);

    const graph = new SeatGraph(classroom);
    const arr = classroomAssignments(classroom);

    const aliceOcc = classroom.furniture.find((f) => f.id === fid('da'))?.occupants[0];
    const bobOcc   = classroom.furniture.find((f) => f.id === fid('db'))?.occupants[0];
    expect(aliceOcc).toBeDefined();
    expect(bobOcc).toBeDefined();

    // Both have the avoid pref after sync
    expect(aliceOcc!.preferences.find((p) => p.kind === 'student')?.weight).toBe(-5);
    expect(bobOcc!.preferences.find((p) => p.kind === 'student')?.weight).toBe(-5);

    // Both seats now show a violation
    expect(hasViolation(aliceOcc!, fid('da'), arr, graph)).toBe(true);
    expect(hasViolation(bobOcc!,   fid('db'), arr, graph)).toBe(true);
  });

  it('positive-weight (prefer) prefs are NOT violations', () => {
    const alice = mkStudent('a', 'Alice');
    const bob   = mkStudent('b', 'Bob');

    let classroom = mkClassroom(
      assignOccupant(mkDesk('da', 0, 0), alice),
      assignOccupant(mkDesk('db', 1, 0), bob),
    );

    // Positive weight — prefer near, not avoid
    const roster = setMutualPreference([alice, bob], alice.id, bob.id, 5);
    classroom = syncRosterToClassroom(classroom, roster);

    const graph = new SeatGraph(classroom);
    const arr = classroomAssignments(classroom);

    const aliceOcc = classroom.furniture.find((f) => f.id === fid('da'))?.occupants[0];
    const bobOcc   = classroom.furniture.find((f) => f.id === fid('db'))?.occupants[0];
    expect(aliceOcc).toBeDefined();
    expect(bobOcc).toBeDefined();

    // Prefer prefs must NOT flag as violations
    expect(hasViolation(aliceOcc!, fid('da'), arr, graph)).toBe(false);
    expect(hasViolation(bobOcc!,   fid('db'), arr, graph)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) Removing the pref clears the violation for both students.
// ---------------------------------------------------------------------------

describe('§12.2 (b) — removing avoid-pref clears violation for both students', () => {
  it('clearing the pref and syncing makes violations disappear', () => {
    const alice = mkStudent('a', 'Alice');
    const bob   = mkStudent('b', 'Bob');

    // Start with an avoid pref already set
    let roster = setMutualPreference([alice, bob], alice.id, bob.id, -5);
    let classroom = mkClassroom(
      assignOccupant(mkDesk('da', 0, 0), roster.find((s) => s.id === sid('a'))!),
      assignOccupant(mkDesk('db', 1, 0), roster.find((s) => s.id === sid('b'))!),
    );
    classroom = syncRosterToClassroom(classroom, roster);

    // Confirm violation exists before removing pref
    {
      const graph = new SeatGraph(classroom);
      const arr = classroomAssignments(classroom);
      const aliceOcc = classroom.furniture.find((f) => f.id === fid('da'))?.occupants[0];
      const bobOcc   = classroom.furniture.find((f) => f.id === fid('db'))?.occupants[0];
      expect(aliceOcc).toBeDefined();
      expect(bobOcc).toBeDefined();
      expect(hasViolation(aliceOcc!, fid('da'), arr, graph)).toBe(true);
      expect(hasViolation(bobOcc!,   fid('db'), arr, graph)).toBe(true);
    }

    // Remove the mutual pref (simulates store.clearMutualPreference)
    roster = clearMutualPreference(roster, alice.id, bob.id);
    classroom = syncRosterToClassroom(classroom, roster);

    // Violation must be gone for both
    const graph = new SeatGraph(classroom);
    const arr = classroomAssignments(classroom);
    const aliceOcc = classroom.furniture.find((f) => f.id === fid('da'))?.occupants[0];
    const bobOcc   = classroom.furniture.find((f) => f.id === fid('db'))?.occupants[0];
    expect(aliceOcc).toBeDefined();
    expect(bobOcc).toBeDefined();
    expect(hasViolation(aliceOcc!, fid('da'), arr, graph)).toBe(false);
    expect(hasViolation(bobOcc!,   fid('db'), arr, graph)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (c) Changing nearness threshold changes which pairs are violations.
// ---------------------------------------------------------------------------

describe('§12.2 (c) — nearness threshold change affects violation detection', () => {
  /**
   * Layout: desk A at (0,0), desk B at (2,0).
   * Center distance = 2.0 (center of A = 0.5,0.5; center of B = 2.5,0.5).
   * At default threshold (1.5): NOT neighbors → no violation even with avoid pref.
   * At wide threshold (3.0):   neighbors → violation appears.
   */
  it('desks two cells apart are not violations at default threshold', () => {
    const alice = mkStudent('a', 'Alice');
    const bob   = mkStudent('b', 'Bob');

    const roster = setMutualPreference([alice, bob], alice.id, bob.id, -5);
    const classroom = syncRosterToClassroom(
      mkClassroom(
        assignOccupant(mkDesk('da', 0, 0), alice),
        assignOccupant(mkDesk('db', 2, 0), bob), // two cells apart
      ),
      roster,
    );

    // Default threshold: 1.5 — distance 2.0 > 1.5, so NOT neighbors
    const graph = new SeatGraph(classroom, PROXIMITY_THRESHOLD);
    expect(graph.areNeighbors(fid('da'), fid('db'))).toBe(false);

    const arr = classroomAssignments(classroom);
    const aliceOcc = classroom.furniture.find((f) => f.id === fid('da'))?.occupants[0];
    expect(aliceOcc).toBeDefined();

    // No violation — they are not neighbors at this threshold
    expect(hasViolation(aliceOcc!, fid('da'), arr, graph)).toBe(false);
  });

  it('widening threshold to 3.0 makes the same pair a violation', () => {
    const alice = mkStudent('a', 'Alice');
    const bob   = mkStudent('b', 'Bob');

    const roster = setMutualPreference([alice, bob], alice.id, bob.id, -5);
    const classroom = syncRosterToClassroom(
      mkClassroom(
        assignOccupant(mkDesk('da', 0, 0), alice),
        assignOccupant(mkDesk('db', 2, 0), bob), // two cells apart
      ),
      roster,
    );

    // Wider threshold: 3.0 — distance 2.0 < 3.0, so NOW neighbors
    const graph = new SeatGraph(classroom, 3.0);
    expect(graph.areNeighbors(fid('da'), fid('db'))).toBe(true);

    const arr = classroomAssignments(classroom);
    const aliceOcc = classroom.furniture.find((f) => f.id === fid('da'))?.occupants[0];
    expect(aliceOcc).toBeDefined();

    // Violation — widened threshold makes them neighbors
    expect(hasViolation(aliceOcc!, fid('da'), arr, graph)).toBe(true);
  });

  it('narrowing threshold below 1.0 removes neighbor-violations for adjacent desks', () => {
    const alice = mkStudent('a', 'Alice');
    const bob   = mkStudent('b', 'Bob');

    const roster = setMutualPreference([alice, bob], alice.id, bob.id, -5);
    const classroom = syncRosterToClassroom(
      mkClassroom(
        assignOccupant(mkDesk('da', 0, 0), alice),
        assignOccupant(mkDesk('db', 1, 0), bob), // one cell apart → distance 1.0
      ),
      roster,
    );

    // Narrow threshold: 0.9 — distance 1.0 > 0.9, so NOT neighbors
    const graph = new SeatGraph(classroom, 0.9);
    expect(graph.areNeighbors(fid('da'), fid('db'))).toBe(false);

    const arr = classroomAssignments(classroom);
    const aliceOcc = classroom.furniture.find((f) => f.id === fid('da'))?.occupants[0];
    expect(aliceOcc).toBeDefined();

    // No violation — narrowed threshold means they are no longer neighbors
    expect(hasViolation(aliceOcc!, fid('da'), arr, graph)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (d) Mutual nature: violation shows on BOTH students, not just the initiator.
// ---------------------------------------------------------------------------

describe('§12.2 (d) — mutual nature: violation appears on both sides', () => {
  it('BOTH students show a violation (bidirectional check)', () => {
    const alice = mkStudent('a', 'Alice');
    const bob   = mkStudent('b', 'Bob');

    const roster = setMutualPreference([alice, bob], alice.id, bob.id, -5);
    const classroom = syncRosterToClassroom(
      mkClassroom(
        assignOccupant(mkDesk('da', 0, 0), alice),
        assignOccupant(mkDesk('db', 1, 0), bob),
      ),
      roster,
    );

    const graph = new SeatGraph(classroom);
    const arr = classroomAssignments(classroom);

    const aliceOcc = classroom.furniture.find((f) => f.id === fid('da'))?.occupants[0];
    const bobOcc   = classroom.furniture.find((f) => f.id === fid('db'))?.occupants[0];
    expect(aliceOcc).toBeDefined();
    expect(bobOcc).toBeDefined();

    // Both sides have the pref (mutual invariant)
    expect(aliceOcc!.preferences.find((p) => p.kind === 'student' && p.targetId === sid('b'))?.weight).toBe(-5);
    expect(bobOcc!.preferences.find((p) => p.kind === 'student' && p.targetId === sid('a'))?.weight).toBe(-5);

    // Violation shows on BOTH students
    expect(hasViolation(aliceOcc!, fid('da'), arr, graph)).toBe(true); // Alice should show a violation
    expect(hasViolation(bobOcc!,   fid('db'), arr, graph)).toBe(true); // Bob should show a violation
  });

  it('bidirectional check: even if only one side has the pref, both seats flag (part b of hasViolation)', () => {
    /**
     * This tests the bidirectional (part b) of hasViolation:
     * If Alice has an avoid-pref toward Bob, Bob's seat also flags a violation
     * because "someone who avoids Bob is seated at a neighbor" (Alice).
     * In practice mutual prefs are always symmetric, but the predicate is
     * designed to flag both seats even via the one-sided check.
     */
    const alice = mkStudent('a', 'Alice');
    // Bob without any prefs — Alice has the avoid pref only
    const bobWithoutPref = mkStudent('b', 'Bob');
    const aliceWithPref: Student = {
      ...alice,
      preferences: [{ kind: 'student', targetId: sid('b'), weight: -5 }],
    };

    const classroom = mkClassroom(
      assignOccupant(mkDesk('da', 0, 0), aliceWithPref),
      assignOccupant(mkDesk('db', 1, 0), bobWithoutPref),
    );

    const graph = new SeatGraph(classroom);
    const arr = classroomAssignments(classroom);

    const aliceOcc = classroom.furniture.find((f) => f.id === fid('da'))?.occupants[0];
    const bobOcc   = classroom.furniture.find((f) => f.id === fid('db'))?.occupants[0];
    expect(aliceOcc).toBeDefined();
    expect(bobOcc).toBeDefined();

    // Alice flags via her own pref (part a)
    expect(hasViolation(aliceOcc!, fid('da'), arr, graph)).toBe(true);
    // Bob flags via the bidirectional check (part b) — Alice avoids Bob
    expect(hasViolation(bobOcc!,   fid('db'), arr, graph)).toBe(true);
  });

  it('third student unrelated to the pref shows no violation', () => {
    const alice = mkStudent('a', 'Alice');
    const bob   = mkStudent('b', 'Bob');
    const carol = mkStudent('c', 'Carol');

    const roster = setMutualPreference([alice, bob, carol], alice.id, bob.id, -5);
    const classroom = syncRosterToClassroom(
      mkClassroom(
        assignOccupant(mkDesk('da', 0, 0), alice),
        assignOccupant(mkDesk('db', 1, 0), bob),
        // Carol is far away — no pref with anyone
        assignOccupant(mkDesk('dc', 10, 0), carol),
      ),
      roster,
    );

    const graph = new SeatGraph(classroom);
    const arr = classroomAssignments(classroom);

    const carolOcc = classroom.furniture.find((f) => f.id === fid('dc'))?.occupants[0];
    expect(carolOcc).toBeDefined();

    // Carol has no violations
    expect(hasViolation(carolOcc!, fid('dc'), arr, graph)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (e) Cache invalidation: syncRosterToClassroom produces a new reference
//     after a pref edit, causing the SeatGraph cache to miss.
// ---------------------------------------------------------------------------

describe('§12.2 (e) — cache invalidation via classroom reference change', () => {
  it('syncRosterToClassroom returns a new reference after a pref edit', () => {
    const alice = mkStudent('a', 'Alice');
    const bob   = mkStudent('b', 'Bob');

    const classroomBefore = mkClassroom(
      assignOccupant(mkDesk('da', 0, 0), alice),
      assignOccupant(mkDesk('db', 1, 0), bob),
    );

    // Add pref → roster changes → occupants should change → new classroom reference
    const roster = setMutualPreference([alice, bob], alice.id, bob.id, -5);
    const classroomAfter = syncRosterToClassroom(classroomBefore, roster);

    expect(classroomAfter).not.toBe(classroomBefore);
  });

  it('SeatGraph cache misses after a pref edit (new classroom reference)', () => {
    const alice = mkStudent('a', 'Alice');
    const bob   = mkStudent('b', 'Bob');

    const cache = makeSeatGraphCache();

    // First build
    const classroom1 = mkClassroom(
      assignOccupant(mkDesk('da', 0, 0), alice),
      assignOccupant(mkDesk('db', 1, 0), bob),
    );
    cache.get(classroom1, PROXIMITY_THRESHOLD);
    expect(cache.buildCount()).toBe(1);

    // Same reference → cache hit
    cache.get(classroom1, PROXIMITY_THRESHOLD);
    expect(cache.buildCount()).toBe(1);

    // Pref edit → new classroom reference → cache miss
    const roster = setMutualPreference([alice, bob], alice.id, bob.id, -5);
    const classroom2 = syncRosterToClassroom(classroom1, roster);
    expect(classroom2).not.toBe(classroom1); // confirming reference changed
    cache.get(classroom2, PROXIMITY_THRESHOLD);
    expect(cache.buildCount()).toBe(2); // rebuilt
  });

  it('SeatGraph cache hits when no occupant changed (same classroom reference)', () => {
    const alice = mkStudent('a', 'Alice');

    const cache = makeSeatGraphCache();

    // No seated students with prefs — sync short-circuits
    const classroom = mkClassroom(mkDesk('da', 0, 0)); // empty desk
    const rosterNoChange = [alice]; // alice not seated
    const classroomSynced = syncRosterToClassroom(classroom, rosterNoChange);

    // Short-circuit: same reference (no occupant to update)
    expect(classroomSynced).toBe(classroom);

    cache.get(classroom, PROXIMITY_THRESHOLD);
    expect(cache.buildCount()).toBe(1);
    cache.get(classroomSynced, PROXIMITY_THRESHOLD);
    expect(cache.buildCount()).toBe(1); // still a hit — same reference
  });
});

// ---------------------------------------------------------------------------
// (f) Threshold change busts the cache independently of classroom reference.
// ---------------------------------------------------------------------------

describe('§12.2 (f) — threshold change busts the SeatGraph cache', () => {
  it('same classroom, different threshold → cache miss', () => {
    const alice = mkStudent('a', 'Alice');
    const bob   = mkStudent('b', 'Bob');

    const cache = makeSeatGraphCache();

    const classroom = mkClassroom(
      assignOccupant(mkDesk('da', 0, 0), alice),
      assignOccupant(mkDesk('db', 2, 0), bob),
    );

    cache.get(classroom, PROXIMITY_THRESHOLD);
    expect(cache.buildCount()).toBe(1);

    // Same classroom, different threshold — must rebuild
    cache.get(classroom, 3.0);
    expect(cache.buildCount()).toBe(2);
  });

  it('same classroom, same threshold → cache hit (no rebuild)', () => {
    const alice = mkStudent('a', 'Alice');

    const cache = makeSeatGraphCache();
    const classroom = mkClassroom(assignOccupant(mkDesk('da', 0, 0), alice));

    cache.get(classroom, PROXIMITY_THRESHOLD);
    cache.get(classroom, PROXIMITY_THRESHOLD);
    expect(cache.buildCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (g) End-to-end freshness: add pref, edit pref weight, remove pref —
//     violation status tracks correctly at each step.
// ---------------------------------------------------------------------------

describe('§12.2 (g) — end-to-end violation freshness through add/edit/remove', () => {
  it('add avoid → violation; change weight → still violation; remove → no violation', () => {
    const alice = mkStudent('a', 'Alice');
    const bob   = mkStudent('b', 'Bob');

    let classroom = mkClassroom(
      assignOccupant(mkDesk('da', 0, 0), alice),
      assignOccupant(mkDesk('db', 1, 0), bob),
    );

    function checkBoth(c: Classroom, threshold: number): { alice: boolean; bob: boolean } {
      const graph = new SeatGraph(c, threshold);
      const arr = classroomAssignments(c);
      const aliceOcc = c.furniture.find((f) => f.id === fid('da'))?.occupants[0];
      const bobOcc   = c.furniture.find((f) => f.id === fid('db'))?.occupants[0];
      return {
        alice: aliceOcc !== undefined ? hasViolation(aliceOcc, fid('da'), arr, graph) : false,
        bob:   bobOcc !== undefined   ? hasViolation(bobOcc, fid('db'), arr, graph)   : false,
      };
    }

    // Step 1: no prefs → no violations
    const step1 = checkBoth(classroom, PROXIMITY_THRESHOLD);
    expect(step1.alice).toBe(false);
    expect(step1.bob).toBe(false);

    // Step 2: add avoid pref → violations
    let roster = setMutualPreference([alice, bob], sid('a'), sid('b'), -3);
    classroom = syncRosterToClassroom(classroom, roster);
    const step2 = checkBoth(classroom, PROXIMITY_THRESHOLD);
    expect(step2.alice).toBe(true);
    expect(step2.bob).toBe(true);

    // Step 3: change weight (still negative → still violations)
    roster = setMutualPreference(roster, sid('a'), sid('b'), -10);
    classroom = syncRosterToClassroom(classroom, roster);
    const step3 = checkBoth(classroom, PROXIMITY_THRESHOLD);
    expect(step3.alice).toBe(true);
    expect(step3.bob).toBe(true);

    // Step 4: remove pref → no violations
    roster = clearMutualPreference(roster, sid('a'), sid('b'));
    classroom = syncRosterToClassroom(classroom, roster);
    const step4 = checkBoth(classroom, PROXIMITY_THRESHOLD);
    expect(step4.alice).toBe(false);
    expect(step4.bob).toBe(false);
  });
});
