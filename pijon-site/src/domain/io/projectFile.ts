/**
 * ProjectFile — the single `.pijon` project document.
 *
 * "One file = one class" (Design Goal 4). The file is pure JSON, validated
 * with Zod. This module deals only with string ↔ object serialisation; it has
 * no knowledge of IndexedDB, File System Access API, or any browser/DOM API
 * other than JSON.parse/stringify. Those concerns belong in Phase 5 (store +
 * persistence).
 *
 * On-disk shape
 * -------------
 * {
 *   version: 1,
 *   classroom: {
 *     id, name, gridW, gridH,
 *     furniture: [{ id, kind, pos, w, h, rotation, imagePath?, numSeats?,
 *                   // occupants: ONLY fixture occupants are stored here.
 *                   // Real student occupants are derived at load time from
 *                   // the arrangement field.
 *                   fixtureOccupant?: { id, name } }]
 *   },
 *   roster: [{ id, name, isFixture, preferences, metadata }],
 *   arrangement: { [furnitureId]: studentId },  // fid → real student's id
 *   locks: [furnitureId, …],
 * }
 *
 * Why this shape?
 * - `classroom` carries only geometry + fixture occupants (room features like
 *   whiteboard). Real students are NOT embedded in furniture here — they live
 *   in `roster` and are re-placed via `arrangement` at load time. This keeps
 *   student data in one place and avoids duplication.
 * - `arrangement` is a flat map so it's easy to diff, undo/redo, and snapshot
 *   separately from the durable project (roster + layout + preferences + locks).
 * - `locks` is a flat list of furniture ids (Phase 3 design decision: locks are
 *   part of the durable project, not the reversible arrangement snapshot).
 * - `version` is at the top level for future migration: a migration function
 *   receives the raw parsed object and returns a v-current ProjectFile.
 *
 * API for Phase 5 (store + persistence)
 * ---------------------------------------
 * - `serializeProject(state)` → JSON string  (call on every debounced autosave)
 * - `parseProject(json)` → ProjectFile | throws ProjectParseError
 * - `composeClassroom(pf)` → Classroom  (hydrate runtime state from disk)
 * - `extractProject(classroom, roster, locks)` → ProjectState  (snapshot for save)
 *
 * No React/DOM imports. No network calls.
 */

import { z } from 'zod';

import type { FurnitureId, StudentId, FurnitureKind, Vec2 } from '../types.js';
import type { Student } from '../student.js';
import type { Furniture } from '../furniture.js';
import type { Classroom } from '../classroom.js';
import { furnitureId, studentId } from '../types.js';
import { makeFixture } from '../student.js';
import { assignOccupant } from '../furniture.js';
import { assignments, fixtures } from '../classroom.js';

// ---------------------------------------------------------------------------
// Zod schemas — single source of truth for the on-disk format
// ---------------------------------------------------------------------------

const Vec2Schema = z.object({
  x: z.number(),
  y: z.number(),
});

const FurnitureKindSchema = z.enum([
  'single_desk',
  'table',
  'teacher_desk',
  'whiteboard',
]);

/**
 * A fixture occupant as persisted in the classroom geometry.
 * Only id and name are needed — isFixture is always true for these.
 */
const FixtureOccupantSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const FurnitureSchema = z.object({
  id: z.string(),
  kind: FurnitureKindSchema,
  pos: Vec2Schema,
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  imagePath: z.string().optional(),
  numSeats: z.number().int().positive().optional(),
  /** Only fixture occupants (isFixture === true) are persisted in geometry. */
  fixtureOccupant: FixtureOccupantSchema.optional(),
});

const PreferenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('student'),
    targetId: z.string(),
    weight: z.number(),
  }),
  z.object({
    kind: z.literal('furniture'),
    targetId: z.string(),
    weight: z.number(),
  }),
  z.object({
    kind: z.literal('location'),
    target: z.string(),
    weight: z.number(),
  }),
]);

const StudentSchema = z.object({
  id: z.string(),
  name: z.string(),
  isFixture: z.boolean(),
  preferences: z.array(PreferenceSchema),
  metadata: z.record(z.string(), z.unknown()),
});

const ClassroomGeometrySchema = z.object({
  id: z.string(),
  name: z.string(),
  gridW: z.number().int().positive(),
  gridH: z.number().int().positive(),
  furniture: z.array(FurnitureSchema),
});

/**
 * The full on-disk project schema.
 * Version 1 — increment for breaking migrations.
 */
const ProjectFileSchema = z.object({
  version: z.literal(1),
  classroom: ClassroomGeometrySchema,
  roster: z.array(StudentSchema),
  /**
   * The seating arrangement: furnitureId → studentId.
   * Only real (non-fixture) students appear here; fixture occupants are
   * embedded in classroom.furniture[*].fixtureOccupant instead.
   */
  arrangement: z.record(z.string(), z.string()),
  /** Furniture ids whose occupant must not be moved by the allocator. */
  locks: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Exported TypeScript types (inferred from Zod schemas)
// ---------------------------------------------------------------------------

export type ProjectFile = z.infer<typeof ProjectFileSchema>;
export type ProjectFurniture = z.infer<typeof FurnitureSchema>;
export type ProjectStudent = z.infer<typeof StudentSchema>;
export type ProjectClassroomGeometry = z.infer<typeof ClassroomGeometrySchema>;

// ---------------------------------------------------------------------------
// Parse error
// ---------------------------------------------------------------------------

/**
 * Thrown by parseProject when the JSON is structurally valid but fails Zod
 * validation, or when JSON.parse itself throws.
 */
export class ProjectParseError extends Error {
  /** The raw Zod issue list, or undefined for JSON syntax errors. */
  readonly issues: z.ZodError | undefined;

  constructor(message: string, issues?: z.ZodError) {
    super(message);
    this.name = 'ProjectParseError';
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// Migration stubs (version → version+1)
// ---------------------------------------------------------------------------

/**
 * Run any pending migrations on a raw parsed object.
 * Currently a no-op (only version 1 exists). Add cases here as the schema
 * evolves: read `raw.version`, transform, bump, repeat until current version.
 *
 * The pattern:
 *   if (raw.version === 1) { raw = migrateV1toV2(raw); }
 *   if (raw.version === 2) { raw = migrateV2toV3(raw); }
 *   …
 */
function applyMigrations(raw: unknown): unknown {
  // Future: check (raw as { version?: number }).version and transform.
  return raw;
}

// ---------------------------------------------------------------------------
// serialize / parse
// ---------------------------------------------------------------------------

/**
 * Serialize a ProjectFile to a JSON string (the `.pijon` file contents).
 * Call with a value produced by extractProject().
 */
export function serializeProject(pf: ProjectFile): string {
  return JSON.stringify(pf, null, 2);
}

/**
 * Parse and validate a `.pijon` JSON string.
 *
 * Throws ProjectParseError on:
 *   - Invalid JSON syntax
 *   - Schema validation failure (wrong shape / types)
 *
 * On success returns a fully typed ProjectFile.
 * Runs migrations before validation so future formats are handled gracefully.
 */
export function parseProject(json: string): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch (err) {
    throw new ProjectParseError(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  raw = applyMigrations(raw);

  const result = ProjectFileSchema.safeParse(raw);
  if (!result.success) {
    throw new ProjectParseError('Project file schema validation failed.', result.error);
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// composeClassroom — load ProjectFile → runtime Classroom
// ---------------------------------------------------------------------------

/**
 * Rebuild a runtime Classroom from a parsed ProjectFile.
 *
 * Steps:
 *  1. Build the classroom with furniture (geometry + fixture occupants).
 *  2. Look up each arrangement entry (fid → studentId) in the roster and
 *     use assignOccupant to place the real student on the correct furniture.
 *
 * Furniture ids or student ids that no longer exist (e.g. stale arrangement
 * after the user deleted a desk or student) are silently skipped — mirroring
 * Python's ArrangementIO.load behaviour.
 *
 * Returns { classroom, roster, locks } — everything Phase 5's store needs.
 */
export interface LoadedProject {
  readonly classroom: Classroom;
  /** Full roster as domain Student objects (real + fixture). */
  readonly roster: readonly Student[];
  /** Furniture ids that are locked. */
  readonly locks: readonly FurnitureId[];
}

export function composeClassroom(pf: ProjectFile): LoadedProject {
  // Build id → domain Student map from the roster
  const studentById = new Map<StudentId, Student>();
  const roster: Student[] = [];

  for (const s of pf.roster) {
    const sid = studentId(s.id);
    const domainStudent: Student = {
      id: sid,
      name: s.name,
      isFixture: s.isFixture,
      // Preferences: re-brand the string ids to typed branded ids
      preferences: s.preferences.map((p) => {
        if (p.kind === 'student') {
          return { kind: 'student' as const, targetId: studentId(p.targetId), weight: p.weight };
        }
        if (p.kind === 'furniture') {
          return { kind: 'furniture' as const, targetId: p.targetId, weight: p.weight };
        }
        return { kind: 'location' as const, target: p.target, weight: p.weight };
      }),
      metadata: s.metadata,
    };
    studentById.set(sid, domainStudent);
    roster.push(domainStudent);
  }

  // Build furniture pieces (geometry + fixture occupants), no real students yet
  let furnitureList: Furniture[] = [];
  for (const pf_f of pf.classroom.furniture) {
    const fid = furnitureId(pf_f.id);
    const pos: Vec2 = { x: pf_f.pos.x, y: pf_f.pos.y };

    let baseFurniture: Furniture = {
      id: fid,
      kind: pf_f.kind,
      pos,
      w: pf_f.w,
      h: pf_f.h,
      rotation: pf_f.rotation,
      imagePath: pf_f.imagePath,
      numSeats: pf_f.numSeats,
      occupants: [],
    };

    // Re-attach fixture occupant if present
    if (pf_f.fixtureOccupant !== undefined) {
      const fixSid = studentId(pf_f.fixtureOccupant.id);
      // Prefer the full student record from roster if it's there; otherwise
      // reconstruct a minimal fixture (handles the case where the fixture is
      // not in the roster — shouldn't happen but be defensive).
      const fixStudent =
        studentById.get(fixSid) ?? makeFixture(fixSid, pf_f.fixtureOccupant.name);
      baseFurniture = assignOccupant(baseFurniture, fixStudent);
    }

    furnitureList.push(baseFurniture);
  }

  // Place real students from the arrangement map
  const fidMap = new Map<FurnitureId, Furniture>(
    furnitureList.map((f) => [f.id, f]),
  );

  for (const [rawFid, rawSid] of Object.entries(pf.arrangement)) {
    const fid = furnitureId(rawFid);
    const sid = studentId(rawSid);

    const furniture = fidMap.get(fid);
    const student = studentById.get(sid);

    if (furniture === undefined || student === undefined) continue; // stale ref — skip

    try {
      const updated = assignOccupant(furniture, student);
      fidMap.set(fid, updated);
    } catch {
      // If assignment fails (e.g. furniture already full from a corrupt file), skip.
    }
  }

  furnitureList = Array.from(fidMap.values());

  const classroom: Classroom = {
    id: pf.classroom.id,
    name: pf.classroom.name,
    gridW: pf.classroom.gridW,
    gridH: pf.classroom.gridH,
    furniture: furnitureList,
  };

  const locks: FurnitureId[] = pf.locks.map(furnitureId);

  return { classroom, roster, locks };
}

// ---------------------------------------------------------------------------
// extractProject — snapshot runtime Classroom → ProjectFile
// ---------------------------------------------------------------------------

/**
 * The inputs Phase 5's store will pass to extractProject.
 */
export interface ProjectState {
  readonly classroom: Classroom;
  readonly roster: readonly Student[];
  readonly locks: readonly FurnitureId[];
}

/**
 * Snapshot the current runtime state into a ProjectFile ready for serialisation.
 *
 * Inverse of composeClassroom:
 *  - Classroom furniture → geometry + fixtureOccupant fields (real occupants stripped).
 *  - assignments(classroom) → arrangement map (fid → studentId).
 *  - fixtures(classroom) → embedded in furniture geometry as fixtureOccupant.
 *  - roster → serialised as-is.
 *  - locks → serialised as string list.
 */
export function extractProject(state: ProjectState): ProjectFile {
  const { classroom, roster, locks } = state;

  const arrangementMap = assignments(classroom);
  const fixtureMap = fixtures(classroom);

  // Serialise furniture: geometry + fixture occupants, no real students
  const pfFurniture: ProjectFurniture[] = classroom.furniture.map((f) => {
    const fixtureOcc = fixtureMap.get(f.id);
    const pfF: ProjectFurniture = {
      id: f.id,
      kind: f.kind,
      pos: { x: f.pos.x, y: f.pos.y },
      w: f.w,
      h: f.h,
      rotation: f.rotation,
      ...(f.imagePath !== undefined ? { imagePath: f.imagePath } : {}),
      ...(f.numSeats !== undefined ? { numSeats: f.numSeats } : {}),
      ...(fixtureOcc !== undefined
        ? { fixtureOccupant: { id: fixtureOcc.id, name: fixtureOcc.name } }
        : {}),
    };
    return pfF;
  });

  // Serialise real-student arrangement
  const arrangement: Record<string, string> = {};
  for (const [fid, student] of arrangementMap) {
    arrangement[fid] = student.id;
  }

  // Serialise roster
  const pfRoster: ProjectStudent[] = roster.map((s) => ({
    id: s.id,
    name: s.name,
    isFixture: s.isFixture,
    preferences: s.preferences.map((p) => {
      if (p.kind === 'location') return { kind: 'location' as const, target: p.target, weight: p.weight };
      return { kind: p.kind, targetId: p.targetId, weight: p.weight };
    }),
    metadata: s.metadata,
  }));

  return {
    version: 1,
    classroom: {
      id: classroom.id,
      name: classroom.name,
      gridW: classroom.gridW,
      gridH: classroom.gridH,
      furniture: pfFurniture,
    },
    roster: pfRoster,
    arrangement,
    locks: locks.map((fid) => fid),
  };
}

// ---------------------------------------------------------------------------
// Optional: legacy prototype classroom geometry importer
// ---------------------------------------------------------------------------

/**
 * The shape of a prototype classroom JSON (data/classrooms/*.json).
 * Kept minimal — only the fields needed for geometry import.
 */
const PrototypeClassroomSchema = z.object({
  name: z.string(),
  grid_width: z.number().int().positive(),
  grid_height: z.number().int().positive(),
  furniture: z.array(
    z.object({
      furniture_id: z.string(),
      furniture_type: z.string(),
      position: z.tuple([z.number(), z.number()]),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      image_path: z.string().optional(),
      rotation: z.number().default(0),
    }),
  ),
});

/**
 * Import a prototype `data/classrooms/*.json` geometry into a ProjectFile.
 *
 * The prototype JSON carries no students or preferences, so roster and
 * arrangement are empty. Fixture occupants are not present in the old format.
 *
 * Unknown furniture_type values are mapped to 'single_desk' as a safe fallback.
 *
 * Returns a ProjectFile with version: 1 ready to be saved or used directly.
 * Throws ProjectParseError on invalid JSON or missing required fields.
 */
export function importLegacyClassroom(json: string): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch (err) {
    throw new ProjectParseError(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const result = PrototypeClassroomSchema.safeParse(raw);
  if (!result.success) {
    throw new ProjectParseError(
      'Legacy classroom JSON does not match the expected prototype format.',
      result.error,
    );
  }

  const proto = result.data;

  const kindMap: Record<string, FurnitureKind> = {
    single_desk: 'single_desk',
    table: 'table',
    teacher_desk: 'teacher_desk',
    whiteboard: 'whiteboard',
  };

  const pfFurniture: ProjectFurniture[] = proto.furniture.map((f) => {
    const kind: FurnitureKind = kindMap[f.furniture_type] ?? 'single_desk';
    const rot = f.rotation;
    const rotation: 0 | 90 | 180 | 270 =
      rot === 90 ? 90 : rot === 180 ? 180 : rot === 270 ? 270 : 0;

    return {
      id: f.furniture_id,
      kind,
      pos: { x: f.position[0], y: f.position[1] },
      w: f.width,
      h: f.height,
      rotation,
      ...(f.image_path !== undefined ? { imagePath: f.image_path } : {}),
    };
  });

  // Use a stable id derived from the classroom name
  const classroomId = `legacy-${proto.name}`;

  return {
    version: 1,
    classroom: {
      id: classroomId,
      name: proto.name,
      gridW: proto.grid_width,
      gridH: proto.grid_height,
      furniture: pfFurniture,
    },
    roster: [],
    arrangement: {},
    locks: [],
  };
}
