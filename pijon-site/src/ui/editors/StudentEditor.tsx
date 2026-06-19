/**
 * StudentEditor — Phase 8.
 *
 * An EditorMode that implements "The Teacher's Workflow":
 *   1. Import a student roster from CSV (SidePanel — FileReader, no network).
 *   2. Allocate / smart-shuffle students into desks via GreedyAllocator or BogoAllocator.
 *   3. Drag a student from one desk to another (swap if occupied, move if empty).
 *   4. Right-click a desk to toggle lock/unlock.
 *   5. Show neighbor preview (right-click) and violation highlighting (toolbar toggle).
 *   6. Export roster to full-format CSV (Blob download — no network).
 *   7. Undo / Redo.
 *
 * Design notes (same template as FurnitureEditor):
 *  - All transient drag / hover / neighbor state lives in module-level vars.
 *  - deactivate() clears all transient state + the cached SeatGraph.
 *  - paintOverlay() draws the delta: drag ghost, lock badges, violation tint, neighbor highlight.
 *  - SeatGraph is rebuilt only when the classroom or proximity threshold changes.
 *
 * Violation parity with prototype's _has_violation():
 *  Avoid-preferences (weight < 0) are checked bidirectionally:
 *    a) Student S at desk D: for each avoid-pref targeting student/fixture T,
 *       if T is currently seated and is a neighbor of D → violation.
 *    b) Bidirectional: for each OTHER placed student P who has an avoid-pref for S,
 *       if P's desk neighbors D → violation.
 *  Positive-weight (prefer) prefs are NOT flagged as violations here — matches the Python
 *  prototype which only highlights avoid violations, not unmet attract-preferences.
 *
 * Save/Load Arrangement:
 *  The PersistenceHandle is not reachable inside EditorMode (it lives in the App shell,
 *  Phase 9). The Save/Load buttons call console.warn stubs — Phase 9 passes real callbacks.
 *
 * LOCAL-FIRST: no fetch(), no XHR, no WebSocket. CSV import uses FileReader on a local file;
 * CSV export builds a Blob and triggers a <a> download — all in-memory.
 */

import React, { useState, useRef, useCallback } from 'react';
import type { EditorContext, EditorMode, CanvasView } from './EditorMode.js';
import type { FurnitureId } from '../../domain/types.js';
import type { Furniture } from '../../domain/furniture.js';
import { capacity, occupant, isFixture as isFurnitureFixture } from '../../domain/furniture.js';
import type { Student } from '../../domain/student.js';
import { SeatGraph, PROXIMITY_THRESHOLD } from '../../domain/seatGraph.js';
import { GreedyAllocator } from '../../domain/allocators/greedy.js';
import { BogoAllocator } from '../../domain/allocators/bogo.js';
import { exportCsv } from '../../domain/io/csv.js';
import type { Classroom } from '../../domain/classroom.js';
import { assignments as classroomAssignments } from '../../domain/classroom.js';
import { furnitureToPixelRect } from '../canvas/hitTest.js';
import { usePijonStore } from '../../state/store.js';

// ---------------------------------------------------------------------------
// Module-level transient state (mirrors FurnitureEditor pattern)
// Cleared on deactivate() so no artifacts leak on tool-switch.
// ---------------------------------------------------------------------------

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
/** The threshold the cache was built with. */
let cachedGraphThreshold: number = PROXIMITY_THRESHOLD;

/** Editor-local mutable state (shared with Toolbar/SidePanel via closure / store). */
let showViolations = false;
let nearness: number = PROXIMITY_THRESHOLD;

// ---------------------------------------------------------------------------
// SeatGraph cache helpers
// ---------------------------------------------------------------------------

/**
 * Return a SeatGraph for the given classroom + threshold.
 * Rebuilds only when classroom reference or threshold changed.
 */
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
}

// ---------------------------------------------------------------------------
// Violation logic (port of SeatingGrid._has_violation — bidirectional avoid)
// ---------------------------------------------------------------------------

/**
 * True when placing student S at desk fid violates any avoid-preference
 * (bidirectionally), using the current classroom assignments and the SeatGraph.
 *
 * Port of Python SeatingGrid._has_violation():
 *   a) S avoids someone who is currently a neighbor of fid.
 *   b) Someone who avoids S is seated at a neighbor of fid.
 *
 * Positive-weight prefs (prefer) are deliberately NOT flagged — only avoidances.
 */
function hasViolation(
  student: Student,
  fid: FurnitureId,
  arrangement: Map<FurnitureId, Student>,
  graph: SeatGraph,
): boolean {
  // Build studentId → furnitureId map (real students only, not the student itself)
  const sidToFid = new Map<string, FurnitureId>();
  for (const [f, s] of arrangement) {
    if (!s.isFixture && f !== fid) {
      sidToFid.set(s.id, f);
    }
  }

  // a) S's own avoid-preferences
  for (const pref of student.preferences) {
    if (pref.weight >= 0) continue; // only avoidances

    if (pref.kind === 'student') {
      const targetFid = sidToFid.get(pref.targetId);
      if (targetFid !== undefined && graph.areNeighbors(fid, targetFid)) {
        return true;
      }
    } else if (pref.kind === 'furniture') {
      // pref.targetId is a StudentId (fixture's student id) — look up via fixtureIdToFid
      const fixtureFid = graph.fixtureIdToFid.get(
        pref.targetId as import('../../domain/types.js').StudentId,
      );
      if (fixtureFid !== undefined && graph.areNeighbors(fid, fixtureFid)) {
        return true;
      }
    }
    // 'location' prefs are not graphed
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
// paintOverlay — draws on top of the base canvas pass
// ---------------------------------------------------------------------------

function paintOverlay(
  ctx2d: CanvasRenderingContext2D,
  view: CanvasView,
  classroom: Classroom,
  locks: ReadonlySet<FurnitureId>,
): void {
  ctx2d.save();

  const graph = getSeatGraph(classroom, nearness);
  const arrangement = classroomAssignments(classroom);

  // Build neighbor set for preview
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

    // --- Drag target highlight ---
    if (isDragTarget) {
      ctx2d.fillStyle = 'rgba(21, 101, 192, 0.22)';
      ctx2d.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx2d.strokeStyle = 'rgba(21, 101, 192, 0.9)';
      ctx2d.lineWidth = 2;
      ctx2d.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }

    // --- Drag source fade ---
    if (isDragSource) {
      ctx2d.fillStyle = 'rgba(200, 200, 200, 0.5)';
      ctx2d.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      ctx2d.restore();
      ctx2d.save();
      continue;
    }

    // --- Violation tint (show violations mode, real occupied desk) ---
    if (showViolations && occ !== undefined && !isFixt) {
      const violated = hasViolation(occ, fid, arrangement, graph);
      if (violated) {
        ctx2d.fillStyle = 'rgba(211, 47, 47, 0.22)';
        ctx2d.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
        ctx2d.strokeStyle = 'rgba(211, 47, 47, 0.8)';
        ctx2d.lineWidth = 1.5;
        ctx2d.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      }
    }

    // --- Neighbor preview highlight ---
    if (neighborPreviewFid !== null) {
      if (isNeighborSource) {
        ctx2d.strokeStyle = 'rgba(81, 45, 168, 0.9)';
        ctx2d.lineWidth = 2.5;
        ctx2d.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        ctx2d.fillStyle = 'rgba(81, 45, 168, 0.12)';
        ctx2d.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      } else if (isNeighbor) {
        ctx2d.strokeStyle = 'rgba(123, 31, 162, 0.55)';
        ctx2d.lineWidth = 1.5;
        ctx2d.setLineDash([4, 3]);
        ctx2d.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        ctx2d.setLineDash([]);
        ctx2d.fillStyle = 'rgba(123, 31, 162, 0.08)';
        ctx2d.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      }
    }

    // --- Lock badge (small padlock icon via unicode, top-right corner) ---
    if (locks.has(fid) && occ !== undefined && !isFixt) {
      const badgeSize = Math.max(10, Math.round(view.cellSize * 0.22));
      const bx = r.x + r.w - badgeSize - 2;
      const by = r.y + 2;
      ctx2d.fillStyle = 'rgba(245, 124, 0, 0.92)';
      ctx2d.fillRect(bx, by, badgeSize, badgeSize);
      ctx2d.fillStyle = '#fff';
      ctx2d.font = `bold ${Math.max(8, badgeSize - 3).toString()}px sans-serif`;
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.fillText('🔒', bx + badgeSize / 2, by + badgeSize / 2);
    }
  }

  // --- Drag ghost (floating label under the pointer) ---
  if (dragStudent !== null && dragCanvasPos !== null) {
    const label = dragStudent.name;
    const ghostW = Math.max(70, label.length * 7 + 16);
    const ghostH = 26;
    const gx = dragCanvasPos.x - ghostW / 2;
    const gy = dragCanvasPos.y - ghostH / 2;

    ctx2d.fillStyle = 'rgba(21, 101, 192, 0.88)';
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

    ctx2d.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx2d.lineWidth = 1;
    ctx2d.stroke();

    ctx2d.fillStyle = '#fff';
    ctx2d.font = `bold ${Math.min(13, Math.max(10, view.cellSize / 4)).toString()}px sans-serif`;
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText(label, gx + ghostW / 2, gy + ghostH / 2);
  }

  ctx2d.restore();
}

// ---------------------------------------------------------------------------
// Context menu component (tiny inline menu for lock/unlock + neighbor toggle)
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

const StudentToolbar: React.FC<{ ctx: EditorContext }> = ({ ctx }) => {
  const [algorithmChoice, setAlgorithmChoice] = useState<'greedy' | 'bogo'>('greedy');
  const [violationsOn, setViolationsOn] = useState(false);
  const [nearnessVal, setNearnessVal] = useState(PROXIMITY_THRESHOLD);

  const canUndo = ctx.store.historyPtr > 0;
  const canRedo = ctx.store.historyPtr < ctx.store.history.length - 1;

  const makeAllocator = () =>
    algorithmChoice === 'bogo' ? new BogoAllocator() : new GreedyAllocator();

  const handleAllocate = () => {
    ctx.store.allocate(makeAllocator());
    clearGraphCache();
    ctx.canvas.requestRepaint();
  };

  const handleSmartShuffle = () => {
    ctx.store.smartShuffle(makeAllocator());
    clearGraphCache();
    ctx.canvas.requestRepaint();
  };

  const handleClear = () => {
    ctx.store.clearArrangement();
    // Clear drag state too in case a drag was in progress
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

  const handleExportCsv = () => {
    const roster = ctx.store.roster;
    if (roster.length === 0) {
      alert('No students to export.');
      return;
    }
    const csv = exportCsv(roster);
    // Blob download — no network call
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'roster.csv';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a tick so the download can start
    setTimeout(() => { URL.revokeObjectURL(url); }, 500);
  };

  const handleToggleViolations = () => {
    const next = !violationsOn;
    setViolationsOn(next);
    showViolations = next;
    ctx.canvas.requestRepaint();
  };

  const handleNearnessChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!Number.isFinite(val) || val <= 0) return;
    setNearnessVal(val);
    nearness = val;
    clearGraphCache();
    ctx.canvas.requestRepaint();
  };

  const handleSave = () => {
    // Use persistence handle from EditorContext (wired by Phase 9 shell).
    if (ctx.persistence === null) {
      console.warn('[StudentEditor] Persistence not yet available.');
      return;
    }
    void ctx.persistence.saveToFile();
  };

  const handleLoad = () => {
    // Use persistence handle from EditorContext (wired by Phase 9 shell).
    if (ctx.persistence === null) {
      console.warn('[StudentEditor] Persistence not yet available.');
      return;
    }
    void ctx.persistence.openFromFile();
  };

  const btn: React.CSSProperties = {
    padding: '4px 10px',
    marginRight: 4,
    borderRadius: 4,
    border: '1px solid #bbb',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '0.82rem',
    whiteSpace: 'nowrap',
  };

  const btnDisabled: React.CSSProperties = { ...btn, opacity: 0.45, cursor: 'default' };
  const btnToggled: React.CSSProperties = { ...btn, background: '#1565c0', color: '#fff', borderColor: '#1565c0' };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 4,
        padding: '5px 10px',
        background: '#f5f5f5',
        borderBottom: '1px solid #ddd',
      }}
    >
      <span style={{ fontWeight: 700, fontSize: '0.88rem', marginRight: 6, color: '#333' }}>
        Students
      </span>

      {/* Algorithm picker */}
      <select
        value={algorithmChoice}
        onChange={(e) => { setAlgorithmChoice(e.target.value as 'greedy' | 'bogo'); }}
        style={{ fontSize: '0.8rem', padding: '3px 6px', borderRadius: 4, border: '1px solid #bbb', marginRight: 2 }}
        title="Seating algorithm"
      >
        <option value="greedy">Greedy</option>
        <option value="bogo">Random</option>
      </select>

      <button style={btn} type="button" onClick={handleAllocate} title="Assign all students to desks">
        Allocate
      </button>
      <button style={btn} type="button" onClick={handleSmartShuffle} title="Re-seat respecting preferences (locked seats stay)">
        Smart Shuffle
      </button>

      <span style={{ borderLeft: '1px solid #ddd', height: 20, margin: '0 4px' }} />

      <button style={btn} type="button" onClick={handleClear}>
        Clear
      </button>

      <span style={{ borderLeft: '1px solid #ddd', height: 20, margin: '0 4px' }} />

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

      <span style={{ borderLeft: '1px solid #ddd', height: 20, margin: '0 4px' }} />

      <button style={btn} type="button" onClick={handleExportCsv} title="Download roster as CSV">
        Export CSV
      </button>

      <span style={{ borderLeft: '1px solid #ddd', height: 20, margin: '0 4px' }} />

      <button
        style={violationsOn ? btnToggled : btn}
        type="button"
        onClick={handleToggleViolations}
        title="Highlight desks with avoid-preference violations"
      >
        {violationsOn ? '⚠ Violations ON' : 'Show Violations'}
      </button>

      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', marginLeft: 4 }}>
        <span style={{ color: '#555' }}>Nearness:</span>
        <input
          type="number"
          min="0.5"
          max="10"
          step="0.5"
          value={nearnessVal}
          onChange={handleNearnessChange}
          style={{ width: 58, padding: '2px 4px', borderRadius: 4, border: '1px solid #bbb', fontSize: '0.8rem' }}
          title="Proximity threshold (grid units). 1.5 = orthogonal + diagonal neighbors."
        />
      </label>

      <span style={{ borderLeft: '1px solid #ddd', height: 20, margin: '0 4px' }} />

      <button style={btn} type="button" onClick={handleSave} title="Save classroom to a .pijon file">
        Save Arr…
      </button>
      <button style={btn} type="button" onClick={handleLoad} title="Open a .pijon file">
        Load Arr…
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SidePanel — roster panel with CSV import
// ---------------------------------------------------------------------------

const StudentSidePanel: React.FC<{ ctx: EditorContext }> = ({ ctx }) => {
  const roster = ctx.store.roster;
  const [warnings, setWarnings] = useState<string[]>([]);
  const [importStatus, setImportStatus] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file === undefined) return;

      // Read file as text (FileReader — no network, no fetch)
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

      // Reset the file input so the same file can be re-imported
      e.target.value = '';
    },
    [ctx.store],
  );

  const realStudents = roster.filter((s) => !s.isFixture);
  const fixtures = roster.filter((s) => s.isFixture);

  const itemStyle: React.CSSProperties = {
    padding: '5px 8px',
    borderBottom: '1px solid #eee',
    fontSize: '0.8rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  return (
    <div
      style={{
        width: 170,
        minWidth: 150,
        display: 'flex',
        flexDirection: 'column',
        background: '#fafafa',
        borderRight: '1px solid #ddd',
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
          color: '#555',
          borderBottom: '1px solid #ddd',
        }}
      >
        Roster
      </div>

      {/* Import control */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #eee' }}>
        {/* Hidden file input — FileReader path, no network */}
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
            background: '#e3f2fd',
            border: '1px solid #90caf9',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: '0.79rem',
            fontWeight: 600,
            color: '#1565c0',
          }}
          title="Choose a CSV file from your device — the file is read locally, never uploaded"
        >
          Import CSV…
        </button>

        {importStatus && (
          <div style={{ marginTop: 4, fontSize: '0.72rem', color: '#2e7d32' }}>
            {importStatus}
          </div>
        )}

        {warnings.length > 0 && (
          <div
            style={{
              marginTop: 4,
              padding: '4px 6px',
              background: '#fff3e0',
              borderRadius: 3,
              fontSize: '0.7rem',
              color: '#e65100',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 2 }}>Warnings:</div>
            {warnings.map((w, i) => (
              // key uses index since warnings list is rebuilt on each import
              // eslint-disable-next-line react/no-array-index-key
              <div key={i}>• {w}</div>
            ))}
          </div>
        )}
      </div>

      {/* Student count badge */}
      <div
        style={{
          padding: '3px 10px',
          fontSize: '0.72rem',
          color: '#666',
          borderBottom: '1px solid #eee',
        }}
      >
        {realStudents.length === 0
          ? 'No students loaded'
          : `${realStudents.length.toString()} student${realStudents.length !== 1 ? 's' : ''}`}
        {fixtures.length > 0 && `, ${fixtures.length.toString()} fixture${fixtures.length !== 1 ? 's' : ''}`}
      </div>

      {/* Scrollable student list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {realStudents.map((s) => (
          <div key={s.id} style={itemStyle}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.name}
            </span>
            {s.preferences.length > 0 && (
              <span
                style={{
                  flexShrink: 0,
                  marginLeft: 4,
                  fontSize: '0.68rem',
                  color: '#888',
                  background: '#f0f0f0',
                  borderRadius: 3,
                  padding: '1px 4px',
                }}
                title={`${s.preferences.length.toString()} preference(s)`}
              >
                {s.preferences.length}p
              </span>
            )}
          </div>
        ))}

        {fixtures.length > 0 && (
          <>
            <div
              style={{
                padding: '4px 8px 2px',
                fontSize: '0.68rem',
                color: '#999',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                borderTop: '1px solid #eee',
                marginTop: 4,
              }}
            >
              Fixtures
            </div>
            {fixtures.map((s) => (
              <div key={s.id} style={{ ...itemStyle, color: '#9c27b0', fontStyle: 'italic' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.name}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Usage hint */}
      <div
        style={{
          padding: '6px 8px',
          fontSize: '0.68rem',
          color: '#aaa',
          lineHeight: 1.4,
          borderTop: '1px solid #eee',
        }}
      >
        Drag students between desks.
        <br />
        Right-click to lock / preview neighbors.
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Context menu (inline — no external dialog lib)
// ---------------------------------------------------------------------------

const StudentContextMenu: React.FC<{
  menu: ContextMenuState;
  locks: ReadonlySet<FurnitureId>;
  onLock: (fid: FurnitureId) => void;
  onUnlock: (fid: FurnitureId) => void;
  onClose: () => void;
}> = ({ menu, locks, onLock, onUnlock, onClose }) => {
  const isLocked = locks.has(menu.fid);

  return (
    <>
      {/* Backdrop to close the menu */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 999 }}
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        style={{
          position: 'fixed',
          left: menu.x,
          top: menu.y,
          zIndex: 1000,
          background: '#fff',
          border: '1px solid #ccc',
          borderRadius: 5,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          minWidth: 160,
          fontSize: '0.83rem',
          userSelect: 'none',
        }}
      >
        {/* Header — student name */}
        <div
          style={{
            padding: '6px 12px',
            fontWeight: 700,
            borderBottom: '1px solid #eee',
            color: '#333',
          }}
        >
          {menu.studentName}
        </div>

        {/* Neighbor count info */}
        <div style={{ padding: '4px 12px', color: '#888', fontSize: '0.76rem' }}>
          {menu.neighborCount} neighboring desk{menu.neighborCount !== 1 ? 's' : ''}
        </div>

        <div style={{ borderTop: '1px solid #eee' }} />

        {/* Lock toggle */}
        <div
          role="menuitem"
          tabIndex={0}
          style={{
            padding: '7px 12px',
            cursor: 'pointer',
            color: isLocked ? '#e65100' : '#1565c0',
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
// StudentEditor shell — wraps the EditorMode and mounts the context menu
// ---------------------------------------------------------------------------
//
// The EditorMode object itself cannot use React hooks (it's a plain object).
// We therefore split: the EditorMode object handles all canvas interaction and
// delegates the context menu to a React wrapper component that is rendered in
// the SidePanel via a shared signal mechanism. Instead, we use a simpler
// approach: the context menu is a floating React component anchored to the
// document body, controlled via a React state lifted into the Toolbar/SidePanel
// parent (which would be the shell in Phase 9). For Phase 8, we implement the
// context menu inside the SidePanel component, which has access to React state,
// and communicate from the EditorMode's onContextMenu via a module-level
// callback that the SidePanel registers.

/** Callback set by the SidePanel so onContextMenu can show the menu. */
let showContextMenuCallback:
  | ((state: ContextMenuState) => void)
  | null = null;

// ---------------------------------------------------------------------------
// StudentEditorWithMenu — wrapper that provides React state for the context menu
// ---------------------------------------------------------------------------

/**
 * We need React state for the context menu, but EditorMode components
 * (Toolbar / SidePanel) are separate React components. We compose them in
 * the shell. To handle the context menu without Phase 9 shell involvement we
 * provide a compound SidePanel component that includes both the roster and the
 * floating context menu, using a module-level callback to bridge the canvas
 * event to React state.
 */
const StudentSidePanelWithMenu: React.FC<{ ctx: EditorContext }> = ({ ctx }) => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const locks = ctx.store.locks;

  // Register the callback so onContextMenu can trigger the menu.
  // useEffect with [] ensures we register once on mount and unregister on unmount,
  // avoiding the ESLint react-hooks/globals rule against in-render module-level mutation.
  // The stable `setContextMenu` from useState is safe to capture in the effect.
  React.useEffect(() => {
    showContextMenuCallback = setContextMenu;
    return () => {
      showContextMenuCallback = null;
    };
  }, []);

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
      <StudentSidePanel ctx={ctx} />
      {contextMenu !== null && (
        <StudentContextMenu
          menu={contextMenu}
          locks={locks}
          onLock={handleLock}
          onUnlock={handleUnlock}
          onClose={() => { setContextMenu(null); }}
        />
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Client-space → canvas-pixel conversion helper
// (needed for drag ghost: pointer is in client space, canvas draws in its own space)
// ---------------------------------------------------------------------------

/**
 * Given a pointer event client position and the CanvasView, return the
 * position in canvas-pixel space (same coordinate system as paintOverlay).
 * The CanvasView provides cellAt() and cellRect() which we can use to
 * reconstruct the canvas origin.
 *
 * We derive the canvas pixel position from the cell coordinates:
 *   canvasX = col * cellSize + (clientX - clientLeftOfCell)
 * But cellAt() gives us the cell; cellRect() gives us the cell's pixel rect
 * in canvas space. To get client→canvas offset we need the origin.
 *
 * Simpler approach: compute (clientX - canvasOriginX) directly. CanvasView
 * doesn't expose the origin, but we can recover it: cellAt returns a cell,
 * and the cell's pixel rect is known, so:
 *   canvasX = (clientX - originX) where originX = clientX - (cell.x * cellSize + fractional)
 * Instead, since we only need an approximate ghost position for the drag,
 * we just use the cell center in canvas space. This matches the Python
 * prototype which used the cursor position as the ghost center.
 *
 * We store the raw canvas-local pixel position by computing:
 *   x = (cell.x + 0.5) * cellSize, y = (cell.y + 0.5) * cellSize
 * This snaps the ghost to the hovered cell's center, which is visually clean.
 */
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

// ---------------------------------------------------------------------------
// Find furniture under pointer (returns furniture with a real occupant, not fixture)
// ---------------------------------------------------------------------------

function findDraggableFurnitureAt(
  cell: { x: number; y: number },
  furniture: readonly Furniture[],
): Furniture | null {
  // Use furnitureAt from the canvas (last match wins — topmost in paint order)
  // We replicate the logic here since we have access to furniture directly.
  let found: Furniture | null = null;
  for (const f of furniture) {
    // Check if cell is within f's bounding box
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

  // ---- Lifecycle -----------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  activate(_ctx: EditorContext): void {
    // Reset all transient state
    dragSourceFid = null;
    dragStudent = null;
    dragCanvasPos = null;
    dragHoverFid = null;
    neighborPreviewFid = null;
    clearGraphCache();
    // Keep showViolations and nearness across activations (editor-local settings persist within session)
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deactivate(_ctx: EditorContext): void {
    dragSourceFid = null;
    dragStudent = null;
    dragCanvasPos = null;
    dragHoverFid = null;
    neighborPreviewFid = null;
    showContextMenuCallback = null;
    clearGraphCache();
  },

  // ---- Pointer events — drag-between-desks ---------------------------------

  onPointerDown(e: PointerEvent, ctx: EditorContext): void {
    if (e.button !== 0) return;

    const cell = ctx.canvas.cellAt(e.clientX, e.clientY);
    if (cell === undefined) return;

    const furniture = findDraggableFurnitureAt(cell, ctx.store.classroom.furniture);
    if (furniture === null) return;

    const occ = occupant(furniture);
    // Skip empty desks and fixtures
    if (occ === undefined || occ.isFixture) return;

    dragSourceFid = furniture.id;
    dragStudent = occ;
    dragCanvasPos = clientToCanvasPixel(e.clientX, e.clientY, ctx.canvas) ?? dragCanvasPos;
    dragHoverFid = furniture.id;

    ctx.canvas.requestRepaint();
  },

  onPointerMove(e: PointerEvent, ctx: EditorContext): void {
    if (dragSourceFid === null) return;

    // Update ghost position
    const pos = clientToCanvasPixel(e.clientX, e.clientY, ctx.canvas);
    if (pos !== null) dragCanvasPos = pos;

    // Find hover target
    const cell = ctx.canvas.cellAt(e.clientX, e.clientY);
    if (cell !== undefined) {
      const f = findDraggableFurnitureAt(cell, ctx.store.classroom.furniture);
      // Allow hovering over: occupied non-fixture desks (swap) OR empty assignable desks (move)
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
    if (dragSourceFid === null || dragStudent === null) return;

    const sourceFid = dragSourceFid;

    // Reset drag state before committing so any repaint shows clean state
    dragSourceFid = null;
    dragStudent = null;
    dragCanvasPos = null;

    const targetFid = dragHoverFid;
    dragHoverFid = null;

    if (targetFid !== null && targetFid !== sourceFid) {
      // manualReassign handles swap/move + fixture preservation + history push
      ctx.store.manualReassign(
        sourceFid,
        targetFid,
      );
      // Note: the prototype clears locks on both desks after a manual drag.
      // Our store's manualReassign does NOT clear locks automatically (locks are
      // a separate durable-project concern). We clear them here to match the
      // prototype's behavior.
      if (ctx.store.locks.has(sourceFid)) ctx.store.unlockSeat(sourceFid);
      if (ctx.store.locks.has(targetFid)) ctx.store.unlockSeat(targetFid);
      clearGraphCache();
    }

    ctx.canvas.requestRepaint();
  },

  // ---- Keyboard ------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onKeyDown(_e: KeyboardEvent, _ctx: EditorContext): void {
    // Escape could clear neighbor preview — keeping minimal for Phase 8
  },

  // ---- Drop — not used in StudentEditor (roster drags are pointer events) --

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onDrop(_e: DragEvent, _ctx: EditorContext): void {
    // No HTML5 drag-and-drop from the roster panel in this phase.
    // Drag-between-desks uses pointer events only.
  },

  // ---- Context menu — toggle lock + neighbor preview ----------------------

  onContextMenu(e: MouseEvent, ctx: EditorContext): void {
    e.preventDefault();

    const cell = ctx.canvas.cellAt(e.clientX, e.clientY);

    // Right-click anywhere without a furniture: clear neighbor preview
    if (cell === undefined) {
      if (neighborPreviewFid !== null) {
        neighborPreviewFid = null;
        ctx.canvas.requestRepaint();
      }
      return;
    }

    const furniture = findDraggableFurnitureAt(cell, ctx.store.classroom.furniture);
    if (furniture === null) {
      // Empty cell: clear neighbor preview
      if (neighborPreviewFid !== null) {
        neighborPreviewFid = null;
        ctx.canvas.requestRepaint();
      }
      return;
    }

    const fid = furniture.id;

    // Toggle neighbor preview (works for any desk, occupied or not, fixture or not)
    if (neighborPreviewFid === fid) {
      neighborPreviewFid = null;
    } else {
      neighborPreviewFid = fid;
    }
    ctx.canvas.requestRepaint();

    // Only show context menu for occupied, non-fixture desks
    const occ = occupant(furniture);
    if (occ === undefined || occ.isFixture) return;

    const graph = getSeatGraph(ctx.store.classroom, nearness);
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
    // EditorMode.paintOverlay only receives ctx2d + view (not EditorContext).
    // We need classroom + locks from the store. Since this is a Zustand singleton
    // we read via getState() — the same pattern used by FurnitureEditor for
    // selectedRect (which reads module-level state set by pointer handlers).
    // getState() is synchronous and always returns the current state snapshot.
    const state = usePijonStore.getState();
    paintOverlay(ctx2d, view, state.classroom, state.locks);
  },
};
