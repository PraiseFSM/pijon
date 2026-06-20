/**
 * SeatGraph — proximity graph over all furniture in a classroom.
 *
 * Two furniture pieces are connected when the Euclidean distance between their
 * centers (in grid units) is ≤ proximityThreshold (default 1.5). At 1.5 the
 * graph captures all direct orthogonal neighbors (distance = 1.0) and all
 * diagonal neighbors (distance = √2 ≈ 1.414) but excludes pieces two cells
 * apart (distance = 2.0).
 *
 * Node types
 * ----------
 * - Assignable seats: furniture with capacity > 0 — filled by allocators.
 * - Non-assignable nodes: furniture with capacity = 0 (teacher_desk,
 *   whiteboard). They participate in the graph so that `areNeighbors` works
 *   for student↔fixture proximity checks.
 *
 * Fixtures
 * --------
 * A "fixture" is a piece of furniture whose occupant has `isFixture === true`.
 * Fixtures represent room features (whiteboard, door, teacher desk) that
 * students can express preferences toward.
 *
 * **Fixtures live in the model** — they are read from `furniture.occupants`,
 * not synthesised here. This mirrors the TS design decision: moving a
 * teacher_desk in the furniture editor automatically carries its fixture
 * occupant, because occupants are embedded in the furniture record.
 *
 * `fixtureIdToFid` maps a fixture occupant's StudentId → FurnitureId so that
 * allocators can look up the seat of a fixture given a preference's `targetId`.
 *
 * Class vs. builder function
 * --------------------------
 * SeatGraph is implemented as a class (not a plain builder function + frozen
 * object) because it holds *identity-carrying mutable assignment state*
 * (`occupants`, `locked`) that changes incrementally as the UI pre-populates
 * seats before running an allocator. Modelling this state as a class with
 * `assign/lock/unlock` methods that mutate internal maps is cleaner than
 * threading a new state object through every pre-population call and stays
 * consistent with Section 7's note that "a class holding readonly maps is
 * acceptable here since it has identity/mutable assignment state."
 * The graph-topology fields (nodes, edges, assignable, fixtures,
 * fixtureIdToFid) are set once at construction and treated as readonly.
 *
 * No React/DOM imports.
 */

import type { FurnitureId, StudentId } from './types.js';
import type { Student } from './student.js';
import type { Furniture } from './furniture.js';
import type { Classroom } from './classroom.js';
import { capacity, occupant, isFixture } from './furniture.js';
import { DEFAULT_THRESHOLD_UNITS } from './classroom.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default proximity threshold in UNITS (not raw cells).
 * At G=1 (default cellsPerUnit) this equals the raw cell threshold — so all
 * existing call sites that relied on the old constant continue to work.
 */
export const PROXIMITY_THRESHOLD = DEFAULT_THRESHOLD_UNITS; // 1.5 units

// ---------------------------------------------------------------------------
// Center-to-center distance (grid units)
// ---------------------------------------------------------------------------

/** Euclidean distance between the geometric centers of two furniture pieces. */
function furnitureDistance(a: Furniture, b: Furniture): number {
  const cx1 = a.pos.x + a.w / 2;
  const cy1 = a.pos.y + a.h / 2;
  const cx2 = b.pos.x + b.w / 2;
  const cy2 = b.pos.y + b.h / 2;
  return Math.sqrt((cx2 - cx1) ** 2 + (cy2 - cy1) ** 2);
}

// ---------------------------------------------------------------------------
// SeatGraph class
// ---------------------------------------------------------------------------

export class SeatGraph {
  /** All furniture nodes (assignable + non-assignable). FurnitureId → Furniture. */
  readonly nodes: ReadonlyMap<FurnitureId, Furniture>;

  /** Adjacency list. FurnitureId → Set of neighbor FurnitureIds. */
  readonly edges: ReadonlyMap<FurnitureId, ReadonlySet<FurnitureId>>;

  /** FurnitureIds of furniture with capacity > 0 (can seat students). */
  readonly assignable: ReadonlySet<FurnitureId>;

  /**
   * FurnitureId → fixture Student for all furniture whose occupant is a
   * fixture. Derived from the model, not synthesised.
   */
  readonly fixtures: ReadonlyMap<FurnitureId, Student>;

  /**
   * Reverse map: fixture Student's StudentId → the FurnitureId it occupies.
   * Used by allocators to score `kind: 'furniture'` preferences.
   */
  readonly fixtureIdToFid: ReadonlyMap<StudentId, FurnitureId>;

  /** The proximity threshold used to build edges (grid units). */
  readonly proximityThreshold: number;

  // -- Mutable assignment state (pre-population for the lock workflow) --

  /** Pre-assigned seats: FurnitureId → Student. Modified by `assign`. */
  readonly occupants: Map<FurnitureId, Student>;

  /** Locked FurnitureIds. Allocators must not move their students. */
  readonly locked: Set<FurnitureId>;

  // -------------------------------------------------------------------------

  /**
   * Build the SeatGraph for a classroom.
   *
   * `proximityThreshold` is interpreted as a value in UNITS when the classroom
   * has `cellsPerUnit` set (i.e. it is converted to fine-cell space before
   * comparing distances). The default is `PROXIMITY_THRESHOLD` (1.5 units),
   * which preserves the existing neighbour relationships at any granularity.
   *
   * Legacy call sites that pass a raw numeric threshold continue to work: at
   * the default granularity (cellsPerUnit = 1) units = cells, so thresholdCells
   * = thresholdUnits * 1 = thresholdUnits unchanged.
   */
  constructor(classroom: Classroom, proximityThreshold: number = PROXIMITY_THRESHOLD) {
    // Convert the threshold from units to fine cells.
    const thresholdInCells = proximityThreshold * classroom.cellsPerUnit;
    this.proximityThreshold = thresholdInCells;
    this.occupants = new Map();
    this.locked = new Set();

    const nodes = new Map<FurnitureId, Furniture>();
    const edges = new Map<FurnitureId, Set<FurnitureId>>();
    const assignable = new Set<FurnitureId>();
    const fixtures = new Map<FurnitureId, Student>();
    const fixtureIdToFid = new Map<StudentId, FurnitureId>();

    // Build nodes
    for (const f of classroom.furniture) {
      nodes.set(f.id, f);
      edges.set(f.id, new Set());

      if (capacity(f) > 0) {
        assignable.add(f.id);
      }

      // Read fixture from the model (not synthesised)
      const occ = occupant(f);
      if (occ !== undefined && isFixture(f)) {
        fixtures.set(f.id, occ);
        fixtureIdToFid.set(occ.id, f.id);
      }
    }

    // Build edges — center-to-center distance ≤ threshold, all pairs
    const all = Array.from(nodes.values());
    for (let i = 0; i < all.length; i++) {
      const f1 = all[i];
      // noUncheckedIndexedAccess guard — i is always < all.length, so f1 is never
      // undefined at runtime; the check exists only to satisfy the TS compiler.
      if (f1 === undefined) continue;
      for (let j = i + 1; j < all.length; j++) {
        const f2 = all[j];
        // Same noUncheckedIndexedAccess guard as above.
        if (f2 === undefined) continue;
        if (furnitureDistance(f1, f2) <= thresholdInCells) {
          edges.get(f1.id)?.add(f2.id);
          edges.get(f2.id)?.add(f1.id);
        }
      }
    }

    this.nodes = nodes;
    this.edges = edges;
    this.assignable = assignable;
    this.fixtures = fixtures;
    this.fixtureIdToFid = fixtureIdToFid;
  }

  // -------------------------------------------------------------------------
  // Graph queries
  // -------------------------------------------------------------------------

  /** Return all FurnitureIds adjacent to the given node. */
  neighbors(fid: FurnitureId): readonly FurnitureId[] {
    const nbrs = this.edges.get(fid);
    return nbrs !== undefined ? Array.from(nbrs) : [];
  }

  /** True iff two furniture pieces are direct neighbors in the graph. */
  areNeighbors(a: FurnitureId, b: FurnitureId): boolean {
    return this.edges.get(a)?.has(b) ?? false;
  }

  // -------------------------------------------------------------------------
  // Assignment state — pre-population for the lock workflow
  // -------------------------------------------------------------------------

  /** Pre-assign a student to a seat before running an allocator. */
  assign(fid: FurnitureId, student: Student): void {
    this.occupants.set(fid, student);
  }

  /** Lock a seat so allocators will not move the pre-assigned student. */
  lock(fid: FurnitureId): void {
    this.locked.add(fid);
  }

  /** Unlock a seat, making it available for allocators to fill. */
  unlock(fid: FurnitureId): void {
    this.locked.delete(fid);
  }

  /**
   * Assignable seats that are free for an allocator to fill.
   * Excludes seats that are pre-occupied OR locked.
   */
  availableSeatIds(): FurnitureId[] {
    return Array.from(this.assignable).filter(
      (fid) => !this.occupants.has(fid) && !this.locked.has(fid),
    );
  }
}
