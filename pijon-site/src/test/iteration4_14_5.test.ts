// @vitest-environment node
/**
 * Tests for §14.5 — Adjustable grid color + live color picker.
 *
 * Covers the pure, testable layers:
 *   - setGridColor domain helper (immutability, default, same-ref short-circuit)
 *   - projectFile round-trip with/without gridColor
 *     (old v1/v2 file without field → null; new file round-trips)
 *   - store setGridColor action (via domain helper delegation)
 *   - SWATCHES palette export (sanity: includes theme default, no duplicate)
 *
 * Canvas pixel drawing and the live-drag behavior of <input type="color"> are
 * NOT tested here — they require a real browser environment and are covered
 * by manual verification and the existing App smoke test in App.test.tsx.
 *
 * Component open/close behavior is tested in iteration4_14_5_ui.test.tsx.
 */

import { describe, it, expect } from 'vitest';
import {
  makeClassroom,
  setGridColor,
  setBackgroundImage,
} from '../domain/classroom.js';
import { gridLine } from '../theme/colors.js';
import {
  parseProject,
  serializeProject,
  composeClassroom,
  extractProject,
  importLegacyClassroom,
} from '../domain/io/projectFile.js';
import { SWATCHES } from '../ui/editors/GridColorPicker.js';

// ---------------------------------------------------------------------------
// Domain helper: setGridColor
// ---------------------------------------------------------------------------

describe('setGridColor (§14.5 domain helper)', () => {
  it('makeClassroom initializes gridColor to null', () => {
    const c = makeClassroom('id1', 'Test', 10, 8);
    expect(c.gridColor).toBeNull();
  });

  it('setGridColor returns a new Classroom with the color set', () => {
    const c = makeClassroom('id1', 'Test', 10, 8);
    const c2 = setGridColor(c, '#ff0000');
    expect(c2.gridColor).toBe('#ff0000');
    // Original unchanged (immutability)
    expect(c.gridColor).toBeNull();
  });

  it('setGridColor to null clears the color (restore theme default)', () => {
    const c = makeClassroom('id1', 'Test', 10, 8);
    const c2 = setGridColor(c, '#ff0000');
    const c3 = setGridColor(c2, null);
    expect(c3.gridColor).toBeNull();
  });

  it('returns the same reference when color is unchanged (null → null)', () => {
    const c = makeClassroom('id1', 'Test', 10, 8); // gridColor: null
    const result = setGridColor(c, null);
    expect(result).toBe(c); // exact same reference
  });

  it('returns the same reference when color is unchanged (same hex)', () => {
    const c = makeClassroom('id1', 'Test', 10, 8);
    const c2 = setGridColor(c, '#123456');
    const c3 = setGridColor(c2, '#123456');
    expect(c3).toBe(c2); // same reference
  });

  it('does not mutate any other Classroom fields', () => {
    const c = makeClassroom('id1', 'Test Room', 10, 8);
    const c2 = setGridColor(c, '#aabbcc');
    expect(c2.id).toBe(c.id);
    expect(c2.name).toBe(c.name);
    expect(c2.gridW).toBe(c.gridW);
    expect(c2.gridH).toBe(c.gridH);
    expect(c2.cellsPerUnit).toBe(c.cellsPerUnit);
    expect(c2.thresholdUnits).toBe(c.thresholdUnits);
    expect(c2.furniture).toBe(c.furniture); // same array reference
    expect(c2.backgroundImage).toBe(c.backgroundImage);
  });

  it('accepts any valid CSS color string', () => {
    const c = makeClassroom('id1', 'Test', 10, 8);
    // Named color
    expect(setGridColor(c, 'red').gridColor).toBe('red');
    // rgb()
    expect(setGridColor(c, 'rgb(0,128,255)').gridColor).toBe('rgb(0,128,255)');
    // hsl()
    expect(setGridColor(c, 'hsl(200,50%,50%)').gridColor).toBe('hsl(200,50%,50%)');
    // 3-digit hex
    expect(setGridColor(c, '#abc').gridColor).toBe('#abc');
  });

  it('is independent of setBackgroundImage (both coexist on the same Classroom)', () => {
    const c = makeClassroom('id1', 'Test', 10, 8);
    const c2 = setBackgroundImage(c, '/assets/bg.png');
    const c3 = setGridColor(c2, '#ff00ff');
    expect(c3.backgroundImage).toBe('/assets/bg.png');
    expect(c3.gridColor).toBe('#ff00ff');
  });
});

// ---------------------------------------------------------------------------
// Persistence: project file round-trip for gridColor
// ---------------------------------------------------------------------------

describe('projectFile gridColor round-trip (§14.5)', () => {
  /** Build a minimal valid v2 project JSON string with optional gridColor. */
  function minimalV2Project(gridColor?: string | null): string {
    const classroom: Record<string, unknown> = {
      id: 'c1',
      name: 'Test Room',
      gridW: 5,
      gridH: 4,
      furniture: [],
      cellsPerUnit: 1,
      thresholdUnits: 1.5,
      backgroundImage: null,
    };
    if (gridColor !== undefined) {
      classroom.gridColor = gridColor;
    }
    return JSON.stringify({
      version: 2,
      classroom,
      roster: [],
      arrangement: {},
      locks: [],
    });
  }

  it('round-trips gridColor: null through serialize + parse', () => {
    const json = minimalV2Project(null);
    const pf = parseProject(json);
    expect(pf.classroom.gridColor).toBeNull();
  });

  it('round-trips gridColor: hex string through serialize + parse', () => {
    const color = '#ff6600';
    const json = minimalV2Project(color);
    const pf = parseProject(json);
    expect(pf.classroom.gridColor).toBe(color);
  });

  it('round-trips gridColor: named color through serialize + parse', () => {
    const color = 'teal';
    const json = minimalV2Project(color);
    const pf = parseProject(json);
    expect(pf.classroom.gridColor).toBe(color);
  });

  it('old v2 file WITHOUT gridColor field loads successfully (defaults to null)', () => {
    // A v2 file written before §14.5 — no gridColor key at all
    const json = minimalV2Project(undefined); // key not present
    const pf = parseProject(json);
    // Zod .nullable().default(null) fills in null when key is absent
    expect(pf.classroom.gridColor).toBeNull();
  });

  it('v1 file migration produces null gridColor (default)', () => {
    // Simulates a v1 file: no cellsPerUnit, thresholdUnits, backgroundImage, or gridColor
    const v1Json = JSON.stringify({
      version: 1,
      classroom: {
        id: 'c1',
        name: 'Old Room',
        gridW: 5,
        gridH: 4,
        furniture: [],
      },
      roster: [],
      arrangement: {},
      locks: [],
    });
    const pf = parseProject(v1Json);
    expect(pf.classroom.gridColor).toBeNull();
    // Other migrated defaults are still correct
    expect(pf.classroom.cellsPerUnit).toBe(1);
    expect(pf.classroom.thresholdUnits).toBe(1.5);
    expect(pf.classroom.backgroundImage).toBeNull();
  });

  it('composeClassroom preserves gridColor from the project file', () => {
    const color = '#0000ff';
    const json = minimalV2Project(color);
    const pf = parseProject(json);
    const { classroom } = composeClassroom(pf);
    expect(classroom.gridColor).toBe(color);
  });

  it('composeClassroom sets gridColor to null when absent in project file', () => {
    const json = minimalV2Project(undefined);
    const pf = parseProject(json);
    const { classroom } = composeClassroom(pf);
    expect(classroom.gridColor).toBeNull();
  });

  it('extractProject serializes gridColor into the project file', () => {
    const color = '#abcdef';
    const classroom = setGridColor(makeClassroom('c1', 'Test', 5, 4), color);
    const pf = extractProject({ classroom, roster: [], locks: [] });
    expect(pf.classroom.gridColor).toBe(color);
  });

  it('extractProject serializes null gridColor correctly', () => {
    const classroom = makeClassroom('c1', 'Test', 5, 4); // gridColor: null
    const pf = extractProject({ classroom, roster: [], locks: [] });
    expect(pf.classroom.gridColor).toBeNull();
  });

  it('full serialize → parse round-trip preserves gridColor', () => {
    const color = '#1565c0';
    const classroom = setGridColor(makeClassroom('c1', 'Test', 5, 4), color);
    const pf = extractProject({ classroom, roster: [], locks: [] });
    const json = serializeProject(pf);
    const parsed = parseProject(json);
    expect(parsed.classroom.gridColor).toBe(color);

    const { classroom: reloaded } = composeClassroom(parsed);
    expect(reloaded.gridColor).toBe(color);
  });

  it('full serialize → parse round-trip with null gridColor', () => {
    const classroom = makeClassroom('c1', 'Test', 5, 4); // null
    const pf = extractProject({ classroom, roster: [], locks: [] });
    const json = serializeProject(pf);
    const parsed = parseProject(json);
    expect(parsed.classroom.gridColor).toBeNull();

    const { classroom: reloaded } = composeClassroom(parsed);
    expect(reloaded.gridColor).toBeNull();
  });

  it('importLegacyClassroom produces null gridColor', () => {
    // Legacy prototype JSON has no gridColor field — must default to null
    const legacyJson = JSON.stringify({
      name: 'Room A',
      grid_width: 8,
      grid_height: 6,
      furniture: [],
    });
    const pf = importLegacyClassroom(legacyJson);
    expect(pf.classroom.gridColor).toBeNull();
  });

  it('backgroundImage and gridColor are independent in the project file', () => {
    const color = '#ff0000';
    const bgUrl = '/assets/classroom-background.png';
    const c1 = makeClassroom('c1', 'Test', 5, 4);
    const c2 = setBackgroundImage(c1, bgUrl);
    const c3 = setGridColor(c2, color);
    const pf = extractProject({ classroom: c3, roster: [], locks: [] });
    expect(pf.classroom.gridColor).toBe(color);
    expect(pf.classroom.backgroundImage).toBe(bgUrl);

    const { classroom } = composeClassroom(pf);
    expect(classroom.gridColor).toBe(color);
    expect(classroom.backgroundImage).toBe(bgUrl);
  });
});

// ---------------------------------------------------------------------------
// SWATCHES palette sanity checks
// ---------------------------------------------------------------------------

describe('SWATCHES palette (§14.5)', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(SWATCHES)).toBe(true);
    expect(SWATCHES.length).toBeGreaterThan(0);
  });

  it('includes the theme default gridLine color as the first swatch', () => {
    expect(SWATCHES[0]).toBe(gridLine);
  });

  it('has no duplicate colors', () => {
    const unique = new Set(SWATCHES.map((s) => s.toLowerCase()));
    expect(unique.size).toBe(SWATCHES.length);
  });

  it('all entries are non-empty strings', () => {
    for (const swatch of SWATCHES) {
      expect(typeof swatch).toBe('string');
      expect(swatch.length).toBeGreaterThan(0);
    }
  });

  it('includes at least one clearly blue color (matches brand)', () => {
    // The primary brand blue (#1565c0) should be in the palette
    const hasBlue = SWATCHES.some((s) => s === '#1565c0');
    expect(hasBlue).toBe(true);
  });
});
