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

import React from 'react';
import type { EditorContext, EditorMode, CanvasView } from './EditorMode.js';
import type { FurnitureKind, Vec2 } from '../../domain/types.js';
import { furnitureId } from '../../domain/types.js';
import type { Furniture } from '../../domain/furniture.js';
import { occupiedCells } from '../../domain/furniture.js';
import { furnitureToPixelRect } from '../canvas/hitTest.js';
import { makeClassroom } from '../../domain/classroom.js';

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

const DRAG_KIND_KEY = 'application/x-pijon-furniture-kind';

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
// Toolbar component
// ---------------------------------------------------------------------------

/**
 * Toolbar for FurnitureEditor.
 * Accepts an optional `onSave` / `onLoad` so Phase 9 can pass PersistenceHandle callbacks.
 * Without them, Save/Load log a console.warn informing Phase 9 wiring is needed.
 */
const FurnitureToolbar: React.FC<{ ctx: EditorContext }> = ({ ctx }) => {
  const handleNew = () => {
    // ctx.store is the full PijonState & PijonActions snapshot;
    // read classroom dims from it directly (no .getState() needed here).
    const fresh = makeClassroom(
      crypto.randomUUID(),
      'My Classroom',
      ctx.store.classroom.gridW,
      ctx.store.classroom.gridH,
    );
    ctx.store.setClassroom(fresh);
  };

  const handleClear = () => {
    // Remove all furniture one by one (store tracks locks cleanup per piece).
    // Snapshot the array first so iteration is stable as pieces are removed.
    const furniture = [...ctx.store.classroom.furniture];
    for (const f of furniture) {
      ctx.store.removeFurniture(f.id);
    }
  };

  const handleSave = () => {
    // Use persistence handle from EditorContext (wired by Phase 9 shell).
    if (ctx.persistence === null) {
      console.warn('[FurnitureEditor] Persistence not yet available.');
      return;
    }
    void ctx.persistence.saveToFile();
  };

  const handleLoad = () => {
    // Use persistence handle from EditorContext (wired by Phase 9 shell).
    if (ctx.persistence === null) {
      console.warn('[FurnitureEditor] Persistence not yet available.');
      return;
    }
    void ctx.persistence.openFromFile();
  };

  const btnStyle: React.CSSProperties = {
    padding: '4px 12px',
    marginRight: 6,
    borderRadius: 4,
    border: '1px solid #bbb',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '0.85rem',
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 10px',
        background: '#f5f5f5',
        borderBottom: '1px solid #ddd',
      }}
    >
      <span style={{ fontWeight: 600, marginRight: 10, fontSize: '0.9rem' }}>Furniture</span>
      <button style={btnStyle} onClick={handleNew} type="button">
        New
      </button>
      <button style={btnStyle} onClick={handleClear} type="button">
        Clear
      </button>
      <button style={btnStyle} onClick={handleSave} type="button" title="Save classroom to a .pijon file">
        Save…
      </button>
      <button style={btnStyle} onClick={handleLoad} type="button" title="Open a .pijon file">
        Load…
      </button>
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

  // --- Drag preview ---
  if (dragState !== null) {
    const { furniture: f, previewPos, valid } = dragState;
    const r = {
      x: previewPos.x * view.cellSize,
      y: previewPos.y * view.cellSize,
      w: f.w * view.cellSize,
      h: f.h * view.cellSize,
    };

    if (valid) {
      ctx2d.fillStyle = 'rgba(25, 118, 210, 0.18)';
      ctx2d.fillRect(r.x, r.y, r.w, r.h);
      ctx2d.strokeStyle = 'rgba(25, 118, 210, 0.9)';
      ctx2d.lineWidth = 2;
      ctx2d.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    } else {
      ctx2d.fillStyle = 'rgba(211, 47, 47, 0.18)';
      ctx2d.fillRect(r.x, r.y, r.w, r.h);
      ctx2d.strokeStyle = 'rgba(211, 47, 47, 0.8)';
      ctx2d.lineWidth = 2;
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
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deactivate(_ctx: EditorContext): void {
    selectedId = null;
    selectedRect = null;
    dragState = null;
    dropCollisionFlash = false;
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

    // Read the furniture kind from dataTransfer
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
