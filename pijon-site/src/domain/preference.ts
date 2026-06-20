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

// ---------------------------------------------------------------------------
// Mutual-preference helpers (operate on a roster — returns a new roster)
// These are the ONLY correct way to write student↔student preferences.
// Furniture/location preferences are one-sided and are NOT handled here.
// ---------------------------------------------------------------------------

import type { Student } from './student.js';

/**
 * Return a new student with the existing student-kind pref toward `otherId`
 * replaced by a new one at `weight`, or with the new pref appended if no pref
 * existed. Returns the SAME student reference if the pref is already correct
 * (same weight, exactly one entry) — avoids churn when nothing changed.
 */
function upsertStudentPref(
  s: Student,
  otherId: StudentId,
  weight: number,
): Student {
  const existingPrefs = s.preferences.filter(
    (p): boolean => p.kind === 'student' && p.targetId === otherId,
  );
  // Already exactly one pref with the correct weight — no change.
  if (existingPrefs.length === 1 && existingPrefs[0]?.weight === weight) return s;

  const withoutOld = s.preferences.filter(
    (p): boolean => !(p.kind === 'student' && p.targetId === otherId),
  );
  const newPref: Preference = { kind: 'student', targetId: otherId, weight };
  return { ...s, preferences: [...withoutOld, newPref] };
}

/**
 * Return a new roster where student A has a student-kind preference targeting B
 * with `weight`, AND student B has a symmetric preference targeting A with the
 * same `weight`. If a preference between the pair already exists it is replaced
 * (never duplicated). Self-targeting (aId === bId) is a no-op and returns the
 * roster unchanged.
 *
 * Only 'student' kind preferences are touched — furniture/location prefs on
 * either student are left completely intact.
 *
 * Returns the same roster reference when nothing actually changed (no churn).
 */
export function setMutualPreference(
  roster: readonly Student[],
  aId: StudentId,
  bId: StudentId,
  weight: number,
): readonly Student[] {
  // Reject self-target — no-op (silently) to keep the roster clean.
  if (aId === bId) return roster;

  const next = roster.map((s) => {
    if (s.id === aId) return upsertStudentPref(s, bId, weight);
    if (s.id === bId) return upsertStudentPref(s, aId, weight);
    return s;
  });

  // Return original reference when neither student needed an update
  // (both were absent from the roster, or both were already correct).
  // We detect this by checking whether every element is the same reference.
  const anyChanged = next.some((s, i) => s !== roster[i]);
  return anyChanged ? next : roster;
}

/**
 * Return a new roster where any student-kind preference between A and B is
 * removed from BOTH sides. Furniture/location prefs are untouched.
 * Self-targeting (aId === bId) is a no-op.
 */
export function clearMutualPreference(
  roster: readonly Student[],
  aId: StudentId,
  bId: StudentId,
): readonly Student[] {
  if (aId === bId) return roster;

  const next = roster.map((s) => {
    if (s.id !== aId && s.id !== bId) return s;

    const otherId = s.id === aId ? bId : aId;
    const hadPref = s.preferences.some(
      (p): boolean => p.kind === 'student' && p.targetId === otherId,
    );
    // No student pref to remove — return the same reference (no churn).
    if (!hadPref) return s;

    const filtered = s.preferences.filter(
      (p): boolean => !(p.kind === 'student' && p.targetId === otherId),
    );
    return { ...s, preferences: filtered };
  });

  // Return original reference when nothing was actually removed.
  const anyChanged = next.some((s, i) => s !== roster[i]);
  return anyChanged ? next : roster;
}

/**
 * Return a new roster where every student-kind preference that targets a student
 * id NOT present in the roster is removed from all students.
 *
 * This is the orphan-pref cleanup pass, called after any student is removed from
 * the roster (e.g. via setRoster). Without it, students retain "ghost" prefs
 * targeting a deleted peer. The prefs are algorithmically inert (the target is
 * never placed, so scorers skip them), but they pollute the preference panel UI.
 *
 * Returns the same roster reference when nothing needed pruning (no churn).
 * Fixture students are included in the valid-id set — their prefs are one-sided
 * furniture prefs and don't need cleanup, but we must not strip refs to them.
 */
export function pruneOrphanStudentPrefs(
  roster: readonly Student[],
): readonly Student[] {
  const validIds = new Set<string>(roster.map((s) => s.id));

  const next = roster.map((s) => {
    const pruned = s.preferences.filter(
      (p): boolean => p.kind !== 'student' || validIds.has(p.targetId),
    );
    if (pruned.length === s.preferences.length) return s; // nothing removed
    return { ...s, preferences: pruned };
  });

  // Return original reference when no student was modified (no churn).
  const anyChanged = next.some((s, i) => s !== roster[i]);
  return anyChanged ? next : roster;
}
