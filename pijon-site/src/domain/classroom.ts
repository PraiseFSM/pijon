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
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeClassroom(
  id: string,
  name: string,
  gridW: number,
  gridH: number,
): Classroom {
  return { id, name, gridW, gridH, furniture: [] };
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
