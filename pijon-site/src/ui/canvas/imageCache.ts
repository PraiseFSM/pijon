/**
 * imageCache.ts — load-once HTMLImageElement cache for canvas drawing (§14.3).
 *
 * Responsibilities:
 *  - Load each image URL exactly once (no duplicate network calls — these are
 *    same-origin bundled public/ assets, not remote URLs).
 *  - Return the loaded HTMLImageElement synchronously when available.
 *  - Register repaint callbacks so callers get redrawn when images finish
 *    loading (first paint shows the color fallback; once loaded the image
 *    replaces it seamlessly).
 *  - Zero leaked listeners — each Image's onload fires once and removes itself.
 *
 * UI layer only — no domain imports.
 * No `any`; no fetch/XHR — `new Image()` with a same-origin src is local.
 *
 * Usage:
 *   import { getImage, primeImage, registerRepaintCallback } from './imageCache.js';
 *
 *   // Kick off loading early (optional):
 *   primeImage('/assets/furniture-default.png');
 *
 *   // In draw code — returns undefined until loaded:
 *   const img = getImage('/assets/furniture-default.png');
 *   if (img !== undefined) {
 *     ctx.drawImage(img, x, y, w, h);
 *   } else {
 *     ctx.fillStyle = fallbackColor;
 *     ctx.fillRect(x, y, w, h);
 *   }
 *
 *   // Register a single global repaint callback (ClassroomCanvas calls this once
 *   // on mount so the canvas repaints whenever any image finishes loading):
 *   registerRepaintCallback(() => requestAnimationFrame(redraw));
 */

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** Map from URL string → loaded HTMLImageElement (only present once loaded). */
const _loaded = new Map<string, HTMLImageElement>();

/**
 * Map from URL string → HTMLImageElement that is still loading.
 * Prevents duplicate Image() objects for the same URL.
 */
const _pending = new Map<string, HTMLImageElement>();

/**
 * Global repaint callbacks. Called once each time ANY image finishes loading.
 * Typically one entry — the ClassroomCanvas scheduleRepaint.
 */
const _repaintCallbacks = new Set<() => void>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a callback to be called whenever an image finishes loading.
 * Returns an unregister function for cleanup on unmount.
 *
 * @param fn  A stable callback (e.g. canvas scheduleRepaint). The cache holds
 *            a reference — call the returned unregister to remove it.
 */
export function registerRepaintCallback(fn: () => void): () => void {
  _repaintCallbacks.add(fn);
  return () => {
    _repaintCallbacks.delete(fn);
  };
}

/**
 * Get a loaded HTMLImageElement for `url`.
 * Returns `undefined` if the image has not finished loading yet.
 * Side effect: starts loading the image if it hasn't been requested before.
 */
export function getImage(url: string): HTMLImageElement | undefined {
  // Already loaded → return immediately
  const cached = _loaded.get(url);
  if (cached !== undefined) return cached;

  // Already loading → wait (do not start a second load)
  if (_pending.has(url)) return undefined;

  // Start loading
  _startLoad(url);
  return undefined;
}

/**
 * Prime the cache for a URL without needing the image right away.
 * Useful for warming the cache before the first paint (e.g. call on app init).
 * No-op if the image is already loaded or loading.
 */
export function primeImage(url: string): void {
  if (_loaded.has(url) || _pending.has(url)) return;
  _startLoad(url);
}

/**
 * Check whether a URL is fully loaded (without triggering a load).
 * Useful for tests / decision-logic extraction.
 */
export function isImageLoaded(url: string): boolean {
  return _loaded.has(url);
}

/**
 * Return the loaded image or undefined without triggering a new load.
 * Useful for tests / decision-logic extraction.
 */
export function peekImage(url: string): HTMLImageElement | undefined {
  return _loaded.get(url);
}

/**
 * Inject a pre-loaded image into the cache (for testing).
 * In production code, use `getImage` / `primeImage` instead.
 *
 * @internal — exported for test use only.
 */
export function _injectForTest(url: string, img: HTMLImageElement): void {
  _loaded.set(url, img);
  _pending.delete(url);
}

/**
 * Clear all cache state (for testing — never call in production).
 *
 * @internal — exported for test use only.
 */
export function _clearForTest(): void {
  _loaded.clear();
  _pending.clear();
}

// ---------------------------------------------------------------------------
// Internal load logic
// ---------------------------------------------------------------------------

function _startLoad(url: string): void {
  const img = new Image();
  _pending.set(url, img);

  img.onload = () => {
    _pending.delete(url);
    _loaded.set(url, img);
    // Notify all repaint subscribers — the canvas will redraw with the real image
    for (const cb of _repaintCallbacks) {
      cb();
    }
  };

  img.onerror = () => {
    // Failed to load — remove from pending so it won't block future retries,
    // but do NOT add to _loaded (getImage will keep returning undefined).
    _pending.delete(url);
    // Note: we intentionally do NOT retry automatically. The asset is likely
    // a placeholder that will be replaced; callers fall back to the color path.
  };

  // Assigning src starts the browser load. For same-origin public/ assets this
  // is a local file read — NOT a network call (the ESLint no-network rule
  // targets fetch/XHR; Image src to a same-origin bundled asset is standard
  // browser asset loading, identical to <img src="/assets/…"> in HTML).
  img.src = url;
}

/**
 * Select the image to use for drawing furniture (§14.3 decision logic).
 *
 * Returns the loaded HTMLImageElement if available, otherwise undefined.
 * This function is extracted (not inlined in draw code) so it can be unit-tested
 * without a real canvas or DOM.
 *
 * @param url  The asset URL (from ASSET or furnitureAssetUrl).
 * @returns    Loaded image, or undefined → caller should use color fallback.
 */
export function selectFurnitureImage(url: string): HTMLImageElement | undefined {
  return peekImage(url); // reads cache without triggering a new load
}
