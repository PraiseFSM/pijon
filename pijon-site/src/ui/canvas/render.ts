/**
 * render.ts — base canvas render pass (Phase 6).
 *
 * Pure-ish drawing functions: they take a CanvasRenderingContext2D plus state
 * and draw to it. No side effects beyond the canvas. No React, no store.
 *
 * Painter model (mirrors classroom_builder.py):
 *  1. clearCanvas — blank the frame.
 *  2. drawGrid    — light grid lines.
 *  3. drawFurniture — fill + stroke each piece.
 *  4. drawOccupant  — centered name text over each occupied piece.
 *
 * Mode-specific decorations (highlights, drag ghosts, connection lines) are
 * NOT here — they live in each EditorMode.paintOverlay().
 *
 * DPR scaling is handled by ClassroomCanvas (it scales the context before
 * calling these functions), so all coordinates here are in CSS pixels.
 */

import type { Furniture } from '../../domain/furniture.js';
import { occupant, isFixture } from '../../domain/furniture.js';
import type { Classroom } from '../../domain/classroom.js';
import { furnitureToPixelRect } from './hitTest.js';

// ---------------------------------------------------------------------------
// Colour palette (matches the PyQt prototype's visual style)
// ---------------------------------------------------------------------------

const COLORS = {
  gridLine: '#d0d0d0',
  gridBackground: '#f8f8f8',

  // Furniture fills by kind
  singleDesk: '#e3f2fd',       // light blue — most common element
  table: '#e8f5e9',            // light green
  teacherDesk: '#fff3e0',      // light orange
  whiteboard: '#f3e5f5',       // light purple

  // Furniture strokes
  stroke: '#90a4ae',           // blue-grey
  strokeFixture: '#b39ddb',    // purple-grey for fixtures

  // Occupant name colours
  studentName: '#1a237e',      // dark blue (real student)
  fixtureName: '#4a148c',      // dark purple (fixture label)

  // Locked-seat overlay
  lockTint: 'rgba(255, 152, 0, 0.18)',
} as const;

// ---------------------------------------------------------------------------
// clearCanvas
// ---------------------------------------------------------------------------

/**
 * Fill the entire canvas with the background colour.
 * Must be called first at the start of each frame.
 */
export function clearCanvas(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
): void {
  ctx.fillStyle = COLORS.gridBackground;
  ctx.fillRect(0, 0, cssW, cssH);
}

// ---------------------------------------------------------------------------
// drawGrid
// ---------------------------------------------------------------------------

/**
 * Draw the light grid lines over the background.
 *
 * @param ctx       canvas 2D context (already DPR-scaled by caller)
 * @param gridW     number of columns
 * @param gridH     number of rows
 * @param cellSize  CSS pixels per cell
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  gridW: number,
  gridH: number,
  cellSize: number,
): void {
  const totalW = gridW * cellSize;
  const totalH = gridH * cellSize;

  ctx.save();
  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 0.5;
  ctx.beginPath();

  // Vertical lines
  for (let col = 0; col <= gridW; col++) {
    const x = col * cellSize;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, totalH);
  }

  // Horizontal lines
  for (let row = 0; row <= gridH; row++) {
    const y = row * cellSize;
    ctx.moveTo(0, y);
    ctx.lineTo(totalW, y);
  }

  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// drawFurniture
// ---------------------------------------------------------------------------

/** Pick the fill colour for a piece of furniture by its kind. */
function fillForFurniture(f: Furniture): string {
  switch (f.kind) {
    case 'single_desk':   return COLORS.singleDesk;
    case 'table':         return COLORS.table;
    case 'teacher_desk':  return COLORS.teacherDesk;
    case 'whiteboard':    return COLORS.whiteboard;
  }
}

/** Pick the stroke colour — fixtures get a slightly different tone. */
function strokeForFurniture(f: Furniture): string {
  if (f.kind === 'teacher_desk' || f.kind === 'whiteboard') {
    return COLORS.strokeFixture;
  }
  return COLORS.stroke;
}

/**
 * Draw all furniture in the classroom.
 * Each piece is drawn as a filled + stroked rectangle covering its bounding box.
 * imagePath is noted here for future image-based rendering; for Phase 6 we fall
 * back to the coloured rectangle.
 *
 * @param ctx       canvas 2D context
 * @param classroom the classroom document
 * @param cellSize  CSS pixels per cell
 * @param locks     set of locked furniture ids (drawn with a tint overlay)
 */
export function drawFurniture(
  ctx: CanvasRenderingContext2D,
  classroom: Classroom,
  cellSize: number,
  locks: ReadonlySet<string>,
): void {
  ctx.save();
  ctx.lineWidth = 1.5;

  for (const f of classroom.furniture) {
    const rect = furnitureToPixelRect(f, cellSize);

    // Fill
    ctx.fillStyle = fillForFurniture(f);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    // Lock tint overlay
    if (locks.has(f.id)) {
      ctx.fillStyle = COLORS.lockTint;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }

    // Stroke
    ctx.strokeStyle = strokeForFurniture(f);
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// drawOccupants
// ---------------------------------------------------------------------------

/** Minimum rect dimension (in CSS px) for text to be drawn at all. */
const MIN_TEXT_PX = 12;

/**
 * Draw the occupant's name centered over the furniture bounding box.
 * Fixture occupants are drawn in a distinct colour + italic style to make
 * room-feature labels visually different from real students.
 *
 * Skips furniture with no occupant and cells too small for legible text.
 *
 * @param ctx       canvas 2D context
 * @param classroom the classroom document
 * @param cellSize  CSS pixels per cell
 */
export function drawOccupants(
  ctx: CanvasRenderingContext2D,
  classroom: Classroom,
  cellSize: number,
): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const fontSize = Math.max(9, Math.min(13, cellSize * 0.28));

  for (const f of classroom.furniture) {
    const occ = occupant(f);
    if (occ === undefined) continue;

    const rect = furnitureToPixelRect(f, cellSize);
    if (rect.w < MIN_TEXT_PX || rect.h < MIN_TEXT_PX) continue;

    const fixture = isFixture(f);

    ctx.fillStyle = fixture ? COLORS.fixtureName : COLORS.studentName;
    ctx.font = fixture
      ? `italic ${fontSize.toString()}px sans-serif`
      : `${fontSize.toString()}px sans-serif`;

    // Clip text to furniture rect so it never overflows into neighboring cells
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4);
    ctx.clip();

    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    ctx.fillText(occ.name, cx, cy);

    ctx.restore();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// renderBasePass — convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Run the full base render pass in order:
 * clear → grid → furniture → occupant names.
 *
 * ClassroomCanvas calls this at the start of each frame, then the active
 * editor's paintOverlay() runs on top.
 *
 * @param ctx       canvas 2D context (already DPR-scaled by ClassroomCanvas)
 * @param classroom classroom document from the store
 * @param cellSize  CSS pixels per cell
 * @param locks     locked seat ids (for lock-tint overlay on furniture)
 */
export function renderBasePass(
  ctx: CanvasRenderingContext2D,
  classroom: Classroom,
  cellSize: number,
  locks: ReadonlySet<string>,
): void {
  const cssW = classroom.gridW * cellSize;
  const cssH = classroom.gridH * cellSize;

  clearCanvas(ctx, cssW, cssH);
  drawGrid(ctx, classroom.gridW, classroom.gridH, cellSize);
  drawFurniture(ctx, classroom, cellSize, locks);
  drawOccupants(ctx, classroom, cellSize);
}
