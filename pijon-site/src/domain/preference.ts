/**
 * Preference — a student's expressed like or dislike.
 *
 * Discriminated union on `kind`:
 *   - 'student'   → toward another student (positive = prefer near, negative = avoid)
 *   - 'furniture' → toward a piece of furniture / room feature
 *   - 'location'  → toward an abstract location ('front' | 'back' | 'window' | ...)
 *
 * weight > 0  → prefer (sit near)
 * weight < 0  → avoid  (sit far)
 * |weight|    → strength
 *
 * Pure data — no methods. Query helpers live alongside.
 * No React/DOM imports.
 */

import type { StudentId } from './types.js';

// ---------------------------------------------------------------------------
// Preference union
// ---------------------------------------------------------------------------

export type Preference =
  | { readonly kind: 'student'; readonly targetId: StudentId; readonly weight: number }
  | { readonly kind: 'furniture'; readonly targetId: string; readonly weight: number }
  | { readonly kind: 'location'; readonly target: string; readonly weight: number };

// ---------------------------------------------------------------------------
// Constructor helpers (mirror Python convenience functions)
// ---------------------------------------------------------------------------

/** Prefer sitting near another student. weight clamped to positive. */
export function preferStudent(targetId: StudentId, weight = 1.0): Preference {
  return { kind: 'student', targetId, weight: Math.abs(weight) };
}

/** Avoid sitting near another student. weight clamped to negative. */
export function avoidStudent(targetId: StudentId, weight = 1.0): Preference {
  return { kind: 'student', targetId, weight: -Math.abs(weight) };
}

/** Prefer sitting near a piece of furniture / room feature. weight clamped to positive. */
export function preferFurniture(targetId: string, weight = 1.0): Preference {
  return { kind: 'furniture', targetId, weight: Math.abs(weight) };
}

/** Avoid sitting near a piece of furniture / room feature. weight clamped to negative. */
export function avoidFurniture(targetId: string, weight = 1.0): Preference {
  return { kind: 'furniture', targetId, weight: -Math.abs(weight) };
}

/** Prefer a location ('front', 'back', 'window', …). Positive = prefer, negative = avoid. */
export function preferLocation(target: string, weight = 1.0): Preference {
  return { kind: 'location', target, weight };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** True for attractive (positive-weight) preferences. */
export function isAttractive(p: Preference): boolean {
  return p.weight > 0;
}

/** True for repulsive (negative-weight) preferences. */
export function isRepulsive(p: Preference): boolean {
  return p.weight < 0;
}

/** Absolute magnitude of the preference weight. */
export function strength(p: Preference): number {
  return Math.abs(p.weight);
}

/** Filter preferences by kind. */
export function studentPreferences(
  prefs: readonly Preference[],
): (Preference & { kind: 'student' })[] {
  return prefs.filter((p): p is Preference & { kind: 'student' } => p.kind === 'student');
}

export function furniturePreferences(
  prefs: readonly Preference[],
): (Preference & { kind: 'furniture' })[] {
  return prefs.filter((p): p is Preference & { kind: 'furniture' } => p.kind === 'furniture');
}

export function locationPreferences(
  prefs: readonly Preference[],
): (Preference & { kind: 'location' })[] {
  return prefs.filter((p): p is Preference & { kind: 'location' } => p.kind === 'location');
}

/** Find the first preference for a given student/furniture target id. */
export function preferenceFor(
  prefs: readonly Preference[],
  targetId: string,
): Preference | undefined {
  return prefs.find((p) => {
    if (p.kind === 'location') return false;
    return p.targetId === targetId;
  });
}

/** True if any preference targets the given id. */
export function hasPreferenceFor(prefs: readonly Preference[], targetId: string): boolean {
  return preferenceFor(prefs, targetId) !== undefined;
}
