/**
 * Asset path helper — §14.1.
 *
 * Maps logical asset names → URL strings so components never hard-code raw
 * `/assets/<filename>` paths. If an asset is ever renamed or moved, update
 * this file and all references follow automatically.
 *
 * All assets live in `public/assets/` which Vite serves at `/assets/…`.
 * The paths are root-relative so they work regardless of the page URL depth.
 *
 * See `public/assets/ASSETS.md` for the authoritative asset reference table
 * (purpose, expected size, format, filename for every asset).
 *
 * LOCAL-FIRST: No network. These paths are resolved by the browser against
 * the same origin as the app shell (served locally / via the same CDN origin).
 */

// ---------------------------------------------------------------------------
// Base prefix — single place to update if the asset folder ever moves
// ---------------------------------------------------------------------------

const BASE = '/assets' as const;

// ---------------------------------------------------------------------------
// ASSET — the public API for this module
// ---------------------------------------------------------------------------

/**
 * Logical-name → URL mapping for all image assets.
 *
 * Usage:
 *   import { ASSET } from '../../assets/paths.js';
 *   <img src={ASSET.furnitureDefault} />
 *   ctx.drawImage(img, 0, 0);  // after loading
 */
export const ASSET = {
  /**
   * Default furniture image — shown when no kind-specific image exists.
   * 128 × 128 px, PNG. Replace with a desk silhouette or photo for production.
   */
  furnitureDefault: `${BASE}/furniture-default.png`,

  /**
   * Classroom background — drawn behind the grid in render.ts (§14.4).
   * 64 × 64 px, PNG (tiles/stretches). Default is plain white.
   */
  background: `${BASE}/classroom-background.png`,

  /**
   * App favicon — referenced from index.html.
   * SVG, resolution-independent purple "P" on indigo background.
   */
  favicon: `${BASE}/favicon.svg`,

  /**
   * Grid-color-button icon — the button that opens the grid color picker (§14.5).
   * 32 × 32 px, PNG. Solid purple placeholder.
   */
  gridColorButton: `${BASE}/grid-color-button.png`,
} as const;

/**
 * Type for valid logical asset names.
 * Useful for helper functions that accept an asset key.
 */
export type AssetKey = keyof typeof ASSET;

// ---------------------------------------------------------------------------
// §14.3 — Per-kind furniture asset map
//
// Data-driven: each FurnitureKind maps to its ideal asset filename.
// If the file exists in `public/assets/` it will be loaded; if the file
// is missing or fails to load the image cache returns undefined and the
// renderer falls back to the flat kind-color.
//
// To add a real per-kind image later:
//   1. Drop `furniture-<kind>.png` into `public/assets/`.
//   2. Update the entry below to `${BASE}/furniture-<kind>.png`.
//   No code changes elsewhere are needed — the image cache picks it up.
// ---------------------------------------------------------------------------

/**
 * Map from FurnitureKind string to the asset URL to use when drawing that kind.
 * Currently all kinds map to the shared placeholder; update when per-kind art ships.
 *
 * Using `furniture-default.png` for all kinds intentionally:
 *  - The placeholder is a blank square that looks close to the color fallback,
 *    so the appearance degrades gracefully.
 *  - When a designer drops `furniture-single_desk.png` into `public/assets/`,
 *    change the `single_desk` entry to `${BASE}/furniture-single_desk.png`.
 */
export const FURNITURE_ASSET_BY_KIND: Readonly<Record<string, string>> = {
  single_desk:  `${BASE}/furniture-default.png`,
  table:        `${BASE}/furniture-default.png`,
  teacher_desk: `${BASE}/furniture-default.png`,
  whiteboard:   `${BASE}/furniture-default.png`,
} as const;

/**
 * Return the asset URL for a given FurnitureKind, or `undefined` if no mapping
 * exists (which should never happen for the four known kinds, but is a safety
 * valve for future kinds added before the asset map is updated).
 */
export function furnitureAssetUrl(kind: string): string | undefined {
  return FURNITURE_ASSET_BY_KIND[kind];
}
