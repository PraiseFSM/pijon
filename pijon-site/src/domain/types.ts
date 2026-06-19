/**
 * Domain primitive types for Pijon.
 *
 * Branded id types prevent accidental mixing of FurnitureId and StudentId.
 * All types are readonly — the domain layer is immutable data + pure functions.
 * No React/DOM imports.
 */

// ---------------------------------------------------------------------------
// Branded id types
// ---------------------------------------------------------------------------

export type FurnitureId = string & { readonly _t: 'FurnitureId' };
export type StudentId = string & { readonly _t: 'StudentId' };

/** Mint a FurnitureId from a raw string (e.g. crypto-generated uuid). */
export function furnitureId(raw: string): FurnitureId {
  return raw as FurnitureId;
}

/** Mint a StudentId from a raw string. */
export function studentId(raw: string): StudentId {
  return raw as StudentId;
}

// ---------------------------------------------------------------------------
// 2D grid position — top-left is (0, 0), x grows right, y grows down.
// ---------------------------------------------------------------------------

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

// ---------------------------------------------------------------------------
// Furniture kinds (discriminated union tag)
// ---------------------------------------------------------------------------

/**
 * Kinds of furniture that can be placed on the grid.
 *
 * - single_desk  — one seat (1×1 by convention, capacity 1)
 * - table        — multi-seat; capacity = numSeats field on Furniture
 * - teacher_desk — fixture, capacity 0
 * - whiteboard   — fixture, capacity 0
 */
export type FurnitureKind =
  | 'single_desk'
  | 'table'
  | 'teacher_desk'
  | 'whiteboard';
