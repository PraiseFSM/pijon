/**
 * Classroom — the top-level document (single source of truth at runtime).
 *
 * A Classroom is a grid of a chosen size plus all the Furniture placed on it.
 * Furniture carries its occupants, so moving a desk also moves its student.
 *
 * Pure functions derive views (assignments, fixtures) and return new Classrooms
 * for add/remove/move operations (immutable update pattern).
 *
 * fixtureId() is a deterministic SHA-256-based hash (port of csv_handler.fixture_id).
 * It uses the Web Crypto API (available in browsers and Node.js 15+). Because
 * crypto.subtle.digest is async we expose both an async and a sync-fallback variant;
 * the sync one uses a tiny pure-JS SHA-256 so it works in any environment without
 * extra dependencies.
 *
 * No React/DOM imports.
 */

import type { FurnitureId, Vec2 } from './types.js';
import type { Student } from './student.js';
import type { Furniture } from './furniture.js';
import { studentId } from './types.js';
import { occupant } from './furniture.js';

// ---------------------------------------------------------------------------
// Classroom interface
// ---------------------------------------------------------------------------

export interface Classroom {
  readonly id: string;
  readonly name: string;
  readonly gridW: number;
  readonly gridH: number;
  readonly furniture: readonly Furniture[];
  /**
   * Grid granularity: how many fine cells equal one "unit".
   * Default 1 = existing behaviour (one cell = one unit).
   * At G > 1 the grid has more cells but furniture physical size is unchanged —
   * positions/sizes are all in fine cells; divide by G to get units.
   */
  readonly cellsPerUnit: number;
  /**
   * Proximity threshold in UNITS (not raw cells).
   * Default 1.5 units = today's behaviour (orthogonal + diagonal neighbours at G=1).
   * SeatGraph converts this to cells: thresholdCells = thresholdUnits * cellsPerUnit.
   * Storing in units means the threshold is stable when granularity changes.
   */
  readonly thresholdUnits: number;
  /**
   * §14.4 — Optional classroom background image URL.
   * When set, the background image is drawn behind grid lines and furniture.
   * Default null = no background image (current plain-white appearance preserved).
   * The URL should reference a same-origin public/ asset (e.g. from ASSET.background).
   * Persisted in the project file (ClassroomGeometrySchema).
   */
  readonly backgroundImage?: string | null;
  /**
   * §14.5 — Optional grid line color override.
   * When set, overrides the default `gridLine` token from colors.ts.
   * Default null = use the theme default (current appearance preserved).
   * Any valid CSS color string is accepted.
   * Persisted in the project file (ClassroomGeometrySchema).
   */
  readonly gridColor?: string | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Default proximity threshold in units (covers orthogonal + diagonal neighbours). */
export const DEFAULT_THRESHOLD_UNITS = 1.5;
/** Default granularity: 1 fine cell = 1 unit (preserves all existing behaviour). */
export const DEFAULT_CELLS_PER_UNIT = 1;

export function makeClassroom(
  id: string,
  name: string,
  gridW: number,
  gridH: number,
  cellsPerUnit: number = DEFAULT_CELLS_PER_UNIT,
  thresholdUnits: number = DEFAULT_THRESHOLD_UNITS,
): Classroom {
  return { id, name, gridW, gridH, furniture: [], cellsPerUnit, thresholdUnits, backgroundImage: null, gridColor: null };
}

/**
 * §14.4 — Return a new Classroom with `backgroundImage` set to `url`.
 * Pass null to clear the background image (restores plain-color appearance).
 * This is an opt-in setting — existing classrooms have backgroundImage: null.
 */
export function setBackgroundImage(c: Classroom, url: string | null): Classroom {
  if (c.backgroundImage === url) return c;
  return { ...c, backgroundImage: url };
}

/**
 * §14.5 — Return a new Classroom with `gridColor` set to `color`.
 * Pass null to restore the theme default (gridLine token from colors.ts).
 * Any valid CSS color string is accepted (hex, rgb, hsl, named colors).
 * This is an opt-in setting — existing classrooms have gridColor: null.
 *
 * Same-reference short-circuit: returns `c` unchanged when the color is
 * already set to the requested value, enabling React's referential equality
 * checks to skip unnecessary re-renders and canvas repaints.
 */
export function setGridColor(c: Classroom, color: string | null): Classroom {
  if (c.gridColor === color) return c;
  return { ...c, gridColor: color };
}

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------

/**
 * Map of FurnitureId → Student for all furniture with a real (non-fixture) occupant.
 * This is the "seating arrangement" view.
 */
export function assignments(c: Classroom): Map<FurnitureId, Student> {
  const m = new Map<FurnitureId, Student>();
  for (const f of c.furniture) {
    const o = occupant(f);
    if (o !== undefined && !o.isFixture) {
      m.set(f.id, o);
    }
  }
  return m;
}

/**
 * Map of FurnitureId → Student for all furniture whose occupant is a fixture
 * (a faux stand-in for a room feature like whiteboard or door).
 */
export function fixtures(c: Classroom): Map<FurnitureId, Student> {
  const m = new Map<FurnitureId, Student>();
  for (const f of c.furniture) {
    const o = occupant(f);
    if (o?.isFixture) {
      m.set(f.id, o);
    }
  }
  return m;
}

/** Lookup a single piece of furniture by id. Returns undefined if not found. */
export function furnitureById(c: Classroom, id: FurnitureId): Furniture | undefined {
  return c.furniture.find((f) => f.id === id);
}

// ---------------------------------------------------------------------------
// Pure mutation helpers (return new Classroom — originals unchanged)
// ---------------------------------------------------------------------------

/** Return a new Classroom with this furniture added. */
export function addFurniture(c: Classroom, f: Furniture): Classroom {
  return { ...c, furniture: [...c.furniture, f] };
}

/** Return a new Classroom with the furniture matching f.id removed. */
export function removeFurniture(c: Classroom, id: FurnitureId): Classroom {
  return { ...c, furniture: c.furniture.filter((f) => f.id !== id) };
}

/**
 * Return a new Classroom with the furniture matching `id` replaced by `updated`.
 * Use this to apply any change to a piece of furniture (move, assign, vacate, …).
 */
export function updateFurniture(c: Classroom, id: FurnitureId, updated: Furniture): Classroom {
  return {
    ...c,
    furniture: c.furniture.map((f) => (f.id === id ? updated : f)),
  };
}

/**
 * Return a new Classroom with the furniture at `id` moved to `pos`.
 * Occupants travel with the furniture.
 */
export function moveFurniture(c: Classroom, id: FurnitureId, pos: Vec2): Classroom {
  return {
    ...c,
    // Spread occupants on the moved piece so the result shares no mutable array
    // reference with the original (same defense as moveTo in furniture.ts).
    furniture: c.furniture.map((f) => (f.id === id ? { ...f, pos, occupants: [...f.occupants] } : f)),
  };
}

// ---------------------------------------------------------------------------
// resizeGrid — add/remove rows or columns at a given edge
// ---------------------------------------------------------------------------

/** The four edges at which a row/column can be added or removed. */
export type GridEdge = 'top' | 'bottom' | 'left' | 'right';

/**
 * Result type: success carries the new Classroom; failure carries a reason.
 *
 * The discriminated union keeps this pure — callers pattern-match on `ok` and
 * the store surfaces the `reason` as a warning toast, never throws.
 */
export type ResizeGridResult =
  | { readonly ok: true; readonly classroom: Classroom }
  | { readonly ok: false; readonly reason: string };

/**
 * Add or remove rows/columns at the given edge, returning a new Classroom.
 *
 * delta > 0: add |delta| rows/columns at that edge.
 * delta < 0: remove |delta| rows/columns from that edge.
 * delta = 0: no-op (returns the same classroom reference).
 *
 * Adding at 'top'/'left' shifts ALL furniture positions by +delta so that the
 * physical layout stays put relative to content (i.e. new empty space appears
 * at the edge, existing furniture moves into the enlarged grid).
 *
 * Adding at 'bottom'/'right' just increases gridW/gridH; furniture is unchanged.
 *
 * Removing is blocked (returns { ok: false }) if any furniture piece would
 * occupy a row/column being removed or would fall outside the new bounds after
 * the shift. The caller must surface this as a warning.
 *
 * Minimum grid size is 1×1 — removal that would reduce a dimension below 1 is
 * also blocked.
 */
export function resizeGrid(
  c: Classroom,
  edge: GridEdge,
  delta: number,
): ResizeGridResult {
  // Guard: delta must be a finite integer (non-integer or NaN bypasses all range guards).
  if (!Number.isFinite(delta) || !Number.isInteger(delta)) {
    return { ok: false, reason: `resizeGrid delta must be a finite integer, got ${String(delta)}.` };
  }
  if (delta === 0) return { ok: true, classroom: c };

  // ---- Determine new grid dimensions and shift amounts -----
  let newGridW = c.gridW;
  let newGridH = c.gridH;
  let shiftX = 0;
  let shiftY = 0;

  switch (edge) {
    case 'top':
      newGridH = c.gridH + delta;
      shiftY = delta; // positive delta → furniture moves down
      break;
    case 'bottom':
      newGridH = c.gridH + delta;
      // No shift — rows added/removed at the far end
      break;
    case 'left':
      newGridW = c.gridW + delta;
      shiftX = delta; // positive delta → furniture moves right
      break;
    case 'right':
      newGridW = c.gridW + delta;
      // No shift
      break;
  }

  // ---- Guard: minimum placeable area is 3×3 UNITS (granularity-aware) -----
  // The floor is measured in real units, so it scales with granularity:
  // 3×3 cells at G=1, 6×6 at G=2, 12×12 at G=4. This keeps the smallest usable
  // classroom constant in physical size regardless of cell density.
  const minCells = 3 * c.cellsPerUnit;
  if (newGridW < minCells) {
    return { ok: false, reason: `Cannot remove: grid would be smaller than the 3×3-unit minimum (${newGridW.toString()} columns; minimum is ${minCells.toString()} at this granularity).` };
  }
  if (newGridH < minCells) {
    return { ok: false, reason: `Cannot remove: grid would be smaller than the 3×3-unit minimum (${newGridH.toString()} rows; minimum is ${minCells.toString()} at this granularity).` };
  }

  // ---- Compute shifted furniture positions -----
  // We compute the new positions first so we can check bounds before committing.
  const shifted = c.furniture.map((f) => ({
    f,
    newPos: { x: f.pos.x + shiftX, y: f.pos.y + shiftY },
  }));

  // ---- Guard: furniture must fit in the new grid -----
  for (const { f, newPos } of shifted) {
    if (
      newPos.x < 0 ||
      newPos.y < 0 ||
      newPos.x + f.w > newGridW ||
      newPos.y + f.h > newGridH
    ) {
      // Determine a human-readable description of what's out of bounds.
      // If the furniture was shifted by delta < 0 (removal at top/left), it means
      // that furniture occupies the rows/cols being removed.
      let edgeDesc: string;
      if (delta < 0 && (edge === 'top' || edge === 'left')) {
        edgeDesc = `"${f.kind}" at (${f.pos.x.toString()},${f.pos.y.toString()}) occupies the ${edge === 'top' ? 'row(s)' : 'column(s)'} being removed`;
      } else {
        edgeDesc = `"${f.kind}" at (${f.pos.x.toString()},${f.pos.y.toString()}) would fall outside the new grid bounds`;
      }
      return {
        ok: false,
        reason: `Cannot resize: ${edgeDesc}. Move or remove it first.`,
      };
    }
  }

  // ---- Commit: apply shifted positions -----
  const newFurniture = shifted.map(({ f, newPos }) =>
    newPos.x === f.pos.x && newPos.y === f.pos.y
      ? f
      : { ...f, pos: newPos, occupants: [...f.occupants] },
  );

  return {
    ok: true,
    classroom: { ...c, gridW: newGridW, gridH: newGridH, furniture: newFurniture },
  };
}

/**
 * Whether one row/column can be validly removed at the given edge.
 *
 * Returns false when removing would (a) breach the 3×3-unit minimum placeable
 * area, or (b) require removing a row/column that any furniture occupies (which
 * `resizeGrid` already rejects). Equivalent to "would `resizeGrid(c, edge, -1)`
 * succeed?" — kept as a named helper so the Furniture editor can decide whether
 * to render the − (remove) button for each edge.
 *
 * Hiding the − button at edges where removal is illegal also prevents a desk
 * from ever sitting on top of a − button: when furniture occupies the edge
 * row/col, that edge's button simply isn't drawn.
 */
export function canRemoveEdge(c: Classroom, edge: GridEdge): boolean {
  return resizeGrid(c, edge, -1).ok;
}

// ---------------------------------------------------------------------------
// setGranularity — change cellsPerUnit, scaling all furniture + grid
// ---------------------------------------------------------------------------

/**
 * Change the grid granularity from the classroom's current cellsPerUnit to
 * `newG`, scaling all furniture positions, sizes, and the grid dimensions so
 * that the physical layout is unchanged.
 *
 * Scale factor: each value is multiplied by (newG / oldG).
 *
 * Constraints:
 *  - newG must be a positive integer ≥ 1.
 *  - All resulting values must be positive integers (if oldG does not divide
 *    evenly into the scaled values, the operation is rejected to avoid
 *    fractional cell positions).
 *
 * Returns a new Classroom (or throws TypeError for invalid newG).
 * The proximity threshold (thresholdUnits) is NOT changed — it stays in units
 * so neighbour relationships remain identical.
 */
export function setGranularity(c: Classroom, newG: number): Classroom {
  if (!Number.isInteger(newG) || newG < 1) {
    throw new TypeError(`cellsPerUnit must be a positive integer ≥ 1, got ${newG.toString()}`);
  }

  const oldG = c.cellsPerUnit;
  if (newG === oldG) return c;

  // Scale factor as a rational number (newG / oldG).
  // We check divisibility explicitly to avoid silent fractional truncation.
  const numerator = newG;
  const denominator = oldG;

  function scale(v: number): number {
    const result = (v * numerator) / denominator;
    // Must be a positive integer — reject if not exactly representable.
    if (!Number.isInteger(result)) {
      throw new RangeError(
        `Cannot change granularity from ${oldG.toString()} to ${newG.toString()}: ` +
        `value ${v.toString()} does not scale to an integer (result: ${result.toString()}). ` +
        `Try a granularity that is a multiple or divisor of the current one.`,
      );
    }
    return result;
  }

  const newGridW = scale(c.gridW);
  const newGridH = scale(c.gridH);

  const newFurniture = c.furniture.map((f) => ({
    ...f,
    pos: { x: scale(f.pos.x), y: scale(f.pos.y) },
    w: scale(f.w),
    h: scale(f.h),
    occupants: [...f.occupants],
  }));

  return {
    ...c,
    gridW: newGridW,
    gridH: newGridH,
    cellsPerUnit: newG,
    furniture: newFurniture,
    // thresholdUnits is in units — do NOT change it.
  };
}

// ---------------------------------------------------------------------------
// setThreshold — change the proximity threshold in units
// ---------------------------------------------------------------------------

/**
 * Return a new Classroom with `thresholdUnits` set to `units`.
 *
 * The threshold is stored in UNITS (not raw cells) so it remains correct
 * regardless of grid granularity (cellsPerUnit). This is the single domain
 * mutation for the "Nearness" control in the settings popover (§13.4).
 *
 * Constraints:
 *  - units must be a positive finite number.
 *  - Throws TypeError if units ≤ 0 or not finite.
 *
 * The returned Classroom is a new object (immutable update pattern).
 * Furniture and roster are NOT touched — only the scalar field changes.
 */
export function setThreshold(c: Classroom, units: number): Classroom {
  if (!Number.isFinite(units) || units <= 0) {
    throw new TypeError(`thresholdUnits must be a positive finite number, got ${String(units)}`);
  }
  if (c.thresholdUnits === units) return c;
  return { ...c, thresholdUnits: units };
}

// ---------------------------------------------------------------------------
// Source-of-truth sync helper
// ---------------------------------------------------------------------------

/**
 * Return a new Classroom where every real-student occupant copy is replaced
 * with the corresponding Student from `roster` (looked up by id).
 *
 * This must be called after ANY mutation to a real Student in the roster
 * (preference add/remove, rename, …) so that the embedded copies in
 * `furniture.occupants` never become stale. Fixture occupants are left
 * untouched — they are part of the room geometry and are not in the roster.
 *
 * If a student id in the furniture is no longer present in the roster (the
 * student was deleted), the occupant is vacated (occupants → []).
 */
export function syncRosterToClassroom(
  c: Classroom,
  roster: readonly Student[],
): Classroom {
  const rosterById = new Map<string, Student>(roster.map((s) => [s.id, s]));

  const needsUpdate = c.furniture.some((f) => {
    const occ = occupant(f);
    if (occ === undefined || occ.isFixture) return false;
    const fresh = rosterById.get(occ.id);
    // Needs update if not in roster or the object reference differs
    return fresh === undefined || fresh !== occ;
  });

  // Short-circuit when no desk has a stale real occupant
  if (!needsUpdate) return c;

  return {
    ...c,
    furniture: c.furniture.map((f) => {
      const occ = occupant(f);
      if (occ === undefined || occ.isFixture) return f;

      const fresh = rosterById.get(occ.id);
      if (fresh === undefined) {
        // Student was removed from roster — vacate the seat
        return { ...f, occupants: [] };
      }
      if (fresh === occ) return f; // already in sync
      return { ...f, occupants: [fresh] };
    }),
  };
}

// ---------------------------------------------------------------------------
// fixtureId — deterministic hash for fixture occupants
// Port of csv_handler.fixture_id: sha256("FIXTURE:<name>")[:12]
// ---------------------------------------------------------------------------

// Tiny pure-JS SHA-256. Uses DataView for structured 32-bit big-endian reads
// (DataView.getUint32 returns `number`, not `number | undefined`, so it plays
// cleanly with noUncheckedIndexedAccess). Self-contained, no external deps.
// Based on FIPS 180-4.

// SHA-256 round constants (64 values, one per round)
const SHA256_K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** Safe indexed reads — arrays are fixed-size and indices are always in range. */
function k(j: number): number {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return SHA256_K[j]!;
}
function wAt(w: number[], j: number): number {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return w[j]!;
}

function rotr32(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/**
 * Synchronous, pure-JS SHA-256. Input is a UTF-8 string. Returns hex digest.
 * Uses DataView.getUint32 (big-endian) so noUncheckedIndexedAccess doesn't
 * force non-null assertions on typed array reads.
 */
function sha256(message: string): string {
  const msgBytes = new TextEncoder().encode(message);
  const byteLen = msgBytes.length;

  // Build padded message: [msg][0x80][zeros][bitLen as 64-bit big-endian]
  const blockCount = Math.ceil((byteLen + 9) / 64);
  const totalLen = blockCount * 64;
  const buf = new ArrayBuffer(totalLen);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);

  u8.set(msgBytes);
  u8[byteLen] = 0x80;
  // 64-bit big-endian bit length — upper 32 bits are 0 for practical inputs
  const bitLen = byteLen * 8;
  dv.setUint32(totalLen - 4, bitLen >>> 0, false /* big-endian */);

  // SHA-256 initial hash values
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  // Message schedule (64 words per block, pre-filled with 0)
  const w: number[] = Array.from({ length: 64 }, () => 0);

  for (let i = 0; i < totalLen; i += 64) {
    // First 16 words from the block (DataView.getUint32 is always number)
    for (let j = 0; j < 16; j++) {
      w[j] = dv.getUint32(i + j * 4, false);
    }
    // Remaining 48 words from message schedule
    for (let j = 16; j < 64; j++) {
      const wj15 = wAt(w, j - 15);
      const wj2 = wAt(w, j - 2);
      const s0 = rotr32(wj15, 7) ^ rotr32(wj15, 18) ^ (wj15 >>> 3);
      const s1 = rotr32(wj2, 17) ^ rotr32(wj2, 19) ^ (wj2 >>> 10);
      w[j] = (wAt(w, j - 16) + s0 + wAt(w, j - 7) + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let j = 0; j < 64; j++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k(j) + wAt(w, j)) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

/**
 * Deterministic, salt-free id for fixture occupants.
 * Port of csv_handler.fixture_id: sha256("FIXTURE:<name>")[:12]
 *
 * A fixture is semantically a Student (it is an Occupant — it slots into
 * Furniture.occupants alongside real students). Its id must therefore be a
 * StudentId so that:
 *   - makeFixture(fixtureId(name), name) type-checks without any cast
 *   - Preference.targetId (typed as StudentId for 'student' kind) can
 *     reference a fixture directly in Phase 3 allocators
 *
 * Synchronous, dependency-free, works in browser and Node.
 */
export function fixtureId(name: string): ReturnType<typeof studentId> {
  const hex = sha256(`FIXTURE:${name}`);
  return studentId(hex.slice(0, 12));
}
