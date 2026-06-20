/**
 * FurnitureEditor — Phase 7.
 *
 * An EditorMode that lets the teacher:
 *   1. Drag furniture kinds from the SidePanel palette onto the grid (HTML5 drag).
 *   2. Click-drag existing furniture to move it (collision + bounds checked; occupant rides along).
 *   3. Press Delete / Backspace to remove the selected furniture.
 *
 * Design notes:
 *  - All transient drag/selection state lives in module-level refs (not the store).
 *  - deactivate() clears all transient state so no artifacts leak on tool-switch.
 *  - paintOverlay() draws only the delta: selection highlight, drag preview, collision flash.
 *  - Toolbar wires New / Clear / Save / Load using either the PersistenceHandle (from context)
 *    or a TODO stub for Phase 9 (shell) when no handle is provided.
 *
 * Furniture factory — IMPORTANT vs Python prototype:
 *   The prototype creates a bare Furniture with no capacity concept; its SingleDesk simply has
 *   `capacity = 1` baked into the class. In our domain, capacity() derives from `kind`, so a
 *   'single_desk' automatically has capacity 1 — no extra field needed. We do NOT create a
 *   capacity-0 base furniture for desks; we create the correct kind directly. This means students
 *   can be seated on freshly placed desks without any extra step.
 *
 * Collision check (port of classroom_builder.py check_collision):
 *   Build the set of cells the candidate would occupy; intersect with the union of cells already
 *   occupied by all OTHER furniture. If intersection is non-empty → collision.
 *   During move-drag the dragged piece is excluded from the check (can't collide with itself).
 *
 * Save/Load:
 *   The PersistenceHandle is not available inside EditorMode (it lives in the App shell, which
 *   is not wired until Phase 9). The Toolbar accepts an optional `persist` callback prop — in
 *   Phase 9 the shell passes the real handle; until then the buttons show a console.warn stub.
 *   This is clean and requires no changes to EditorMode or the store.
 *
 * LOCAL-FIRST: no fetch(), no XHR, no WebSocket. All writes go through the Zustand store.
 */

import React, { useState } from 'react';
import type { EditorContext, EditorMode, CanvasView } from './EditorMode.js';
import type { FurnitureKind, Vec2 } from '../../domain/types.js';
import { furnitureId } from '../../domain/types.js';
import type { Furniture } from '../../domain/furniture.js';
import { occupiedCells } from '../../domain/furniture.js';
import { furnitureToPixelRect } from '../canvas/hitTest.js';
import { makeClassroom } from '../../domain/classroom.js';
import type { GridEdge } from '../../domain/classroom.js';

// ---------------------------------------------------------------------------
// §13.1 — Transparent 1×1 image for suppressing the HTML5 drag ghost
// ---------------------------------------------------------------------------

/**
 * A tiny transparent canvas used as a replacement drag image so the browser
 * shows nothing when the teacher starts dragging from the palette.
 * Created lazily once on first use; reused thereafter.
 */
let _transparentDragImage: HTMLCanvasElement | null = null;

function getTransparentDragImage(): HTMLCanvasElement {
  if (_transparentDragImage === null) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    _transparentDragImage = canvas;
  }
  return _transparentDragImage;
}

// ---------------------------------------------------------------------------
// Furniture kind metadata — drives both the palette and the factory
// ---------------------------------------------------------------------------

interface KindMeta {
  kind: FurnitureKind;
  label: string;
  w: number;
  h: number;
}

const PALETTE_ITEMS: readonly KindMeta[] = [
  { kind: 'single_desk', label: 'Single Desk', w: 1, h: 1 },
  { kind: 'table',       label: 'Table (4-seat)', w: 2, h: 2 },
  { kind: 'teacher_desk', label: "Teacher's Desk", w: 2, h: 1 },
  { kind: 'whiteboard',  label: 'Whiteboard', w: 4, h: 1 },
];

/** Build a Furniture record for a given kind at position (0,0).
 *  The caller moves it to the correct position after creation.
 *  numSeats is only set for 'table' (the only kind where it's meaningful). */
function makeFurniture(kind: FurnitureKind, pos: Vec2): Furniture {
  const meta = PALETTE_ITEMS.find((m) => m.kind === kind);
  const w = meta?.w ?? 1;
  const h = meta?.h ?? 1;
  const base: Furniture = {
    id: furnitureId(crypto.randomUUID()),
    kind,
    pos,
    w,
    h,
    rotation: 0,
    occupants: [],
  };
  if (kind === 'table') {
    return { ...base, numSeats: 4 };
  }
  return base;
}

// ---------------------------------------------------------------------------
// dataTransfer key for palette drag
// ---------------------------------------------------------------------------

export const DRAG_KIND_KEY = 'application/x-pijon-furniture-kind';

// ---------------------------------------------------------------------------
// §13.1 — Cross-browser dragstart kind stash
//
// Firefox and Safari both return "" from dataTransfer.getData() during a
// dragover event (the HTML5 spec deliberately restricts data access to drop
// events in some browsers). To paint a live preview we stash the dragged kind
// in a module-level variable on dragstart and clear it on dragend/drop.
// onDragOver reads this variable when getData() returns empty.
// ---------------------------------------------------------------------------

let _draggedKindStash = '';

/** Called by the palette's onDragStart to stash the kind for cross-browser dragover. */
export function stashDraggedKind(kind: string): void {
  _draggedKindStash = kind;
}

/** Clear the stash on dragend or drop so it never bleeds to a later drag. */
export function clearDraggedKindStash(): void {
  _draggedKindStash = '';
}

/**
 * Read the dragged furniture kind, falling back to the module-level stash when
 * dataTransfer.getData() returns "" (Firefox/Safari during dragover).
 */
export function readDraggedKind(e: DragEvent): string {
  let kind = e.dataTransfer?.getData(DRAG_KIND_KEY) ?? '';
  if (!kind) kind = e.dataTransfer?.getData('text/plain') ?? '';
  if (!kind) kind = _draggedKindStash; // Firefox/Safari dragover fallback
  return kind;
}

// ---------------------------------------------------------------------------
// Collision helper (port of classroom_builder.py check_collision)
// ---------------------------------------------------------------------------

/** Build a set of "col,row" strings for fast intersection tests. */
function cellSet(cells: Vec2[]): Set<string> {
  const s = new Set<string>();
  for (const c of cells) {
    s.add(`${c.x.toString()},${c.y.toString()}`);
  }
  return s;
}

/**
 * Return true when placing furniture of size w×h at pos would overlap any
 * existing furniture, excluding the piece with id `excludeId` (used during
 * move so the dragged piece can't collide with its own footprint).
 */
function hasCollision(
  pos: Vec2,
  w: number,
  h: number,
  furniture: readonly Furniture[],
  excludeId?: string,
): boolean {
  // Cells the candidate would occupy
  const candidate = new Set<string>();
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      candidate.add(`${(pos.x + dx).toString()},${(pos.y + dy).toString()}`);
    }
  }

  for (const f of furniture) {
    if (f.id === excludeId) continue;
    const existing = cellSet(occupiedCells(f));
    for (const cell of candidate) {
      if (existing.has(cell)) return true;
    }
  }
  return false;
}

/** True when a w×h piece at pos fits within gridW×gridH. */
function inBounds(pos: Vec2, w: number, h: number, gridW: number, gridH: number): boolean {
  return pos.x >= 0 && pos.y >= 0 && pos.x + w <= gridW && pos.y + h <= gridH;
}

// ---------------------------------------------------------------------------
// Module-level transient drag/selection state
// (never touches the Zustand store — cleared in deactivate)
// ---------------------------------------------------------------------------

/** Furniture selected by the last pointerdown on the grid. */
let selectedId: string | null = null;

/** If a grid-drag is in progress, stores the drag data. */
let dragState: {
  furniture: Furniture;
  /** Cell the pointer was in when pointerdown fired, relative to furniture top-left. */
  offsetInFurniture: Vec2;
  /** Cell position the piece is previewed at (updated on pointerMove). */
  previewPos: Vec2;
  /** Whether the preview position is currently valid (no collision, in bounds). */
  valid: boolean;
  /** True once the pointer has moved at least one cell from start. */
  moved: boolean;
} | null = null;

/** True when the last drop from the palette had a collision (flash highlight). */
let dropCollisionFlash = false;

/** requestRepaint reference captured on activate so paintOverlay triggers can call it. */
let repaintFn: (() => void) | null = null;

// ---------------------------------------------------------------------------
// §13.1 — Palette drag-over preview (live canvas preview while dragging from palette)
// ---------------------------------------------------------------------------

/**
 * When the teacher drags a palette item over the grid (HTML5 dragover), we paint
 * a live preview of the to-be-placed furniture at the hovered cell.
 * Cleared on dragend / drop / dragleave.
 */
let paletteDragPreview: {
  kind: FurnitureKind;
  previewPos: Vec2;
  /** True = fits (no collision, in bounds); False = red warning. */
  valid: boolean;
} | null = null;

// ---------------------------------------------------------------------------
// Toolbar component
// ---------------------------------------------------------------------------

/**
 * Toolbar for FurnitureEditor.
 *
 * Contains:
 *  - New / Clear / Save / Load project controls.
 *  - Grid resize section: +/- buttons at each edge (top, bottom, left, right).
 *  - Grid granularity control: integer input to set cellsPerUnit.
 *
 * A warning banner appears when a resize is blocked (furniture in the way).
 */
const FurnitureToolbar: React.FC<{ ctx: EditorContext }> = ({ ctx }) => {
  const warning = ctx.store.resizeGridWarning;
  const classroom = ctx.store.classroom;
  const [granularityInput, setGranularityInput] = useState(classroom.cellsPerUnit);

  const handleNew = () => {
    const fresh = makeClassroom(
      crypto.randomUUID(),
      'My Classroom',
      classroom.gridW,
      classroom.gridH,
    );
    ctx.store.setClassroom(fresh);
  };

  const handleClear = () => {
    const furniture = [...classroom.furniture];
    for (const f of furniture) {
      ctx.store.removeFurniture(f.id);
    }
  };

  const handleSave = () => {
    if (ctx.persistence === null) {
      console.warn('[FurnitureEditor] Persistence not yet available.');
      return;
    }
    void ctx.persistence.saveToFile();
  };

  const handleLoad = () => {
    if (ctx.persistence === null) {
      console.warn('[FurnitureEditor] Persistence not yet available.');
      return;
    }
    void ctx.persistence.openFromFile();
  };

  const handleResize = (edge: GridEdge, delta: number) => {
    ctx.store.resizeGrid(edge, delta);
    ctx.canvas.requestRepaint();
  };

  const handleGranularityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10);
    if (!Number.isFinite(v) || v < 1) return;
    setGranularityInput(v);
  };

  const handleGranularityApply = () => {
    if (granularityInput === classroom.cellsPerUnit) return;
    try {
      ctx.store.setGranularity(granularityInput);
      ctx.canvas.requestRepaint();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      setGranularityInput(classroom.cellsPerUnit);
    }
  };

  const handleGranularityKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleGranularityApply();
  };

  const btn: React.CSSProperties = {
    padding: '3px 9px',
    borderRadius: 4,
    border: '1px solid #bbb',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '0.82rem',
    lineHeight: '1.4',
  };

  const btnSm: React.CSSProperties = {
    ...btn,
    padding: '2px 7px',
    fontWeight: 700,
    minWidth: 24,
  };

  const sep = (
    <span style={{ borderLeft: '1px solid #ddd', height: 20, margin: '0 4px', display: 'inline-block' }} />
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: '#f5f5f5',
        borderBottom: '1px solid #ddd',
      }}
    >
      {/* Warning banner */}
      {warning !== null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 10px',
            background: '#fff3e0',
            borderBottom: '1px solid #ffe0b2',
            fontSize: '0.78rem',
            color: '#e65100',
          }}
        >
          <span style={{ flex: 1 }}>⚠ {warning}</span>
          <button
            type="button"
            onClick={() => { ctx.store.dismissResizeWarning(); }}
            style={{ ...btn, padding: '1px 7px', fontSize: '0.74rem', color: '#e65100', borderColor: '#ffb74d' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Main toolbar row */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 4,
          padding: '5px 10px',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '0.88rem', marginRight: 6, color: '#333' }}>Furniture</span>
        <button style={btn} onClick={handleNew} type="button">New</button>
        <button style={btn} onClick={handleClear} type="button">Clear</button>
        <button style={btn} onClick={handleSave} type="button" title="Save classroom to a .pijon file">Save…</button>
        <button style={btn} onClick={handleLoad} type="button" title="Open a .pijon file">Load…</button>

        {sep}

        {/* Grid resize controls */}
        <span style={{ fontSize: '0.78rem', color: '#555', fontWeight: 600 }}>Grid:</span>

        {/* Top/Bottom rows */}
        <span style={{ fontSize: '0.72rem', color: '#888' }}>Rows</span>
        <button
          style={btnSm}
          type="button"
          title="Add a row at the top (shifts furniture down)"
          onClick={() => { handleResize('top', 1); }}
        >+T</button>
        <button
          style={btnSm}
          type="button"
          title="Remove a row from the top"
          onClick={() => { handleResize('top', -1); }}
        >−T</button>
        <button
          style={btnSm}
          type="button"
          title="Add a row at the bottom"
          onClick={() => { handleResize('bottom', 1); }}
        >+B</button>
        <button
          style={btnSm}
          type="button"
          title="Remove a row from the bottom"
          onClick={() => { handleResize('bottom', -1); }}
        >−B</button>

        {/* Left/Right cols */}
        <span style={{ fontSize: '0.72rem', color: '#888', marginLeft: 4 }}>Cols</span>
        <button
          style={btnSm}
          type="button"
          title="Add a column at the left (shifts furniture right)"
          onClick={() => { handleResize('left', 1); }}
        >+L</button>
        <button
          style={btnSm}
          type="button"
          title="Remove a column from the left"
          onClick={() => { handleResize('left', -1); }}
        >−L</button>
        <button
          style={btnSm}
          type="button"
          title="Add a column at the right"
          onClick={() => { handleResize('right', 1); }}
        >+R</button>
        <button
          style={btnSm}
          type="button"
          title="Remove a column from the right"
          onClick={() => { handleResize('right', -1); }}
        >−R</button>

        {/* Grid size readout */}
        <span style={{ fontSize: '0.72rem', color: '#777', marginLeft: 4 }}>
          ({classroom.gridW}×{classroom.gridH})
        </span>

        {sep}

        {/* Granularity */}
        <span style={{ fontSize: '0.78rem', color: '#555', fontWeight: 600 }}>Granularity:</span>
        <input
          type="number"
          min="1"
          max="16"
          step="1"
          value={granularityInput}
          onChange={handleGranularityChange}
          onBlur={handleGranularityApply}
          onKeyDown={handleGranularityKeyDown}
          style={{
            width: 46,
            padding: '2px 4px',
            borderRadius: 4,
            border: '1px solid #bbb',
            fontSize: '0.8rem',
            textAlign: 'center',
          }}
          title={`Fine cells per unit (current: ${classroom.cellsPerUnit.toString()}). Changing scales furniture positions/sizes so physical layout is unchanged.`}
        />
        <button
          type="button"
          style={{ ...btn, fontSize: '0.78rem' }}
          onClick={handleGranularityApply}
          title="Apply granularity change"
          disabled={granularityInput === classroom.cellsPerUnit}
        >
          Apply
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SidePanel — furniture palette
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const FurnitureSidePanel: React.FC<{ ctx: EditorContext }> = ({ ctx: _ctx }) => {
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, kind: FurnitureKind) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(DRAG_KIND_KEY, kind);
    // Also set text/plain as a fallback (some browsers strip custom MIME types)
    e.dataTransfer.setData('text/plain', kind);

    // §13.1 — Stash the kind in a module-level variable so onDragOver can read
    // it in Firefox/Safari, where getData() returns "" during dragover (spec restriction).
    stashDraggedKind(kind);

    // §13.1 — Suppress the browser's default HTML5 drag-image (the furniture PNG ghost).
    // Replace it with a transparent 1px canvas so the teacher sees only our live
    // canvas preview painted in onDragOver, not a faded snapshot of the palette item.
    e.dataTransfer.setDragImage(getTransparentDragImage(), 0, 0);
  };

  const itemStyle: React.CSSProperties = {
    padding: '10px 12px',
    marginBottom: 6,
    borderRadius: 6,
    border: '1px solid #ccc',
    background: '#e3f2fd',
    cursor: 'grab',
    userSelect: 'none',
    fontSize: '0.85rem',
    fontWeight: 500,
  };

  const kindColors: Record<FurnitureKind, string> = {
    single_desk: '#e3f2fd',
    table: '#e8f5e9',
    teacher_desk: '#fff3e0',
    whiteboard: '#f3e5f5',
  };

  return (
    <div
      style={{
        width: 160,
        padding: '10px 8px',
        background: '#fafafa',
        borderRight: '1px solid #ddd',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: '0.8rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: '#555',
          marginBottom: 10,
        }}
      >
        Palette
      </div>
      {PALETTE_ITEMS.map((item) => (
        <div
          key={item.kind}
          draggable
          onDragStart={(e) => {
            handleDragStart(e, item.kind);
          }}
          style={{ ...itemStyle, background: kindColors[item.kind] }}
          title={`Drag onto the grid to place a ${item.label}`}
        >
          {item.label}
          <div style={{ fontSize: '0.7rem', color: '#888', fontWeight: 400 }}>
            {item.w}×{item.h}
          </div>
        </div>
      ))}
      <div
        style={{
          marginTop: 16,
          fontSize: '0.72rem',
          color: '#999',
          lineHeight: 1.4,
        }}
      >
        Drag to place.
        <br />
        Click-drag on grid to move.
        <br />
        Delete to remove.
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// §13.1 — Furniture fill-colour helpers (mirror render.ts so the live preview
// looks identical to the base-pass furniture)
// ---------------------------------------------------------------------------

/** Fill colour for each furniture kind — must mirror render.ts COLORS. */
function kindFillColor(kind: FurnitureKind): string {
  switch (kind) {
    case 'single_desk':   return '#e3f2fd';
    case 'table':         return '#e8f5e9';
    case 'teacher_desk':  return '#fff3e0';
    case 'whiteboard':    return '#f3e5f5';
  }
}

/** Stroke colour — mirrors render.ts strokeForFurniture logic. */
function kindStrokeColor(kind: FurnitureKind): string {
  if (kind === 'teacher_desk' || kind === 'whiteboard') return '#b39ddb';
  return '#90a4ae';
}

/**
 * Draw the furniture kind as a filled+stroked rectangle at pixel rect r.
 * This is the same visual as the base render pass so the preview is
 * indistinguishable from placed furniture.
 */
function paintFurnitureRect(
  ctx2d: CanvasRenderingContext2D,
  kind: FurnitureKind,
  r: { x: number; y: number; w: number; h: number },
  alpha = 1.0,
): void {
  ctx2d.save();
  ctx2d.globalAlpha = alpha;
  ctx2d.fillStyle = kindFillColor(kind);
  ctx2d.fillRect(r.x, r.y, r.w, r.h);
  ctx2d.strokeStyle = kindStrokeColor(kind);
  ctx2d.lineWidth = 1.5;
  ctx2d.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  ctx2d.restore();
}

// ---------------------------------------------------------------------------
// paintOverlay
// ---------------------------------------------------------------------------

function paintOverlay(ctx2d: CanvasRenderingContext2D, view: CanvasView): void {
  ctx2d.save();

  // --- Selection highlight ---
  // selectedRect is kept in sync with the selected furniture by the pointer/drop handlers.
  // paintOverlay draws only from this pre-computed rect so no store access is needed here.
  if (selectedId !== null && dragState === null && selectedRect !== null) {
    ctx2d.strokeStyle = 'rgba(25, 118, 210, 0.9)';
    ctx2d.lineWidth = 2.5;
    ctx2d.setLineDash([5, 3]);
    ctx2d.strokeRect(
      selectedRect.x + 1,
      selectedRect.y + 1,
      selectedRect.w - 2,
      selectedRect.h - 2,
    );
    ctx2d.setLineDash([]);
  }

  // --- §13.1 Drag preview — real-time furniture (not a ghost outline) ---
  if (dragState !== null) {
    const { furniture: f, previewPos, valid } = dragState;
    const r = {
      x: previewPos.x * view.cellSize,
      y: previewPos.y * view.cellSize,
      w: f.w * view.cellSize,
      h: f.h * view.cellSize,
    };

    // Ghost/dim the original spot so the teacher can see it was moved
    const origR = {
      x: f.pos.x * view.cellSize,
      y: f.pos.y * view.cellSize,
      w: f.w * view.cellSize,
      h: f.h * view.cellSize,
    };
    if (origR.x !== r.x || origR.y !== r.y) {
      // Draw the original position faded out to show the "source"
      ctx2d.fillStyle = 'rgba(240, 240, 240, 0.65)';
      ctx2d.fillRect(origR.x, origR.y, origR.w, origR.h);
    }

    // Draw actual furniture at the preview position
    paintFurnitureRect(ctx2d, f.kind, r);

    // Validity tint — overlay to signal valid/invalid drop position
    if (valid) {
      ctx2d.strokeStyle = 'rgba(25, 118, 210, 0.9)';
      ctx2d.lineWidth = 2.5;
      ctx2d.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    } else {
      ctx2d.fillStyle = 'rgba(211, 47, 47, 0.30)';
      ctx2d.fillRect(r.x, r.y, r.w, r.h);
      ctx2d.strokeStyle = 'rgba(211, 47, 47, 0.9)';
      ctx2d.lineWidth = 2.5;
      ctx2d.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
  }

  // --- §13.1 Palette drag-over live preview ---
  if (paletteDragPreview !== null) {
    const { kind, previewPos, valid } = paletteDragPreview;
    const meta = PALETTE_ITEMS.find((m) => m.kind === kind);
    const w = meta?.w ?? 1;
    const h = meta?.h ?? 1;
    const r = {
      x: previewPos.x * view.cellSize,
      y: previewPos.y * view.cellSize,
      w: w * view.cellSize,
      h: h * view.cellSize,
    };

    // Draw real furniture at drag position
    paintFurnitureRect(ctx2d, kind, r, 0.85);

    // Validity tint
    if (valid) {
      ctx2d.strokeStyle = 'rgba(25, 118, 210, 0.85)';
      ctx2d.lineWidth = 2.5;
      ctx2d.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    } else {
      ctx2d.fillStyle = 'rgba(211, 47, 47, 0.28)';
      ctx2d.fillRect(r.x, r.y, r.w, r.h);
      ctx2d.strokeStyle = 'rgba(211, 47, 47, 0.85)';
      ctx2d.lineWidth = 2.5;
      ctx2d.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
  }

  // --- Drop collision flash ---
  if (dropCollisionFlash && selectedRect !== null) {
    ctx2d.fillStyle = 'rgba(211, 47, 47, 0.25)';
    ctx2d.fillRect(selectedRect.x, selectedRect.y, selectedRect.w, selectedRect.h);
  }

  ctx2d.restore();
}

// ---------------------------------------------------------------------------
// selectedRect — pixel rect of the selected furniture, kept in sync with
// selection changes so paintOverlay can draw the highlight without store access.
// ---------------------------------------------------------------------------

let selectedRect: { x: number; y: number; w: number; h: number } | null = null;

/** Update selectedRect from the selected furniture + current CanvasView. */
function syncSelectedRect(furniture: Furniture | undefined, view: CanvasView): void {
  if (furniture === undefined) {
    selectedRect = null;
    return;
  }
  selectedRect = furnitureToPixelRect(furniture, view.cellSize);
}

// ---------------------------------------------------------------------------
// FurnitureEditor — the EditorMode instance
// ---------------------------------------------------------------------------

export const FurnitureEditor: EditorMode = {
  id: 'furniture',
  label: 'Furniture',

  Toolbar: FurnitureToolbar,
  SidePanel: FurnitureSidePanel,

  // ---- Lifecycle -----------------------------------------------------------

  activate(ctx: EditorContext): void {
    repaintFn = () => { ctx.canvas.requestRepaint(); };
    selectedId = null;
    selectedRect = null;
    dragState = null;
    dropCollisionFlash = false;
    paletteDragPreview = null;
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deactivate(_ctx: EditorContext): void {
    selectedId = null;
    selectedRect = null;
    dragState = null;
    dropCollisionFlash = false;
    paletteDragPreview = null;
    // Clear the cross-browser drag kind stash — important if the teacher switches
    // editors mid-drag (unlikely but guards against any stale state).
    clearDraggedKindStash();
    repaintFn = null;
  },

  // ---- Pointer events — grid drag/move -------------------------------------

  onPointerDown(e: PointerEvent, ctx: EditorContext): void {
    if (e.button !== 0) return;

    const cell = ctx.canvas.cellAt(e.clientX, e.clientY);
    if (cell === undefined) {
      selectedId = null;
      selectedRect = null;
      ctx.canvas.requestRepaint();
      return;
    }

    const furniture = ctx.canvas.furnitureAt(cell);
    if (furniture === undefined) {
      selectedId = null;
      selectedRect = null;
      ctx.canvas.requestRepaint();
      return;
    }

    selectedId = furniture.id;
    syncSelectedRect(furniture, ctx.canvas);

    // Start potential drag: record offset from furniture top-left to clicked cell
    const offset: Vec2 = {
      x: cell.x - furniture.pos.x,
      y: cell.y - furniture.pos.y,
    };

    dragState = {
      furniture,
      offsetInFurniture: offset,
      previewPos: furniture.pos,
      valid: true,
      moved: false,
    };

    ctx.canvas.requestRepaint();
  },

  onPointerMove(e: PointerEvent, ctx: EditorContext): void {
    if (dragState === null) return;

    const cell = ctx.canvas.cellAt(e.clientX, e.clientY);
    if (cell === undefined) return;

    const { furniture, offsetInFurniture } = dragState;
    const newPos: Vec2 = {
      x: cell.x - offsetInFurniture.x,
      y: cell.y - offsetInFurniture.y,
    };

    // Detect if we actually moved at least one cell
    const moved =
      newPos.x !== furniture.pos.x || newPos.y !== furniture.pos.y;

    // ctx.store is a PijonState snapshot — read classroom directly.
    const valid =
      inBounds(newPos, furniture.w, furniture.h, ctx.store.classroom.gridW, ctx.store.classroom.gridH) &&
      !hasCollision(newPos, furniture.w, furniture.h, ctx.store.classroom.furniture, furniture.id);

    dragState = {
      ...dragState,
      previewPos: newPos,
      valid,
      moved: dragState.moved || moved,
    };

    // Keep selection rect in sync with the preview
    selectedRect = {
      x: newPos.x * ctx.canvas.cellSize,
      y: newPos.y * ctx.canvas.cellSize,
      w: furniture.w * ctx.canvas.cellSize,
      h: furniture.h * ctx.canvas.cellSize,
    };

    ctx.canvas.requestRepaint();
  },

  onPointerUp(e: PointerEvent, ctx: EditorContext): void {
    if (e.button !== 0) return;
    if (dragState === null) return;

    const { furniture, previewPos, valid, moved } = dragState;
    dragState = null;

    if (moved && valid) {
      ctx.store.moveFurniture(furniture.id, previewPos);
      // Update selectedRect to committed position
      selectedRect = {
        x: previewPos.x * ctx.canvas.cellSize,
        y: previewPos.y * ctx.canvas.cellSize,
        w: furniture.w * ctx.canvas.cellSize,
        h: furniture.h * ctx.canvas.cellSize,
      };
    } else if (moved && !valid) {
      // Revert — keep original position rect
      syncSelectedRect(furniture, ctx.canvas);
    } else {
      // No movement — just a click-select; keep selection at original pos
      syncSelectedRect(furniture, ctx.canvas);
    }

    ctx.canvas.requestRepaint();
  },

  // ---- Keyboard — Delete/Backspace removes selected furniture --------------

  onKeyDown(e: KeyboardEvent, ctx: EditorContext): void {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (selectedId === null) return;

    // Type assertion: furnitureId() branding
    ctx.store.removeFurniture(selectedId as ReturnType<typeof furnitureId>);
    selectedId = null;
    selectedRect = null;
    dragState = null;
    ctx.canvas.requestRepaint();
  },

  // ---- Drop — from palette drag --------------------------------------------

  onDrop(e: DragEvent, ctx: EditorContext): void {
    e.preventDefault();

    // §13.1 — Clear the live preview immediately on drop
    paletteDragPreview = null;
    // Clear the cross-browser stash — this drag is over
    clearDraggedKindStash();

    // Read the furniture kind from dataTransfer (drop event always allows getData)
    let kind = e.dataTransfer?.getData(DRAG_KIND_KEY) ?? '';
    if (!kind) {
      kind = e.dataTransfer?.getData('text/plain') ?? '';
    }

    const validKinds: readonly string[] = ['single_desk', 'table', 'teacher_desk', 'whiteboard'];
    if (!validKinds.includes(kind)) return;

    const cell = ctx.canvas.cellAt(e.clientX, e.clientY);
    if (cell === undefined) return;

    const furnitureKind = kind as FurnitureKind;
    const meta = PALETTE_ITEMS.find((m) => m.kind === furnitureKind);
    if (meta === undefined) return;

    // Bounds check
    if (!inBounds(cell, meta.w, meta.h, ctx.store.classroom.gridW, ctx.store.classroom.gridH)) {
      return;
    }

    // Collision check
    if (hasCollision(cell, meta.w, meta.h, ctx.store.classroom.furniture)) {
      // Flash the target area red
      dropCollisionFlash = true;
      selectedRect = {
        x: cell.x * ctx.canvas.cellSize,
        y: cell.y * ctx.canvas.cellSize,
        w: meta.w * ctx.canvas.cellSize,
        h: meta.h * ctx.canvas.cellSize,
      };
      ctx.canvas.requestRepaint();
      setTimeout(() => {
        dropCollisionFlash = false;
        repaintFn?.();
      }, 400);
      return;
    }

    // Create and add the furniture
    const newFurniture = makeFurniture(furnitureKind, cell);
    ctx.store.addFurniture(newFurniture);

    // Auto-select the newly placed piece
    selectedId = newFurniture.id;
    selectedRect = {
      x: cell.x * ctx.canvas.cellSize,
      y: cell.y * ctx.canvas.cellSize,
      w: meta.w * ctx.canvas.cellSize,
      h: meta.h * ctx.canvas.cellSize,
    };
    ctx.canvas.requestRepaint();
  },

  // ---- §13.1 dragover — live palette preview on the canvas ------------------

  onDragOver(e: DragEvent, ctx: EditorContext): void {
    // Read the furniture kind — falls back to the module-level stash in Firefox/Safari
    // where getData() returns "" during dragover (see readDraggedKind).
    const kind = readDraggedKind(e);

    const validKinds: readonly string[] = ['single_desk', 'table', 'teacher_desk', 'whiteboard'];
    if (!validKinds.includes(kind)) {
      // Not a furniture drag — clear any stale preview and bail
      if (paletteDragPreview !== null) {
        paletteDragPreview = null;
        ctx.canvas.requestRepaint();
      }
      return;
    }

    const furnitureKind = kind as FurnitureKind;
    const meta = PALETTE_ITEMS.find((m) => m.kind === furnitureKind);
    if (meta === undefined) return;

    const cell = ctx.canvas.cellAt(e.clientX, e.clientY);
    if (cell === undefined) {
      if (paletteDragPreview !== null) {
        paletteDragPreview = null;
        ctx.canvas.requestRepaint();
      }
      return;
    }

    const valid =
      inBounds(cell, meta.w, meta.h, ctx.store.classroom.gridW, ctx.store.classroom.gridH) &&
      !hasCollision(cell, meta.w, meta.h, ctx.store.classroom.furniture);

    // Update preview only if it changed (avoid unnecessary repaints)
    const prev = paletteDragPreview;
    const changed =
      prev?.kind !== furnitureKind ||
      prev.previewPos.x !== cell.x ||
      prev.previewPos.y !== cell.y ||
      prev.valid !== valid;
    if (changed) {
      paletteDragPreview = { kind: furnitureKind, previewPos: cell, valid };
      ctx.canvas.requestRepaint();
    }
  },

  // ---- §13.1 dragend — clear palette preview on drag end -------------------

  onDragEnd(_e: DragEvent, ctx: EditorContext): void {
    // Clear the cross-browser stash so it never bleeds to a later drag.
    clearDraggedKindStash();
    if (paletteDragPreview !== null) {
      paletteDragPreview = null;
      ctx.canvas.requestRepaint();
    }
  },

  // ---- Context menu — no-op for now ----------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onContextMenu(_e: MouseEvent, _ctx: EditorContext): void {
    // Future: right-click menu (rotate, duplicate, etc.)
  },

  // ---- paintOverlay --------------------------------------------------------

  paintOverlay,
};

// ---------------------------------------------------------------------------
// FurniturePalette — also exported if callers want it standalone (Phase 9 shell)
// ---------------------------------------------------------------------------

export { FurnitureSidePanel as FurniturePalette };

// Phase 9 note: if the shell needs to show the selected furniture id in a status bar,
// read the module-level `selectedId` variable directly (it is not reactive). A proper
// reactive approach would expose a Zustand slice for selection state.
