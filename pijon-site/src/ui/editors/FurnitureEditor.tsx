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

import React, { useState, useCallback } from 'react';
import type { EditorContext, EditorMode, CanvasView } from './EditorMode.js';
import type { FurnitureKind, Vec2 } from '../../domain/types.js';
import { furnitureId } from '../../domain/types.js';
import type { Furniture } from '../../domain/furniture.js';
import { occupiedCells } from '../../domain/furniture.js';
import { furnitureToPixelRect } from '../canvas/hitTest.js';
import { resizeButtonRects, hitButton, ghostRingCells, type ResizeButton } from '../canvas/ghostRing.js';
import { usePijonStore } from '../../state/store.js';
import { getImage } from '../canvas/imageCache.js';
import { furnitureAssetUrl, ASSET } from '../../assets/paths.js';
import { makeClassroom, canRemoveEdge } from '../../domain/classroom.js';
import type { Classroom } from '../../domain/classroom.js';

/**
 * 5.A1 — Filter the resize buttons so a MINUS (remove) button is shown only at
 * edges where removing a row/column is actually valid (`canRemoveEdge`). PLUS
 * (add) buttons are always kept. Used identically by the paint and both
 * hit-test paths so a hidden button is never clickable — and a desk can never
 * sit on top of a − button, because the button isn't drawn when that edge's
 * row/column is occupied.
 */
function removableButtons(
  buttons: readonly ResizeButton[],
  classroom: Classroom,
): readonly ResizeButton[] {
  return buttons.filter((b) => b.sign === 1 || canRemoveEdge(classroom, b.edge));
}
import { GridColorButton, GridColorPickerPopover } from './GridColorPicker.js';
import {
  toolbarBackground,
  toolbarBorder,
  textDark,
  textMedium,
  textFainter,
  textFaint,
  textPlaceholder,
  btnBackground,
  btnBorder,
  bannerWarningBackground,
  bannerWarningBorder,
  bannerWarningText,
  bannerWarningButtonBorder,
  furnitureFillByKind,
  paletteItemBorder,
  sidePanelBackground,
  panelBorder,
  sidePanelHeaderText,
  selectionStroke,
  gridDragOriginFade,
  gridDragValidStroke,
  gridDragInvalidFill,
  gridDragInvalidStroke,
  dragPreviewValidStroke,
  dragPreviewInvalidFill,
  dragPreviewInvalidStroke,
  dropCollisionFlashFill,
  furnitureFillSingleDesk,
  furnitureFillTable,
  furnitureFillTeacherDesk,
  furnitureFillWhiteboard,
  furnitureStroke,
  furnitureStrokeFixture,
  ghostRingCellFill,
  ghostRingCellStroke,
  ghostRingPlusButtonFill,
  ghostRingPlusButtonStroke,
  ghostRingPlusButtonText,
  ghostRingPlusButtonHoverFill,
  ghostRingMinusButtonFill,
  ghostRingMinusButtonStroke,
  ghostRingMinusButtonText,
  ghostRingMinusButtonHoverFill,
} from '../../theme/colors.js';

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

/**
 * Build a Furniture record for a given kind at position `pos`.
 *
 * `cellsPerUnit` (G) is the current grid granularity.  Palette items store
 * their dimensions in UNITS (1×1, 2×2 etc.); multiplying by G gives the
 * fine-cell dimensions that match the classroom's coordinate space.
 *
 * At G=1 this is a no-op (w_units × 1 = w_units).  At G=2 a 1×1 desk
 * becomes 2×2 fine cells so its physical size is unchanged.
 */
function makeFurniture(kind: FurnitureKind, pos: Vec2, cellsPerUnit = 1): Furniture {
  const meta = PALETTE_ITEMS.find((m) => m.kind === kind);
  const w = (meta?.w ?? 1) * cellsPerUnit;
  const h = (meta?.h ?? 1) * cellsPerUnit;
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

/**
 * §14.7 — The ghost-ring resize button the pointer is currently hovering over,
 * or null when not hovering any button.  Used by paintOverlay to draw the
 * hover highlight without a re-render.
 */
let hoveredButton: ResizeButton | null = null;

/** requestRepaint reference captured on activate so paintOverlay triggers can call it. */
let repaintFn: (() => void) | null = null;

// ---------------------------------------------------------------------------
// §13.1 — Palette drag-over preview (live canvas preview while dragging from palette)
// ---------------------------------------------------------------------------

/**
 * When the teacher drags a palette item over the grid (HTML5 dragover), we paint
 * a live preview of the to-be-placed furniture at the hovered cell.
 * Cleared on dragend / drop / dragleave.
 *
 * `w` and `h` are stored in FINE CELLS (already scaled by cellsPerUnit) so that
 * paintOverlay can draw the correct size without needing classroom state.
 */
let paletteDragPreview: {
  kind: FurnitureKind;
  previewPos: Vec2;
  /** Width in fine cells (= unitW × cellsPerUnit). */
  w: number;
  /** Height in fine cells (= unitH × cellsPerUnit). */
  h: number;
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

  /**
   * §polish Fix 2 — non-blocking granularity error banner.
   * Set when the user tries to apply an invalid granularity; cleared on success.
   */
  const [granularityWarning, setGranularityWarning] = useState<string | null>(null);
  /** §14.5 — grid color picker open state */
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

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

  // 5.A3 — granularity is restricted to {1, 2, 4} (powers of two, so every
  // transition between allowed values is a clean multiple/divisor and
  // setGranularity never rejects on divisibility between them). Applied
  // immediately on select; the non-blocking banner surfaces the rare case where
  // scaling back down rejects (furniture not on a coarse-unit boundary).
  const handleGranularitySelect = (g: number) => {
    if (g === classroom.cellsPerUnit) return;
    try {
      ctx.store.setGranularity(g);
      setGranularityWarning(null);
      ctx.canvas.requestRepaint();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : `Can't set granularity to ${g.toString()} — move furniture onto unit boundaries first.`;
      setGranularityWarning(msg);
    }
  };

  /** §14.5 — Handle live grid color changes from the picker (onInput = continuous). */
  const handleGridColorChange = useCallback(
    (color: string | null) => {
      ctx.store.setGridColor(color);
      ctx.canvas.requestRepaint();
    },
    [ctx.store, ctx.canvas],
  );

  const handleColorPickerClose = useCallback(() => {
    setColorPickerOpen(false);
  }, []);

  const btn: React.CSSProperties = {
    padding: '3px 9px',
    borderRadius: 4,
    border: `1px solid ${btnBorder}`,
    background: btnBackground,
    cursor: 'pointer',
    fontSize: '0.82rem',
    lineHeight: '1.4',
  };

  const sep = (
    <span style={{ borderLeft: '1px solid #ddd', height: 20, margin: '0 4px', display: 'inline-block' }} />
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: toolbarBackground,
        borderBottom: `1px solid ${toolbarBorder}`,
      }}
    >
      {/* Resize grid warning banner */}
      {warning !== null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 10px',
            background: bannerWarningBackground,
            borderBottom: `1px solid ${bannerWarningBorder}`,
            fontSize: '0.78rem',
            color: bannerWarningText,
          }}
        >
          <span style={{ flex: 1 }}>⚠ {warning}</span>
          <button
            type="button"
            onClick={() => { ctx.store.dismissResizeWarning(); }}
            style={{ ...btn, padding: '1px 7px', fontSize: '0.74rem', color: bannerWarningText, borderColor: bannerWarningButtonBorder }}
          >
            ✕
          </button>
        </div>
      )}

      {/* §polish Fix 2 — Granularity warning banner (non-blocking, dismissable) */}
      {granularityWarning !== null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 10px',
            background: bannerWarningBackground,
            borderBottom: `1px solid ${bannerWarningBorder}`,
            fontSize: '0.78rem',
            color: bannerWarningText,
          }}
        >
          <span style={{ flex: 1 }}>⚠ {granularityWarning}</span>
          <button
            type="button"
            onClick={() => { setGranularityWarning(null); }}
            style={{ ...btn, padding: '1px 7px', fontSize: '0.74rem', color: bannerWarningText, borderColor: bannerWarningButtonBorder }}
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
        <span style={{ fontWeight: 700, fontSize: '0.88rem', marginRight: 6, color: textDark }}>Furniture</span>
        <button style={btn} onClick={handleNew} type="button">New</button>
        <button style={btn} onClick={handleClear} type="button">Clear</button>
        <button style={btn} onClick={handleSave} type="button" title="Save classroom to a .pijon file">Save…</button>
        <button style={btn} onClick={handleLoad} type="button" title="Open a .pijon file">Load…</button>

        {sep}

        {/* §14.7 — Grid size readout (resize controls moved to in-grid ghost ring) */}
        <span style={{ fontSize: '0.78rem', color: textMedium, fontWeight: 600 }}>Grid:</span>
        <span
          style={{ fontSize: '0.78rem', color: textFaint, marginLeft: 2 }}
          title="Use the +/− buttons on the grid edges to resize"
        >
          {classroom.gridW}×{classroom.gridH}
        </span>

        {sep}

        {/* Granularity — restricted to {1, 2, 4} (5.A3) */}
        <span style={{ fontSize: '0.78rem', color: textMedium, fontWeight: 600 }}>Granularity:</span>
        <div style={{ display: 'inline-flex', gap: 2 }} role="group" aria-label="Grid granularity">
          {[1, 2, 4].map((g) => {
            const active = classroom.cellsPerUnit === g;
            return (
              <button
                key={g}
                type="button"
                aria-pressed={active}
                onClick={() => { handleGranularitySelect(g); }}
                title={`Fine cells per unit: ${g.toString()}. Changing scales furniture so the physical layout is unchanged.`}
                style={{
                  ...btn,
                  fontSize: '0.78rem',
                  minWidth: 26,
                  fontWeight: active ? 700 : 400,
                  background: active ? '#e3f2fd' : btnBackground,
                  borderColor: active ? '#1565c0' : btnBorder,
                  color: active ? '#0d47a1' : textDark,
                }}
              >
                {g}
              </button>
            );
          })}
        </div>

        {sep}

        {/* §14.4 — Background image toggle */}
        <span style={{ fontSize: '0.78rem', color: textMedium, fontWeight: 600 }}>BG:</span>
        <button
          type="button"
          style={{
            ...btn,
            fontSize: '0.78rem',
            background: classroom.backgroundImage ? '#e3f2fd' : btnBackground,
            borderColor: classroom.backgroundImage ? '#1565c0' : btnBorder,
            color: classroom.backgroundImage ? '#0d47a1' : textDark,
          }}
          title={
            classroom.backgroundImage
              ? 'Click to disable the classroom background image'
              : 'Click to enable the classroom background image (classroom-background.png)'
          }
          onClick={() => {
            ctx.store.setBackgroundImage(
              classroom.backgroundImage ? null : ASSET.background,
            );
            ctx.canvas.requestRepaint();
          }}
        >
          {classroom.backgroundImage ? 'On' : 'Off'}
        </button>

        {sep}

        {/* §14.5 — Grid color picker */}
        <span style={{ fontSize: '0.78rem', color: textMedium, fontWeight: 600 }}>Grid Color:</span>
        <div style={{ position: 'relative' }}>
          <GridColorButton
            open={colorPickerOpen}
            currentColor={classroom.gridColor ?? null}
            onClick={() => { setColorPickerOpen((v) => !v); }}
          />
          <GridColorPickerPopover
            open={colorPickerOpen}
            currentColor={classroom.gridColor ?? null}
            onChange={handleGridColorChange}
            onClose={handleColorPickerClose}
          />
        </div>
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
    border: `1px solid ${paletteItemBorder}`,
    background: furnitureFillSingleDesk,
    cursor: 'grab',
    userSelect: 'none',
    fontSize: '0.85rem',
    fontWeight: 500,
  };

  return (
    <div
      style={{
        width: 160,
        padding: '10px 8px',
        background: sidePanelBackground,
        borderRight: `1px solid ${panelBorder}`,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: '0.8rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: sidePanelHeaderText,
          marginBottom: 10,
        }}
      >
        Palette
      </div>
      {PALETTE_ITEMS.map((item) => {
        const assetUrl = furnitureAssetUrl(item.kind);
        return (
          <div
            key={item.kind}
            draggable
            onDragStart={(e) => {
              handleDragStart(e, item.kind);
            }}
            style={{
              ...itemStyle,
              background: furnitureFillByKind[item.kind] ?? furnitureFillSingleDesk,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            title={`Drag onto the grid to place a ${item.label}`}
          >
            {/* §14.3 — Show the furniture image asset in the palette item when available */}
            {assetUrl !== undefined && (
              <img
                src={assetUrl}
                alt=""
                aria-hidden="true"
                width={24}
                height={24}
                style={{ objectFit: 'contain', borderRadius: 2, flexShrink: 0 }}
              />
            )}
            <div>
              {item.label}
              <div style={{ fontSize: '0.7rem', color: textFainter, fontWeight: 400 }}>
                {item.w}×{item.h}
              </div>
            </div>
          </div>
        );
      })}
      <div
        style={{
          marginTop: 16,
          fontSize: '0.72rem',
          color: textPlaceholder,
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

/** Fill colour for each furniture kind — sourced from colors.ts (mirrors render.ts). */
function kindFillColor(kind: FurnitureKind): string {
  switch (kind) {
    case 'single_desk':   return furnitureFillSingleDesk;
    case 'table':         return furnitureFillTable;
    case 'teacher_desk':  return furnitureFillTeacherDesk;
    case 'whiteboard':    return furnitureFillWhiteboard;
  }
}

/** Stroke colour — sourced from colors.ts, mirrors render.ts strokeForFurniture logic. */
function kindStrokeColor(kind: FurnitureKind): string {
  if (kind === 'teacher_desk' || kind === 'whiteboard') return furnitureStrokeFixture;
  return furnitureStroke;
}

/**
 * Draw the furniture kind as a filled+stroked rectangle at pixel rect r.
 * §14.3: uses the image asset for this kind when loaded (matches render.ts base pass).
 * Falls back to the kind-color fill when the image is not yet loaded.
 * This keeps the live-drag preview visually identical to placed furniture.
 */
function paintFurnitureRect(
  ctx2d: CanvasRenderingContext2D,
  kind: FurnitureKind,
  r: { x: number; y: number; w: number; h: number },
  alpha = 1.0,
): void {
  ctx2d.save();
  ctx2d.globalAlpha = alpha;

  // §14.3 — Use image if loaded, else color fallback
  const assetUrl = furnitureAssetUrl(kind);
  const img = assetUrl !== undefined ? getImage(assetUrl) : undefined;

  if (img !== undefined) {
    ctx2d.drawImage(img, r.x, r.y, r.w, r.h);
  } else {
    ctx2d.fillStyle = kindFillColor(kind);
    ctx2d.fillRect(r.x, r.y, r.w, r.h);
  }

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

  // §14.7 — Draw the ghost ring BEFORE the grid-coordinate content so it
  // is drawn in canvas space (no translate needed — rects are already in
  // canvas pixel coords from resizeButtonRects/ghostRingCells).
  if (view.originOffset > 0) {
    const cs = view.cellSize;

    // --- Ghost ring cells (lighter translucent squares around the grid) ---
    const ringCells = ghostRingCells(view.gridW, view.gridH, view.originOffset);
    ctx2d.fillStyle = ghostRingCellFill;
    ctx2d.strokeStyle = ghostRingCellStroke;
    ctx2d.lineWidth = 0.5;
    for (const { col, row } of ringCells) {
      const rx = col * cs;
      const ry = row * cs;
      ctx2d.fillRect(rx, ry, cs, cs);
      ctx2d.strokeRect(rx + 0.25, ry + 0.25, cs - 0.5, cs - 0.5);
    }

    // --- Resize buttons (PLUS outside, MINUS inside) ---
    // 5.A1 — only show − buttons at edges that can validly shrink.
    const ringClassroom = usePijonStore.getState().classroom;
    const buttons = removableButtons(
      resizeButtonRects(view.gridW, view.gridH, cs, view.originOffset, ringClassroom.cellsPerUnit),
      ringClassroom,
    );

    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';

    for (const btn of buttons) {
      const isHovered = hoveredButton !== null
        && hoveredButton.edge === btn.edge
        && hoveredButton.sign === btn.sign;

      if (btn.sign === 1) {
        // PLUS button — outside grid
        ctx2d.fillStyle = isHovered ? ghostRingPlusButtonHoverFill : ghostRingPlusButtonFill;
        ctx2d.strokeStyle = ghostRingPlusButtonStroke;
      } else {
        // MINUS button — inside grid, edge row/col
        ctx2d.fillStyle = isHovered ? ghostRingMinusButtonHoverFill : ghostRingMinusButtonFill;
        ctx2d.strokeStyle = ghostRingMinusButtonStroke;
      }
      ctx2d.lineWidth = 1;
      ctx2d.fillRect(btn.x + 1, btn.y + 1, btn.w - 2, btn.h - 2);
      ctx2d.strokeRect(btn.x + 1.5, btn.y + 1.5, btn.w - 3, btn.h - 3);

      // Label (± sign)
      const label = btn.sign === 1 ? '+' : '−';
      const fontSize = Math.max(10, Math.min(18, cs * 0.38));
      ctx2d.font = `bold ${fontSize.toString()}px sans-serif`;
      ctx2d.fillStyle = btn.sign === 1 ? ghostRingPlusButtonText : ghostRingMinusButtonText;
      ctx2d.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2);
    }
  }

  // Translate so that all grid-coordinate drawing (selectedRect, drag previews)
  // maps correctly when originOffset > 0. selectedRect and drag pixel rects are
  // stored in canvas pixel space (they already include the origin offset), so
  // no further adjustment is needed inside this translated block — they work as-is.
  // We do NOT translate here; instead selectedRect includes the offset already.

  // --- Selection highlight ---
  // selectedRect is kept in sync with the selected furniture by the pointer/drop handlers.
  // paintOverlay draws only from this pre-computed rect so no store access is needed here.
  if (selectedId !== null && dragState === null && selectedRect !== null) {
    ctx2d.strokeStyle = selectionStroke;
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
    const originPx = view.originOffset * view.cellSize;
    const r = {
      x: previewPos.x * view.cellSize + originPx,
      y: previewPos.y * view.cellSize + originPx,
      w: f.w * view.cellSize,
      h: f.h * view.cellSize,
    };

    // Ghost/dim the original spot so the teacher can see it was moved
    const origR = {
      x: f.pos.x * view.cellSize + originPx,
      y: f.pos.y * view.cellSize + originPx,
      w: f.w * view.cellSize,
      h: f.h * view.cellSize,
    };
    if (origR.x !== r.x || origR.y !== r.y) {
      // Draw the original position faded out to show the "source"
      ctx2d.fillStyle = gridDragOriginFade;
      ctx2d.fillRect(origR.x, origR.y, origR.w, origR.h);
    }

    // Draw actual furniture at the preview position
    paintFurnitureRect(ctx2d, f.kind, r);

    // Validity tint — overlay to signal valid/invalid drop position
    if (valid) {
      ctx2d.strokeStyle = gridDragValidStroke;
      ctx2d.lineWidth = 2.5;
      ctx2d.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    } else {
      ctx2d.fillStyle = gridDragInvalidFill;
      ctx2d.fillRect(r.x, r.y, r.w, r.h);
      ctx2d.strokeStyle = gridDragInvalidStroke;
      ctx2d.lineWidth = 2.5;
      ctx2d.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
  }

  // --- §13.1 Palette drag-over live preview ---
  if (paletteDragPreview !== null) {
    // w and h are already in fine cells (scaled by cellsPerUnit when stored).
    const { kind, previewPos, valid, w, h } = paletteDragPreview;
    const originPx = view.originOffset * view.cellSize;
    const r = {
      x: previewPos.x * view.cellSize + originPx,
      y: previewPos.y * view.cellSize + originPx,
      w: w * view.cellSize,
      h: h * view.cellSize,
    };

    // Draw real furniture at drag position
    paintFurnitureRect(ctx2d, kind, r, 0.85);

    // Validity tint
    if (valid) {
      ctx2d.strokeStyle = dragPreviewValidStroke;
      ctx2d.lineWidth = 2.5;
      ctx2d.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    } else {
      ctx2d.fillStyle = dragPreviewInvalidFill;
      ctx2d.fillRect(r.x, r.y, r.w, r.h);
      ctx2d.strokeStyle = dragPreviewInvalidStroke;
      ctx2d.lineWidth = 2.5;
      ctx2d.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
  }

  // --- Drop collision flash ---
  if (dropCollisionFlash && selectedRect !== null) {
    ctx2d.fillStyle = dropCollisionFlashFill;
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
  const baseRect = furnitureToPixelRect(furniture, view.cellSize);
  const originPx = view.originOffset * view.cellSize;
  selectedRect = {
    x: baseRect.x + originPx,
    y: baseRect.y + originPx,
    w: baseRect.w,
    h: baseRect.h,
  };
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
    hoveredButton = null;
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deactivate(_ctx: EditorContext): void {
    selectedId = null;
    selectedRect = null;
    dragState = null;
    dropCollisionFlash = false;
    paletteDragPreview = null;
    hoveredButton = null;
    // Clear the cross-browser drag kind stash — important if the teacher switches
    // editors mid-drag (unlikely but guards against any stale state).
    clearDraggedKindStash();
    repaintFn = null;
  },

  // ---- Pointer events — grid drag/move -------------------------------------

  onPointerDown(e: PointerEvent, ctx: EditorContext): void {
    if (e.button !== 0) return;

    // §14.7 — Check ghost-ring resize buttons BEFORE normal place/select logic.
    // Convert client coords → canvas-pixel coords for button hit-testing.
    if (ctx.canvas.originOffset > 0) {
      // Defensively check if target has getBoundingClientRect (works in DOM and
      // in test environments that pass a plain object with that method).
      const t = e.target;
      const getRect =
        t !== null &&
        typeof t === 'object' &&
        'getBoundingClientRect' in t &&
        typeof (t as { getBoundingClientRect: unknown }).getBoundingClientRect === 'function'
          ? (t as { getBoundingClientRect: () => { left: number; top: number } }).getBoundingClientRect
          : null;
      if (getRect !== null) {
        const canvasRect = getRect.call(t);
        const canvasPx = e.clientX - canvasRect.left;
        const canvasPy = e.clientY - canvasRect.top;
        const buttons = removableButtons(
          resizeButtonRects(
            ctx.canvas.gridW,
            ctx.canvas.gridH,
            ctx.canvas.cellSize,
            ctx.canvas.originOffset,
            ctx.store.classroom.cellsPerUnit,
          ),
          ctx.store.classroom,
        );
        const hit = hitButton(canvasPx, canvasPy, buttons);
        if (hit !== undefined) {
          ctx.store.resizeGrid(hit.edge, hit.sign);
          ctx.canvas.requestRepaint();
          return; // consumed — do not proceed to normal drag/select
        }
      }
    }

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
    // §14.7 — Track hovered ghost-ring button when NOT dragging furniture.
    if (dragState === null && ctx.canvas.originOffset > 0) {
      const tm = e.target;
      const getMoveRect =
        tm !== null &&
        typeof tm === 'object' &&
        'getBoundingClientRect' in tm &&
        typeof (tm as { getBoundingClientRect: unknown }).getBoundingClientRect === 'function'
          ? (tm as { getBoundingClientRect: () => { left: number; top: number } }).getBoundingClientRect
          : null;
      if (getMoveRect !== null) {
        const canvasRect = getMoveRect.call(tm);
        const canvasPx = e.clientX - canvasRect.left;
        const canvasPy = e.clientY - canvasRect.top;
        const buttons = removableButtons(
          resizeButtonRects(
            ctx.canvas.gridW,
            ctx.canvas.gridH,
            ctx.canvas.cellSize,
            ctx.canvas.originOffset,
            ctx.store.classroom.cellsPerUnit,
          ),
          ctx.store.classroom,
        );
        const hit = hitButton(canvasPx, canvasPy, buttons) ?? null;
        const prevHovered = hoveredButton;
        hoveredButton = hit;
        // Only repaint when hover state changed
        if (
          prevHovered?.edge !== hit?.edge ||
          prevHovered?.sign !== hit?.sign
        ) {
          ctx.canvas.requestRepaint();
        }
      }
    }

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

    // Keep selection rect in sync with the preview (in canvas pixel space, with origin offset)
    const previewOriginPx = ctx.canvas.originOffset * ctx.canvas.cellSize;
    selectedRect = {
      x: newPos.x * ctx.canvas.cellSize + previewOriginPx,
      y: newPos.y * ctx.canvas.cellSize + previewOriginPx,
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
      // Update selectedRect to committed position (canvas pixel space, with origin offset)
      const commitOriginPx = ctx.canvas.originOffset * ctx.canvas.cellSize;
      selectedRect = {
        x: previewPos.x * ctx.canvas.cellSize + commitOriginPx,
        y: previewPos.y * ctx.canvas.cellSize + commitOriginPx,
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

    // §14.6 — Scale palette unit-dimensions to fine cells.
    // PALETTE_ITEMS stores dimensions in units; multiply by cellsPerUnit (G) so
    // the placed furniture occupies the correct number of fine grid cells.
    const G = ctx.store.classroom.cellsPerUnit;
    const fw = meta.w * G;
    const fh = meta.h * G;

    // Bounds check
    if (!inBounds(cell, fw, fh, ctx.store.classroom.gridW, ctx.store.classroom.gridH)) {
      return;
    }

    const dropOriginPx = ctx.canvas.originOffset * ctx.canvas.cellSize;

    // Collision check
    if (hasCollision(cell, fw, fh, ctx.store.classroom.furniture)) {
      // Flash the target area red
      dropCollisionFlash = true;
      selectedRect = {
        x: cell.x * ctx.canvas.cellSize + dropOriginPx,
        y: cell.y * ctx.canvas.cellSize + dropOriginPx,
        w: fw * ctx.canvas.cellSize,
        h: fh * ctx.canvas.cellSize,
      };
      ctx.canvas.requestRepaint();
      setTimeout(() => {
        dropCollisionFlash = false;
        repaintFn?.();
      }, 400);
      return;
    }

    // Create and add the furniture (makeFurniture scales by G internally)
    const newFurniture = makeFurniture(furnitureKind, cell, G);
    ctx.store.addFurniture(newFurniture);

    // Auto-select the newly placed piece
    selectedId = newFurniture.id;
    selectedRect = {
      x: cell.x * ctx.canvas.cellSize + dropOriginPx,
      y: cell.y * ctx.canvas.cellSize + dropOriginPx,
      w: fw * ctx.canvas.cellSize,
      h: fh * ctx.canvas.cellSize,
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

    // §14.6 — Scale palette unit-dimensions to fine cells.
    const G = ctx.store.classroom.cellsPerUnit;
    const fw = meta.w * G;
    const fh = meta.h * G;

    const valid =
      inBounds(cell, fw, fh, ctx.store.classroom.gridW, ctx.store.classroom.gridH) &&
      !hasCollision(cell, fw, fh, ctx.store.classroom.furniture);

    // Update preview only if it changed (avoid unnecessary repaints)
    const prev = paletteDragPreview;
    const changed =
      prev?.kind !== furnitureKind ||
      prev.previewPos.x !== cell.x ||
      prev.previewPos.y !== cell.y ||
      prev.w !== fw ||
      prev.h !== fh ||
      prev.valid !== valid;
    if (changed) {
      paletteDragPreview = { kind: furnitureKind, previewPos: cell, w: fw, h: fh, valid };
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

/**
 * §14.6 — Exported alias for makeFurniture (with cellsPerUnit scaling).
 * Tests import this to verify that new placements at G>1 get correct fine-cell
 * dimensions. Internal code uses makeFurniture directly.
 */
export { makeFurniture as makeFurnitureForPalette };

// Phase 9 note: if the shell needs to show the selected furniture id in a status bar,
// read the module-level `selectedId` variable directly (it is not reactive). A proper
// reactive approach would expose a Zustand slice for selection state.
