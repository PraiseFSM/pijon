/**
 * PreferenceEditor — Phase 10.
 *
 * An EditorMode that implements the "set preferences as you go" part of the
 * teacher workflow (PROJECT_OUTLINE.md § workflow step 4).
 *
 * Marker mode (primary path — port of student_placer.py SeatingGrid._handle_marker_click):
 *   1. Click an occupied desk → selects student1 (first pick, shown with a ring in paintOverlay).
 *   2. Click a second occupied desk → creates a student-preference from student1 → student2
 *      with the current weight via store.addPreference. Clears the selection.
 *   3. Click the same student twice → no-op (self-target, prevents invalid preference).
 *   4. ESC (onKeyDown) → cancels in-progress selection.
 *   Marker mode is always active while this editor is mounted.
 *
 * Toolbar:
 *   - Weight numeric input (default −1.0; negative = avoid, positive = prefer).
 *   - Hint label ("Click a student, then another, to link them. ESC to cancel.").
 *   - Show Links toggle: draws existing preference links on the canvas.
 *
 * SidePanel — preference overview:
 *   - List of all real students with their preference counts.
 *   - Click a student to expand their preferences (direction, target name, weight).
 *   - Remove button per preference (calls store.removePreference).
 *   - Inline "add preference" form (target dropdown + weight) as a nice-to-have.
 *
 * paintOverlay:
 *   - Highlights the first-selected student's desk with a colored ring (amber).
 *   - When showLinks=true: draws green lines for prefer (weight>0) and red for
 *     avoid (weight<0) between currently-seated students.
 *   save()/restore() used; canvas NOT cleared.
 *
 * deactivate: clears in-progress selection and all transient state.
 *
 * Registry: adding PreferenceEditor to EDITOR_REGISTRY is the ONLY shell change
 * needed for this editor (no TopBar/SidePanel wiring required in the shell).
 *
 * LOCAL-FIRST: no fetch(), no XHR, no WebSocket. All mutations go through the
 * Zustand store. The ESLint no-restricted-globals rule enforces this.
 */

import React, { useState } from 'react';
import type { EditorContext, EditorMode, CanvasView } from './EditorMode.js';
import type { FurnitureId, StudentId } from '../../domain/types.js';
import type { Furniture } from '../../domain/furniture.js';
import { occupant, isFixture as isFurnitureFixture, capacity } from '../../domain/furniture.js';
import type { Student } from '../../domain/student.js';
import type { Preference } from '../../domain/preference.js';
import { preferStudent, avoidStudent } from '../../domain/preference.js';
import { furnitureToPixelRect } from '../canvas/hitTest.js';
import { usePijonStore } from '../../state/store.js';
import type { Classroom } from '../../domain/classroom.js';
import { assignments as classroomAssignments } from '../../domain/classroom.js';

// ---------------------------------------------------------------------------
// Module-level transient state — cleared in deactivate()
// ---------------------------------------------------------------------------

/** FurnitureId of the first-selected desk (step 1 of the marker flow). */
let markerFirstFid: FurnitureId | null = null;
/** The student who occupies markerFirstFid (kept so paintOverlay can ring them). */
let markerFirstStudent: Student | null = null;

/** Whether to draw preference links between currently-seated students. */
let showLinks = false;

// ---------------------------------------------------------------------------
// Helper: find the topmost furniture whose bounding box covers the given cell
// (mirrors findDraggableFurnitureAt in StudentEditor but here we want any
// furniture that has a real (non-fixture) occupant).
// ---------------------------------------------------------------------------

function findOccupiedFurnitureAt(
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
// paintOverlay (module-level, no React dependency)
// ---------------------------------------------------------------------------

function paintOverlay(
  ctx2d: CanvasRenderingContext2D,
  view: CanvasView,
  classroom: Classroom,
): void {
  ctx2d.save();

  const furniture = classroom.furniture;

  // Build fid → student map for currently-seated real students
  const arrangement: Map<FurnitureId, Student> = classroomAssignments(classroom);
  // Build studentId → fid reverse map (for drawing links)
  const sidToFid = new Map<StudentId, FurnitureId>();
  for (const [fid, student] of arrangement) {
    if (!student.isFixture) {
      sidToFid.set(student.id, fid);
    }
  }

  // --- Draw existing preference links ---
  if (showLinks) {
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
        if (pref.weight > 0) {
          // prefer → green
          ctx2d.strokeStyle = 'rgba(46, 125, 50, 0.55)';
        } else {
          // avoid → red
          ctx2d.strokeStyle = 'rgba(183, 28, 28, 0.55)';
        }
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

  // --- Highlight first-selected student's desk with an amber ring ---
  if (markerFirstFid !== null) {
    const srcF = furniture.find((f) => f.id === markerFirstFid);
    if (srcF !== undefined) {
      const r = furnitureToPixelRect(srcF, view.cellSize);
      const inset = 2;
      ctx2d.strokeStyle = 'rgba(230, 120, 0, 0.95)';
      ctx2d.lineWidth = 3;
      ctx2d.strokeRect(r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2);
      ctx2d.fillStyle = 'rgba(255, 152, 0, 0.14)';
      ctx2d.fillRect(r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2);
    }
  }

  ctx2d.restore();
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

const PreferenceToolbar: React.FC<{ ctx: EditorContext }> = ({ ctx }) => {
  const [weight, setWeight] = useState(-1.0);
  const [showLinksOn, setShowLinksOn] = useState(false);

  // Keep module-level weight in sync so pointer handlers can read it
  // (module var is read in onPointerDown without a React re-render path)
  // We use a ref trick via a callback to avoid stale closure in onPointerDown:
  // instead, we expose the weight via a module-level variable.
  React.useEffect(() => {
    currentWeight = weight;
  }, [weight]);

  const handleWeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v)) {
      setWeight(v);
      currentWeight = v;
    }
  };

  const handleToggleLinks = () => {
    const next = !showLinksOn;
    setShowLinksOn(next);
    showLinks = next;
    ctx.canvas.requestRepaint();
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
  const btnToggled: React.CSSProperties = {
    ...btn,
    background: '#1565c0',
    color: '#fff',
    borderColor: '#1565c0',
  };

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
        Preferences
      </span>

      <label
        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.82rem', color: '#555' }}
      >
        Weight:
        <input
          type="number"
          step="0.5"
          value={weight}
          onChange={handleWeightChange}
          style={{
            width: 68,
            padding: '2px 5px',
            borderRadius: 4,
            border: '1px solid #bbb',
            fontSize: '0.82rem',
          }}
          title="Negative = avoid, positive = prefer. Magnitude = strength."
        />
      </label>

      <span
        style={{
          fontSize: '0.76rem',
          color: weight < 0 ? '#c62828' : '#2e7d32',
          fontWeight: 600,
          marginLeft: 2,
        }}
      >
        {weight < 0 ? 'Avoid' : weight > 0 ? 'Prefer' : 'Neutral'}
      </span>

      <span style={{ borderLeft: '1px solid #ddd', height: 20, margin: '0 4px' }} />

      <button
        style={showLinksOn ? btnToggled : btn}
        type="button"
        onClick={handleToggleLinks}
        title="Draw preference links between currently seated students"
      >
        {showLinksOn ? 'Links ON' : 'Show Links'}
      </button>

      <span style={{ borderLeft: '1px solid #ddd', height: 20, margin: '0 6px' }} />

      <span
        style={{
          fontSize: '0.76rem',
          color: '#777',
          fontStyle: 'italic',
        }}
      >
        Click a student, then another to link them. ESC to cancel.
      </span>
    </div>
  );
};

/** Module-level weight mirror so onPointerDown can read the current weight
 *  without a React closure. Updated by PreferenceToolbar via useEffect. */
let currentWeight = -1.0;

// ---------------------------------------------------------------------------
// SidePanel — preference overview
// ---------------------------------------------------------------------------

const PreferenceSidePanel: React.FC<{ ctx: EditorContext }> = ({ ctx }) => {
  const roster = ctx.store.roster;
  const [selectedStudentId, setSelectedStudentId] = useState<StudentId | null>(null);
  const [addTargetId, setAddTargetId] = useState<StudentId | ''>('');
  const [addWeight, setAddWeight] = useState(-1.0);

  const realStudents = roster.filter((s) => !s.isFixture);
  // Build id → name for showing target names
  const nameMap = new Map<StudentId, string>(roster.map((s) => [s.id, s.name]));

  const selectedStudent = selectedStudentId !== null
    ? roster.find((s) => s.id === selectedStudentId) ?? null
    : null;

  const handleStudentClick = (id: StudentId) => {
    setSelectedStudentId((prev) => (prev === id ? null : id));
    setAddTargetId('');
    setAddWeight(-1.0);
  };

  const handleRemovePref = (pref: Preference) => {
    if (selectedStudentId === null) return;
    if (pref.kind === 'location') return; // location prefs not managed here
    ctx.store.removePreference(selectedStudentId, pref.targetId);
    ctx.canvas.requestRepaint();
  };

  const handleAddPref = () => {
    if (selectedStudentId === null || addTargetId === '') return;
    if (addTargetId === selectedStudentId) return; // no self-target
    // After the guard above, addTargetId is narrowed to StudentId.
    const targetId: StudentId = addTargetId;
    const pref: Preference =
      addWeight >= 0
        ? preferStudent(targetId, Math.abs(addWeight))
        : avoidStudent(targetId, Math.abs(addWeight));
    ctx.store.addPreference(selectedStudentId, pref);
    setAddTargetId('');
    ctx.canvas.requestRepaint();
  };

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

  const prefRowStyle: React.CSSProperties = {
    padding: '3px 8px 3px 16px',
    borderBottom: '1px solid #f0f0f0',
    fontSize: '0.75rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  return (
    <div
      style={{
        width: 200,
        minWidth: 170,
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
        Preferences
      </div>

      {/* Student count */}
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
      </div>

      {/* Scrollable student list with expandable preferences */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {realStudents.map((s) => {
          const isSelected = s.id === selectedStudentId;
          const prefCount = s.preferences.length;
          return (
            <React.Fragment key={s.id}>
              {/* Student row */}
              <div
                role="button"
                tabIndex={0}
                style={{
                  ...itemStyle,
                  background: isSelected ? '#e3f2fd' : undefined,
                  borderLeft: isSelected ? '3px solid #1565c0' : '3px solid transparent',
                }}
                onClick={() => { handleStudentClick(s.id); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') handleStudentClick(s.id);
                }}
              >
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}
                >
                  {s.name}
                </span>
                {prefCount > 0 && (
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
                    title={`${prefCount.toString()} preference(s)`}
                  >
                    {prefCount}p
                  </span>
                )}
              </div>

              {/* Expanded preference list */}
              {isSelected && (
                <div style={{ background: '#f5f9ff', borderBottom: '1px solid #ddd' }}>
                  {s.preferences.length === 0 ? (
                    <div
                      style={{
                        padding: '4px 8px 4px 16px',
                        fontSize: '0.72rem',
                        color: '#aaa',
                      }}
                    >
                      No preferences set.
                    </div>
                  ) : (
                    s.preferences.map((pref, idx) => {
                      let targetLabel: string;
                      if (pref.kind === 'student') {
                        targetLabel = nameMap.get(pref.targetId) ?? pref.targetId;
                      } else if (pref.kind === 'furniture') {
                        targetLabel = `Furniture: ${pref.targetId}`;
                      } else {
                        targetLabel = `Location: ${pref.target}`;
                      }
                      const dirLabel = pref.weight > 0 ? '↑ Prefer' : '↓ Avoid';
                      const dirColor = pref.weight > 0 ? '#2e7d32' : '#c62828';
                      return (
                        <div
                          // eslint-disable-next-line react/no-array-index-key
                          key={idx}
                          style={prefRowStyle}
                        >
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span style={{ color: dirColor, fontWeight: 700 }}>{dirLabel}</span>
                            {' '}
                            {targetLabel}
                            <span style={{ color: '#aaa', marginLeft: 3 }}>
                              ({pref.weight > 0 ? '+' : ''}{pref.weight.toFixed(1)})
                            </span>
                          </span>
                          {pref.kind !== 'location' && (
                            <button
                              type="button"
                              onClick={() => { handleRemovePref(pref); }}
                              style={{
                                flexShrink: 0,
                                marginLeft: 4,
                                padding: '1px 5px',
                                fontSize: '0.68rem',
                                border: '1px solid #ffcdd2',
                                borderRadius: 3,
                                background: '#ffebee',
                                color: '#c62828',
                                cursor: 'pointer',
                              }}
                              title="Remove this preference"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}

                  {/* Inline add form */}
                  {selectedStudent !== null && (
                    <div
                      style={{
                        padding: '6px 8px 6px 16px',
                        borderTop: '1px solid #e3f2fd',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <div style={{ fontSize: '0.7rem', color: '#555', fontWeight: 600 }}>
                        Add preference:
                      </div>
                      <select
                        value={addTargetId}
                        onChange={(e) => { setAddTargetId(e.target.value as StudentId | ''); }}
                        style={{
                          fontSize: '0.74rem',
                          padding: '2px 4px',
                          borderRadius: 3,
                          border: '1px solid #bbb',
                        }}
                      >
                        <option value="">— target student —</option>
                        {realStudents
                          .filter((st) => st.id !== selectedStudentId)
                          .map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.name}
                            </option>
                          ))}
                      </select>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input
                          type="number"
                          step="0.5"
                          value={addWeight}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (Number.isFinite(v)) setAddWeight(v);
                          }}
                          style={{
                            width: 58,
                            padding: '2px 4px',
                            borderRadius: 3,
                            border: '1px solid #bbb',
                            fontSize: '0.74rem',
                          }}
                          title="Negative = avoid, positive = prefer"
                        />
                        <button
                          type="button"
                          onClick={handleAddPref}
                          disabled={addTargetId === ''}
                          style={{
                            padding: '2px 8px',
                            borderRadius: 3,
                            border: '1px solid #90caf9',
                            background: addTargetId === '' ? '#eee' : '#e3f2fd',
                            color: '#1565c0',
                            cursor: addTargetId === '' ? 'default' : 'pointer',
                            fontSize: '0.74rem',
                            fontWeight: 600,
                          }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </React.Fragment>
          );
        })}
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
        Click a student to see preferences.
        <br />
        Use the canvas: click two students to link them.
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// PreferenceEditor — the EditorMode instance
// ---------------------------------------------------------------------------

export const PreferenceEditor: EditorMode = {
  id: 'preference',
  label: 'Preferences',

  Toolbar: PreferenceToolbar,
  SidePanel: PreferenceSidePanel,

  // ---- Lifecycle -----------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  activate(_ctx: EditorContext): void {
    markerFirstFid = null;
    markerFirstStudent = null;
    // showLinks and currentWeight persist across activations within a session
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deactivate(_ctx: EditorContext): void {
    markerFirstFid = null;
    markerFirstStudent = null;
  },

  // ---- Pointer events — marker mode ----------------------------------------

  onPointerDown(e: PointerEvent, ctx: EditorContext): void {
    if (e.button !== 0) return;

    const cell = ctx.canvas.cellAt(e.clientX, e.clientY);
    if (cell === undefined) return;

    const f = findOccupiedFurnitureAt(cell, ctx.store.classroom.furniture);
    if (f === null) return;

    // Must have a real (non-fixture) occupant and be assignable
    const occ = occupant(f);
    if (occ === undefined || occ.isFixture) return;
    if (isFurnitureFixture(f) || capacity(f) === 0) return;

    if (markerFirstFid === null) {
      // Step 1: select first student
      markerFirstFid = f.id;
      markerFirstStudent = occ;
      ctx.canvas.requestRepaint();
    } else {
      // Step 2: select second student and create preference
      if (f.id === markerFirstFid) {
        // Self-target: gentle no-op, keep selection
        return;
      }
      const student1 = markerFirstStudent;
      const student2 = occ;

      if (student1 !== null) {
        // Build the preference using the current weight
        const pref: Preference =
          currentWeight >= 0
            ? preferStudent(student2.id, Math.abs(currentWeight))
            : avoidStudent(student2.id, Math.abs(currentWeight));

        ctx.store.addPreference(student1.id, pref);
      }

      // Reset selection
      markerFirstFid = null;
      markerFirstStudent = null;
      ctx.canvas.requestRepaint();
    }
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onPointerMove(_e: PointerEvent, _ctx: EditorContext): void {
    // No hover tracking needed for preference marker mode
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onPointerUp(_e: PointerEvent, _ctx: EditorContext): void {
    // No drag in preference mode
  },

  // ---- Keyboard — ESC cancels in-progress selection ------------------------

  onKeyDown(e: KeyboardEvent, ctx: EditorContext): void {
    if (e.key !== 'Escape') return;
    if (markerFirstFid === null) return;

    markerFirstFid = null;
    markerFirstStudent = null;
    ctx.canvas.requestRepaint();
  },

  // ---- Drop — not used in PreferenceEditor ---------------------------------

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onDrop(_e: DragEvent, _ctx: EditorContext): void {
    // No HTML5 drag-and-drop in preference mode.
  },

  // ---- Context menu — no-op ------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onContextMenu(_e: MouseEvent, _ctx: EditorContext): void {
    // Future: right-click for quick remove preference.
  },

  // ---- paintOverlay --------------------------------------------------------

  paintOverlay(ctx2d: CanvasRenderingContext2D, view: CanvasView): void {
    // Read classroom from the store singleton (same pattern as StudentEditor).
    const state = usePijonStore.getState();
    paintOverlay(ctx2d, view, state.classroom);
  },
};
