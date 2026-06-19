/**
 * CSV import and export for Pijon rosters.
 *
 * Port of pijon-app/src/io/csv_handler.py (StudentImporter + StudentExporter).
 *
 * Two formats are supported:
 *
 *   SIMPLE format — any CSV whose first row is NOT the canonical full header.
 *     Only the first column is used (student names). A header row is stripped
 *     when the first cell matches common header labels ('name', 'student', …).
 *     Students are given random UUIDs (stable within an import session via
 *     a per-call salt, mirroring Python's secrets.token_hex salt approach).
 *
 *   FULL format — first row is exactly: name,fixture,pref_target,pref_type,pref_weight
 *     Students and fixtures are rebuilt, and preferences are re-resolved from
 *     target names back to StudentIds. Fixtures get deterministic ids via
 *     fixtureId(name) (port of csv_handler.fixture_id).
 *
 * Warnings (non-fatal) are returned alongside the student list so the UI can
 * surface them — mirroring the Python self.warnings list.
 *
 * Dependency-free CSV mini-parser instead of papaparse:
 *   - The input is always an in-memory string (no streaming, no file handles).
 *   - Pijon's CSVs are teacher-generated, RFC 4180-compliant, and small (≤ a few
 *     hundred rows). A tiny parser is simpler, keeps the bundle smaller, and
 *     avoids an extra dependency for a one-feature use case.
 *   - If edge cases arise (unusual quoting, UTF-8 BOM, etc.) we can swap in
 *     papaparse later with zero API surface change — the importer/exporter
 *     boundary is just string in / Student[] out.
 *
 * No React/DOM imports. No network calls.
 */

import type { Student } from '../student.js';
import type { Preference } from '../preference.js';
import type { StudentId } from '../types.js';
import { makeStudent, makeFixture } from '../student.js';
import { studentId, furnitureId } from '../types.js';
import { fixtureId } from '../classroom.js';

// ---------------------------------------------------------------------------
// Constants (mirrors Python FULL_FORMAT_HEADER)
// ---------------------------------------------------------------------------

const FULL_HEADER = ['name', 'fixture', 'pref_target', 'pref_type', 'pref_weight'] as const;

/**
 * Header label values recognised as "this row is a header, skip it" in simple
 * format — port of csv_handler.parse_csv's guard list.
 */
const SIMPLE_HEADER_LABELS = new Set(['name', 'student', 'student name', 'students', 'names']);

// ---------------------------------------------------------------------------
// Import result
// ---------------------------------------------------------------------------

export interface ImportResult {
  /** The imported students (real + fixture). Order matches CSV row order. */
  readonly students: readonly Student[];
  /**
   * Non-fatal warnings collected during import (invalid weight, unknown pref
   * type, empty file, …). Mirror of Python's self.warnings list.
   */
  readonly warnings: readonly string[];
}

// ---------------------------------------------------------------------------
// Tiny dependency-free CSV parser
// ---------------------------------------------------------------------------

/**
 * Parse a CSV string into rows of string arrays.
 * Handles:
 *   - Quoted fields (double-quote RFC 4180, including embedded commas/newlines)
 *   - Doubled quotes inside quoted fields ("")
 *   - Both \r\n and \n line endings
 *   - UTF-8 BOM (strips it silently)
 *
 * Returns an array of rows; each row is an array of raw string field values.
 * Empty trailing rows are omitted.
 */
function parseCsvString(csv: string): string[][] {
  // Strip BOM if present
  const input = csv.startsWith('﻿') ? csv.slice(1) : csv;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    // noUncheckedIndexedAccess: i is always < input.length here, so ch is never
    // actually undefined. The ?? '' guard satisfies the compiler without a cast.
    const ch = input[i] ?? '';

    if (inQuotes) {
      if (ch === '"') {
        // Peek ahead: doubled-quote escape?
        if ((input[i + 1] ?? '') === '"') {
          field += '"';
          i += 2;
          continue;
        }
        // Closing quote
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    // Outside quotes
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      // Handle \r\n as a single newline
      if (ch === '\r' && (input[i + 1] ?? '') === '\n') {
        i++;
      }
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // Flush the last field/row (no trailing newline)
  if (row.length > 0 || field.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop completely empty trailing rows
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last === undefined || last.every((c) => c.trim() === '')) {
      rows.pop();
    } else {
      break;
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/**
 * Auto-detect whether a CSV string is SIMPLE or FULL format.
 * FULL if and only if the first non-empty row is exactly the canonical header.
 */
function detectFormat(rows: string[][]): 'simple' | 'full' {
  const firstRow = rows[0];
  if (firstRow === undefined || firstRow.length === 0) return 'simple';
  const normalised = firstRow.map((c) => c.trim().toLowerCase());
  if (normalised.length === FULL_HEADER.length && normalised.every((v, i) => v === FULL_HEADER[i])) {
    return 'full';
  }
  return 'simple';
}

// ---------------------------------------------------------------------------
// ID generation helpers
// ---------------------------------------------------------------------------

/**
 * Generate a random salt for an import session (mirrors Python secrets.token_hex(16)).
 * Uses crypto.randomUUID() which is available in modern browsers and Node ≥ 14.17.
 */
function makeSalt(): string {
  return crypto.randomUUID();
}

/**
 * Deterministic per-session student id: sha256(name + salt) first 12 hex chars.
 * We reuse the same inline SHA-256 approach by using a simple UUID-based scheme
 * since we don't need cross-session stability for real students (only fixtures need
 * deterministic ids, handled by fixtureId()).
 *
 * For real students we just need a stable id *within* the import session so that
 * preference cross-references work. A salted UUID-v4 concatenation is sufficient
 * and keeps things dependency-free.
 *
 * Note: Python uses sha256(name + salt)[:12]; TS mirrors the *intent* (session-
 * stable, salted, not guessable) not the exact byte sequence — they are not
 * cross-runtime compatible by design (the Python prototype also used a fresh salt
 * each import session, so ids were never portable across imports anyway).
 */
function makeStudentId(name: string, salt: string): StudentId {
  // crypto.randomUUID is not deterministic per-name, so we combine name + salt
  // in a predictable way. Since we are browser/Node only and crypto.subtle is
  // async (and we want sync), we build a lightweight deterministic id from the
  // name + salt via a simple hash-alike based on the existing pure-JS approach.
  // We namespace so name collisions across salts are astronomically unlikely.
  const raw = `${salt}:${name}`;
  // Use a fast djb2 variant for a 12-char hex-ish id. Not cryptographic, but
  // sufficient for within-session deduplication (no security requirement here).
  let h1 = 5381;
  let h2 = 0x9747b28c;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 = Math.imul(h1, 33) ^ c;
    h2 = Math.imul(h2, 31) ^ c;
  }
  // Combine into a 12-char hex string (2 × 32-bit → 64 bits → 16 hex chars, take 12)
  const hex =
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0');
  return studentId(hex.slice(0, 12));
}

// ---------------------------------------------------------------------------
// SIMPLE format import
// ---------------------------------------------------------------------------

function importSimple(rows: string[][], salt: string): ImportResult {
  const warnings: string[] = [];
  const names: string[] = [];

  let firstRow = true;
  for (const row of rows) {
    const name = (row[0] ?? '').trim();
    if (!name) continue;

    if (firstRow) {
      firstRow = false;
      // Skip header row if its value matches common header labels
      if (SIMPLE_HEADER_LABELS.has(name.toLowerCase())) continue;
    }

    names.push(name);
  }

  if (names.length === 0) {
    warnings.push('No students found in the file.');
  }

  const students = names.map((name) => makeStudent(makeStudentId(name, salt), name));
  return { students, warnings };
}

// ---------------------------------------------------------------------------
// FULL format import
// ---------------------------------------------------------------------------

function importFull(rows: string[][], salt: string): ImportResult {
  const warnings: string[] = [];

  // Skip the header row (already detected as full format)
  const dataRows = rows.slice(1);

  // Pass 1: build all students (real + fixture), preserving order and deduplicating
  const nameToStudent = new Map<string, Student>();

  for (const row of dataRows) {
    const name = (row[0] ?? '').trim();
    if (!name || nameToStudent.has(name)) continue;

    const isFixtureFlag = (row[1] ?? '').trim().toLowerCase() === 'true';
    const sid = isFixtureFlag ? fixtureId(name) : makeStudentId(name, salt);

    const student = isFixtureFlag ? makeFixture(sid, name) : makeStudent(sid, name);
    nameToStudent.set(name, student);
  }

  // Pass 2: build preferences, resolve target names → StudentIds
  // We accumulate a mutable preferences list per student name, then rebuild.
  const prefsByName = new Map<string, Preference[]>();

  for (const row of dataRows) {
    const name = (row[0] ?? '').trim();
    const prefTarget = (row[2] ?? '').trim();
    const prefTypeStr = (row[3] ?? '').trim();
    const prefWeightStr = (row[4] ?? '').trim();

    if (!name || !prefTarget || !prefTypeStr || !prefWeightStr) continue;

    const student = nameToStudent.get(name);
    if (!student) continue;

    // Validate weight
    const weight = parseFloat(prefWeightStr);
    if (!Number.isFinite(weight)) {
      warnings.push(`Row for '${name}': invalid weight '${prefWeightStr}' — skipped.`);
      continue;
    }

    // Validate preference type (mirrors Python PreferenceTargetType enum values)
    const validPrefTypes = new Set(['student', 'furniture', 'location']);
    if (!validPrefTypes.has(prefTypeStr)) {
      warnings.push(`Row for '${name}': unknown preference type '${prefTypeStr}' — skipped.`);
      continue;
    }
    const prefKind = prefTypeStr as 'student' | 'furniture' | 'location';

    // Resolve target name → id (fall back to the raw string if not found, mirroring Python)
    let pref: Preference;
    if (prefKind === 'student') {
      const targetStudent = nameToStudent.get(prefTarget);
      const resolvedId = targetStudent !== undefined ? targetStudent.id : studentId(prefTarget);
      pref = { kind: 'student', targetId: resolvedId, weight };
    } else if (prefKind === 'furniture') {
      const targetStudent = nameToStudent.get(prefTarget);
      const resolvedId =
        targetStudent !== undefined ? targetStudent.id : furnitureId(prefTarget);
      pref = { kind: 'furniture', targetId: resolvedId, weight };
    } else {
      // location
      pref = { kind: 'location', target: prefTarget, weight };
    }

    const existing = prefsByName.get(name) ?? [];
    existing.push(pref);
    prefsByName.set(name, existing);
  }

  // Assemble final student list with preferences
  const students: Student[] = [];
  for (const [name, student] of nameToStudent) {
    const prefs = prefsByName.get(name) ?? [];
    const withPrefs: Student = { ...student, preferences: prefs };
    students.push(withPrefs);
  }

  return { students, warnings };
}

// ---------------------------------------------------------------------------
// Public: importCsv
// ---------------------------------------------------------------------------

/**
 * Parse a CSV string and return a list of students with their preferences.
 *
 * Auto-detects format:
 *   - SIMPLE: first row is NOT the canonical full header → names-only import.
 *   - FULL:   first row is `name,fixture,pref_target,pref_type,pref_weight` →
 *             full import with fixtures and preferences.
 *
 * Returns { students, warnings } — check warnings for non-fatal issues.
 */
export function importCsv(csvText: string): ImportResult {
  const rows = parseCsvString(csvText);
  if (rows.length === 0) {
    return { students: [], warnings: ['No students found in the file.'] };
  }

  const salt = makeSalt();
  const format = detectFormat(rows);
  return format === 'full' ? importFull(rows, salt) : importSimple(rows, salt);
}

// ---------------------------------------------------------------------------
// Public: exportCsv
// ---------------------------------------------------------------------------

/**
 * Export students to a FULL-format CSV string.
 *
 * Port of Python StudentExporter.export_to_csv.
 *
 * @param students   The roster (real students + fixtures) to export.
 * @param idToName   Optional map from StudentId/FurnitureId → display name, so
 *                   preferences are portable by name across import sessions.
 *                   Defaults to mapping each student's own id → name.
 *
 * Returns a CSV string ready to write to a file or download.
 */
export function exportCsv(
  students: readonly Student[],
  idToName?: ReadonlyMap<string, string>,
): string {
  // Build default id→name map from the roster if not provided
  const nameMap =
    idToName ??
    new Map<string, string>(students.map((s) => [s.id as string, s.name]));

  const lines: string[] = [];

  // Header
  lines.push(FULL_HEADER.join(','));

  for (const student of students) {
    const name = csvField(student.name);
    const fixture = student.isFixture ? 'true' : 'false';

    if (student.preferences.length === 0) {
      lines.push(`${name},${fixture},,,`);
    } else {
      for (const pref of student.preferences) {
        let targetName: string;
        let prefType: string;

        if (pref.kind === 'location') {
          targetName = pref.target;
          prefType = 'location';
        } else {
          // student or furniture kind
          targetName = nameMap.get(pref.targetId) ?? pref.targetId;
          prefType = pref.kind;
        }

        lines.push(
          `${name},${fixture},${csvField(targetName)},${prefType},${pref.weight.toString()}`,
        );
      }
    }
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// CSV field quoting helper
// ---------------------------------------------------------------------------

/**
 * Quote a field value for CSV output if it contains commas, quotes, or newlines.
 * Doubles any embedded double-quote characters (RFC 4180).
 */
function csvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
