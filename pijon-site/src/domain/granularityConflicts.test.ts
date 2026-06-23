// @vitest-environment node
/**
 * Tests for §6.C1 — granularityConflicts pure domain helper.
 *
 * granularityConflicts(classroom, newG) returns a list of pieces whose pos.x
 * or pos.y is not a multiple of step = oldG / newG, together with the nearest
 * valid (snapped, clamped, ideally non-colliding) target position.
 *
 * Scenarios covered:
 *   (a) Returns empty when newG >= oldG (increase or same).
 *   (b) Returns empty when all pieces are already aligned.
 *   (c) Detects a single off-boundary piece at 4->2 (step=2) and 4->1 (step=4).
 *   (d) Detects an off-boundary piece at 2->1 (step=2).
 *   (e) `to` is the nearest valid multiple, clamped in-bounds.
 *   (f) Multiple pieces — each has its own conflict entry.
 *   (g) Collision avoidance: `to` picks a non-colliding slot when available.
 *   (h) Falls back to snapped/clamped position when all neighbours collide.
 *   (i) Furniture with w/h > 1 are clamped so they stay in-bounds.
 *   (j) from matches the current furniture pos exactly.
 */

import { describe, it, expect } from 'vitest';
import { granularityConflicts } from './classroom.js';
import type { Classroom } from './classroom.js';
import type { Furniture } from './furniture.js';
import { furnitureId } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkDesk(id: string, x: number, y: number, w = 1, h = 1): Furniture {
  return {
    id: furnitureId(id),
    kind: 'single_desk',
    pos: { x, y },
    w,
    h,
    rotation: 0,
    occupants: [],
  };
}

function mkClassroom(
  gridW: number,
  gridH: number,
  cellsPerUnit: number,
  ...furniture: Furniture[]
): Classroom {
  return {
    id: 'test',
    name: 'Test',
    gridW,
    gridH,
    furniture,
    cellsPerUnit,
    thresholdUnits: 1.5,
  };
}

// ---------------------------------------------------------------------------
// (a) No conflict when newG >= oldG (increase or same)
// ---------------------------------------------------------------------------

describe('granularityConflicts — returns empty when newG >= oldG', () => {
  it('returns empty when newG === oldG (same granularity)', () => {
    // Place desk at odd position that would fail a downscale, but same G = no issue
    const c = mkClassroom(8, 8, 2, mkDesk('d', 1, 1, 2, 2));
    expect(granularityConflicts(c, 2)).toHaveLength(0);
  });

  it('returns empty when newG > oldG (increase)', () => {
    const c = mkClassroom(8, 8, 1, mkDesk('d', 1, 1));
    expect(granularityConflicts(c, 2)).toHaveLength(0);
  });

  it('returns empty when newG is much larger than oldG', () => {
    const c = mkClassroom(4, 4, 1, mkDesk('d', 1, 1));
    expect(granularityConflicts(c, 4)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (b) No conflict when all pieces are already aligned
// ---------------------------------------------------------------------------

describe('granularityConflicts — returns empty when all pieces are aligned', () => {
  it('G=2 -> G=1: desk at (0,0) — aligned (0 is a multiple of 2)', () => {
    const c = mkClassroom(8, 8, 2, mkDesk('d', 0, 0, 2, 2));
    expect(granularityConflicts(c, 1)).toHaveLength(0);
  });

  it('G=4 -> G=2: desk at (4,0) — aligned (4 is a multiple of step=2)', () => {
    const c = mkClassroom(16, 16, 4, mkDesk('d', 4, 0, 4, 4));
    expect(granularityConflicts(c, 2)).toHaveLength(0);
  });

  it('G=4 -> G=1: desk at (4,8) — aligned (4 and 8 are multiples of step=4)', () => {
    const c = mkClassroom(16, 16, 4, mkDesk('d', 4, 8, 4, 4));
    expect(granularityConflicts(c, 1)).toHaveLength(0);
  });

  it('G=2 -> G=1: multiple desks all aligned at even positions', () => {
    const c = mkClassroom(12, 12, 2,
      mkDesk('a', 0, 0, 2, 2),
      mkDesk('b', 2, 4, 2, 2),
      mkDesk('c', 6, 6, 2, 2),
    );
    expect(granularityConflicts(c, 1)).toHaveLength(0);
  });

  it('empty classroom returns empty', () => {
    const c = mkClassroom(8, 8, 4);
    expect(granularityConflicts(c, 1)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (c) Detects off-boundary pieces at 4->2 and 4->1
// ---------------------------------------------------------------------------

describe('granularityConflicts — detects conflicts at 4->2', () => {
  // At G=4, step = 4/2 = 2. pos.x must be a multiple of 2.
  // pos.x=1 → NOT a multiple of 2 → conflict.
  it('detects a piece at odd pos.x (4->2, step=2)', () => {
    const c = mkClassroom(16, 16, 4, mkDesk('d', 1, 0, 4, 4));
    const conflicts = granularityConflicts(c, 2);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.id).toBe(furnitureId('d'));
  });

  it('detects a piece at odd pos.y (4->2, step=2)', () => {
    const c = mkClassroom(16, 16, 4, mkDesk('d', 0, 3, 4, 4));
    const conflicts = granularityConflicts(c, 2);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.id).toBe(furnitureId('d'));
  });

  it('detects a piece at odd pos.x AND pos.y (4->2, step=2)', () => {
    const c = mkClassroom(16, 16, 4, mkDesk('d', 1, 3, 4, 4));
    const conflicts = granularityConflicts(c, 2);
    expect(conflicts).toHaveLength(1);
  });
});

describe('granularityConflicts — detects conflicts at 4->1', () => {
  // At G=4, step = 4/1 = 4. pos.x must be a multiple of 4.
  // pos.x=2 → NOT a multiple of 4 → conflict.
  it('detects a piece at pos.x=2 (4->1, step=4)', () => {
    const c = mkClassroom(16, 16, 4, mkDesk('d', 2, 0, 4, 4));
    const conflicts = granularityConflicts(c, 1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.id).toBe(furnitureId('d'));
  });

  it('detects a piece at pos.x=1 (4->1, step=4)', () => {
    const c = mkClassroom(16, 16, 4, mkDesk('d', 1, 0, 4, 4));
    const conflicts = granularityConflicts(c, 1);
    expect(conflicts).toHaveLength(1);
  });

  it('does NOT conflict when pos.x=4 (multiple of step=4)', () => {
    const c = mkClassroom(16, 16, 4, mkDesk('d', 4, 0, 4, 4));
    expect(granularityConflicts(c, 1)).toHaveLength(0);
  });
});

describe('granularityConflicts — detects conflicts at 2->1', () => {
  // At G=2, step = 2/1 = 2. pos.x must be a multiple of 2.
  // pos.x=1 → NOT a multiple of 2 → conflict.
  it('detects a piece at pos.x=1 (2->1, step=2)', () => {
    const c = mkClassroom(8, 8, 2, mkDesk('d', 1, 0, 2, 2));
    const conflicts = granularityConflicts(c, 1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.id).toBe(furnitureId('d'));
  });

  it('does NOT conflict when pos.x=2 (multiple of step=2)', () => {
    const c = mkClassroom(8, 8, 2, mkDesk('d', 2, 0, 2, 2));
    expect(granularityConflicts(c, 1)).toHaveLength(0);
  });

  it('from field matches the current furniture position exactly', () => {
    const c = mkClassroom(8, 8, 2, mkDesk('d', 1, 3, 2, 2));
    const conflicts = granularityConflicts(c, 1);
    expect(conflicts[0]?.from).toEqual({ x: 1, y: 3 });
  });
});

// ---------------------------------------------------------------------------
// (e) `to` is the nearest valid multiple, clamped in-bounds
// ---------------------------------------------------------------------------

describe('granularityConflicts — nearest valid multiple and clamping', () => {
  it('snaps pos.x to the nearest multiple of step', () => {
    // G=2->1, step=2. Desk at pos.x=1. Math.round(1/2)=1, so snap = 1*2 = 2.
    const c = mkClassroom(8, 8, 2, mkDesk('d', 1, 0, 2, 2));
    const conflicts = granularityConflicts(c, 1);
    expect(conflicts[0]?.to.x).toBe(2);
  });

  it('snaps pos.x=3 to nearest even (round(3/2)*2 = 4)', () => {
    // G=2->1, step=2. Desk at pos.x=3. Round(3/2)*2 = 2*2=4.
    // But we need to check clamping: gridW=8, w=2, maxX=6. 4 <= 6, no clamp.
    const c = mkClassroom(8, 8, 2, mkDesk('d', 3, 0, 2, 2));
    const conflicts = granularityConflicts(c, 1);
    expect(conflicts[0]?.to.x).toBe(4);
  });

  it('snaps pos.y independently from pos.x', () => {
    // G=2->1, step=2. Desk at (1,3).
    // Snap x: round(1/2)*2 = round(0.5)*2 = 1*2 = 2.
    // Snap y: round(3/2)*2 = round(1.5)*2 = 2*2 = 4.
    const c = mkClassroom(8, 8, 2, mkDesk('d', 1, 3, 2, 2));
    const conflicts = granularityConflicts(c, 1);
    const to = conflicts[0]?.to;
    expect(to?.x).toBe(2);
    expect(to?.y).toBe(4);
  });

  it('clamps to.x to 0 when snap would be negative', () => {
    // G=2->1, step=2. Desk at pos.x=0 — but this is aligned (0 % 2 === 0), no conflict.
    // Instead try a desk at pos.x=1 with narrow grid so snap lands at -step.
    // Actually round(1/2)*2 = 0, so no negative here. Test: desk at odd pos with left boundary.
    // G=4->1, step=4. Desk at pos.x=1, gridW=8, w=4, maxX=4. snap: round(1/4)*4=0. In-bounds.
    const c = mkClassroom(8, 8, 4, mkDesk('d', 1, 0, 4, 4));
    const conflicts = granularityConflicts(c, 1);
    expect(conflicts[0]?.to.x).toBeGreaterThanOrEqual(0);
  });

  it('clamps to.x so piece stays in-bounds (to.x <= gridW - w)', () => {
    // G=4->2, step=2. Desk w=4 at pos.x=13 in a 16-wide grid. maxX=16-4=12.
    // snap(13, 2) = round(13/2)*2 = 7*2 = 14. Clamped to min(14, 12) = 12.
    const c = mkClassroom(16, 16, 4, mkDesk('d', 13, 0, 4, 4));
    const conflicts = granularityConflicts(c, 2);
    expect(conflicts[0]?.to.x).toBeLessThanOrEqual(12);
    expect(conflicts[0]?.to.x).toBeGreaterThanOrEqual(0);
  });

  it('to position is always a multiple of step', () => {
    // G=4->2, step=2. For any conflict, to.x and to.y must be multiples of 2.
    const c = mkClassroom(16, 16, 4,
      mkDesk('a', 1, 0, 4, 4),
      mkDesk('b', 3, 5, 4, 4),
    );
    const conflicts = granularityConflicts(c, 2);
    for (const conflict of conflicts) {
      expect(conflict.to.x % 2).toBe(0);
      expect(conflict.to.y % 2).toBe(0);
    }
  });

  it('to position keeps piece in-bounds: to.x in [0, gridW-w]', () => {
    const cases: { pos: number; gridW: number; w: number }[] = [
      { pos: 1, gridW: 8, w: 2 },
      { pos: 5, gridW: 8, w: 2 },
      { pos: 1, gridW: 16, w: 4 },
    ];
    for (const { pos, gridW, w } of cases) {
      const c = mkClassroom(gridW, 8, 2, mkDesk('d', pos, 0, w, 2));
      const conflicts = granularityConflicts(c, 1);
      if (pos % 2 === 0) continue; // might not conflict if aligned
      const to = conflicts[0]?.to;
      if (to !== undefined) {
        expect(to.x).toBeGreaterThanOrEqual(0);
        expect(to.x + w).toBeLessThanOrEqual(gridW);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (f) Multiple pieces — each gets its own conflict entry
// ---------------------------------------------------------------------------

describe('granularityConflicts — multiple conflicting pieces', () => {
  it('returns one entry per conflicting piece', () => {
    // G=2->1, step=2. Three desks at odd x positions.
    const c = mkClassroom(12, 12, 2,
      mkDesk('a', 1, 0, 2, 2),
      mkDesk('b', 3, 0, 2, 2),
      mkDesk('c', 5, 0, 2, 2),
    );
    const conflicts = granularityConflicts(c, 1);
    expect(conflicts).toHaveLength(3);
    const ids = conflicts.map((cf) => cf.id);
    expect(ids).toContain(furnitureId('a'));
    expect(ids).toContain(furnitureId('b'));
    expect(ids).toContain(furnitureId('c'));
  });

  it('returns only conflicting pieces, not aligned ones', () => {
    // One aligned (pos.x=2, ok at step=2) and one not (pos.x=1).
    const c = mkClassroom(12, 12, 2,
      mkDesk('ok', 2, 0, 2, 2),
      mkDesk('bad', 1, 4, 2, 2),
    );
    const conflicts = granularityConflicts(c, 1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.id).toBe(furnitureId('bad'));
  });

  it('each conflict has a unique id matching the furniture', () => {
    const c = mkClassroom(16, 16, 4,
      mkDesk('x', 1, 0, 4, 4),
      mkDesk('y', 0, 1, 4, 4),
    );
    const conflicts = granularityConflicts(c, 1);
    expect(conflicts).toHaveLength(2);
    const idSet = new Set(conflicts.map((cf) => cf.id));
    expect(idSet.has(furnitureId('x'))).toBe(true);
    expect(idSet.has(furnitureId('y'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (g) Collision avoidance: prefers a non-colliding `to` position
// ---------------------------------------------------------------------------

describe('granularityConflicts — collision avoidance', () => {
  it('avoids a collision at the snapped position by choosing an adjacent slot', () => {
    // G=2->1, step=2. Desk A at (1,0) conflicts. Nearest snap: x=0.
    // But desk B is at (0,0) blocking x=0. So `to` should be x=2 instead.
    const c = mkClassroom(12, 8, 2,
      mkDesk('conflict', 1, 0, 2, 2),  // pos.x=1 not multiple of 2
      mkDesk('blocker', 0, 0, 2, 2),   // occupies x=0..1, y=0..1
    );
    const conflicts = granularityConflicts(c, 1);
    expect(conflicts).toHaveLength(1);
    const to = conflicts[0]?.to;
    expect(to).toBeDefined();
    if (to !== undefined) {
      // to must not collide with the blocker at (0,0)
      const overlapX = to.x < 2 && to.x + 2 > 0;
      const overlapY = to.y < 2 && to.y + 2 > 0;
      const collidesWithBlocker = overlapX && overlapY;
      expect(collidesWithBlocker).toBe(false);
      // Must be a valid step=2 multiple
      expect(to.x % 2).toBe(0);
    }
  });

  it('to is always in-bounds even after collision avoidance', () => {
    // Build a dense classroom where the snapped position is blocked; any `to`
    // the helper picks must still be in-bounds.
    const c = mkClassroom(8, 4, 2,
      mkDesk('conflict', 1, 0, 2, 2),
      mkDesk('blocker', 0, 0, 2, 2),
    );
    const conflicts = granularityConflicts(c, 1);
    for (const conflict of conflicts) {
      const f = c.furniture.find((fu) => fu.id === conflict.id);
      if (f === undefined) continue;
      expect(conflict.to.x).toBeGreaterThanOrEqual(0);
      expect(conflict.to.y).toBeGreaterThanOrEqual(0);
      expect(conflict.to.x + f.w).toBeLessThanOrEqual(c.gridW);
      expect(conflict.to.y + f.h).toBeLessThanOrEqual(c.gridH);
    }
  });

  it('falls back to snapped/clamped position when no non-colliding slot exists', () => {
    // A very tight grid where every nearby slot is blocked. The helper must still
    // return SOME valid (in-bounds, step-aligned) position — even if it collides.
    // G=2->1, step=2. Grid 4×4, w=h=2. Only slots: (0,0),(2,0),(0,2),(2,2).
    // Conflict piece at (1,0). Snap: (0,0). Block all others so only (0,0) remains.
    // The piece can fall back to (0,0) even though it collides with the blocker.
    const c = mkClassroom(4, 4, 2,
      mkDesk('conflict', 1, 0, 2, 2),
      mkDesk('b1', 0, 0, 2, 2),  // blocks (0,0)
      mkDesk('b2', 2, 0, 2, 2),  // blocks (2,0)
      mkDesk('b3', 0, 2, 2, 2),  // blocks (0,2)
      mkDesk('b4', 2, 2, 2, 2),  // blocks (2,2)
    );
    const conflicts = granularityConflicts(c, 1);
    // There must be exactly one conflict for the 'conflict' desk
    const conflictEntry = conflicts.find((cf) => cf.id === furnitureId('conflict'));
    expect(conflictEntry).toBeDefined();
    if (conflictEntry !== undefined) {
      // to is still in-bounds and step-aligned (even if it collides)
      expect(conflictEntry.to.x % 2).toBe(0);
      expect(conflictEntry.to.y % 2).toBe(0);
      expect(conflictEntry.to.x).toBeGreaterThanOrEqual(0);
      expect(conflictEntry.to.y).toBeGreaterThanOrEqual(0);
      expect(conflictEntry.to.x + 2).toBeLessThanOrEqual(4);
      expect(conflictEntry.to.y + 2).toBeLessThanOrEqual(4);
    }
  });
});

// ---------------------------------------------------------------------------
// (i) Furniture with w/h > 1 stays in-bounds
// ---------------------------------------------------------------------------

describe('granularityConflicts — large furniture stays in-bounds', () => {
  it('2x2 desk: to.x + w <= gridW and to.y + h <= gridH', () => {
    // G=4->2, step=2. Desk 4x4 at pos=(3,3) in 16x16 grid.
    // snap(3,2)=4. to=(4,4). w=h=4. to.x+4=8<=16, to.y+4=8<=16. OK.
    const c = mkClassroom(16, 16, 4, mkDesk('big', 3, 3, 4, 4));
    const conflicts = granularityConflicts(c, 2);
    expect(conflicts).toHaveLength(1);
    const to = conflicts[0]?.to;
    if (to !== undefined) {
      expect(to.x + 4).toBeLessThanOrEqual(16);
      expect(to.y + 4).toBeLessThanOrEqual(16);
    }
  });

  it('whiteboard (4x1): clamped so it fits the grid width', () => {
    // G=2->1, step=2. Whiteboard 4x2 at (7,0) in a 10x10 grid. maxX=10-4=6.
    // snap(7,2)=8. Clamped to min(8,6)=6.
    const wb: Furniture = {
      id: furnitureId('wb'),
      kind: 'whiteboard',
      pos: { x: 7, y: 0 },
      w: 4,
      h: 2,
      rotation: 0,
      occupants: [],
    };
    const c = mkClassroom(10, 10, 2, wb);
    const conflicts = granularityConflicts(c, 1);
    expect(conflicts).toHaveLength(1);
    const to = conflicts[0]?.to;
    if (to !== undefined) {
      expect(to.x + 4).toBeLessThanOrEqual(10);
      expect(to.x).toBeGreaterThanOrEqual(0);
      expect(to.x % 2).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// (k) Clamping is applied BEFORE the collision-avoidance candidate search
//     so the search is centred on the in-bounds snap, not the raw snap.
//     Without pre-clamp, a snap that exceeds maxX would anchor the ±2-step
//     neighbourhood outside the grid, potentially missing valid in-bounds slots
//     that are only reachable from a clamped centre.
// ---------------------------------------------------------------------------

describe('granularityConflicts — clamping precedes candidate search', () => {
  it('to is in-bounds when snap exceeds maxX and every ±2-step candidate from unclamped base is blocked or OOB', () => {
    // G=4->2, step=2. Tall desk w=4 h=8 (fills full height) at pos.x=13 in a 16x8 grid.
    // maxX = 16-4 = 12, maxY = 8-8 = 0  (only y=0 is valid for a full-height piece).
    // snap(13,2) = round(13/2)*2 = 14 → clamped to 12.
    // Without clamping: unclamped base = 14.
    //   Candidates in ±2 steps of 14 that are in-bounds: 12 (dx=-1) and 10 (dx=-2).
    //   Block both with furniture → no non-colliding candidate → fallback is baseX=14 (OOB!).
    // With clamping: base = 12. Candidates: 12(dx=0), 10(dx=-1), 8(dx=-2), 14(dx=+1, OOB), 16(OOB).
    //   12 is blocked, 10 is blocked → 8 (dx=-2) is non-colliding → to.x=8 (in-bounds).
    // Using tall blockers (h=8) to prevent any y-axis escape.
    const c = mkClassroom(16, 8, 4,
      mkDesk('conflict', 13, 0, 4, 8),  // pos.x=13, not a multiple of step=2, fills full height
      mkDesk('b1', 10, 0, 2, 8),         // blocks x=10, full height
      mkDesk('b2', 12, 0, 2, 8),         // blocks x=12, full height
    );
    const conflicts = granularityConflicts(c, 2);
    const entry = conflicts.find((cf) => cf.id === furnitureId('conflict'));
    expect(entry).toBeDefined();
    if (entry !== undefined) {
      // to.x must be in-bounds (without proper clamping the fallback is 14 which is OOB)
      expect(entry.to.x + 4).toBeLessThanOrEqual(16);
      expect(entry.to.x).toBeGreaterThanOrEqual(0);
      expect(entry.to.x % 2).toBe(0);
    }
  });

  it('fallback to clamped pos is in-bounds when all ±2-step candidates are blocked', () => {
    // G=4->2, step=2. Desk w=4 at pos.x=15 in a 16-wide grid.
    // maxX=12. snap(15,2)=16 → clamped to 12.
    // Unclamped 16+dx*2 for dx=-2..2 = 12,14,16,18,20.
    // 14,16,18,20 are OOB. Block x=12 so only OOB candidates remain from unclamped base.
    // Without clamping: ALL candidates OOB (14+) or blocked → fallback is 16 (OOB!).
    // With clamping: fallback is 12 (clamped baseX), which is in-bounds.
    const c = mkClassroom(16, 8, 4,
      mkDesk('conflict', 15, 0, 4, 2),  // pos.x=15 odd step (step=2)
      mkDesk('b1', 12, 0, 2, 2),         // blocks x=12
      mkDesk('b2', 10, 0, 2, 2),         // blocks x=10
      mkDesk('b3', 8, 0, 2, 2),          // blocks x=8
      mkDesk('b4', 6, 0, 2, 2),          // blocks x=6
    );
    const conflicts = granularityConflicts(c, 2);
    const entry = conflicts.find((cf) => cf.id === furnitureId('conflict'));
    expect(entry).toBeDefined();
    if (entry !== undefined) {
      // Must be in-bounds regardless (fallback is clamped baseX=12, not unclamped 16)
      expect(entry.to.x + 4).toBeLessThanOrEqual(16);
      expect(entry.to.x).toBeGreaterThanOrEqual(0);
      expect(entry.to.x % 2).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// (j) `from` always matches the current furniture pos exactly
// ---------------------------------------------------------------------------

describe('granularityConflicts — from field is the current position', () => {
  it('from matches furniture.pos exactly', () => {
    const c = mkClassroom(16, 16, 4, mkDesk('d', 3, 7, 4, 4));
    const conflicts = granularityConflicts(c, 2);
    expect(conflicts[0]?.from).toEqual({ x: 3, y: 7 });
  });

  it('from is not modified by the collision-avoidance logic', () => {
    // Even if the snapped/clamped `to` differs, `from` must stay as the original pos.
    const c = mkClassroom(8, 8, 2,
      mkDesk('conflict', 1, 3, 2, 2),
      mkDesk('blocker', 0, 2, 2, 2),
    );
    const conflicts = granularityConflicts(c, 1);
    expect(conflicts[0]?.from).toEqual({ x: 1, y: 3 });
  });
});
