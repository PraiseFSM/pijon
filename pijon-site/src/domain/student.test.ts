// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  makeStudent,
  makeFixture,
  addPreference,
  removePreferencesFor,
  clearPreferences,
  rename,
} from './student.js';
import { studentId } from './types.js';
import { preferStudent, avoidStudent, preferLocation } from './preference.js';

const sid = studentId('s-001');
const sid2 = studentId('s-002');
const sid3 = studentId('s-003');

describe('makeStudent', () => {
  it('creates a real student with no preferences', () => {
    const s = makeStudent(sid, 'Alice');
    expect(s.id).toBe(sid);
    expect(s.name).toBe('Alice');
    expect(s.isFixture).toBe(false);
    expect(s.preferences).toHaveLength(0);
  });

  it('has empty metadata by default', () => {
    const s = makeStudent(sid, 'Alice');
    expect(Object.keys(s.metadata)).toHaveLength(0);
  });
});

describe('makeFixture', () => {
  it('creates a fixture occupant with isFixture=true', () => {
    const f = makeFixture(sid, 'Whiteboard');
    expect(f.isFixture).toBe(true);
    expect(f.name).toBe('Whiteboard');
  });

  it('fixture has no preferences', () => {
    const f = makeFixture(sid, 'Door');
    expect(f.preferences).toHaveLength(0);
  });
});

describe('addPreference (immutable)', () => {
  it('returns a new student with the preference appended', () => {
    const s = makeStudent(sid, 'Alice');
    const pref = preferStudent(sid2);
    const s2 = addPreference(s, pref);
    expect(s2.preferences).toHaveLength(1);
    expect(s2.preferences[0]).toBe(pref);
  });

  it('does not mutate the original student', () => {
    const s = makeStudent(sid, 'Alice');
    addPreference(s, preferStudent(sid2));
    expect(s.preferences).toHaveLength(0);
  });

  it('accumulates multiple preferences', () => {
    const s = makeStudent(sid, 'Alice');
    const s1 = addPreference(s, preferStudent(sid2));
    const s2 = addPreference(s1, avoidStudent(sid3));
    expect(s2.preferences).toHaveLength(2);
  });
});

describe('removePreferencesFor (immutable)', () => {
  it('removes all preferences targeting the given id', () => {
    const s = makeStudent(sid, 'Alice');
    const withPrefs = addPreference(addPreference(s, preferStudent(sid2)), avoidStudent(sid2));
    const cleaned = removePreferencesFor(withPrefs, sid2);
    expect(cleaned.preferences).toHaveLength(0);
  });

  it('keeps preferences for other targets', () => {
    const s = makeStudent(sid, 'Alice');
    const withPrefs = addPreference(addPreference(s, preferStudent(sid2)), preferStudent(sid3));
    const cleaned = removePreferencesFor(withPrefs, sid2);
    expect(cleaned.preferences).toHaveLength(1);
    const remaining = cleaned.preferences[0];
    expect(remaining?.kind).toBe('student');
    if (remaining?.kind === 'student') {
      expect(remaining.targetId).toBe(sid3);
    }
  });

  it('does not mutate the original', () => {
    const s = addPreference(makeStudent(sid, 'Alice'), preferStudent(sid2));
    removePreferencesFor(s, sid2);
    expect(s.preferences).toHaveLength(1);
  });

  it('handles no-op removal (target not in list)', () => {
    const s = addPreference(makeStudent(sid, 'Alice'), preferStudent(sid2));
    const cleaned = removePreferencesFor(s, sid3);
    expect(cleaned.preferences).toHaveLength(1);
  });

  it('preserves location preferences during removal (no targetId)', () => {
    const s = addPreference(makeStudent(sid, 'Alice'), preferLocation('window'));
    const cleaned = removePreferencesFor(s, 'window');
    // location prefs have no targetId, so they should NOT be removed by this helper
    expect(cleaned.preferences).toHaveLength(1);
  });
});

describe('clearPreferences (immutable)', () => {
  it('returns a student with no preferences', () => {
    const s = addPreference(makeStudent(sid, 'Alice'), preferStudent(sid2));
    const cleared = clearPreferences(s);
    expect(cleared.preferences).toHaveLength(0);
  });

  it('does not mutate the original', () => {
    const s = addPreference(makeStudent(sid, 'Alice'), preferStudent(sid2));
    clearPreferences(s);
    expect(s.preferences).toHaveLength(1);
  });

  it('clearing an already-empty list is a no-op', () => {
    const s = makeStudent(sid, 'Alice');
    const cleared = clearPreferences(s);
    expect(cleared.preferences).toHaveLength(0);
  });
});

describe('rename (immutable)', () => {
  it('returns a student with the new name', () => {
    const s = makeStudent(sid, 'Alice');
    const s2 = rename(s, 'Alicia');
    expect(s2.name).toBe('Alicia');
  });

  it('does not mutate the original', () => {
    const s = makeStudent(sid, 'Alice');
    rename(s, 'Alicia');
    expect(s.name).toBe('Alice');
  });

  it('preserves all other fields', () => {
    const pref = preferStudent(sid2);
    const s = addPreference(makeStudent(sid, 'Alice'), pref);
    const s2 = rename(s, 'Alicia');
    expect(s2.id).toBe(sid);
    expect(s2.isFixture).toBe(false);
    expect(s2.preferences).toHaveLength(1);
  });
});
