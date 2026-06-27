// @vitest-environment node
/**
 * 8.D2 — Unit tests for the newly exported fillForFurnitureKind and
 * strokeForFurnitureKind helpers in render.ts.
 *
 * These helpers were previously private (fillForFurniture / strokeForFurniture)
 * and duplicated in FurnitureEditor.tsx as kindFillColor / kindStrokeColor.
 * After the 8.D2 refactor they live once in render.ts and are shared.
 *
 * Tests verify:
 *   - Each FurnitureKind maps to a non-empty CSS colour string.
 *   - The mapping is consistent with the colour tokens in colors.ts.
 *   - Fixture kinds (teacher_desk, whiteboard, custom) use the fixture stroke token.
 *   - Desk kinds (single_desk, table) use the standard stroke token.
 */

import { describe, it, expect } from 'vitest';
import { fillForFurnitureKind, strokeForFurnitureKind } from '../ui/canvas/render.js';
import {
  furnitureFillSingleDesk,
  furnitureFillTable,
  furnitureFillTeacherDesk,
  furnitureFillWhiteboard,
  furnitureStroke,
  furnitureStrokeFixture,
} from '../theme/colors.js';
import type { FurnitureKind } from '../domain/types.js';

const ALL_KINDS: FurnitureKind[] = [
  'single_desk',
  'table',
  'teacher_desk',
  'whiteboard',
  'custom',
];

describe('fillForFurnitureKind', () => {
  it('returns a non-empty string for every kind', () => {
    for (const kind of ALL_KINDS) {
      const result = fillForFurnitureKind(kind);
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('maps single_desk to furnitureFillSingleDesk', () => {
    expect(fillForFurnitureKind('single_desk')).toBe(furnitureFillSingleDesk);
  });

  it('maps table to furnitureFillTable', () => {
    expect(fillForFurnitureKind('table')).toBe(furnitureFillTable);
  });

  it('maps teacher_desk to furnitureFillTeacherDesk', () => {
    expect(fillForFurnitureKind('teacher_desk')).toBe(furnitureFillTeacherDesk);
  });

  it('maps whiteboard to furnitureFillWhiteboard', () => {
    expect(fillForFurnitureKind('whiteboard')).toBe(furnitureFillWhiteboard);
  });

  it('maps custom to the neutral whiteboard fallback', () => {
    // custom has no dedicated fill token — uses whiteboard as a neutral fallback
    expect(fillForFurnitureKind('custom')).toBe(furnitureFillWhiteboard);
  });
});

describe('strokeForFurnitureKind', () => {
  it('returns a non-empty string for every kind', () => {
    for (const kind of ALL_KINDS) {
      const result = strokeForFurnitureKind(kind);
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('desk kinds use the standard stroke token', () => {
    expect(strokeForFurnitureKind('single_desk')).toBe(furnitureStroke);
    expect(strokeForFurnitureKind('table')).toBe(furnitureStroke);
  });

  it('fixture kinds use the fixture stroke token', () => {
    expect(strokeForFurnitureKind('teacher_desk')).toBe(furnitureStrokeFixture);
    expect(strokeForFurnitureKind('whiteboard')).toBe(furnitureStrokeFixture);
    expect(strokeForFurnitureKind('custom')).toBe(furnitureStrokeFixture);
  });
});
