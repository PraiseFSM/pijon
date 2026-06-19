// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { furnitureId, studentId } from './types.js';

describe('types — branded id helpers', () => {
  it('furnitureId returns the raw string value', () => {
    const id = furnitureId('abc-123');
    expect(id).toBe('abc-123');
  });

  it('studentId returns the raw string value', () => {
    const id = studentId('xyz-456');
    expect(id).toBe('xyz-456');
  });

  it('furnitureId and studentId produce the same runtime value from the same raw string', () => {
    // Branded types diverge at compile time only; runtime they're both plain strings.
    const raw = 'same-raw-string';
    // Compare via String() to avoid the unnecessary-type-assertion lint rule.
    expect(String(furnitureId(raw))).toBe(String(studentId(raw)));
  });

  it('furnitureId handles empty string', () => {
    expect(furnitureId('')).toBe('');
  });

  it('studentId handles unicode names', () => {
    const id = studentId('学生-001');
    expect(id).toBe('学生-001');
  });
});
