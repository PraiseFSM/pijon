// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  preferStudent,
  avoidStudent,
  preferFurniture,
  avoidFurniture,
  preferLocation,
  isAttractive,
  isRepulsive,
  strength,
  studentPreferences,
  furniturePreferences,
  locationPreferences,
  preferenceFor,
  hasPreferenceFor,
} from './preference.js';
import { studentId } from './types.js';

const sid1 = studentId('s1');
const sid2 = studentId('s2');

describe('preference constructors', () => {
  it('preferStudent creates a positive-weight student preference', () => {
    const p = preferStudent(sid1);
    expect(p.kind).toBe('student');
    if (p.kind === 'student') expect(p.targetId).toBe(sid1);
    expect(p.weight).toBe(1.0);
  });

  it('preferStudent clamps negative input to positive', () => {
    const p = preferStudent(sid1, -5);
    expect(p.weight).toBe(5);
  });

  it('avoidStudent creates a negative-weight student preference', () => {
    const p = avoidStudent(sid2, 2.0);
    expect(p.kind).toBe('student');
    if (p.kind === 'student') expect(p.targetId).toBe(sid2);
    expect(p.weight).toBe(-2.0);
  });

  it('avoidStudent clamps positive input to negative', () => {
    const p = avoidStudent(sid1, 3);
    expect(p.weight).toBe(-3);
  });

  it('preferFurniture creates a positive-weight furniture preference', () => {
    const p = preferFurniture('furn-1');
    expect(p.kind).toBe('furniture');
    if (p.kind === 'furniture') expect(p.targetId).toBe('furn-1');
    expect(p.weight).toBeGreaterThan(0);
  });

  it('avoidFurniture creates a negative-weight furniture preference', () => {
    const p = avoidFurniture('furn-2', 0.5);
    expect(p.kind).toBe('furniture');
    expect(p.weight).toBe(-0.5);
  });

  it('preferLocation creates a location preference with given weight', () => {
    const p = preferLocation('window', 1.5);
    expect(p.kind).toBe('location');
    if (p.kind === 'location') expect(p.target).toBe('window');
    expect(p.weight).toBe(1.5);
  });

  it('preferLocation with negative weight creates repulsive location preference', () => {
    const p = preferLocation('front', -1);
    expect(p.weight).toBe(-1);
  });

  it('default weight for preferStudent is 1.0', () => {
    expect(preferStudent(sid1).weight).toBe(1.0);
  });

  it('default weight for avoidStudent is -1.0', () => {
    expect(avoidStudent(sid1).weight).toBe(-1.0);
  });
});

describe('preference query helpers', () => {
  const pos = preferStudent(sid1, 2.0);
  const neg = avoidStudent(sid2, 1.0);
  const loc = preferLocation('back', -0.5);
  const furn = preferFurniture('wb');

  it('isAttractive returns true for positive weight', () => {
    expect(isAttractive(pos)).toBe(true);
    expect(isAttractive(furn)).toBe(true);
  });

  it('isAttractive returns false for negative weight', () => {
    expect(isAttractive(neg)).toBe(false);
    expect(isAttractive(loc)).toBe(false);
  });

  it('isRepulsive returns true for negative weight', () => {
    expect(isRepulsive(neg)).toBe(true);
    expect(isRepulsive(loc)).toBe(true);
  });

  it('isRepulsive returns false for positive weight', () => {
    expect(isRepulsive(pos)).toBe(false);
  });

  it('strength returns absolute value of weight', () => {
    expect(strength(neg)).toBe(1.0);
    expect(strength(pos)).toBe(2.0);
  });

  it('studentPreferences filters to student kind only', () => {
    const prefs = [pos, neg, loc, furn];
    const result = studentPreferences(prefs);
    expect(result).toHaveLength(2);
    // Return type is narrowed to (Preference & { kind: 'student' })[] — kind is always 'student'
    expect(result[0]?.kind).toBe('student');
    expect(result[1]?.kind).toBe('student');
  });

  it('furniturePreferences filters to furniture kind only', () => {
    const prefs = [pos, neg, loc, furn];
    const result = furniturePreferences(prefs);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('furniture');
  });

  it('locationPreferences filters to location kind only', () => {
    const prefs = [pos, neg, loc, furn];
    const result = locationPreferences(prefs);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('location');
  });

  it('preferenceFor finds by targetId (student kind)', () => {
    const prefs = [pos, neg, furn];
    const found = preferenceFor(prefs, sid1);
    expect(found).toBe(pos);
  });

  it('preferenceFor finds by targetId (furniture kind)', () => {
    const prefs = [pos, furn];
    const found = preferenceFor(prefs, 'wb');
    expect(found).toBe(furn);
  });

  it('preferenceFor returns undefined when not found', () => {
    expect(preferenceFor([pos], 'unknown')).toBeUndefined();
  });

  it('preferenceFor ignores location preferences (no targetId)', () => {
    const prefs = [loc];
    expect(preferenceFor(prefs, 'back')).toBeUndefined();
  });

  it('hasPreferenceFor returns true when preference exists', () => {
    expect(hasPreferenceFor([pos], sid1)).toBe(true);
  });

  it('hasPreferenceFor returns false when no preference exists', () => {
    expect(hasPreferenceFor([pos], 'nobody')).toBe(false);
  });

  it('hasPreferenceFor on empty list returns false', () => {
    expect(hasPreferenceFor([], sid1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('a student can express a preference targeting their own id (domain allows it; UI should warn)', () => {
    // The domain layer is a pure data layer — it does not enforce the "no self-preferences"
    // invariant. That is a UI / allocator concern. This test pins that behavior so Phase 3
    // allocators know to filter self-targeting preferences rather than relying on the model.
    const selfPref = preferStudent(sid1, 1.0);
    expect(selfPref.kind).toBe('student');
    if (selfPref.kind === 'student') expect(selfPref.targetId).toBe(sid1);
    // It passes all helpers without throwing
    expect(isAttractive(selfPref)).toBe(true);
    expect(strength(selfPref)).toBe(1.0);
  });

  it('weight of 0 is neither attractive nor repulsive', () => {
    const neutral = preferLocation('front', 0);
    expect(isAttractive(neutral)).toBe(false);
    expect(isRepulsive(neutral)).toBe(false);
    expect(strength(neutral)).toBe(0);
  });

  it('preferStudent with weight 0 is neither attractive nor repulsive', () => {
    const p = preferStudent(sid1, 0);
    expect(p.weight).toBe(0);
    expect(isAttractive(p)).toBe(false);
    expect(isRepulsive(p)).toBe(false);
  });

  it('preferenceFor with duplicate targetIds returns the first match', () => {
    const p1 = preferStudent(sid1, 1.0);
    const p2 = preferStudent(sid1, 2.0);
    const found = preferenceFor([p1, p2], sid1);
    expect(found).toBe(p1);
  });
});
