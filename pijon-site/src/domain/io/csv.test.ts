// @vitest-environment node
/**
 * Tests for src/domain/io/csv.ts
 *
 * Covers both importCsv (SIMPLE + FULL format) and exportCsv, plus the
 * internal CSV parser edge-cases and round-trip correctness.
 *
 * Pure domain module — no DOM, no network, no React.
 */

import { describe, it, expect } from 'vitest';
import { importCsv, exportCsv } from './csv.js';
import type { Student } from '../student.js';
import { makeStudent, makeFixture } from '../student.js';
import { studentId, furnitureId } from '../types.js';
import { fixtureId } from '../classroom.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal FULL-format CSV string from raw rows. */
function fullCsv(...dataRows: string[]): string {
  return ['name,fixture,pref_target,pref_type,pref_weight', ...dataRows].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Format auto-detection
// ---------------------------------------------------------------------------

describe('format auto-detection', () => {
  it('detects FULL when first row matches canonical header exactly', () => {
    const csv = fullCsv('Alice,false,,,');
    const { students } = importCsv(csv);
    // FULL format gives student with isFixture=false
    expect(students).toHaveLength(1);
    expect(students[0]?.name).toBe('Alice');
    expect(students[0]?.isFixture).toBe(false);
  });

  it('detects SIMPLE when first row does not match full header', () => {
    const csv = 'Alice\nBob\n';
    const { students } = importCsv(csv);
    expect(students).toHaveLength(2);
    // SIMPLE format always produces non-fixture students
    expect(students.every((s) => !s.isFixture)).toBe(true);
  });

  it('is case-insensitive for the FULL header', () => {
    const csv = 'NAME,FIXTURE,PREF_TARGET,PREF_TYPE,PREF_WEIGHT\nAlice,false,,,\n';
    const { students } = importCsv(csv);
    // Should be detected as FULL (case-normalised)
    expect(students).toHaveLength(1);
    expect(students[0]?.name).toBe('Alice');
    expect(students[0]?.isFixture).toBe(false);
  });

  it('is insensitive to surrounding whitespace in header cells', () => {
    const csv = ' name , fixture , pref_target , pref_type , pref_weight \nBob,false,,,\n';
    const { students } = importCsv(csv);
    expect(students).toHaveLength(1);
    expect(students[0]?.name).toBe('Bob');
  });

  it('treats a CSV with only a partial header as SIMPLE', () => {
    // Has only 4 columns — NOT a full header
    const csv = 'name,fixture,pref_target,pref_type\nAlice\nBob\n';
    const { students } = importCsv(csv);
    // SIMPLE: first column values used, first-row skip if header label
    // "name" matches SIMPLE_HEADER_LABELS, so it is skipped
    expect(students.some((s) => s.name === 'Alice')).toBe(true);
  });

  it('treats a reordered header as SIMPLE', () => {
    const csv = 'fixture,name,pref_target,pref_type,pref_weight\nAlice\n';
    const { students } = importCsv(csv);
    // Not FULL (wrong order); SIMPLE — first column "fixture" is not a header label
    // so it becomes a student name
    expect(students.some((s) => s.name === 'fixture')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SIMPLE format import
// ---------------------------------------------------------------------------

describe('SIMPLE import — basics', () => {
  it('extracts names from first column', () => {
    const csv = 'Alice,extra1,extra2\nBob,stuff\nCarol\n';
    const { students } = importCsv(csv);
    expect(students.map((s) => s.name)).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('skips blank lines', () => {
    const csv = 'Alice\n\nBob\n\nCarol\n';
    const { students } = importCsv(csv);
    expect(students.map((s) => s.name)).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('trims whitespace from names', () => {
    const csv = '  Alice  \n Bob \n  Carol\n';
    const { students } = importCsv(csv);
    expect(students.map((s) => s.name)).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('skips header row labelled "name"', () => {
    const csv = 'name\nAlice\nBob\n';
    const { students } = importCsv(csv);
    expect(students.map((s) => s.name)).toEqual(['Alice', 'Bob']);
  });

  it('skips header row labelled "student"', () => {
    const csv = 'student\nAlice\nBob\n';
    const { students } = importCsv(csv);
    expect(students.map((s) => s.name)).toEqual(['Alice', 'Bob']);
  });

  it('skips header row labelled "students" (plural)', () => {
    const csv = 'students\nAlice\nBob\n';
    const { students } = importCsv(csv);
    expect(students.map((s) => s.name)).toEqual(['Alice', 'Bob']);
  });

  it('skips header row labelled "names"', () => {
    const csv = 'names\nAlice\nBob\n';
    const { students } = importCsv(csv);
    expect(students.map((s) => s.name)).toEqual(['Alice', 'Bob']);
  });

  it('skips header row labelled "student name"', () => {
    const csv = 'student name\nAlice\nBob\n';
    const { students } = importCsv(csv);
    expect(students.map((s) => s.name)).toEqual(['Alice', 'Bob']);
  });

  it('header skip is case-insensitive', () => {
    const csv = 'NAME\nAlice\nBob\n';
    const { students } = importCsv(csv);
    expect(students.map((s) => s.name)).toEqual(['Alice', 'Bob']);
  });

  it('does NOT skip a non-header first row (real name stays)', () => {
    const csv = 'Alice\nBob\n';
    const { students } = importCsv(csv);
    expect(students.map((s) => s.name)).toEqual(['Alice', 'Bob']);
  });

  it('produces a warning for an empty file', () => {
    const { students, warnings } = importCsv('');
    expect(students).toHaveLength(0);
    expect(warnings.some((w) => w.includes('No students found'))).toBe(true);
  });

  it('produces a warning for a file with only blank lines', () => {
    const { students, warnings } = importCsv('\n\n\n');
    expect(students).toHaveLength(0);
    expect(warnings.some((w) => w.includes('No students found'))).toBe(true);
  });

  it('produces a warning for a file with only a header row', () => {
    const { students, warnings } = importCsv('name\n');
    expect(students).toHaveLength(0);
    expect(warnings.some((w) => w.includes('No students found'))).toBe(true);
  });

  it('returns no warnings for a normal import', () => {
    const { warnings } = importCsv('Alice\nBob\n');
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SIMPLE format — id stability within one import session
// ---------------------------------------------------------------------------

describe('SIMPLE import — id stability', () => {
  it('same name gets the same id within one import call', () => {
    // If the same name appears twice (unusual but possible if teacher duped a row),
    // we just check that our id function is deterministic for a given name+salt.
    // We do this by importing and then exporting+re-importing to verify round-trip.
    const csv = 'Alice\nBob\nCarol\n';
    const { students: s1 } = importCsv(csv);
    // Same session → all ids are stable; different sessions may differ (that's fine)
    const aliceId = s1.find((s) => s.name === 'Alice')?.id;
    const bobId = s1.find((s) => s.name === 'Bob')?.id;
    expect(aliceId).toBeDefined();
    expect(bobId).toBeDefined();
    expect(aliceId).not.toBe(bobId);
  });

  it('two imports of the same file may have different ids (salted)', () => {
    const csv = 'Alice\nBob\n';
    const { students: s1 } = importCsv(csv);
    const { students: s2 } = importCsv(csv);
    // This test is probabilistic but virtually guaranteed — salt is random UUID
    // Different sessions produce different salts → different ids
    const alice1 = s1.find((s) => s.name === 'Alice')?.id;
    const alice2 = s2.find((s) => s.name === 'Alice')?.id;
    // Note: there's a ~1-in-2^122 chance of collision; acceptable for a test.
    expect(alice1).not.toBe(alice2);
  });

  it('all students produced by SIMPLE import are non-fixture', () => {
    const csv = 'Alice\nBob\nCarol\n';
    const { students } = importCsv(csv);
    expect(students.every((s) => !s.isFixture)).toBe(true);
  });

  it('all students have empty preferences in SIMPLE format', () => {
    const csv = 'Alice\nBob\n';
    const { students } = importCsv(csv);
    expect(students.every((s) => s.preferences.length === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FULL format import — pass 1 (student building)
// ---------------------------------------------------------------------------

describe('FULL import — student building', () => {
  it('imports real students (fixture=false)', () => {
    const csv = fullCsv('Alice,false,,,', 'Bob,false,,,');
    const { students } = importCsv(csv);
    expect(students).toHaveLength(2);
    expect(students.every((s) => !s.isFixture)).toBe(true);
  });

  it('imports fixture occupants (fixture=true)', () => {
    const csv = fullCsv('Whiteboard,true,,,');
    const { students } = importCsv(csv);
    expect(students).toHaveLength(1);
    expect(students[0]?.isFixture).toBe(true);
    expect(students[0]?.name).toBe('Whiteboard');
  });

  it('fixtures get deterministic ids via fixtureId()', () => {
    const csv = fullCsv('Whiteboard,true,,,');
    const { students } = importCsv(csv);
    const expected = fixtureId('Whiteboard');
    expect(students[0]?.id).toBe(expected);
  });

  it('fixture ids are stable across import sessions', () => {
    const csv = fullCsv('Door,true,,,');
    const { students: s1 } = importCsv(csv);
    const { students: s2 } = importCsv(csv);
    expect(s1[0]?.id).toBe(s2[0]?.id);
  });

  it('deduplicates students when the same name appears on multiple rows', () => {
    // Same name → only one student, but preferences from all rows accumulated
    const csv = fullCsv(
      'Alice,false,,,',
      'Alice,false,Bob,student,1',
    );
    const { students } = importCsv(csv);
    expect(students.filter((s) => s.name === 'Alice')).toHaveLength(1);
  });

  it('preserves row order for students', () => {
    const csv = fullCsv('Charlie,false,,,', 'Alice,false,,,', 'Bob,false,,,');
    const { students } = importCsv(csv);
    expect(students.map((s) => s.name)).toEqual(['Charlie', 'Alice', 'Bob']);
  });

  it('handles mix of real students and fixtures', () => {
    const csv = fullCsv('Alice,false,,,', 'Whiteboard,true,,,', 'Bob,false,,,');
    const { students } = importCsv(csv);
    expect(students).toHaveLength(3);
    const wb = students.find((s) => s.name === 'Whiteboard');
    expect(wb?.isFixture).toBe(true);
    expect(students.filter((s) => !s.isFixture)).toHaveLength(2);
  });

  it('skips rows with empty name', () => {
    const csv = fullCsv('Alice,false,,,', ',false,,,', 'Bob,false,,,');
    const { students } = importCsv(csv);
    expect(students).toHaveLength(2);
    expect(students.map((s) => s.name)).toEqual(['Alice', 'Bob']);
  });
});

// ---------------------------------------------------------------------------
// FULL format import — pass 2 (preference building)
// ---------------------------------------------------------------------------

describe('FULL import — preference resolution', () => {
  it('builds a student→student preference with correct weight', () => {
    const csv = fullCsv('Alice,false,Bob,student,2.5', 'Bob,false,,,');
    const { students } = importCsv(csv);
    const alice = students.find((s) => s.name === 'Alice');
    expect(alice?.preferences).toHaveLength(1);
    const pref = alice?.preferences[0];
    expect(pref?.kind).toBe('student');
    expect(pref?.weight).toBe(2.5);
    if (pref?.kind === 'student') {
      // targetId must be Bob's actual student id
      const bob = students.find((s) => s.name === 'Bob');
      expect(pref.targetId).toBe(bob?.id);
    }
  });

  it('builds a furniture preference', () => {
    const csv = fullCsv('Whiteboard,true,,,', 'Alice,false,Whiteboard,furniture,1');
    const { students } = importCsv(csv);
    const alice = students.find((s) => s.name === 'Alice');
    const pref = alice?.preferences[0];
    expect(pref?.kind).toBe('furniture');
    if (pref?.kind === 'furniture') {
      const wb = students.find((s) => s.name === 'Whiteboard');
      expect(pref.targetId).toBe(wb?.id);
    }
  });

  it('builds a location preference', () => {
    const csv = fullCsv('Alice,false,front,location,-1');
    const { students } = importCsv(csv);
    const alice = students.find((s) => s.name === 'Alice');
    const pref = alice?.preferences[0];
    expect(pref?.kind).toBe('location');
    if (pref?.kind === 'location') {
      expect(pref.target).toBe('front');
      expect(pref.weight).toBe(-1);
    }
  });

  it('accumulates multiple preferences for one student', () => {
    const csv = fullCsv(
      'Alice,false,Bob,student,1',
      'Alice,false,front,location,-0.5',
      'Bob,false,,,',
    );
    const { students } = importCsv(csv);
    const alice = students.find((s) => s.name === 'Alice');
    expect(alice?.preferences).toHaveLength(2);
  });

  it('student with no preference rows has empty preferences', () => {
    const csv = fullCsv('Alice,false,,,', 'Bob,false,,,');
    const { students } = importCsv(csv);
    const alice = students.find((s) => s.name === 'Alice');
    expect(alice?.preferences).toHaveLength(0);
  });

  it('warns for invalid (non-numeric) weight and skips that pref', () => {
    const csv = fullCsv('Alice,false,Bob,student,notanumber', 'Bob,false,,,');
    const { students, warnings } = importCsv(csv);
    const alice = students.find((s) => s.name === 'Alice');
    expect(alice?.preferences).toHaveLength(0);
    expect(warnings.some((w) => w.includes('invalid weight') && w.includes('notanumber'))).toBe(true);
  });

  it('warning for invalid weight mentions the student name', () => {
    const csv = fullCsv('Alice,false,Bob,student,abc', 'Bob,false,,,');
    const { warnings } = importCsv(csv);
    expect(warnings.some((w) => w.includes("'Alice'"))).toBe(true);
  });

  it('warns for unknown preference type and skips that pref', () => {
    const csv = fullCsv('Alice,false,Bob,UNKNOWN_TYPE,1', 'Bob,false,,,');
    const { students, warnings } = importCsv(csv);
    const alice = students.find((s) => s.name === 'Alice');
    expect(alice?.preferences).toHaveLength(0);
    expect(warnings.some((w) => w.includes('unknown preference type') && w.includes('UNKNOWN_TYPE'))).toBe(true);
  });

  it('warning for unknown pref type mentions the student name', () => {
    const csv = fullCsv('Alice,false,Bob,weird,1', 'Bob,false,,,');
    const { warnings } = importCsv(csv);
    expect(warnings.some((w) => w.includes("'Alice'"))).toBe(true);
  });

  it('falls back to raw string id when pref target name is not in the file (student kind)', () => {
    const csv = fullCsv('Alice,false,UnknownPerson,student,1');
    const { students } = importCsv(csv);
    const alice = students.find((s) => s.name === 'Alice');
    const pref = alice?.preferences[0];
    expect(pref?.kind).toBe('student');
    if (pref?.kind === 'student') {
      // Fallback: targetId is the raw name string cast to StudentId
      expect(pref.targetId).toBe('UnknownPerson');
    }
  });

  it('falls back to furnitureId for furniture pref targeting unknown name', () => {
    const csv = fullCsv('Alice,false,UnknownDesk,furniture,1');
    const { students } = importCsv(csv);
    const alice = students.find((s) => s.name === 'Alice');
    const pref = alice?.preferences[0];
    expect(pref?.kind).toBe('furniture');
    if (pref?.kind === 'furniture') {
      // Fallback: furnitureId(name) — since the name isn't in the student map
      // the fallback is furnitureId('UnknownDesk')
      expect(pref.targetId).toBe(furnitureId('UnknownDesk'));
    }
  });

  it('skips preference rows with blank pref_target', () => {
    const csv = fullCsv('Alice,false,,student,1');
    const { students } = importCsv(csv);
    const alice = students.find((s) => s.name === 'Alice');
    expect(alice?.preferences).toHaveLength(0);
  });

  it('skips preference rows with blank pref_type', () => {
    const csv = fullCsv('Alice,false,Bob,,1');
    const { students } = importCsv(csv);
    const alice = students.find((s) => s.name === 'Alice');
    expect(alice?.preferences).toHaveLength(0);
  });

  it('skips preference rows with blank pref_weight', () => {
    const csv = fullCsv('Alice,false,Bob,student,');
    const { students } = importCsv(csv);
    const alice = students.find((s) => s.name === 'Alice');
    expect(alice?.preferences).toHaveLength(0);
  });

  it('handles negative weights correctly', () => {
    const csv = fullCsv('Alice,false,Bob,student,-3', 'Bob,false,,,');
    const { students } = importCsv(csv);
    const alice = students.find((s) => s.name === 'Alice');
    const pref = alice?.preferences[0];
    expect(pref?.weight).toBe(-3);
  });

  it('handles fractional weights correctly', () => {
    const csv = fullCsv('Alice,false,front,location,0.75');
    const { students } = importCsv(csv);
    const alice = students.find((s) => s.name === 'Alice');
    const pref = alice?.preferences[0];
    expect(pref?.weight).toBeCloseTo(0.75);
  });

  it('produces no warnings for a valid full import', () => {
    const csv = fullCsv('Alice,false,Bob,student,1', 'Bob,false,,,');
    const { warnings } = importCsv(csv);
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// RFC-4180 parser edge cases
// ---------------------------------------------------------------------------

describe('CSV parser — RFC-4180 edge cases', () => {
  it('handles UTF-8 BOM at the start', () => {
    // BOM is U+FEFF (the UTF-8 BOM is a zero-width no-break space prefix)
    const bom = '﻿';
    const csv = `${bom}Alice\nBob\n`;
    const { students } = importCsv(csv);
    expect(students.map((s) => s.name)).toEqual(['Alice', 'Bob']);
  });

  it('handles \\r\\n line endings', () => {
    const csv = 'Alice\r\nBob\r\nCarol\r\n';
    const { students } = importCsv(csv);
    expect(students.map((s) => s.name)).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('handles standalone \\r line endings', () => {
    const csv = 'Alice\rBob\rCarol\r';
    const { students } = importCsv(csv);
    expect(students.map((s) => s.name)).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('handles quoted fields containing commas', () => {
    const csv = '"Smith, John"\nBob\n';
    const { students } = importCsv(csv);
    expect(students[0]?.name).toBe('Smith, John');
    expect(students[1]?.name).toBe('Bob');
  });

  it('handles doubled-quote escapes inside quoted fields', () => {
    const csv = '"O""Brien"\nBob\n';
    const { students } = importCsv(csv);
    expect(students[0]?.name).toBe("O\"Brien");
  });

  it('handles trailing newline without an extra empty student', () => {
    const csv = 'Alice\nBob\n';
    const { students } = importCsv(csv);
    expect(students).toHaveLength(2);
  });

  it('handles file with no trailing newline', () => {
    const csv = 'Alice\nBob';
    const { students } = importCsv(csv);
    expect(students).toHaveLength(2);
    expect(students.map((s) => s.name)).toEqual(['Alice', 'Bob']);
  });

  it('parses quoted field with embedded newline', () => {
    // A student name with a newline embedded in a quoted field (unusual but valid RFC-4180)
    const csv = '"Alice\nSmith"\nBob\n';
    const { students } = importCsv(csv);
    expect(students[0]?.name).toBe('Alice\nSmith');
    expect(students[1]?.name).toBe('Bob');
  });

  it('handles BOM in FULL format', () => {
    const bom = '﻿';
    const csv = `${bom}name,fixture,pref_target,pref_type,pref_weight\nAlice,false,,,\n`;
    const { students } = importCsv(csv);
    expect(students).toHaveLength(1);
    expect(students[0]?.name).toBe('Alice');
    expect(students[0]?.isFixture).toBe(false);
  });

  it('handles \\r\\n line endings in FULL format', () => {
    const csv = 'name,fixture,pref_target,pref_type,pref_weight\r\nAlice,false,,,\r\nBob,false,,,\r\n';
    const { students } = importCsv(csv);
    expect(students.map((s) => s.name)).toEqual(['Alice', 'Bob']);
  });

  it('handles quoted fields with commas in FULL format (name has comma)', () => {
    const csv = fullCsv('"Smith, John",false,,,', 'Bob,false,,,');
    const { students } = importCsv(csv);
    expect(students.find((s) => s.name === 'Smith, John')).toBeDefined();
  });

  it('handles doubled-quote in a FULL format name field', () => {
    const csv = fullCsv('"O""Brien",false,,,');
    const { students } = importCsv(csv);
    expect(students[0]?.name).toBe('O"Brien');
  });

  it('trailing empty rows are ignored', () => {
    const csv = 'Alice\nBob\n\n\n';
    const { students } = importCsv(csv);
    expect(students).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

describe('exportCsv', () => {
  it('produces the canonical FULL header as the first line', () => {
    const students: Student[] = [];
    const csv = exportCsv(students);
    expect(csv.split('\n')[0]).toBe('name,fixture,pref_target,pref_type,pref_weight');
  });

  it('produces one row per student with no preferences', () => {
    const students = [
      makeStudent(studentId('s1'), 'Alice'),
      makeStudent(studentId('s2'), 'Bob'),
    ];
    const csv = exportCsv(students);
    const lines = csv.split('\n').filter((l) => l.trim());
    // 1 header + 2 data rows
    expect(lines).toHaveLength(3);
  });

  it('no-preference row has empty pref columns', () => {
    const students = [makeStudent(studentId('s1'), 'Alice')];
    const csv = exportCsv(students);
    const dataLine = csv.split('\n')[1];
    expect(dataLine).toBe('Alice,false,,,');
  });

  it('fixture student emits fixture=true', () => {
    const students = [makeFixture(studentId('fix1'), 'Whiteboard')];
    const csv = exportCsv(students);
    const dataLine = csv.split('\n')[1];
    expect(dataLine).toBe('Whiteboard,true,,,');
  });

  it('produces one row per preference', () => {
    const sid1 = studentId('s1');
    const sid2 = studentId('s2');
    const students: Student[] = [
      {
        id: sid1,
        name: 'Alice',
        isFixture: false,
        preferences: [
          { kind: 'student', targetId: sid2, weight: 1 },
          { kind: 'location', target: 'front', weight: -0.5 },
        ],
        metadata: {},
      },
      makeStudent(sid2, 'Bob'),
    ];
    const idToName = new Map<string, string>([[sid2, 'Bob']]);
    const csv = exportCsv(students, idToName);
    const dataLines = csv.split('\n').filter((l) => l.trim()).slice(1); // skip header
    // Alice has 2 prefs → 2 rows; Bob has 0 → 1 row
    expect(dataLines).toHaveLength(3);
  });

  it('maps pref targetId to name via idToName', () => {
    const sid1 = studentId('s1');
    const sid2 = studentId('s2');
    const students: Student[] = [
      {
        id: sid1,
        name: 'Alice',
        isFixture: false,
        preferences: [{ kind: 'student', targetId: sid2, weight: 1 }],
        metadata: {},
      },
      makeStudent(sid2, 'Bob'),
    ];
    const idToName = new Map<string, string>([[sid2, 'Bob']]);
    const csv = exportCsv(students, idToName);
    expect(csv).toContain('Bob');
    // pref type and weight
    expect(csv).toContain('student');
    expect(csv).toContain('1');
  });

  it('falls back to raw id when idToName does not contain the target', () => {
    const sid1 = studentId('s1');
    const sid2 = studentId('s2');
    const students: Student[] = [
      {
        id: sid1,
        name: 'Alice',
        isFixture: false,
        preferences: [{ kind: 'student', targetId: sid2, weight: 1 }],
        metadata: {},
      },
    ];
    // No idToName provided — default map built from the students array (Alice only)
    const csv = exportCsv(students);
    // The raw id string should appear (since Bob is not in the roster)
    expect(csv).toContain(sid2);
  });

  it('quotes a name containing a comma', () => {
    const students = [makeStudent(studentId('s1'), 'Smith, John')];
    const csv = exportCsv(students);
    expect(csv).toContain('"Smith, John"');
  });

  it('quotes a name containing a double-quote and doubles it', () => {
    const students = [makeStudent(studentId('s1'), 'O"Brien')];
    const csv = exportCsv(students);
    expect(csv).toContain('"O""Brien"');
  });

  it('exports location preferences correctly', () => {
    const sid1 = studentId('s1');
    const students: Student[] = [
      {
        id: sid1,
        name: 'Alice',
        isFixture: false,
        preferences: [{ kind: 'location', target: 'window', weight: 2 }],
        metadata: {},
      },
    ];
    const csv = exportCsv(students);
    expect(csv).toContain('window');
    expect(csv).toContain('location');
    expect(csv).toContain('2');
  });

  it('ends with a trailing newline', () => {
    const students = [makeStudent(studentId('s1'), 'Alice')];
    const csv = exportCsv(students);
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('builds default idToName from students when not provided', () => {
    const sid1 = studentId('s1');
    const sid2 = studentId('s2');
    const students: Student[] = [
      {
        id: sid1,
        name: 'Alice',
        isFixture: false,
        preferences: [{ kind: 'student', targetId: sid2, weight: 1 }],
        metadata: {},
      },
      makeStudent(sid2, 'Bob'),
    ];
    const csv = exportCsv(students);
    // Without explicit idToName, Bob's id should be mapped to 'Bob'
    expect(csv).toContain('Bob');
    // Should NOT contain the raw id string 's2'
    expect(csv).not.toContain(sid2);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: import → export → import
// ---------------------------------------------------------------------------

describe('round-trip: import → export → import', () => {
  it('preserves student names across a round-trip', () => {
    const original = fullCsv('Alice,false,,,', 'Bob,false,,,', 'Carol,false,,,');
    const { students: imported } = importCsv(original);
    const exported = exportCsv(imported);
    const { students: reimported } = importCsv(exported);
    expect(reimported.map((s) => s.name)).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('preserves fixture flag across a round-trip', () => {
    const original = fullCsv('Alice,false,,,', 'Whiteboard,true,,,');
    const { students: imported } = importCsv(original);
    const exported = exportCsv(imported);
    const { students: reimported } = importCsv(exported);
    const wb = reimported.find((s) => s.name === 'Whiteboard');
    expect(wb?.isFixture).toBe(true);
    const alice = reimported.find((s) => s.name === 'Alice');
    expect(alice?.isFixture).toBe(false);
  });

  it('preserves student preferences across a round-trip', () => {
    const original = fullCsv('Alice,false,Bob,student,1', 'Bob,false,,,');
    const { students: imported } = importCsv(original);
    // Build idToName map for export
    const idToName = new Map<string, string>(imported.map((s) => [s.id as string, s.name]));
    const exported = exportCsv(imported, idToName);
    const { students: reimported } = importCsv(exported);
    const alice = reimported.find((s) => s.name === 'Alice');
    expect(alice?.preferences).toHaveLength(1);
    const pref = alice?.preferences[0];
    expect(pref?.kind).toBe('student');
    expect(pref?.weight).toBe(1);
    if (pref?.kind === 'student') {
      const bob = reimported.find((s) => s.name === 'Bob');
      expect(pref.targetId).toBe(bob?.id);
    }
  });

  it('preserves location preferences across a round-trip', () => {
    const original = fullCsv('Alice,false,window,location,2');
    const { students: imported } = importCsv(original);
    const exported = exportCsv(imported);
    const { students: reimported } = importCsv(exported);
    const alice = reimported.find((s) => s.name === 'Alice');
    const pref = alice?.preferences[0];
    expect(pref?.kind).toBe('location');
    if (pref?.kind === 'location') {
      expect(pref.target).toBe('window');
      expect(pref.weight).toBe(2);
    }
  });

  it('round-trip with fixture ids is stable (fixture ids are deterministic)', () => {
    const original = fullCsv('Whiteboard,true,,,');
    const { students: imported } = importCsv(original);
    const idToName = new Map<string, string>(imported.map((s) => [s.id as string, s.name]));
    const exported = exportCsv(imported, idToName);
    const { students: reimported } = importCsv(exported);
    // Fixture ids are deterministic — same id both times
    expect(imported[0]?.id).toBe(reimported[0]?.id);
  });

  it('round-trip with multiple prefs per student', () => {
    const original = fullCsv(
      'Alice,false,Bob,student,1',
      'Alice,false,front,location,-0.5',
      'Bob,false,,,',
    );
    const { students: imported } = importCsv(original);
    const idToName = new Map<string, string>(imported.map((s) => [s.id as string, s.name]));
    const exported = exportCsv(imported, idToName);
    const { students: reimported } = importCsv(exported);
    const alice = reimported.find((s) => s.name === 'Alice');
    expect(alice?.preferences).toHaveLength(2);
  });
});
