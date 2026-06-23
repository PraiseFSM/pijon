/**
 * StudentEditor — Phase 8, merged with PreferenceEditor in §12.4.
 *
 * One tool, two panels:
 *   Left SidePanel  — roster: manual add, student list (click to select, × to remove),
 *                     Import CSV at the bottom.
 *   Right RightPanel — preferences for the selected student: assigner-mode toggle at top,
 *                      show-links toggle, per-student pref list (remove buttons),
 *                      add-pref form (target dropdown + weight).
 *
 * Canvas interaction has two modes (toggled by the right panel):
 *   Drag mode (default) — drag students between desks (swap/move).
 *   Assigner mode       — click student 1, then student 2 → setMutualPreference;
 *                         ESC cancels; self-target no-op.
 *
 * paintOverlay draws:
 *   - Drag ghost, drag source fade, drag target highlight (drag mode only).
 *   - Lock badges.
 *   - Violation tint (when showViolations=true).
 *   - Neighbor preview (right-click).
 *   - Assigner first-selection amber ring (assigner mode only).
 *   - Preference links — green=prefer, red=avoid — between seated students (when showLinks=true).
 *
 * LOCAL-FIRST: no fetch(), no XHR, no WebSocket. CSV import uses FileReader on a
 * local file; CSV export builds a Blob and triggers a <a> download.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  assignerHintBackground,
  assignerHintText,
  primaryButtonBackground,
  primaryButtonBorder,
  primaryButtonText,
  btnBackground,
  btnBorder,
  disabledButtonBackground,
  bannerErrorBackground,
  bannerErrorBorder,
  bannerErrorText,
  bannerAmberBackground,
  bannerAmberBorder,
  bannerAmberText,
  toolbarBackground,
  toolbarBorder,
  textDark,
  textMedium,
  divider,
  sidePanelBackground,
  panelBorder,
  sidePanelHeaderText,
  textMuted,
  textDisabled,
  textPlaceholder,
  rosterSelectedBackground,
  rosterSelectedBorder,
  prefCountBadgeBackground,
  prefCountBadgeText,
  dangerButtonBackground,
  dangerButtonBorder,
  dangerButtonText,
  addStudentButtonBorder,
  addStudentButtonBackground,
  addStudentButtonText,
  dividerLight,
  importWarningsBackground,
  importWarningsText,
  bannerInfoText,
  fixtureItemText,
  contextMenuBackground,
  contextMenuBorder,
  contextMenuShadow,
  contextMenuHeaderText,
  contextMenuMutedText,
  contextMenuLockText,
  contextMenuUnlockText,
  selectedStudentHeaderBackground,
  prefPreferText,
  prefAvoidText,
  dragTargetFill,
  dragTargetStroke,
  rosterDropTargetFill,
  rosterDropTargetStroke,
  dragSourceFade,
  violationFill,
  violationStroke,
  neighborSourceStroke,
  neighborSourceFill,
  neighborStroke,
  neighborFill,
  lockBadgeFill,
  lockBadgeText,
  dragGhostFill,
  dragGhostStroke,
  dragGhostText,
  prefLinkPrefer,
  prefLinkAvoid,
} from '../../theme/colors.js';
import { WeightSelector } from '../components/WeightSelector.js';
import type { EditorContext, EditorMode, CanvasView } from './EditorMode.js';
import type { FurnitureId, StudentId } from '../../domain/types.js';
import type { Furniture } from '../../domain/furniture.js';
import { capacity, occupant, isFixture as isFurnitureFixture } from '../../domain/furniture.js';
import type { Student } from '../../domain/student.js';
import type { Preference } from '../../domain/preference.js';
import { SeatGraph } from '../../domain/seatGraph.js';
import { GreedyAllocator } from '../../domain/allocators/greedy.js';
import { BogoAllocator } from '../../domain/allocators/bogo.js';
import type { Allocator } from '../../domain/allocators/types.js';
import type { Classroom } from '../../domain/classroom.js';
import { assignments as classroomAssignments } from '../../domain/classroom.js';
import { furnitureToPixelRect } from '../canvas/hitTest.js';
import { usePijonStore } from '../../state/store.js';
import { useSeatingIssues } from '../../state/hooks.js';
import { SettingsMenu, GearButton } from '../shell/SettingsMenu.js';

// ---------------------------------------------------------------------------
// §13.2 — Allocator registry (drives the split-button dropdown)
// ---------------------------------------------------------------------------

/**
 * Registered seating algorithms. Adding a new algorithm = add one entry here.
 * The label is shown in the dropdown; the factory builds the Allocator instance.
 * Driven from the existing allocator classes — no hardcoding in the UI.
 */
export interface AllocatorEntry {
  readonly id: string;
  readonly label: string;
  readonly factory: () => Allocator;
}

export const ALLOCATOR_REGISTRY: readonly AllocatorEntry[] = [
  { id: 'greedy', label: 'Greedy', factory: () => new GreedyAllocator() },
  { id: 'bogo',   label: 'Random', factory: () => new BogoAllocator() },
] as const;

/**
 * The two action variants for the split-button.
 * - 'allocate'     — seats ALL students from scratch (existing seating cleared per allocator).
 * - 'smart_shuffle' — re-seats respecting locks (locked students stay put).
 */
export type ActionVariant = 'allocate' | 'smart_shuffle';

// ---------------------------------------------------------------------------
// §13.7 — Roster-drag: HTML5 drag from the roster list onto a desk
//
// We stash the dragged studentId at module level so Firefox / Safari can read
// it during dragover (those browsers return "" from dataTransfer.getData() in
// dragover events — the spec restricts getData to drop events).
// Mirror of the §13.1 pattern in FurnitureEditor.
// ---------------------------------------------------------------------------

/** dataTransfer MIME key carrying the studentId. */
export const DRAG_STUDENT_ID_KEY = 'application/x-pijon-student-id';

/** Module-level stash for Firefox / Safari dragover fallback. */
let _draggedStudentIdStash: StudentId | null = null;

/** Called by the roster item's onDragStart to stash the id. */
export function stashDraggedStudentId(id: StudentId): void {
  _draggedStudentIdStash = id;
}

/** Called on dragend / drop to prevent the stash bleeding to the next drag. */
export function clearDraggedStudentIdStash(): void {
  _draggedStudentIdStash = null;
}

/**
 * Read the dragged studentId from the event, falling back to the module stash
 * when getData() returns "" (Firefox/Safari during dragover).
 */
export function readDraggedStudentId(e: DragEvent): StudentId | null {
  let id = e.dataTransfer?.getData(DRAG_STUDENT_ID_KEY) ?? '';
  if (!id) id = e.dataTransfer?.getData('text/plain') ?? '';
  if (!id && _draggedStudentIdStash !== null) id = _draggedStudentIdStash;
  return (id as StudentId) || null;
}

/**
 * Lazy-created transparent 1px canvas used as the replacement drag-image so
 * the browser shows NO ghost and only our canvas overlay is visible.
 * Mirrors the §13.1 approach in FurnitureEditor.
 */
let _transparentDragImageStudent: HTMLCanvasElement | null = null;

function getTransparentDragImage(): HTMLCanvasElement {
  if (_transparentDragImageStudent === null) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    _transparentDragImageStudent = c;
  }
  return _transparentDragImageStudent;
}

// ---------------------------------------------------------------------------
// §13.7 — Drop-target highlight state (live canvas feedback during dragover)
// ---------------------------------------------------------------------------

/** FurnitureId of the desk currently being hovered during a roster-drag. */
let rosterDragHoverFid: import('../../domain/types.js').FurnitureId | null = null;

// ---------------------------------------------------------------------------
// §13.6 — Callback bridge: first-selected student for assigner-mode toolbar hint
// ---------------------------------------------------------------------------

/**
 * Callback registered by the AssignerHintHost component so the canvas event
 * handler (onPointerDown) can push the first-selected student's name into the
 * React tree as a visible hint.
 *
 * null  → no student selected (hint cleared).
 * string → name of the selected student.
 */
let setAssignerFirstStudentCallback: ((name: string | null) => void) | null = null;

// ---------------------------------------------------------------------------
// Module-level transient state — cleared in deactivate()
// ---------------------------------------------------------------------------

// ---- Drag mode state -------------------------------------------------------

/** Furniture being dragged (source). null when idle. */
let dragSourceFid: FurnitureId | null = null;
/** The student being dragged. */
let dragStudent: Student | null = null;
/** Current pointer position in canvas-pixel space (for ghost drawing). */
let dragCanvasPos: { x: number; y: number } | null = null;
/** The furniture the pointer is currently hovering over during drag. */
let dragHoverFid: FurnitureId | null = null;

/** Furniture whose neighbors are highlighted (toggled via right-click). */
let neighborPreviewFid: FurnitureId | null = null;

/** Cached SeatGraph — rebuilt when classroom or threshold changes. */
let cachedGraph: SeatGraph | null = null;
/** The classroom object the cache was built from (reference equality check). */
let cachedGraphClassroom: Classroom | null = null;
/** The threshold the cache was built with (in units). */
let cachedGraphThreshold = 0;

// showViolations and nearness (thresholdUnits) are no longer editor-local module vars.
// §13.4: nearness is classroom.thresholdUnits (store) — single source of truth.
// §13.5: showViolations is store.showViolations — persisted, defaults to true.
// Both are read from the store at paint time (see getSeatGraph / paintStudentOverlay).

// ---- Assigner mode state ---------------------------------------------------

/**
 * Whether the preference-assigner (marker) mode is active.
 * When true, pointer interaction does the marker flow; when false, drag flow.
 * Driven by the RightPanel toggle; stored module-level so event handlers can read it.
 */
let assignerModeActive = false;

/** FurnitureId of the first-selected desk in assigner mode (step 1 of the marker flow). */
let markerFirstFid: FurnitureId | null = null;
/** The student who occupies markerFirstFid. */
let markerFirstStudent: Student | null = null;

/** Current preference weight for the assigner mode. Default: -1.0 (avoid). */
let currentWeight = -1.0;

/** Whether to draw preference links between currently-seated students. */
let showLinks = false;

/**
 * §5.B3 — Callback registered by the SidePanel's weight display so the toolbar
 * weight buttons can push state changes into the React tree for aria-pressed rendering.
 */
let setCurrentWeightCallback: ((w: number) => void) | null = null;

// ---------------------------------------------------------------------------
// §13.6 — Pulse animation loop
//
// The pulse highlight around the first-selected desk in assigner mode uses
// Date.now() in paintStudentOverlay, but paintOverlay only runs when
// requestRepaint() is called — so without an animation loop the highlight is
// effectively static (it only updates on the next user interaction).
//
// Solution: while a first student is selected, drive a continuous rAF loop that
// calls requestRepaint() ~60fps. The loop stops the moment markerFirstFid is
// cleared (second click / ESC / deactivate / editor switch) so there is no leak.
// ---------------------------------------------------------------------------

/** RAF handle for the pulse animation loop. null = not running. */
let pulseRafHandle: number | null = null;

/** requestRepaint function captured on activate — used by the pulse loop. */
let pulseRepaintFn: (() => void) | null = null;

/** Start the pulse loop. No-op if already running or no repaint fn is available. */
function startPulseLoop(): void {
  if (pulseRafHandle !== null) return; // already running
  if (pulseRepaintFn === null) return;

  const loop = () => {
    // Stop if markerFirstFid was cleared (second click / ESC / deactivate)
    if (markerFirstFid === null) {
      pulseRafHandle = null;
      return;
    }
    pulseRepaintFn?.();
    pulseRafHandle = requestAnimationFrame(loop);
  };

  pulseRafHandle = requestAnimationFrame(loop);
}

/** Stop the pulse loop and cancel any pending RAF frame. */
function stopPulseLoop(): void {
  if (pulseRafHandle !== null) {
    cancelAnimationFrame(pulseRafHandle);
    pulseRafHandle = null;
  }
}

// ---------------------------------------------------------------------------
// Callbacks bridging the canvas EditorMode object to React-stateful components
// ---------------------------------------------------------------------------

/** Callback registered by StudentSidePanelWithMenu so onContextMenu can show the menu. */
let showContextMenuCallback:
  | ((state: ContextMenuState) => void)
  | null = null;

/** Callback registered by StudentSidePanelWithMenu so onPointerDown / deactivate can close it. */
let closeContextMenuCallback: (() => void) | null = null;

/**
 * Callback registered by the SidePanel to toggle assigner mode from outside
 * the React component (so the canvas event handlers can read the current value).
 */
let setAssignerModeCallback: ((on: boolean) => void) | null = null;

/**
 * §6.A4 — Callback registered by App.tsx so ClassroomCanvas receives the correct
 * cursor when assigner mode toggles. The shell calls registerAssignerCursorListener
 * to subscribe; the listener is called with `true` (assigner on) or `false` (off).
 * A single listener is sufficient — only one App renders at a time.
 */
let assignerCursorListener: ((on: boolean) => void) | null = null;

/**
 * Register a listener for assigner-mode on/off transitions.
 * Called by App.tsx once on mount. Returns an unregister function.
 */
export function registerAssignerCursorListener(cb: (on: boolean) => void): () => void {
  assignerCursorListener = cb;
  return () => {
    if (assignerCursorListener === cb) {
      assignerCursorListener = null;
    }
  };
}

// ---------------------------------------------------------------------------
// SeatGraph cache helpers
// ---------------------------------------------------------------------------

function getSeatGraph(classroom: Classroom, threshold: number): SeatGraph {
  if (
    cachedGraph !== null &&
    cachedGraphClassroom === classroom &&
    cachedGraphThreshold === threshold
  ) {
    return cachedGraph;
  }
  const g = new SeatGraph(classroom, threshold);
  cachedGraph = g;
  cachedGraphClassroom = classroom;
  cachedGraphThreshold = threshold;
  return g;
}

function clearGraphCache(): void {
  cachedGraph = null;
  cachedGraphClassroom = null;
  cachedGraphThreshold = 0;
}

// ---------------------------------------------------------------------------
// Violation logic (port of SeatingGrid._has_violation — bidirectional avoid)
// ---------------------------------------------------------------------------

function hasViolation(
  student: Student,
  fid: FurnitureId,
  arrangement: Map<FurnitureId, Student>,
  graph: SeatGraph,
): boolean {
  const sidToFid = new Map<string, FurnitureId>();
  for (const [f, s] of arrangement) {
    if (!s.isFixture && f !== fid) {
      sidToFid.set(s.id, f);
    }
  }

  // a) S's own avoid-preferences
  for (const pref of student.preferences) {
    if (pref.weight >= 0) continue;

    if (pref.kind === 'student') {
      const targetFid = sidToFid.get(pref.targetId);
      if (targetFid !== undefined && graph.areNeighbors(fid, targetFid)) {
        return true;
      }
    } else if (pref.kind === 'furniture') {
      const fixtureFid = graph.fixtureIdToFid.get(
        pref.targetId as import('../../domain/types.js').StudentId,
      );
      if (fixtureFid !== undefined && graph.areNeighbors(fid, fixtureFid)) {
        return true;
      }
    }
  }

  // b) Bidirectional: other placed students who avoid S
  for (const [placedFid, placedStudent] of arrangement) {
    if (placedFid === fid || placedStudent.isFixture) continue;
    for (const pref of placedStudent.preferences) {
      if (
        pref.weight < 0 &&
        pref.kind === 'student' &&
        pref.targetId === student.id &&
        graph.areNeighbors(fid, placedFid)
      ) {
        return true;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// paintOverlay helpers
// ---------------------------------------------------------------------------

/**
 * Draw the preference-link overlay (green=prefer, red=avoid) between all
 * currently-seated students who share a student-kind preference.
 * Called only when showLinks=true.
 */
function paintPreferenceLinks(
  ctx2d: CanvasRenderingContext2D,
  view: CanvasView,
  classroom: Classroom,
): void {
  const furniture = classroom.furniture;
  const arrangement: Map<FurnitureId, Student> = classroomAssignments(classroom);
  const sidToFid = new Map<StudentId, FurnitureId>();
  for (const [fid, student] of arrangement) {
    if (!student.isFixture) {
      sidToFid.set(student.id, fid);
    }
  }

  for (const [fid, student] of arrangement) {
    if (student.isFixture) continue;
    const srcF = furniture.find((f) => f.id === fid);
    if (srcF === undefined) continue;
    const srcR = furnitureToPixelRect(srcF, view.cellSize);
    const srcCx = srcR.x + srcR.w / 2;
    const srcCy = srcR.y + srcR.h / 2;

    for (const pref of student.preferences) {
      if (pref.kind !== 'student') continue;
      const tgtFid = sidToFid.get(pref.targetId);
      if (tgtFid === undefined) continue;
      const tgtF = furniture.find((f) => f.id === tgtFid);
      if (tgtF === undefined) continue;
      const tgtR = furnitureToPixelRect(tgtF, view.cellSize);
      const tgtCx = tgtR.x + tgtR.w / 2;
      const tgtCy = tgtR.y + tgtR.h / 2;

      ctx2d.beginPath();
      ctx2d.moveTo(srcCx, srcCy);
      ctx2d.lineTo(tgtCx, tgtCy);
      ctx2d.strokeStyle = pref.weight > 0 ? prefLinkPrefer : prefLinkAvoid;
      ctx2d.lineWidth = 1.5;
      ctx2d.setLineDash([5, 4]);
      ctx2d.stroke();
      ctx2d.setLineDash([]);

      // Small arrowhead at target
      const angle = Math.atan2(tgtCy - srcCy, tgtCx - srcCx);
      const arrowLen = 8;
      const arrowAngle = Math.PI / 6;
      ctx2d.beginPath();
      ctx2d.moveTo(tgtCx, tgtCy);
      ctx2d.lineTo(
        tgtCx - arrowLen * Math.cos(angle - arrowAngle),
        tgtCy - arrowLen * Math.sin(angle - arrowAngle),
      );
      ctx2d.moveTo(tgtCx, tgtCy);
      ctx2d.lineTo(
        tgtCx - arrowLen * Math.cos(angle + arrowAngle),
        tgtCy - arrowLen * Math.sin(angle + arrowAngle),
      );
      ctx2d.lineWidth = 1.5;
      ctx2d.stroke();
    }
  }
}

/**
 * Full paintOverlay pass — draws all overlays for the StudentEditor.
 *
 * @param showViolationsFlag - from store.showViolations (§13.5, defaults true)
 * @param thresholdUnits     - from classroom.thresholdUnits (§13.4, single source of truth)
 */
function paintStudentOverlay(
  ctx2d: CanvasRenderingContext2D,
  view: CanvasView,
  classroom: Classroom,
  locks: ReadonlySet<FurnitureId>,
  showViolationsFlag: boolean,
  thresholdUnits: number,
): void {
  ctx2d.save();

  // ---- Preference links (bottom-most overlay layer) -----
  if (showLinks) {
    paintPreferenceLinks(ctx2d, view, classroom);
  }

  // ---- Per-desk overlays ----------------------------
  const graph = getSeatGraph(classroom, thresholdUnits);
  const arrangement = classroomAssignments(classroom);

  const neighborSet = new Set<FurnitureId>();
  if (neighborPreviewFid !== null) {
    for (const nbr of graph.neighbors(neighborPreviewFid)) {
      neighborSet.add(nbr);
    }
  }

  for (const f of classroom.furniture) {
    const r = furnitureToPixelRect(f, view.cellSize);
    const occ = occupant(f);
    const isFixt = isFurnitureFixture(f);
    const fid = f.id;
    const isDragSource = fid === dragSourceFid;
    const isDragTarget =
      dragSourceFid !== null && fid === dragHoverFid && fid !== dragSourceFid;
    const isNeighborSource = fid === neighborPreviewFid;
    const isNeighbor = neighborSet.has(fid);

    // --- Drag target highlight (pointer drag between desks) ---
    if (!assignerModeActive && isDragTarget) {
      ctx2d.fillStyle = dragTargetFill;
      ctx2d.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx2d.strokeStyle = dragTargetStroke;
      ctx2d.lineWidth = 2;
      ctx2d.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }

    // --- §13.7 roster-drag drop-target highlight ---
    if (rosterDragHoverFid !== null && fid === rosterDragHoverFid) {
      ctx2d.fillStyle = rosterDropTargetFill;
      ctx2d.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx2d.strokeStyle = rosterDropTargetStroke;
      ctx2d.lineWidth = 2;
      ctx2d.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }

    // --- Drag source fade ---
    if (!assignerModeActive && isDragSource) {
      ctx2d.fillStyle = dragSourceFade;
      ctx2d.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      ctx2d.restore();
      ctx2d.save();
      continue;
    }

    // --- Violation tint ---
    if (showViolationsFlag && occ !== undefined && !isFixt) {
      const violated = hasViolation(occ, fid, arrangement, graph);
      if (violated) {
        ctx2d.fillStyle = violationFill;
        ctx2d.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
        ctx2d.strokeStyle = violationStroke;
        ctx2d.lineWidth = 1.5;
        ctx2d.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      }
    }

    // --- Neighbor preview highlight ---
    if (neighborPreviewFid !== null) {
      if (isNeighborSource) {
        ctx2d.strokeStyle = neighborSourceStroke;
        ctx2d.lineWidth = 2.5;
        ctx2d.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        ctx2d.fillStyle = neighborSourceFill;
        ctx2d.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      } else if (isNeighbor) {
        ctx2d.strokeStyle = neighborStroke;
        ctx2d.lineWidth = 1.5;
        ctx2d.setLineDash([4, 3]);
        ctx2d.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        ctx2d.setLineDash([]);
        ctx2d.fillStyle = neighborFill;
        ctx2d.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      }
    }

    // --- Lock badge ---
    if (locks.has(fid) && occ !== undefined && !isFixt) {
      const badgeSize = Math.max(10, Math.round(view.cellSize * 0.22));
      const bx = r.x + r.w - badgeSize - 2;
      const by = r.y + 2;
      ctx2d.fillStyle = lockBadgeFill;
      ctx2d.fillRect(bx, by, badgeSize, badgeSize);
      ctx2d.fillStyle = lockBadgeText;
      ctx2d.font = `bold ${Math.max(8, badgeSize - 3).toString()}px sans-serif`;
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.fillText('🔒', bx + badgeSize / 2, by + badgeSize / 2);
    }
  }

  // --- Assigner mode: pulsing highlight ring around first-selected desk (§13.6) ---
  if (assignerModeActive && markerFirstFid !== null) {
    const srcF = classroom.furniture.find((f) => f.id === markerFirstFid);
    if (srcF !== undefined) {
      const r = furnitureToPixelRect(srcF, view.cellSize);

      // Pulse: alpha oscillates between 0.6 and 1.0 at ~2 Hz
      const pulse = 0.80 + 0.20 * Math.sin((Date.now() / 1000) * Math.PI * 2 * 2);

      // Outer glow fill — uses assignerPulseGlowBase (255,152,0 = #ff9800) with animated alpha
      // assignerPulseGlowBase token = '#ff6f00' (deep orange); alpha interpolated at runtime
      ctx2d.fillStyle = `rgba(255, 152, 0, ${(0.22 * pulse).toFixed(3)})`;
      ctx2d.fillRect(r.x, r.y, r.w, r.h);

      // Inner thick amber ring (inset by 1px so it sits inside the furniture cell)
      // assignerPulseOrange token = '#e65100' → rgb(230,100,0)
      const inset = 1;
      ctx2d.strokeStyle = `rgba(230, 100, 0, ${pulse.toFixed(3)})`;
      ctx2d.lineWidth = 4;
      ctx2d.strokeRect(r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2);

      // Outer ring — assignerPulseAmber token = '#ff9800' → rgb(255,193,7 approx)
      ctx2d.strokeStyle = `rgba(255, 193, 7, ${(0.7 * pulse).toFixed(3)})`;
      ctx2d.lineWidth = 1.5;
      ctx2d.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    }
  }

  // --- Drag ghost (floating label under the pointer) ---
  if (!assignerModeActive && dragStudent !== null && dragCanvasPos !== null) {
    const label = dragStudent.name;
    const ghostW = Math.max(70, label.length * 7 + 16);
    const ghostH = 26;
    const gx = dragCanvasPos.x - ghostW / 2;
    const gy = dragCanvasPos.y - ghostH / 2;

    ctx2d.fillStyle = dragGhostFill;
    ctx2d.beginPath();
    const rad = 4;
    ctx2d.moveTo(gx + rad, gy);
    ctx2d.lineTo(gx + ghostW - rad, gy);
    ctx2d.quadraticCurveTo(gx + ghostW, gy, gx + ghostW, gy + rad);
    ctx2d.lineTo(gx + ghostW, gy + ghostH - rad);
    ctx2d.quadraticCurveTo(gx + ghostW, gy + ghostH, gx + ghostW - rad, gy + ghostH);
    ctx2d.lineTo(gx + rad, gy + ghostH);
    ctx2d.quadraticCurveTo(gx, gy + ghostH, gx, gy + ghostH - rad);
    ctx2d.lineTo(gx, gy + rad);
    ctx2d.quadraticCurveTo(gx, gy, gx + rad, gy);
    ctx2d.closePath();
    ctx2d.fill();

    ctx2d.strokeStyle = dragGhostStroke;
    ctx2d.lineWidth = 1;
    ctx2d.stroke();

    ctx2d.fillStyle = dragGhostText;
    ctx2d.font = `bold ${Math.min(13, Math.max(10, view.cellSize / 4)).toString()}px sans-serif`;
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText(label, gx + ghostW / 2, gy + ghostH / 2);
  }

  ctx2d.restore();
}

// ---------------------------------------------------------------------------
// Context menu state type
// ---------------------------------------------------------------------------

interface ContextMenuState {
  x: number;
  y: number;
  fid: FurnitureId;
  studentName: string;
  isLocked: boolean;
  neighborCount: number;
}

// ---------------------------------------------------------------------------
// Toolbar component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// §13.6 — AssignerHint: toolbar strip that names the first-selected student
// ---------------------------------------------------------------------------

/**
 * Renders a coloured hint banner when the first student is selected in assigner
 * mode. The banner is driven by `setAssignerFirstStudentCallback` so the canvas
 * event handler (running outside React) can update it.
 *
 * Rendered inside StudentToolbar so it stays in the toolbar row.
 */
const AssignerHint: React.FC = () => {
  const [firstName, setFirstName] = useState<string | null>(null);

  // Register / unregister the callback bridge so canvas events can update us.
  useEffect(() => {
    setAssignerFirstStudentCallback = setFirstName;
    return () => {
      setAssignerFirstStudentCallback = null;
    };
  }, []);

  if (firstName === null) return null;

  return (
    <span
      data-testid="assigner-hint"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 10px',
        borderRadius: 4,
        background: assignerHintBackground,
        color: assignerHintText,
        fontSize: '0.8rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        animation: 'pulseBg 1s ease-in-out infinite',
      }}
    >
      Linking <em style={{ fontStyle: 'normal', textDecoration: 'underline' }}>{firstName}</em>…
      click another student (ESC to cancel)
    </span>
  );
};

// (WEIGHT_OPTIONS moved to WeightSelector.tsx as WEIGHT_OPTIONS export — §6.A1)
// (SplitButton removed in §5.B4 — algorithm + variant moved to SettingsMenu; toolbar shows single Allocate button)

// ---------------------------------------------------------------------------
// §6.A3 — AssignerToggleLever: a clear on/off toggle lever for assigner mode
// Rendered in the top bar in the same section as the weight selector.
// ---------------------------------------------------------------------------

/**
 * Toggle lever for assigner mode. Styled clearly with ON/OFF states:
 * - OFF: neutral button with label
 * - ON : filled amber/orange button to signal the mode is active
 */
const AssignerToggleLever: React.FC<{ on: boolean; onToggle: () => void }> = ({ on, onToggle }) => {
  return (
    <button
      type="button"
      data-testid="assigner-toggle-lever"
      aria-pressed={on}
      onClick={onToggle}
      title={
        on
          ? 'Assigner mode ON — click two students on the canvas to link them. ESC to cancel.'
          : 'Enable assigner mode to link students by clicking them on the canvas'
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 10px',
        borderRadius: 4,
        border: `1px solid ${on ? assignerHintBackground : btnBorder}`,
        background: on ? assignerHintBackground : btnBackground,
        color: on ? assignerHintText : textDark,
        cursor: 'pointer',
        fontSize: '0.82rem',
        fontWeight: on ? 700 : 400,
        whiteSpace: 'nowrap',
        transition: 'background 0.12s, color 0.12s',
      }}
    >
      {/* Lever track + knob for obvious ON/OFF visual */}
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 28,
          height: 14,
          borderRadius: 7,
          background: on ? assignerHintText : '#ccc',
          position: 'relative',
          transition: 'background 0.12s',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: 'block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: on ? assignerHintBackground : '#888',
            position: 'absolute',
            top: 2,
            left: on ? 16 : 2,
            transition: 'left 0.12s, background 0.12s',
          }}
        />
      </span>
      {on ? 'Assigner ON' : 'Assigner'}
    </button>
  );
};

// ---------------------------------------------------------------------------
// §13.8 — SeatingIssuesBanner
//
// Non-blocking warning / error banner shown below the Students toolbar whenever
// the current seating has problems (more students than seats, or unplaced
// students after an allocate/shuffle). The domain keeps messages OUT — the
// banner translates structured SeatingIssue data into human-readable text.
//
// Updates live: useSeatingIssues() subscribes to classroom + roster separately
// so it re-renders whenever either changes without the infinite-loop footgun
// that direct use of selectSeatingIssues would cause in Zustand v5.
// ---------------------------------------------------------------------------

const SeatingIssuesBanner: React.FC = () => {
  // useSeatingIssues() subscribes to classroom + roster as stable primitives and
  // derives the result with useMemo.  Do NOT replace this with
  // usePijonStore(selectSeatingIssues) — that returns a fresh object every call
  // and would cause an infinite render loop under Zustand v5.
  const result = useSeatingIssues();

  // Nothing to show when seating is valid.
  if (result.valid) return null;

  // Separate the two issue kinds for distinct messaging.
  const overCapacity = result.issues.find((i) => i.kind === 'over-capacity');
  const unplaced = result.issues.find((i) => i.kind === 'unplaced');

  // Build message parts.
  //
  // Redundancy UX decision (§13.8):
  //   When over-capacity is present, it already fully explains WHY students are
  //   unplaced — the shortage is structural.  Surfacing a separate "X students
  //   currently unplaced" sub-message alongside "X students can't be seated"
  //   duplicates information and makes the banner feel alarmist.  We therefore
  //   suppress the unplaced sub-message when over-capacity is the root cause.
  //
  //   When unplaced is the ONLY issue (enough seats exist but the arrangement is
  //   partial), we surface it explicitly so the teacher knows to run Allocate.
  const parts: string[] = [];

  if (overCapacity?.kind === 'over-capacity') {
    parts.push(
      `${overCapacity.studentCount.toString()} students, ${overCapacity.seatCount.toString()} seats` +
      ` — ${overCapacity.shortfall.toString()} student${overCapacity.shortfall !== 1 ? 's' : ''} can't be seated`,
    );
    // Unplaced sub-message intentionally omitted here: over-capacity already
    // explains why students are unplaced (structural shortage).
  } else if (unplaced?.kind === 'unplaced') {
    // Unplaced-only: enough seats exist but arrangement is partial.
    parts.push(
      `${unplaced.count.toString()} student${unplaced.count !== 1 ? 's' : ''} not seated` +
      ` (empty seats available — run Allocate to fill them)`,
    );
  }

  // Pick colour: error (red) when seats are genuinely insufficient; warning
  // (amber) when seats exist but some students haven't been placed yet.
  const isError = overCapacity !== undefined;

  const bannerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 12px',
    background: isError ? bannerErrorBackground : bannerAmberBackground,
    borderBottom: `1px solid ${isError ? bannerErrorBorder : bannerAmberBorder}`,
    fontSize: '0.8rem',
    color: isError ? bannerErrorText : bannerAmberText,
    fontWeight: 500,
    lineHeight: 1.4,
  };

  const iconStyle: React.CSSProperties = {
    flexShrink: 0,
    fontSize: '1rem',
  };

  return (
    <div
      data-testid="seating-issues-banner"
      role="alert"
      aria-live="polite"
      style={bannerStyle}
    >
      <span style={iconStyle}>{isError ? '⚠' : 'ℹ'}</span>
      <span>{parts.join(' · ')}</span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// StudentToolbar — §5.B4 order: Allocate · Clear · Undo/Redo · weights · Export · Import · Settings
// ---------------------------------------------------------------------------

const StudentToolbar: React.FC<{ ctx: EditorContext }> = ({ ctx }) => {
  // §5.B4: algorithm id + variant owned by the toolbar, passed into SettingsMenu.
  // Default: Greedy algorithm, Allocate variant.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const [algorithmId, setAlgorithmId] = useState<string>(ALLOCATOR_REGISTRY[0]!.id);
  const [variant, setVariant] = useState<ActionVariant>('allocate');

  // §5.B4: showLinks owned by toolbar, passed into SettingsMenu + drives canvas via module var.
  const [showLinksState, setShowLinksState] = useState(false);

  // §5.B3/6.A1: track active weight in local state so aria-pressed re-renders correctly.
  const [activeWeight, setActiveWeight] = useState(currentWeight);

  // §6.A3 — Assigner toggle lever: moved here from SidePanel.
  const [assignerOn, setAssignerOn] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsAnchorRef = useRef<HTMLDivElement>(null);

  // Keep module-level showLinks in sync with toolbar state
  useEffect(() => {
    showLinks = showLinksState;
    ctx.canvas.requestRepaint();
  }, [showLinksState, ctx.canvas]);

  // §6.A3 — Keep module-level assignerModeActive in sync with toolbar assigner toggle.
  // Mirrors the effect that was in StudentRosterPanel; moved here for §6.A3.
  useEffect(() => {
    assignerModeActive = assignerOn;
    if (!assignerOn) {
      markerFirstFid = null;
      markerFirstStudent = null;
      stopPulseLoop();
      if (setAssignerFirstStudentCallback !== null) {
        setAssignerFirstStudentCallback(null);
      }
    }
    // §6.A4 — notify App so ClassroomCanvas cursor updates
    if (assignerCursorListener !== null) {
      assignerCursorListener(assignerOn);
    }
    ctx.canvas.requestRepaint();
  }, [assignerOn, ctx.canvas]);

  // §6.A3 — Register setAssignerModeCallback so deactivate() can reset the toolbar toggle.
  useEffect(() => {
    setAssignerModeCallback = setAssignerOn;
    return () => {
      setAssignerModeCallback = null;
    };
  }, []);

  const canUndo = ctx.store.historyPtr > 0;
  const canRedo = ctx.store.historyPtr < ctx.store.history.length - 1;

  /** Build the Allocator instance from the currently-selected algorithm. */
  const makeAllocator = useCallback((): Allocator => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const entry = ALLOCATOR_REGISTRY.find((e) => e.id === algorithmId) ?? ALLOCATOR_REGISTRY[0]!;
    return entry.factory();
  }, [algorithmId]);

  // §5.B4 — single Allocate button (variant + algorithm chosen via Settings)
  const handleRun = useCallback(() => {
    const allocator = makeAllocator();
    if (variant === 'allocate') {
      ctx.store.allocate(allocator);
    } else {
      ctx.store.smartShuffle(allocator);
    }
    clearGraphCache();
    ctx.canvas.requestRepaint();
  }, [makeAllocator, variant, ctx.store, ctx.canvas]);

  const handleClear = () => {
    ctx.store.clearArrangement();
    dragSourceFid = null;
    dragStudent = null;
    dragCanvasPos = null;
    dragHoverFid = null;
    neighborPreviewFid = null;
    clearGraphCache();
    ctx.canvas.requestRepaint();
  };

  const handleUndo = () => {
    ctx.store.undo();
    clearGraphCache();
    ctx.canvas.requestRepaint();
  };

  const handleRedo = () => {
    ctx.store.redo();
    clearGraphCache();
    ctx.canvas.requestRepaint();
  };

  // §5.B4 — Export .pijon project file
  const handleExportPijon = () => {
    if (ctx.persistence === null) {
      console.warn('[StudentEditor] Persistence not yet available.');
      return;
    }
    void ctx.persistence.saveToFile();
  };

  // §5.B4 — Import .pijon project file
  const handleImportPijon = () => {
    if (ctx.persistence === null) {
      console.warn('[StudentEditor] Persistence not yet available.');
      return;
    }
    void ctx.persistence.openFromFile();
  };

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const handleToggleShowLinks = useCallback(() => {
    setShowLinksState((prev) => !prev);
  }, []);

  const btn: React.CSSProperties = {
    padding: '4px 10px',
    borderRadius: 4,
    border: `1px solid ${btnBorder}`,
    background: btnBackground,
    cursor: 'pointer',
    fontSize: '0.82rem',
    whiteSpace: 'nowrap',
  };

  const btnDisabled: React.CSSProperties = { ...btn, opacity: 0.45, cursor: 'default' };

  const allocateBtn: React.CSSProperties = {
    padding: '4px 12px',
    borderRadius: 4,
    border: `1px solid ${primaryButtonBorder}`,
    background: primaryButtonBackground,
    color: primaryButtonText,
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  };

  return (
    <>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 4,
          padding: '5px 10px',
          background: toolbarBackground,
          borderBottom: `1px solid ${toolbarBorder}`,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '0.88rem', marginRight: 6, color: textDark }}>
          Students
        </span>

        {/* §5.B4 — Single Allocate button (replaces SplitButton) */}
        <button
          type="button"
          style={allocateBtn}
          onClick={handleRun}
          data-testid="allocate-btn"
          title={variant === 'allocate' ? 'Assign all students to desks from scratch' : 'Re-seat respecting preferences (locked seats stay)'}
        >
          Allocate
        </button>

        <span style={{ borderLeft: `1px solid ${divider}`, height: 20, margin: '0 2px' }} />

        <button style={btn} type="button" onClick={handleClear}>
          Clear
        </button>

        <span style={{ borderLeft: `1px solid ${divider}`, height: 20, margin: '0 2px' }} />

        <button
          style={canUndo ? btn : btnDisabled}
          type="button"
          onClick={canUndo ? handleUndo : undefined}
          disabled={!canUndo}
          title="Undo"
        >
          ↩ Undo
        </button>
        <button
          style={canRedo ? btn : btnDisabled}
          type="button"
          onClick={canRedo ? handleRedo : undefined}
          disabled={!canRedo}
          title="Redo"
        >
          Redo ↪
        </button>

        <span style={{ borderLeft: `1px solid ${divider}`, height: 20, margin: '0 2px' }} />

        {/* §6.A1/5.B3 — Weight selector: shared WeightSelector component */}
        <WeightSelector
          value={activeWeight}
          onChange={(w) => {
            currentWeight = w;
            setActiveWeight(w);
            // Also push into SidePanel for its weight display (legacy sync)
            if (setCurrentWeightCallback !== null) {
              setCurrentWeightCallback(w);
            }
          }}
        />

        {/* §6.A3 — Assigner-mode toggle lever (same section as weight selector) */}
        <AssignerToggleLever
          on={assignerOn}
          onToggle={() => { setAssignerOn((prev) => !prev); }}
        />

        <span style={{ borderLeft: `1px solid ${divider}`, height: 20, margin: '0 2px' }} />

        {/* §5.B4 — Export .pijon project file */}
        <button
          style={btn}
          type="button"
          onClick={handleExportPijon}
          data-testid="toolbar-export-pijon"
          title="Export project as .pijon file"
        >
          Export
        </button>

        {/* §5.B4 — Import .pijon project file */}
        <button
          style={btn}
          type="button"
          onClick={handleImportPijon}
          data-testid="toolbar-import-pijon"
          title="Import project from .pijon file"
        >
          Import
        </button>

        <span style={{ borderLeft: `1px solid ${divider}`, height: 20, margin: '0 2px' }} />

        {/* §13.6 — Assigner hint banner (appears when first student is selected) */}
        <AssignerHint />

        {/* §13.3 Settings gear button + popover (§13.4 Nearness, §13.5 Violations, §5.B4 Algorithm/Variant/ShowLinks) */}
        <div ref={settingsAnchorRef} style={{ position: 'relative', marginLeft: 'auto' }}>
          <GearButton open={settingsOpen} onClick={() => { setSettingsOpen((prev) => !prev); }} />
          <SettingsMenu
            ctx={ctx}
            open={settingsOpen}
            onClose={handleCloseSettings}
            algorithmId={algorithmId}
            onChangeAlgorithm={setAlgorithmId}
            variant={variant}
            onChangeVariant={setVariant}
            showLinks={showLinksState}
            onToggleShowLinks={handleToggleShowLinks}
          />
        </div>
      </div>

      {/* §13.8 — Seating issues banner: shown below toolbar, non-blocking, live */}
      <SeatingIssuesBanner />
    </>
  );
};

// ---------------------------------------------------------------------------
// SidePanel — roster panel (left panel)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// §6.A2 — PrefDetailPanel: inline preference detail beneath a selected student
// ---------------------------------------------------------------------------

/**
 * Renders the expanded preference detail beneath a selected roster student.
 * Shows: student name, one row per existing preference (name | WeightSelector | ✕),
 * and a control to add a new student to their prefs.
 * NO assigner toggle (that lives in the toolbar per §6.A3).
 */
const PrefDetailPanel: React.FC<{
  student: Student;
  roster: readonly Student[];
  nameMap: Map<StudentId, string>;
  displayWeight: number;
  ctx: EditorContext;
  onRemovePref: (pref: Preference) => void;
}> = ({ student, roster, nameMap, displayWeight, ctx, onRemovePref }) => {
  // Local state for the "add another student" control
  const [addTargetId, setAddTargetId] = useState<string>('');

  // Compute students not already linked and not self
  const linkedIds = new Set<string>(
    student.preferences.filter((p) => p.kind === 'student').map((p) => p.targetId),
  );
  const addableStudents = roster.filter(
    (r) => !r.isFixture && r.id !== student.id && !linkedIds.has(r.id),
  );

  const handleAddPref = useCallback(() => {
    if (addTargetId === '') return;
    ctx.store.setMutualPreference(
      student.id,
      addTargetId as StudentId,
      currentWeight,
    );
    ctx.canvas.requestRepaint();
    setAddTargetId('');
  }, [addTargetId, ctx, student.id]);

  const studentOnlyPrefs = student.preferences.filter((p) => p.kind === 'student');
  const otherPrefs = student.preferences.filter((p) => p.kind !== 'student');

  return (
    <div
      data-testid="student-pref-detail"
      style={{
        background: selectedStudentHeaderBackground,
        borderLeft: `3px solid ${rosterSelectedBorder}`,
        borderBottom: `1px solid ${dividerLight}`,
        padding: '6px 8px',
      }}
    >
      {/* Student name heading */}
      <div
        style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          color: rosterSelectedBorder,
          marginBottom: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {student.name}
      </div>

      {/* Student-kind preference rows: name | WeightSelector | ✕ */}
      {studentOnlyPrefs.length === 0 && otherPrefs.length === 0 ? (
        <div style={{ fontSize: '0.7rem', color: textDisabled, fontStyle: 'italic', marginBottom: 4 }}>
          No preferences yet. Use Assigner or drag.
        </div>
      ) : (
        <>
          {studentOnlyPrefs.map((pref, idx) => {
            const targetName = nameMap.get(pref.targetId) ?? pref.targetId;
            return (
              <div
                key={`sp-${idx.toString()}`}
                data-testid={`pref-row-${idx.toString()}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '2px 0',
                  borderBottom: `1px solid ${dividerLight}`,
                  fontSize: '0.7rem',
                }}
              >
                {/* Target student name */}
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: textDark,
                    minWidth: 0,
                  }}
                  title={targetName}
                >
                  {targetName}
                </span>

                {/* Weight selector — compact variant; changes update mutual pref */}
                <WeightSelector
                  value={pref.weight}
                  onChange={(w) => {
                    ctx.store.setMutualPreference(student.id, pref.targetId, w);
                    ctx.canvas.requestRepaint();
                  }}
                  testIdPrefix={`pref-row-${idx.toString()}-`}
                  compact
                />

                {/* ✕ remove */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRemovePref(pref); }}
                  style={{
                    flexShrink: 0,
                    padding: '1px 4px',
                    fontSize: '0.65rem',
                    border: `1px solid ${dangerButtonBorder}`,
                    borderRadius: 3,
                    background: dangerButtonBackground,
                    color: dangerButtonText,
                    cursor: 'pointer',
                  }}
                  title="Remove this preference"
                  data-testid={`pref-row-${idx.toString()}-remove`}
                >
                  ✕
                </button>
              </div>
            );
          })}

          {/* Non-student prefs (furniture / location): show read-only with just ✕ */}
          {otherPrefs.map((pref, idx) => {
            let targetLabel: string;
            if (pref.kind === 'furniture') {
              targetLabel = `Desk: ${pref.targetId}`;
            } else {
              targetLabel = `Loc: ${pref.target}`;
            }
            const dirColor = pref.weight > 0 ? prefPreferText : prefAvoidText;
            return (
              <div
                key={`op-${idx.toString()}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '2px 0',
                  borderBottom: `1px solid ${dividerLight}`,
                  fontSize: '0.7rem',
                }}
              >
                <span style={{ color: dirColor, flexShrink: 0, fontWeight: 700 }}>
                  {pref.weight > 0 ? '+' : ''}
                  {pref.weight.toFixed(0)}
                </span>
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: textMuted,
                  }}
                >
                  {targetLabel}
                </span>
                {pref.kind !== 'location' && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemovePref(pref); }}
                    style={{
                      flexShrink: 0,
                      padding: '1px 4px',
                      fontSize: '0.65rem',
                      border: `1px solid ${dangerButtonBorder}`,
                      borderRadius: 3,
                      background: dangerButtonBackground,
                      color: dangerButtonText,
                      cursor: 'pointer',
                    }}
                    title="Remove this preference"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* Add another student to prefs — current weight from toolbar is used */}
      {addableStudents.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 3,
            marginTop: 5,
            alignItems: 'center',
          }}
        >
          <select
            value={addTargetId}
            onChange={(e) => { setAddTargetId(e.target.value); }}
            data-testid="add-pref-select"
            style={{
              flex: 1,
              fontSize: '0.7rem',
              padding: '2px 3px',
              borderRadius: 3,
              border: `1px solid ${btnBorder}`,
              minWidth: 0,
            }}
            aria-label="Add preference for student"
          >
            <option value="">+ Add student…</option>
            {addableStudents.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleAddPref}
            disabled={addTargetId === ''}
            data-testid="add-pref-btn"
            style={{
              flexShrink: 0,
              padding: '2px 6px',
              fontSize: '0.7rem',
              borderRadius: 3,
              border: `1px solid ${addStudentButtonBorder}`,
              background: addTargetId === '' ? disabledButtonBackground : addStudentButtonBackground,
              color: addStudentButtonText,
              cursor: addTargetId === '' ? 'default' : 'pointer',
              fontWeight: 600,
            }}
            aria-label="Add preference"
          >
            Add
          </button>
        </div>
      )}

      {/* Show current weight from toolbar as a hint */}
      <div style={{ marginTop: 4, fontSize: '0.68rem', color: textMuted }}>
        Next weight: <span style={{ fontWeight: 700, color: displayWeight < 0 ? prefAvoidText : prefPreferText }}>
          {displayWeight > 0 ? '+' : ''}{displayWeight.toFixed(1)}
        </span>
        <span style={{ marginLeft: 3, color: textDisabled }}>(set in toolbar)</span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// §6.A2 — Roster panel with redesigned inline preference detail.
// ---------------------------------------------------------------------------

/**
 * §6.A2 — Roster panel with redesigned inline preference detail.
 * Order (top to bottom):
 *   1. Header
 *   2. Student count badge
 *   3. Scrollable student list: each student row; when selected: name + pref rows + add control
 *   4. Manual add-student form — just above Import CSV
 *   5. Import CSV (bottom-most control)
 *
 * The assigner toggle has moved to StudentToolbar (§6.A3).
 */
const StudentRosterPanel: React.FC<{ ctx: EditorContext }> = ({ ctx }) => {
  const roster = ctx.store.roster;
  const selectedStudentId = ctx.store.selectedStudentId;
  const [addName, setAddName] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [importStatus, setImportStatus] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // §5.B3 — weight display state: tracks currentWeight for aria-pressed rendering
  // (kept for the "current weight" display; no longer drives an assigner toggle)
  const [displayWeight, setDisplayWeight] = useState(currentWeight);

  // §5.B3 — Register setCurrentWeightCallback so toolbar weight buttons update this component
  useEffect(() => {
    setCurrentWeightCallback = setDisplayWeight;
    return () => {
      setCurrentWeightCallback = null;
    };
  }, []);

  const realStudents = roster.filter((s) => !s.isFixture);
  const fixtures = roster.filter((s) => s.isFixture);
  const nameMap = new Map<StudentId, string>(roster.map((s) => [s.id, s.name]));

  const handleAddStudent = useCallback(() => {
    const trimmed = addName.trim();
    if (trimmed === '') return;
    ctx.store.addStudent(trimmed);
    setAddName('');
  }, [addName, ctx.store]);

  const handleAddKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleAddStudent();
    },
    [handleAddStudent],
  );

  const handleStudentClick = useCallback(
    (id: StudentId) => {
      const next = selectedStudentId === id ? null : id;
      ctx.store.setSelectedStudentId(next);
    },
    [selectedStudentId, ctx.store],
  );

  const handleRemoveStudent = useCallback(
    (id: StudentId, e: React.MouseEvent) => {
      e.stopPropagation();
      ctx.store.removeStudent(id);
    },
    [ctx.store],
  );

  // §5.B1 — Pref removal (moves from RightPanel)
  const handleRemovePref = useCallback(
    (pref: Preference) => {
      if (selectedStudentId === null) return;
      if (pref.kind === 'location') return;
      if (pref.kind === 'furniture') {
        ctx.store.removePreference(selectedStudentId, pref.targetId);
        ctx.canvas.requestRepaint();
        return;
      }
      ctx.store.clearMutualPreference(selectedStudentId, pref.targetId);
      ctx.canvas.requestRepaint();
    },
    [selectedStudentId, ctx.store, ctx.canvas],
  );

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file === undefined) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result;
        if (typeof text !== 'string') {
          setImportStatus('Error: could not read file.');
          return;
        }
        const warns = ctx.store.importRosterFromCsv(text);
        setWarnings(warns);
        const totalStudents = ctx.store.roster.filter((s) => !s.isFixture).length;
        setImportStatus(`Imported — ${totalStudents.toString()} student(s) in roster.`);
      };
      reader.onerror = () => {
        setImportStatus('Error: could not read file.');
      };
      reader.readAsText(file, 'UTF-8');
      e.target.value = '';
    },
    [ctx.store],
  );

  const itemStyle: React.CSSProperties = {
    padding: '5px 8px',
    borderBottom: '1px solid #eee',
    fontSize: '0.8rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    userSelect: 'none',
  };

  return (
    <div
      style={{
        width: 220,
        minWidth: 200,
        display: 'flex',
        flexDirection: 'column',
        background: sidePanelBackground,
        borderRight: `1px solid ${panelBorder}`,
        overflowY: 'hidden',
        height: '100%',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 10px 4px',
          fontWeight: 700,
          fontSize: '0.78rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: sidePanelHeaderText,
          borderBottom: `1px solid ${panelBorder}`,
        }}
      >
        Roster
      </div>

      {/* Student count badge */}
      <div
        style={{
          padding: '3px 10px',
          fontSize: '0.72rem',
          color: textMuted,
          borderBottom: `1px solid ${dividerLight}`,
        }}
      >
        {realStudents.length === 0
          ? 'No students loaded'
          : `${realStudents.length.toString()} student${realStudents.length !== 1 ? 's' : ''}`}
        {fixtures.length > 0 && `, ${fixtures.length.toString()} fixture${fixtures.length !== 1 ? 's' : ''}`}
      </div>

      {/* Scrollable student list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {realStudents.map((s) => {
          const isSelected = s.id === selectedStudentId;
          return (
            <div key={s.id}>
              {/* Student row */}
              <div
                role="button"
                tabIndex={0}
                draggable
                onDragStart={(e) => {
                  // §13.7 — set studentId payload + stash for Firefox/Safari fallback
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData(DRAG_STUDENT_ID_KEY, s.id);
                  e.dataTransfer.setData('text/plain', s.id);
                  stashDraggedStudentId(s.id);
                  // Suppress default ghost image so only our canvas overlay is visible
                  e.dataTransfer.setDragImage(getTransparentDragImage(), 0, 0);
                }}
                onDragEnd={() => {
                  // Clear stash regardless of whether drop was accepted
                  clearDraggedStudentIdStash();
                }}
                style={{
                  ...itemStyle,
                  background: isSelected ? rosterSelectedBackground : undefined,
                  borderLeft: isSelected ? `3px solid ${rosterSelectedBorder}` : '3px solid transparent',
                  cursor: 'grab',
                }}
                onClick={() => { handleStudentClick(s.id); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') handleStudentClick(s.id);
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {s.name}
                </span>
                {s.preferences.length > 0 && (
                  <span
                    style={{
                      flexShrink: 0,
                      marginLeft: 4,
                      fontSize: '0.68rem',
                      color: prefCountBadgeText,
                      background: prefCountBadgeBackground,
                      borderRadius: 3,
                      padding: '1px 4px',
                    }}
                    title={`${s.preferences.length.toString()} preference(s)`}
                  >
                    {s.preferences.length}p
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => { handleRemoveStudent(s.id, e); }}
                  style={{
                    flexShrink: 0,
                    marginLeft: 4,
                    padding: '1px 5px',
                    fontSize: '0.68rem',
                    border: `1px solid ${dangerButtonBorder}`,
                    borderRadius: 3,
                    background: dangerButtonBackground,
                    color: dangerButtonText,
                    cursor: 'pointer',
                    lineHeight: 1,
                  }}
                  title={`Remove ${s.name}`}
                  aria-label={`Remove ${s.name}`}
                >
                  ×
                </button>
              </div>

              {/* §6.A2 — Redesigned inline preference detail (no assigner toggle here) */}
              {isSelected && (
                <PrefDetailPanel
                  student={s}
                  roster={roster}
                  nameMap={nameMap}
                  displayWeight={displayWeight}
                  ctx={ctx}
                  onRemovePref={handleRemovePref}
                />
              )}
            </div>
          );
        })}

        {fixtures.length > 0 && (
          <>
            <div
              style={{
                padding: '4px 8px 2px',
                fontSize: '0.68rem',
                color: textPlaceholder,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                borderTop: `1px solid ${dividerLight}`,
                marginTop: 4,
              }}
            >
              Fixtures
            </div>
            {fixtures.map((s) => (
              <div key={s.id} style={{ ...itemStyle, color: fixtureItemText, fontStyle: 'italic', borderLeft: '3px solid transparent' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.name}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Manual add-student form — just above Import CSV */}
      <div
        style={{
          padding: '8px 10px 6px',
          borderTop: `1px solid ${dividerLight}`,
        }}
      >
        <div style={{ fontSize: '0.72rem', color: textMedium, fontWeight: 600, marginBottom: 4 }}>
          Add student:
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            value={addName}
            onChange={(e) => { setAddName(e.target.value); }}
            onKeyDown={handleAddKeyDown}
            placeholder="Name…"
            style={{
              flex: 1,
              padding: '3px 6px',
              borderRadius: 4,
              border: `1px solid ${btnBorder}`,
              fontSize: '0.78rem',
              minWidth: 0,
            }}
            aria-label="New student name"
          />
          <button
            type="button"
            onClick={handleAddStudent}
            disabled={addName.trim() === ''}
            style={{
              padding: '3px 8px',
              borderRadius: 4,
              border: `1px solid ${addStudentButtonBorder}`,
              background: addName.trim() === '' ? disabledButtonBackground : addStudentButtonBackground,
              color: addStudentButtonText,
              cursor: addName.trim() === '' ? 'default' : 'pointer',
              fontSize: '0.78rem',
              fontWeight: 600,
              flexShrink: 0,
            }}
            aria-label="Add student"
          >
            Add
          </button>
        </div>
      </div>

      {/* Import CSV — bottom-most control */}
      <div style={{ padding: '0 10px 10px', borderTop: `1px solid ${dividerLight}` }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={handleImportClick}
          style={{
            width: '100%',
            padding: '5px 8px',
            background: addStudentButtonBackground,
            border: `1px solid ${addStudentButtonBorder}`,
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: '0.79rem',
            fontWeight: 600,
            color: addStudentButtonText,
          }}
          title="Choose a CSV file from your device — the file is read locally, never uploaded"
        >
          Import CSV…
        </button>

        {importStatus !== '' && (
          <div style={{ marginTop: 4, fontSize: '0.72rem', color: bannerInfoText }}>
            {importStatus}
          </div>
        )}

        {warnings.length > 0 && (
          <div
            style={{
              marginTop: 4,
              padding: '4px 6px',
              background: importWarningsBackground,
              borderRadius: 3,
              fontSize: '0.7rem',
              color: importWarningsText,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 2 }}>Warnings:</div>
            {warnings.map((w, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={i}>• {w}</div>
            ))}
          </div>
        )}
      </div>

      {/* Usage hint */}
      <div
        style={{
          padding: '4px 8px',
          fontSize: '0.68rem',
          color: textDisabled,
          lineHeight: 1.4,
          borderTop: `1px solid ${dividerLight}`,
        }}
      >
        Click to select. Drag to a desk. Right-click to lock.
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Context menu component (inline)
// ---------------------------------------------------------------------------

const StudentContextMenu: React.FC<{
  menuRef: React.RefObject<HTMLDivElement>;
  menu: ContextMenuState;
  locks: ReadonlySet<FurnitureId>;
  onLock: (fid: FurnitureId) => void;
  onUnlock: (fid: FurnitureId) => void;
  onClose: () => void;
}> = ({ menuRef, menu, locks, onLock, onUnlock, onClose }) => {
  const isLocked = locks.has(menu.fid);

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 999 }}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        ref={menuRef}
        style={{
          position: 'fixed',
          left: menu.x,
          top: menu.y,
          zIndex: 1000,
          background: contextMenuBackground,
          border: `1px solid ${contextMenuBorder}`,
          borderRadius: 5,
          boxShadow: `0 4px 12px ${contextMenuShadow}`,
          minWidth: 160,
          fontSize: '0.83rem',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            padding: '6px 12px',
            fontWeight: 700,
            borderBottom: `1px solid ${dividerLight}`,
            color: contextMenuHeaderText,
          }}
        >
          {menu.studentName}
        </div>

        <div style={{ padding: '4px 12px', color: contextMenuMutedText, fontSize: '0.76rem' }}>
          {menu.neighborCount} neighboring desk{menu.neighborCount !== 1 ? 's' : ''}
        </div>

        <div style={{ borderTop: `1px solid ${dividerLight}` }} />

        <div
          role="menuitem"
          tabIndex={0}
          style={{
            padding: '7px 12px',
            cursor: 'pointer',
            color: isLocked ? contextMenuLockText : contextMenuUnlockText,
          }}
          onClick={() => {
            if (isLocked) {
              onUnlock(menu.fid);
            } else {
              onLock(menu.fid);
            }
            onClose();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (isLocked) {
                onUnlock(menu.fid);
              } else {
                onLock(menu.fid);
              }
              onClose();
            }
          }}
        >
          {isLocked ? '🔓 Unlock from desk' : '🔒 Lock to this desk'}
        </div>
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// StudentSidePanelWithMenu — left panel + floating context menu
// ---------------------------------------------------------------------------

const StudentSidePanelWithMenu: React.FC<{ ctx: EditorContext }> = ({ ctx }) => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const locks = ctx.store.locks;
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => { setContextMenu(null); }, []);

  React.useEffect(() => {
    showContextMenuCallback = setContextMenu;
    closeContextMenuCallback = closeMenu;
    return () => {
      showContextMenuCallback = null;
      closeContextMenuCallback = null;
    };
  }, [closeMenu]);

  React.useEffect(() => {
    if (contextMenu === null) return;

    const handleWindowPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) {
        return;
      }
      closeMenu();
    };

    window.addEventListener('pointerdown', handleWindowPointerDown, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', handleWindowPointerDown, { capture: true });
    };
  }, [contextMenu, closeMenu]);

  const handleLock = (fid: FurnitureId) => {
    ctx.store.lockSeat(fid);
    ctx.canvas.requestRepaint();
  };

  const handleUnlock = (fid: FurnitureId) => {
    ctx.store.unlockSeat(fid);
    ctx.canvas.requestRepaint();
  };

  return (
    <>
      <StudentRosterPanel ctx={ctx} />
      {contextMenu !== null && (
        <StudentContextMenu
          menuRef={menuRef}
          menu={contextMenu}
          locks={locks}
          onLock={handleLock}
          onUnlock={handleUnlock}
          onClose={closeMenu}
        />
      )}
    </>
  );
};

// (AddPrefForm removed in §5.B2 — prefs created only via assigner mode + drag)

// (StudentPreferencesPanel removed in §5.B1 — preferences now shown inline in the SidePanel)

// ---------------------------------------------------------------------------
// Pointer / canvas helpers
// ---------------------------------------------------------------------------

function clientToCanvasPixel(
  clientX: number,
  clientY: number,
  view: CanvasView,
): { x: number; y: number } | null {
  const cell = view.cellAt(clientX, clientY);
  if (cell === undefined) return null;
  return {
    x: (cell.x + 0.5) * view.cellSize,
    y: (cell.y + 0.5) * view.cellSize,
  };
}

function findDraggableFurnitureAt(
  cell: { x: number; y: number },
  furniture: readonly Furniture[],
): Furniture | null {
  let found: Furniture | null = null;
  for (const f of furniture) {
    if (
      cell.x >= f.pos.x &&
      cell.x < f.pos.x + f.w &&
      cell.y >= f.pos.y &&
      cell.y < f.pos.y + f.h
    ) {
      found = f;
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// StudentEditor — the EditorMode instance
// ---------------------------------------------------------------------------

export const StudentEditor: EditorMode = {
  id: 'student',
  label: 'Students',

  Toolbar: StudentToolbar,
  SidePanel: StudentSidePanelWithMenu,
  // RightPanel removed in §5.B1 — preferences now shown inline in the SidePanel

  // ---- Lifecycle -----------------------------------------------------------

  activate(ctx: EditorContext): void {
    dragSourceFid = null;
    dragStudent = null;
    dragCanvasPos = null;
    dragHoverFid = null;
    neighborPreviewFid = null;
    markerFirstFid = null;
    markerFirstStudent = null;
    // §13.7 — clear roster-drag hover state on activate
    rosterDragHoverFid = null;
    clearDraggedStudentIdStash();
    // Reset mode flags so they match the SidePanel's fresh React state on re-mount.
    // (deactivate also resets these, but activate is the definitive guard against
    // any edge-case where deactivate didn't run cleanly before a re-activate.)
    assignerModeActive = false;
    showLinks = false;
    currentWeight = -1.0;
    // Wire the pulse repaint fn from the incoming context.
    pulseRepaintFn = () => { ctx.canvas.requestRepaint(); };
    clearGraphCache();
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deactivate(_ctx: EditorContext): void {
    dragSourceFid = null;
    dragStudent = null;
    dragCanvasPos = null;
    dragHoverFid = null;
    neighborPreviewFid = null;
    markerFirstFid = null;
    markerFirstStudent = null;
    assignerModeActive = false;
    // §13.7 — clear roster-drag state on deactivate
    rosterDragHoverFid = null;
    clearDraggedStudentIdStash();
    // §13.6: stop the pulse loop on deactivate — no leak to next editor
    stopPulseLoop();
    pulseRepaintFn = null;
    // Reset showLinks so it matches the toolbar's fresh useState(false) on re-mount.
    // Without this, toggling showLinks ON then switching editors and back would leave
    // the overlay rendering but the toolbar button showing the wrong state.
    showLinks = false;
    // Notify the React component to reset its toggle state
    if (setAssignerModeCallback !== null) {
      setAssignerModeCallback(false);
    }
    // §13.6: clear the toolbar hint
    if (setAssignerFirstStudentCallback !== null) {
      setAssignerFirstStudentCallback(null);
    }
    if (closeContextMenuCallback !== null) {
      closeContextMenuCallback();
    }
    showContextMenuCallback = null;
    closeContextMenuCallback = null;
    clearGraphCache();
  },

  // ---- Pointer events — routes to drag or assigner mode --------------------

  onPointerDown(e: PointerEvent, ctx: EditorContext): void {
    if (e.button !== 0) return;

    // Dismiss any open context menu on any left-click on the canvas.
    if (closeContextMenuCallback !== null) {
      closeContextMenuCallback();
    }

    const cell = ctx.canvas.cellAt(e.clientX, e.clientY);
    if (cell === undefined) return;

    if (assignerModeActive) {
      // ---- Assigner (marker) mode flow ------------------------------------
      const f = findDraggableFurnitureAt(cell, ctx.store.classroom.furniture);
      if (f === null) return;

      const occ = occupant(f);
      if (occ === undefined || occ.isFixture) return;
      if (isFurnitureFixture(f) || capacity(f) === 0) return;

      if (markerFirstFid === null) {
        // Step 1: select first student — push name into toolbar hint (§13.6)
        markerFirstFid = f.id;
        markerFirstStudent = occ;
        // Notify the React hint component
        if (setAssignerFirstStudentCallback !== null) {
          setAssignerFirstStudentCallback(occ.name);
        }
        // §13.6: start the pulse loop so the amber ring animates at ~60fps
        startPulseLoop();
        ctx.canvas.requestRepaint();
      } else {
        if (f.id === markerFirstFid) {
          // Self-target: no-op, keep selection
          return;
        }
        // Step 2: create mutual preference — clear the hint
        const student1 = markerFirstStudent;
        const student2 = occ;

        if (student1 !== null) {
          ctx.store.setMutualPreference(student1.id, student2.id, currentWeight);
        }

        markerFirstFid = null;
        markerFirstStudent = null;
        // §13.6: stop the pulse loop — markerFirstFid is now null
        stopPulseLoop();
        // Clear the toolbar hint
        if (setAssignerFirstStudentCallback !== null) {
          setAssignerFirstStudentCallback(null);
        }
        ctx.canvas.requestRepaint();
      }
    } else {
      // ---- Drag mode flow ------------------------------------------------
      const furniture = findDraggableFurnitureAt(cell, ctx.store.classroom.furniture);
      if (furniture === null) return;

      const occ = occupant(furniture);
      if (occ === undefined || occ.isFixture) return;

      dragSourceFid = furniture.id;
      dragStudent = occ;
      dragCanvasPos = clientToCanvasPixel(e.clientX, e.clientY, ctx.canvas) ?? dragCanvasPos;
      dragHoverFid = furniture.id;

      ctx.canvas.requestRepaint();
    }
  },

  onPointerMove(e: PointerEvent, ctx: EditorContext): void {
    if (assignerModeActive) return; // no drag in assigner mode
    if (dragSourceFid === null) return;

    const pos = clientToCanvasPixel(e.clientX, e.clientY, ctx.canvas);
    if (pos !== null) dragCanvasPos = pos;

    const cell = ctx.canvas.cellAt(e.clientX, e.clientY);
    if (cell !== undefined) {
      const f = findDraggableFurnitureAt(cell, ctx.store.classroom.furniture);
      if (f !== null && !isFurnitureFixture(f) && capacity(f) > 0) {
        dragHoverFid = f.id;
      } else {
        dragHoverFid = null;
      }
    } else {
      dragHoverFid = null;
    }

    ctx.canvas.requestRepaint();
  },

  onPointerUp(e: PointerEvent, ctx: EditorContext): void {
    if (e.button !== 0) return;
    if (assignerModeActive) return;
    if (dragSourceFid === null || dragStudent === null) return;

    const sourceFid = dragSourceFid;
    dragSourceFid = null;
    dragStudent = null;
    dragCanvasPos = null;

    const targetFid = dragHoverFid;
    dragHoverFid = null;

    if (targetFid !== null && targetFid !== sourceFid) {
      ctx.store.manualReassign(sourceFid, targetFid);
      if (ctx.store.locks.has(sourceFid)) ctx.store.unlockSeat(sourceFid);
      if (ctx.store.locks.has(targetFid)) ctx.store.unlockSeat(targetFid);
      clearGraphCache();
    }

    ctx.canvas.requestRepaint();
  },

  // ---- Keyboard — ESC cancels assigner selection ---------------------------

  onKeyDown(e: KeyboardEvent, ctx: EditorContext): void {
    if (e.key !== 'Escape') return;
    if (assignerModeActive && markerFirstFid !== null) {
      markerFirstFid = null;
      markerFirstStudent = null;
      // §13.6: stop the pulse loop and clear the toolbar hint on ESC
      stopPulseLoop();
      if (setAssignerFirstStudentCallback !== null) {
        setAssignerFirstStudentCallback(null);
      }
      ctx.canvas.requestRepaint();
    }
  },

  // ---- Drop (§13.7 — roster-drag onto a desk) ------------------------------

  onDrop(e: DragEvent, ctx: EditorContext): void {
    e.preventDefault();

    // Always clear the stash and the hover highlight on drop
    clearDraggedStudentIdStash();
    rosterDragHoverFid = null;
    ctx.canvas.requestRepaint();

    // Read the dragged studentId
    const sid = readDraggedStudentId(e);
    if (sid === null) return;

    // Map the drop point to a grid cell → furniture
    const cell = ctx.canvas.cellAt(e.clientX, e.clientY);
    if (cell === undefined) return;

    const targetF = ctx.canvas.furnitureAt(cell);
    if (targetF === undefined) return;

    // Guard: must be an assignable, non-fixture desk
    if (capacity(targetF) === 0) return;
    if (isFurnitureFixture(targetF)) return;

    // Dispatch store action — handles move / swap / seat-from-unseated,
    // pushes history, clears locks, calls syncRosterToClassroom.
    ctx.store.assignStudentToFurniture(sid, targetF.id);

    // §13.7 — invalidate the SeatGraph cache so violations/neighbors refresh.
    clearGraphCache();

    ctx.canvas.requestRepaint();
  },

  // ---- DragOver (§13.7 — live drop-target highlight during roster-drag) ---

  onDragOver(e: DragEvent, ctx: EditorContext): void {
    // Read the dragged student id — if not a roster drag, ignore
    const sid = readDraggedStudentId(e);
    if (sid === null) {
      if (rosterDragHoverFid !== null) {
        rosterDragHoverFid = null;
        ctx.canvas.requestRepaint();
      }
      return;
    }

    e.preventDefault(); // accept the drop
    if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'move';

    const cell = ctx.canvas.cellAt(e.clientX, e.clientY);
    if (cell === undefined) {
      if (rosterDragHoverFid !== null) {
        rosterDragHoverFid = null;
        ctx.canvas.requestRepaint();
      }
      return;
    }

    const targetF = ctx.canvas.furnitureAt(cell);
    const newHover =
      targetF !== undefined && capacity(targetF) > 0 && !isFurnitureFixture(targetF)
        ? targetF.id
        : null;

    if (newHover !== rosterDragHoverFid) {
      rosterDragHoverFid = newHover;
      ctx.canvas.requestRepaint();
    }
  },

  // ---- DragEnd (§13.7 — clean up hover state if drag was cancelled) -------

  onDragEnd(_e: DragEvent, ctx: EditorContext): void {
    clearDraggedStudentIdStash();
    if (rosterDragHoverFid !== null) {
      rosterDragHoverFid = null;
      ctx.canvas.requestRepaint();
    }
  },

  // ---- Context menu — toggle lock + neighbor preview ----------------------

  onContextMenu(e: MouseEvent, ctx: EditorContext): void {
    e.preventDefault();

    const cell = ctx.canvas.cellAt(e.clientX, e.clientY);

    if (cell === undefined) {
      if (neighborPreviewFid !== null) {
        neighborPreviewFid = null;
        ctx.canvas.requestRepaint();
      }
      return;
    }

    const furniture = findDraggableFurnitureAt(cell, ctx.store.classroom.furniture);
    if (furniture === null) {
      if (neighborPreviewFid !== null) {
        neighborPreviewFid = null;
        ctx.canvas.requestRepaint();
      }
      return;
    }

    const fid = furniture.id;

    if (neighborPreviewFid === fid) {
      neighborPreviewFid = null;
    } else {
      neighborPreviewFid = fid;
    }
    ctx.canvas.requestRepaint();

    const occ = occupant(furniture);
    if (occ === undefined || occ.isFixture) return;

    // §13.4: use classroom.thresholdUnits (single source of truth)
    const graph = getSeatGraph(ctx.store.classroom, ctx.store.classroom.thresholdUnits);
    const neighborCount = graph.neighbors(fid).length;

    if (showContextMenuCallback !== null) {
      showContextMenuCallback({
        x: e.clientX,
        y: e.clientY,
        fid,
        studentName: occ.name,
        isLocked: ctx.store.locks.has(fid),
        neighborCount,
      });
    }
  },

  // ---- paintOverlay --------------------------------------------------------

  paintOverlay(ctx2d: CanvasRenderingContext2D, view: CanvasView): void {
    const state = usePijonStore.getState();
    paintStudentOverlay(
      ctx2d,
      view,
      state.classroom,
      state.locks,
      state.showViolations,           // §13.5: from store, default true
      state.classroom.thresholdUnits, // §13.4: classroom's single source of truth
    );
  },
};
