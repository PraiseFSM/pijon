/**
 * render.ts — base canvas render pass (Phase 6).
 *
 * Pure-ish drawing functions: they take a CanvasRenderingContext2D plus state
 * and draw to it. No side effects beyond the canvas. No React, no store.
 *
 * Painter model (mirrors classroom_builder.py):
 *  1. clearCanvas     — blank the frame (background fill).
 *  2. drawBackground  — optional classroom background image (§14.4), drawn FIRST
 *                       so it sits under grid lines and furniture.
 *  3. drawGrid        — light grid lines.
 *  4. drawFurniture   — fill + stroke each piece (image when loaded, else color — §14.3).
 *  5. drawOccupants   — centered name text over each occupied piece.
 *
 * Mode-specific decorations (highlights, drag ghosts, connection lines) are
 * NOT here — they live in each EditorMode.paintOverlay().
 *
 * DPR scaling is handled by ClassroomCanvas (it scales the context before
 * calling these functions), so all coordinates here are in CSS pixels.
 *
 * §14.3 Furniture images:
 *   Each furniture kind maps to an asset URL via furnitureAssetUrl().
 *   getImage() is called in the draw loop; it returns undefined until loaded.
 *   When undefined, the existing kind-color fill is used (no visual change on
 *   first paint). Once loaded the image is drawn fit-into-rect (objectFit:contain
 *   equivalent via drawImage stretch).
 *
 * §14.4 Background image:
 *   classroom.backgroundImage (string | null | undefined) holds the URL of the
 *   background to paint. When null/undefined the plain gridBackground color is
 *   used (current behaviour — opt-in).  When set, getImage() loads it and the
 *   image is stretched to cover the entire grid area.
 */

import type { Furniture } from '../../domain/furniture.js';
import { occupant, isFixture } from '../../domain/furniture.js';
import type { Classroom } from '../../domain/classroom.js';
import { furnitureToPixelRect } from './hitTest.js';
import { getImage } from './imageCache.js';
import { furnitureAssetUrl } from '../../assets/paths.js';
import {
  gridLine,
  gridBackground,
  furnitureFillSingleDesk,
  furnitureFillTable,
  furnitureFillTeacherDesk,
  furnitureFillWhiteboard,
  furnitureStroke,
  furnitureStrokeFixture,
  occupantNameStudent,
  occupantNameFixture,
  lockTint,
} from '../../theme/colors.js';

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
  ctx.fillStyle = gridBackground;
  ctx.fillRect(0, 0, cssW, cssH);
}

// ---------------------------------------------------------------------------
// §14.4 drawBackground — classroom background image
// ---------------------------------------------------------------------------

/**
 * Draw the classroom background image stretched to cover the entire grid area.
 * Called AFTER clearCanvas but BEFORE drawGrid, so the image sits under everything.
 *
 * If `backgroundImageUrl` is null/undefined/empty, this is a no-op (current
 * behaviour preserved — no visual change unless the feature is opted in).
 *
 * If the image is not yet loaded, getImage() starts loading it; subsequent
 * repaints (triggered by the image cache's repaint callback) will draw it.
 *
 * @param ctx              canvas 2D context
 * @param backgroundImageUrl  URL of the background image, or null/undefined for none
 * @param cssW             total grid width in CSS pixels
 * @param cssH             total grid height in CSS pixels
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  backgroundImageUrl: string | null | undefined,
  cssW: number,
  cssH: number,
): void {
  if (!backgroundImageUrl) return;

  const img = getImage(backgroundImageUrl);
  if (img === undefined) return; // not loaded yet — color fill from clearCanvas shows

  ctx.save();
  // Stretch the image to fill the full grid area
  ctx.drawImage(img, 0, 0, cssW, cssH);
  ctx.restore();
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
 * @param color     optional override for the line color (defaults to gridLine token)
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  gridW: number,
  gridH: number,
  cellSize: number,
  color?: string,
): void {
  const totalW = gridW * cellSize;
  const totalH = gridH * cellSize;

  ctx.save();
  ctx.strokeStyle = color ?? gridLine;
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
    case 'single_desk':   return furnitureFillSingleDesk;
    case 'table':         return furnitureFillTable;
    case 'teacher_desk':  return furnitureFillTeacherDesk;
    case 'whiteboard':    return furnitureFillWhiteboard;
  }
}

/** Pick the stroke colour — fixtures get a slightly different tone. */
function strokeForFurniture(f: Furniture): string {
  if (f.kind === 'teacher_desk' || f.kind === 'whiteboard') {
    return furnitureStrokeFixture;
  }
  return furnitureStroke;
}

/**
 * §14.3 — Draw a single furniture piece at its pixel rect.
 *
 * Decision logic (extracted as a pure function for testability):
 *  - Look up the asset URL for the piece's kind via furnitureAssetUrl().
 *  - Call getImage(url): if loaded, draw image stretched to fit the rect.
 *  - If not loaded (or no URL), draw the flat kind-color fill (existing behavior).
 *  - Always draw the stroke on top (either way).
 *  - Lock tint is applied after the fill/image but before the stroke.
 */
export function drawSingleFurniture(
  ctx: CanvasRenderingContext2D,
  f: Furniture,
  cellSize: number,
  locked: boolean,
): void {
  const rect = furnitureToPixelRect(f, cellSize);

  // --- Fill: image if loaded, else kind-color ---
  const assetUrl = furnitureAssetUrl(f.kind);
  const img = assetUrl !== undefined ? getImage(assetUrl) : undefined;

  if (img !== undefined) {
    // Draw the image stretched to fit the furniture bounding rect
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
  } else {
    ctx.fillStyle = fillForFurniture(f);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  // --- Lock tint overlay (on top of image OR color) ---
  if (locked) {
    ctx.fillStyle = lockTint;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  // --- Stroke (always on top) ---
  ctx.strokeStyle = strokeForFurniture(f);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
}

/**
 * §14.3 — Pure decision function: given a URL and an image-loaded predicate,
 * returns 'image' if an image should be drawn, 'color' otherwise.
 *
 * Extracted so it can be unit-tested without a real canvas or DOM.
 * The caller supplies isLoaded so tests can inject any function.
 *
 * @param url       The asset URL (may be undefined if no mapping exists)
 * @param isLoaded  Predicate: returns true if the image at url is ready
 */
export function selectFurnitureRenderMode(
  url: string | undefined,
  isLoaded: (url: string) => boolean,
): 'image' | 'color' {
  if (url === undefined) return 'color';
  return isLoaded(url) ? 'image' : 'color';
}

/**
 * Draw all furniture in the classroom.
 * Each piece is drawn as a filled + stroked rectangle covering its bounding box.
 * When an image asset is loaded for the piece's kind (§14.3), the image is drawn
 * instead of the flat color fill. The color fallback is always available.
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

  for (const f of classroom.furniture) {
    drawSingleFurniture(ctx, f, cellSize, locks.has(f.id));
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

    ctx.fillStyle = fixture ? occupantNameFixture : occupantNameStudent;
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
 * clear → background image → grid → furniture → occupant names.
 *
 * ClassroomCanvas calls this at the start of each frame, then the active
 * editor's paintOverlay() runs on top.
 *
 * @param ctx       canvas 2D context (already DPR-scaled by ClassroomCanvas)
 * @param classroom classroom document from the store
 * @param cellSize  CSS pixels per cell
 * @param locks     locked seat ids (for lock-tint overlay on furniture)
 * @param gridColor optional override for grid line color (§14.5)
 */
export function renderBasePass(
  ctx: CanvasRenderingContext2D,
  classroom: Classroom,
  cellSize: number,
  locks: ReadonlySet<string>,
  gridColor?: string,
): void {
  const cssW = classroom.gridW * cellSize;
  const cssH = classroom.gridH * cellSize;

  // 1. Clear (background color fill)
  clearCanvas(ctx, cssW, cssH);

  // 2. §14.4 Background image (opt-in; under grid lines and furniture)
  drawBackground(ctx, classroom.backgroundImage, cssW, cssH);

  // 3. Grid lines
  drawGrid(ctx, classroom.gridW, classroom.gridH, cellSize, gridColor);

  // 4. Furniture (image or color fill per §14.3)
  drawFurniture(ctx, classroom, cellSize, locks);

  // 5. Occupant names
  drawOccupants(ctx, classroom, cellSize);
}
