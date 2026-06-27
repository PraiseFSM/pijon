/**
 * Furniture — anything placed on the classroom grid.
 *
 * A single discriminated-union-friendly data type (kind field) replaces the
 * Python prototype's class hierarchy. Capacity, seat cells, and occupied cells
 * are all derived from data via pure functions.
 *
 * Occupants attach to furniture (not to grid cells): moving furniture carries
 * its student for free, and the document remains a single serializable tree.
 *
 * numSeats is only meaningful when kind === 'table'; it is ignored (and 0 is
 * returned from capacity) for fixture kinds.
 *
 * No React/DOM imports.
 */

import type { FurnitureId, FurnitureKind, Vec2 } from './types.js';
import type { Student } from './student.js';

// ---------------------------------------------------------------------------
// Furniture interface
// ---------------------------------------------------------------------------

export interface Furniture {
  readonly id: FurnitureId;
  readonly kind: FurnitureKind;
  /** Top-left cell (0-indexed, x right, y down). */
  readonly pos: Vec2;
  readonly w: number;
  readonly h: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly imagePath?: string;
  /**
   * §8.C1 — Optional image data URL for custom-imported furniture.
   * When set, the canvas renderer draws this image instead of the kind's
   * asset/color fill. Null or undefined falls back to the kind rendering.
   * Data URLs are local (FileReader.readAsDataURL) — no network at any point.
   */
  readonly imageUrl?: string | null;
  /**
   * At most one occupant for now (desk/fixture).
   * Tables will expand to multiple occupants in a later phase.
   */
  readonly occupants: readonly Student[];
  /**
   * For tables: number of seats (determines capacity).
   * Ignored for other kinds.
   */
  readonly numSeats?: number;
}

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

/**
 * How many students this furniture can seat.
 *
 * - single_desk  → 1
 * - table        → numSeats (defaults to 4 if not set)
 * - teacher_desk → 0  (fixture, no students)
 * - whiteboard   → 0  (fixture, no students)
 */
export function capacity(f: Furniture): number {
  switch (f.kind) {
    case 'single_desk':
      return 1;
    case 'table':
      return f.numSeats ?? 4;
    case 'teacher_desk':
    case 'whiteboard':
    case 'custom':
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Grid cells
// ---------------------------------------------------------------------------

/**
 * All grid cells this furniture occupies (its bounding box).
 * Port of Python Furniture.get_occupied_cells().
 */
export function occupiedCells(f: Furniture): Vec2[] {
  const cells: Vec2[] = [];
  for (let dx = 0; dx < f.w; dx++) {
    for (let dy = 0; dy < f.h; dy++) {
      cells.push({ x: f.pos.x + dx, y: f.pos.y + dy });
    }
  }
  return cells;
}

/**
 * Grid cells that correspond to seats (where a student can sit).
 * Port of Python get_seats() → position list.
 *
 * single_desk: one seat at pos.
 * table:       distribute seats following the prototype's perimeter layout
 *              (corners + midpoints for 2/4/6; fallback row-order for others).
 * teacher_desk / whiteboard: no seats.
 */
export function seatCells(f: Furniture): Vec2[] {
  const { x, y } = f.pos;

  switch (f.kind) {
    case 'single_desk':
      return [{ x, y }];

    case 'table': {
      const n = f.numSeats ?? 4;
      if (n === 0) return [];
      const w = f.w;
      const h = f.h;

      if (n === 2) {
        return [
          { x, y },
          { x: x + w - 1, y },
        ];
      }
      if (n === 4) {
        return [
          { x, y },
          { x: x + w - 1, y },
          { x, y: y + h - 1 },
          { x: x + w - 1, y: y + h - 1 },
        ];
      }
      if (n === 6) {
        const midW = Math.floor(w / 2);
        const midH = Math.floor(h / 2);
        void midH; // midH unused in prototype's 6-seat layout (top/bottom rows only)
        return [
          { x, y },
          { x: x + midW, y },
          { x: x + w - 1, y },
          { x, y: y + h - 1 },
          { x: x + midW, y: y + h - 1 },
          { x: x + w - 1, y: y + h - 1 },
        ];
      }
      // Fallback: row-order within bounding box (prototype's else branch)
      return Array.from({ length: n }, (_, i) => ({
        x: x + (i % w),
        y: y + Math.floor(i / w),
      }));
    }

    case 'teacher_desk':
    case 'whiteboard':
    case 'custom':
      return [];
  }
}

// ---------------------------------------------------------------------------
// Occupant helpers
// ---------------------------------------------------------------------------

/** The first (and for now, only) occupant, or undefined. */
export function occupant(f: Furniture): Student | undefined {
  return f.occupants[0];
}

/**
 * True when this furniture's occupant is a fixture (faux/room-feature stand-in).
 * A whiteboard or teacher_desk carrying a fixture Student is itself treated as
 * a fixture for graph/allocator purposes.
 */
export function isFixture(f: Furniture): boolean {
  return occupant(f)?.isFixture === true;
}

// ---------------------------------------------------------------------------
// Pure mutation helpers (return new Furniture — originals unchanged)
// ---------------------------------------------------------------------------

/**
 * Assign a student to this furniture.
 *
 * Fixture occupants (student.isFixture === true) may be placed on any furniture —
 * including capacity-0 kinds (teacher_desk, whiteboard) — because the outline
 * says those piece CAN hold exactly one faux occupant representing the room feature.
 *
 * Real students (isFixture === false) are rejected when capacity is 0 or when the
 * furniture is already full.
 *
 * In either case only one occupant is accepted at a time — the "at most one occupant
 * for now" rule from the domain spec.
 */
export function assignOccupant(f: Furniture, student: Student): Furniture {
  // Fixtures bypass the capacity check — they occupy the "feature slot", not a student seat.
  if (!student.isFixture) {
    const cap = capacity(f);
    if (cap === 0) {
      throw new Error(
        `Furniture "${f.id}" (${f.kind}) has capacity 0 — cannot seat a real student.`,
      );
    }
    if (f.occupants.length >= cap) {
      throw new Error(
        `Furniture "${f.id}" (${f.kind}) is already at capacity (${cap.toString()}).`,
      );
    }
  }
  // Enforce the "at most one occupant for now" rule for fixtures too.
  if (f.occupants.length >= 1) {
    throw new Error(
      `Furniture "${f.id}" (${f.kind}) already has an occupant — vacate it first.`,
    );
  }
  return { ...f, occupants: [...f.occupants, student] };
}

/**
 * Remove all occupants from this furniture.
 * Returns new Furniture with empty occupants array.
 */
export function vacate(f: Furniture): Furniture {
  return { ...f, occupants: [] };
}

/**
 * Move furniture to a new top-left cell.
 * Occupants travel with it (they are embedded in the furniture record).
 */
export function moveTo(f: Furniture, pos: Vec2): Furniture {
  // Explicitly spread occupants so the returned Furniture does not share a mutable
  // array reference with the original. TypeScript's `readonly` prevents compile-time
  // mutation but does not copy at runtime — a shared reference could be mutated
  // through a cast or `as unknown as` escape hatch in Phase 3+.
  return { ...f, pos, occupants: [...f.occupants] };
}
