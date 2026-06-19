/**
 * Student — a person to be seated, with a name and preferences.
 *
 * isFixture marks a faux occupant (a stand-in for a room feature like
 * "Whiteboard" or "Door") so that preferences can refer to it.
 *
 * Immutable record — all fields readonly. Mutation helpers return new Students.
 * No React/DOM imports.
 */

import type { StudentId } from './types.js';
import type { Preference } from './preference.js';

// ---------------------------------------------------------------------------
// Student interface
// ---------------------------------------------------------------------------

export interface Student {
  readonly id: StudentId;
  readonly name: string;
  /** True for faux occupants representing room features (whiteboard, door, …). */
  readonly isFixture: boolean;
  readonly preferences: readonly Preference[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a real student with no preferences. */
export function makeStudent(id: StudentId, name: string): Student {
  return { id, name, isFixture: false, preferences: [], metadata: {} };
}

/** Create a fixture occupant (stands in for a room feature). */
export function makeFixture(id: StudentId, name: string): Student {
  return { id, name, isFixture: true, preferences: [], metadata: {} };
}

// ---------------------------------------------------------------------------
// Pure helpers (return new Student — originals unchanged)
// ---------------------------------------------------------------------------

/** Return a new Student with the given preference appended. */
export function addPreference(student: Student, pref: Preference): Student {
  return { ...student, preferences: [...student.preferences, pref] };
}

/** Return a new Student with all preferences targeting targetId removed. */
export function removePreferencesFor(student: Student, targetId: string): Student {
  return {
    ...student,
    preferences: student.preferences.filter((p) => {
      if (p.kind === 'location') return true; // location prefs don't have targetId
      return p.targetId !== targetId;
    }),
  };
}

/** Return a new Student with all preferences cleared. */
export function clearPreferences(student: Student): Student {
  return { ...student, preferences: [] };
}

/** Return a new Student with updated name. */
export function rename(student: Student, name: string): Student {
  return { ...student, name };
}
