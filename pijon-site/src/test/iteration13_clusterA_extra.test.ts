// @vitest-environment jsdom
/**
 * Iteration 13 Cluster A — Extra checker tests.
 *
 * Covers gaps and integration paths not fully exercised by the primary test suite:
 *   E1  End-to-end through store.hydrate: migration reaches store.roster + store.locks
 *   E2  makeFurniture (FurnitureEditor) actually creates fixture occupants
 *   E3  Round-trip stability: save→parse→compose is idempotent (no duplication)
 *   E4  Two whiteboards: deleting one does not remove the others fixture or prefs
 *   E5  Assigner weight is passed through (both positive + negative weights)
 *   E6  eraseAll wipes roster + locks (including fixtures)
 *   E7  clearArrangement keeps fixture locks intact
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { usePijonStore } from '../state/store.js';
import { furnitureId, studentId } from '../domain/types.js';
import type { FurnitureId } from '../domain/types.js';
import type { Furniture } from '../domain/furniture.js';
import { occupant as furnitureOccupant } from '../domain/furniture.js';
import { makeStudent, makeFixture } from '../domain/student.js';
import { makeClassroom, fixtureId } from '../domain/classroom.js';
import {
  parseProject,
  serializeProject,
  extractProject,
  composeClassroom,
} from '../domain/io/projectFile.js';
import { makeFurnitureForPalette } from '../ui/editors/FurnitureEditor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  usePijonStore.getState().eraseAll();
}

function mkWhiteboardWithFixture(id: string, x = 0, y = 0): Furniture {
  const fid = furnitureId(id);
  const fixName = 'Whiteboard';
  const fix = makeFixture(fixtureId(`${fixName}:${fid}`), fixName);
  const base: Furniture = { id: fid, kind: 'whiteboard', pos: { x, y }, w: 4, h: 1, rotation: 0, occupants: [] };
  return { ...base, occupants: [fix] };
}

// ---------------------------------------------------------------------------
// E1 — End-to-end through store.hydrate
// ---------------------------------------------------------------------------

describe('E1 migration end-to-end: old file -> composeClassroom -> store.hydrate', () => {
  beforeEach(() => { resetStore(); });

  it('hydrate from old teacher_desk file puts fixture in store.roster', () => {
    const oldJson = JSON.stringify({
      version: 2,
      classroom: {
        id: 'c-e2e',
        name: 'E2E Room',
        gridW: 10,
        gridH: 8,
        furniture: [
          { id: 'td-e2e', kind: 'teacher_desk', pos: { x: 0, y: 0 }, w: 2, h: 2, rotation: 0 },
        ],
        cellsPerUnit: 1,
        thresholdUnits: 1.5,
        backgroundImage: null,
        gridColor: null,
        customPalette: [],
      },
      roster: [],
      arrangement: {},
      locks: [],
    });

    const pf = parseProject(oldJson);
    const loaded = composeClassroom(pf);
    usePijonStore.getState().hydrate(loaded);

    const state = usePijonStore.getState();

    // (a) Fixture is furniture occupant
    const td = state.classroom.furniture.find((f) => f.id === furnitureId('td-e2e'))!;
    const occ = furnitureOccupant(td);
    expect(occ).toBeDefined();
    expect(occ!.isFixture).toBe(true);
    expect(occ!.name).toBe("Teacher's Desk");

    // (b) Fixture is in store.roster
    const inRoster = state.roster.find((s) => s.id === occ!.id);
    expect(inRoster).toBeDefined();
    expect(inRoster!.isFixture).toBe(true);

    // (c) Furniture id is in store.locks
    expect(state.locks.has(furnitureId('td-e2e'))).toBe(true);
  });

  it('hydrate from old whiteboard file puts fixture in store.roster and store.locks', () => {
    const oldJson = JSON.stringify({
      version: 2,
      classroom: {
        id: 'c-e2e2',
        name: 'E2E Room 2',
        gridW: 10,
        gridH: 8,
        furniture: [
          { id: 'wb-e2e', kind: 'whiteboard', pos: { x: 0, y: 0 }, w: 4, h: 1, rotation: 0 },
        ],
        cellsPerUnit: 1,
        thresholdUnits: 1.5,
        backgroundImage: null,
        gridColor: null,
        customPalette: [],
      },
      roster: [],
      arrangement: {},
      locks: [],
    });

    const pf = parseProject(oldJson);
    usePijonStore.getState().hydrate(composeClassroom(pf));

    const state = usePijonStore.getState();

    const wb = state.classroom.furniture.find((f) => f.id === furnitureId('wb-e2e'))!;
    const occ = furnitureOccupant(wb);
    expect(occ).toBeDefined();
    expect(occ!.isFixture).toBe(true);

    expect(state.roster.find((s) => s.id === occ!.id)).toBeDefined();
    expect(state.locks.has(furnitureId('wb-e2e'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E2 — makeFurnitureForPalette (FurnitureEditor) creates fixture occupants
// This directly exercises the real factory function so mutation of the
// fixture-creation branch in makeFurniture is caught.
// ---------------------------------------------------------------------------

describe('E2 makeFurnitureForPalette creates fixture occupants for teacher_desk/whiteboard', () => {
  it('teacher_desk from palette factory has a fixture occupant', () => {
    const td = makeFurnitureForPalette('teacher_desk', { x: 0, y: 0 }, 1);
    const occ = furnitureOccupant(td);
    expect(occ).toBeDefined();
    expect(occ!.isFixture).toBe(true);
    expect(occ!.name).toBe("Teacher's Desk");
    // id formula: fixtureId("Teacher's Desk:<fid>")
    const expectedFxId = fixtureId(`Teacher's Desk:${td.id}`);
    expect(occ!.id).toBe(expectedFxId);
  });

  it('whiteboard from palette factory has a fixture occupant', () => {
    const wb = makeFurnitureForPalette('whiteboard', { x: 0, y: 0 }, 1);
    const occ = furnitureOccupant(wb);
    expect(occ).toBeDefined();
    expect(occ!.isFixture).toBe(true);
    expect(occ!.name).toBe('Whiteboard');
    const expectedFxId = fixtureId(`Whiteboard:${wb.id}`);
    expect(occ!.id).toBe(expectedFxId);
  });

  it('single_desk from palette factory has no fixture occupant', () => {
    const d = makeFurnitureForPalette('single_desk', { x: 0, y: 0 }, 1);
    expect(furnitureOccupant(d)).toBeUndefined();
  });

  it('table from palette factory has no fixture occupant', () => {
    const t = makeFurnitureForPalette('table', { x: 0, y: 0 }, 1);
    expect(furnitureOccupant(t)).toBeUndefined();
  });

  it('two teacher_desks from factory get distinct fixture ids', () => {
    const td1 = makeFurnitureForPalette('teacher_desk', { x: 0, y: 0 }, 1);
    const td2 = makeFurnitureForPalette('teacher_desk', { x: 2, y: 0 }, 1);
    const fix1 = furnitureOccupant(td1)!;
    const fix2 = furnitureOccupant(td2)!;
    expect(fix1.id).not.toBe(fix2.id);
  });

  it('palette factory + store.addFurniture puts fixture in roster and locks', () => {
    usePijonStore.getState().eraseAll();
    const wb = makeFurnitureForPalette('whiteboard', { x: 0, y: 0 }, 1);
    const wbFix = furnitureOccupant(wb)!;
    usePijonStore.getState().addFurniture(wb);

    const state = usePijonStore.getState();
    expect(state.roster.find((s) => s.id === wbFix.id)).toBeDefined();
    expect(state.locks.has(wb.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E3 — Round-trip stability (idempotency)
// ---------------------------------------------------------------------------

describe('E3 round-trip stability: save->parse->compose is idempotent', () => {
  it('second serialize->parse->compose of an already-migrated room does not duplicate fixtures', () => {
    const wbFid = furnitureId('wb-rt-stable');
    const fixName = 'Whiteboard';
    const fxId = fixtureId(`${fixName}:${wbFid}`);
    const fix = makeFixture(fxId, fixName);
    const wb: Furniture = {
      id: wbFid,
      kind: 'whiteboard',
      pos: { x: 0, y: 0 },
      w: 4,
      h: 1,
      rotation: 0,
      occupants: [fix],
    };

    const classroom = { ...makeClassroom('rt-stable', 'RT', 10, 8), furniture: [wb] };
    const roster = [fix];
    const locks: FurnitureId[] = [wbFid];

    // First round-trip
    const json1 = serializeProject(extractProject({ classroom, roster, locks }));
    const { classroom: c1, roster: r1, locks: l1 } = composeClassroom(parseProject(json1));

    // Second round-trip (using results of first)
    const json2 = serializeProject(extractProject({ classroom: c1, roster: r1, locks: l1 }));
    const { classroom: c2, roster: r2, locks: l2 } = composeClassroom(parseProject(json2));

    // Roster must have exactly one fixture
    const fixtures2 = r2.filter((s) => s.isFixture);
    expect(fixtures2).toHaveLength(1);
    expect(fixtures2[0]!.id).toBe(fxId);

    // Furniture must have exactly one fixture occupant
    const wb2 = c2.furniture.find((f) => f.id === wbFid)!;
    expect(furnitureOccupant(wb2)!.id).toBe(fxId);

    // Lock must still be present
    expect(l2).toContain(wbFid);
  });

  it('fixture id is deterministic: same fid always produces same fixture id', () => {
    const fid = furnitureId('wb-deterministic');
    const id1 = fixtureId(`Whiteboard:${fid}`);
    const id2 = fixtureId(`Whiteboard:${fid}`);
    expect(id1).toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// E4 — Two whiteboards: deleting one does not remove the other fixture or prefs
// ---------------------------------------------------------------------------

describe('E4 two whiteboards: deleting one leaves the other intact', () => {
  beforeEach(() => { resetStore(); });

  it('deleting whiteboard A does not remove whiteboard B fixture from roster', () => {
    const wb1 = mkWhiteboardWithFixture('wb-two-a', 0, 0);
    const wb2 = mkWhiteboardWithFixture('wb-two-b', 5, 0);
    const fix1 = furnitureOccupant(wb1)!;
    const fix2 = furnitureOccupant(wb2)!;

    usePijonStore.getState().addFurniture(wb1);
    usePijonStore.getState().addFurniture(wb2);

    // Confirm both in roster
    expect(usePijonStore.getState().roster.find((s) => s.id === fix1.id)).toBeDefined();
    expect(usePijonStore.getState().roster.find((s) => s.id === fix2.id)).toBeDefined();

    // Delete whiteboard A
    usePijonStore.getState().removeFurniture(furnitureId('wb-two-a'));

    // B fixture still in roster
    expect(usePijonStore.getState().roster.find((s) => s.id === fix1.id)).toBeUndefined();
    expect(usePijonStore.getState().roster.find((s) => s.id === fix2.id)).toBeDefined();
  });

  it('deleting whiteboard A prunes only prefs that point to A fixture (B prefs survive)', () => {
    const wb1 = mkWhiteboardWithFixture('wb-prune-a', 0, 0);
    const wb2 = mkWhiteboardWithFixture('wb-prune-b', 5, 0);
    const fix1 = furnitureOccupant(wb1)!;
    const fix2 = furnitureOccupant(wb2)!;
    const alice = makeStudent(studentId('alice-two-wb'), 'Alice');

    usePijonStore.setState({
      classroom: { ...makeClassroom('c-two', 'Room', 12, 8), furniture: [wb1, wb2] },
      roster: [alice, fix1, fix2],
      locks: new Set<FurnitureId>(),
    });

    // Alice prefers both whiteboards
    usePijonStore.getState().setMutualPreference(alice.id, fix1.id, 1);
    usePijonStore.getState().setMutualPreference(alice.id, fix2.id, 1);

    // Delete whiteboard A
    usePijonStore.getState().removeFurniture(furnitureId('wb-prune-a'));

    const aliceAfter = usePijonStore.getState().roster.find((s) => s.id === alice.id)!;
    // Pref to A fixture must be gone
    expect(aliceAfter.preferences.some((p) => p.kind === 'student' && p.targetId === fix1.id)).toBe(false);
    // Pref to B fixture must survive
    expect(aliceAfter.preferences.some((p) => p.kind === 'student' && p.targetId === fix2.id)).toBe(true);
  });

  it('deleting whiteboard A does not remove whiteboard B lock', () => {
    const wb1 = mkWhiteboardWithFixture('wb-lock-a', 0, 0);
    const wb2 = mkWhiteboardWithFixture('wb-lock-b', 5, 0);

    usePijonStore.getState().addFurniture(wb1);
    usePijonStore.getState().addFurniture(wb2);

    expect(usePijonStore.getState().locks.has(furnitureId('wb-lock-a'))).toBe(true);
    expect(usePijonStore.getState().locks.has(furnitureId('wb-lock-b'))).toBe(true);

    usePijonStore.getState().removeFurniture(furnitureId('wb-lock-a'));

    expect(usePijonStore.getState().locks.has(furnitureId('wb-lock-a'))).toBe(false);
    expect(usePijonStore.getState().locks.has(furnitureId('wb-lock-b'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E5 — Assigner weight is passed through (both positive and negative)
// ---------------------------------------------------------------------------

describe('E5 assigner both orders and weights reach setMutualPreference', () => {
  beforeEach(() => { resetStore(); });

  it('real->fixture pref with positive weight is recorded in store', () => {
    const alice = makeStudent(studentId('alice-e5a'), 'Alice');
    const wb = mkWhiteboardWithFixture('wb-e5a');
    const wbFix = furnitureOccupant(wb)!;

    usePijonStore.setState({
      classroom: { ...makeClassroom('c-e5', 'Room', 10, 8), furniture: [wb] },
      roster: [alice, wbFix],
      locks: new Set<FurnitureId>(),
    });

    usePijonStore.getState().setMutualPreference(alice.id, wbFix.id, 2);

    const aliceUp = usePijonStore.getState().roster.find((s) => s.id === alice.id)!;
    const pref = aliceUp.preferences.find((p) => p.kind === 'student' && p.targetId === wbFix.id);
    expect(pref).toBeDefined();
    expect(pref!.weight).toBe(2);
  });

  it('fixture->real pref (reverse order) is also recorded on the real student', () => {
    const alice = makeStudent(studentId('alice-e5b'), 'Alice');
    const wb = mkWhiteboardWithFixture('wb-e5b');
    const wbFix = furnitureOccupant(wb)!;

    usePijonStore.setState({
      classroom: { ...makeClassroom('c-e5b', 'Room', 10, 8), furniture: [wb] },
      roster: [alice, wbFix],
      locks: new Set<FurnitureId>(),
    });

    // Call with fixture first (reverse order)
    usePijonStore.getState().setMutualPreference(wbFix.id, alice.id, -1);

    // Pref appears on alice (real student side)
    const aliceUp = usePijonStore.getState().roster.find((s) => s.id === alice.id)!;
    const pref = aliceUp.preferences.find((p) => p.kind === 'student' && p.targetId === wbFix.id);
    expect(pref).toBeDefined();
    expect(pref!.weight).toBe(-1);
  });

  it('removing the real->fixture pref via clearMutualPreference removes it from alice', () => {
    const alice = makeStudent(studentId('alice-e5c'), 'Alice');
    const wb = mkWhiteboardWithFixture('wb-e5c');
    const wbFix = furnitureOccupant(wb)!;

    usePijonStore.setState({
      classroom: { ...makeClassroom('c-e5c', 'Room', 10, 8), furniture: [wb] },
      roster: [alice, wbFix],
      locks: new Set<FurnitureId>(),
    });

    usePijonStore.getState().setMutualPreference(alice.id, wbFix.id, 1);
    usePijonStore.getState().clearMutualPreference(alice.id, wbFix.id);

    const aliceUp = usePijonStore.getState().roster.find((s) => s.id === alice.id)!;
    expect(aliceUp.preferences.some((p) => p.kind === 'student' && p.targetId === wbFix.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E6 — eraseAll wipes roster + locks (including fixtures)
// ---------------------------------------------------------------------------

describe('E6 eraseAll wipes everything including fixture roster + locks', () => {
  beforeEach(() => { resetStore(); });

  it('eraseAll removes fixtures from roster and clears locks', () => {
    const wb = mkWhiteboardWithFixture('wb-erase');
    usePijonStore.getState().addFurniture(wb);

    // Confirm present
    expect(usePijonStore.getState().roster.filter((s) => s.isFixture)).toHaveLength(1);
    expect(usePijonStore.getState().locks.has(furnitureId('wb-erase'))).toBe(true);

    usePijonStore.getState().eraseAll();

    // Both gone
    expect(usePijonStore.getState().roster.filter((s) => s.isFixture)).toHaveLength(0);
    expect(usePijonStore.getState().locks.size).toBe(0);
    expect(usePijonStore.getState().classroom.furniture).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// E7 — clearArrangement keeps fixture locks intact
// ---------------------------------------------------------------------------

describe('E7 clearArrangement preserves fixture locks', () => {
  beforeEach(() => { resetStore(); });

  it('clearArrangement does not remove fixture locks', () => {
    const wb = mkWhiteboardWithFixture('wb-clear-lock');
    usePijonStore.getState().addFurniture(wb);

    expect(usePijonStore.getState().locks.has(furnitureId('wb-clear-lock'))).toBe(true);

    usePijonStore.getState().clearArrangement();

    // Lock must survive clearArrangement
    expect(usePijonStore.getState().locks.has(furnitureId('wb-clear-lock'))).toBe(true);
  });

  it('clearArrangement preserves fixture occupant on whiteboard', () => {
    const wb = mkWhiteboardWithFixture('wb-clear-fix');
    const wbFix = furnitureOccupant(wb)!;

    usePijonStore.getState().addFurniture(wb);
    usePijonStore.getState().clearArrangement();

    const wbAfter = usePijonStore.getState().classroom.furniture.find(
      (f) => f.id === furnitureId('wb-clear-fix'),
    )!;
    const occAfter = furnitureOccupant(wbAfter);
    expect(occAfter).toBeDefined();
    expect(occAfter!.isFixture).toBe(true);
    expect(occAfter!.id).toBe(wbFix.id);
  });
});
