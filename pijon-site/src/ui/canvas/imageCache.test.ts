// @vitest-environment jsdom
/**
 * Tests for imageCache.ts — load-once HTMLImageElement cache (§14.3).
 *
 * Coverage:
 *   A. getImage — undefined while pending; no duplicate Image(); resolved after onload.
 *   B. primeImage — starts a load; no-op when already loaded or pending.
 *   C. isImageLoaded / peekImage — read-only accessors that never trigger a load.
 *   D. registerRepaintCallback — fires once per load; unregister prevents future calls.
 *   E. onerror — removes from pending, does not mark loaded; allows retry.
 *   F. selectFurnitureImage — uses peekImage (no load triggered).
 *   G. _injectForTest — injects a pre-loaded image synchronously.
 *   H. No duplicate Image() for the same URL.
 *
 * No real network: global Image is replaced with a controllable fake class
 * so we can trigger onload/onerror manually without any src fetching.
 *
 * LOCAL-FIRST: no fetch/XHR anywhere in this file.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getImage,
  primeImage,
  isImageLoaded,
  peekImage,
  selectFurnitureImage,
  registerRepaintCallback,
  _injectForTest,
  _clearForTest,
} from './imageCache.js';

// ---------------------------------------------------------------------------
// Fake Image factory
// ---------------------------------------------------------------------------

/**
 * Instances created during each test. Cleared in beforeEach via _clearForTest
 * together with a fresh fakeInstances array.
 */
let fakeInstances: FakeImage[] = [];

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';

  constructor() {
    // Record every instance so tests can access it and fire handlers.
    fakeInstances.push(this);
  }

  /** Convenience: fire the load handler. */
  triggerLoad(): void {
    this.onload?.();
  }

  /** Convenience: fire the error handler. */
  triggerError(): void {
    this.onerror?.();
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  fakeInstances = [];
  _clearForTest();
  // Replace global Image with our controllable fake.
  vi.stubGlobal('Image', FakeImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// A. getImage
// ---------------------------------------------------------------------------

describe('getImage', () => {
  it('returns undefined for a URL that has never been requested', () => {
    const result = getImage('/test/img.png');
    expect(result).toBeUndefined();
  });

  it('creates exactly one Image when first called for a URL', () => {
    getImage('/test/img.png');
    expect(fakeInstances).toHaveLength(1);
  });

  it('sets .src on the created Image to the requested URL', () => {
    const url = '/test/img.png';
    getImage(url);
    expect(fakeInstances[0]!.src).toBe(url);
  });

  it('returns undefined on a second call for the same URL while still loading', () => {
    getImage('/test/img.png');
    const second = getImage('/test/img.png');
    expect(second).toBeUndefined();
  });

  it('does NOT create a second Image when called again while pending', () => {
    getImage('/test/img.png');
    getImage('/test/img.png');
    expect(fakeInstances).toHaveLength(1);
  });

  it('returns the HTMLImageElement synchronously once onload has fired', () => {
    const url = '/test/img.png';
    getImage(url);
    fakeInstances[0]!.triggerLoad();
    const result = getImage(url);
    expect(result).toBe(fakeInstances[0]);
  });

  it('does not create a new Image after the URL is fully loaded', () => {
    const url = '/test/img.png';
    getImage(url);
    fakeInstances[0]!.triggerLoad();
    getImage(url);
    // Still exactly one Image — no second load
    expect(fakeInstances).toHaveLength(1);
  });

  it('starts independent loads for two different URLs', () => {
    getImage('/a.png');
    getImage('/b.png');
    expect(fakeInstances).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// B. primeImage
// ---------------------------------------------------------------------------

describe('primeImage', () => {
  it('starts a load (creates one Image)', () => {
    primeImage('/prime.png');
    expect(fakeInstances).toHaveLength(1);
  });

  it('is a no-op if already loading (pending)', () => {
    primeImage('/prime.png');
    primeImage('/prime.png');
    expect(fakeInstances).toHaveLength(1);
  });

  it('is a no-op if already loaded', () => {
    primeImage('/prime.png');
    fakeInstances[0]!.triggerLoad();
    primeImage('/prime.png');
    expect(fakeInstances).toHaveLength(1);
  });

  it('does not call getImage — subsequent getImage finds the pending load', () => {
    primeImage('/prime.png');
    // At this point getImage should return undefined (still loading) and
    // should NOT create a second Image.
    const result = getImage('/prime.png');
    expect(result).toBeUndefined();
    expect(fakeInstances).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// C. isImageLoaded / peekImage — read-only, never trigger a load
// ---------------------------------------------------------------------------

describe('isImageLoaded', () => {
  it('returns false for an unknown URL without creating an Image', () => {
    const result = isImageLoaded('/unknown.png');
    expect(result).toBe(false);
    expect(fakeInstances).toHaveLength(0);
  });

  it('returns false while the image is still loading', () => {
    getImage('/loading.png');
    expect(isImageLoaded('/loading.png')).toBe(false);
  });

  it('returns true after onload fires', () => {
    getImage('/img.png');
    fakeInstances[0]!.triggerLoad();
    expect(isImageLoaded('/img.png')).toBe(true);
  });

  it('returns false after onerror fires (not loaded)', () => {
    getImage('/bad.png');
    fakeInstances[0]!.triggerError();
    expect(isImageLoaded('/bad.png')).toBe(false);
  });
});

describe('peekImage', () => {
  it('returns undefined for an unknown URL without creating an Image', () => {
    const result = peekImage('/unknown.png');
    expect(result).toBeUndefined();
    expect(fakeInstances).toHaveLength(0);
  });

  it('returns undefined while image is still loading', () => {
    getImage('/loading.png');
    expect(peekImage('/loading.png')).toBeUndefined();
  });

  it('returns the HTMLImageElement after onload fires', () => {
    const url = '/img.png';
    getImage(url);
    fakeInstances[0]!.triggerLoad();
    expect(peekImage(url)).toBe(fakeInstances[0]);
  });
});

// ---------------------------------------------------------------------------
// D. registerRepaintCallback
// ---------------------------------------------------------------------------

describe('registerRepaintCallback', () => {
  it('fires the callback when any image finishes loading', () => {
    const cb = vi.fn();
    registerRepaintCallback(cb);
    getImage('/img.png');
    fakeInstances[0]!.triggerLoad();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires the callback for each separate image that loads', () => {
    const cb = vi.fn();
    registerRepaintCallback(cb);
    getImage('/a.png');
    getImage('/b.png');
    fakeInstances[0]!.triggerLoad();
    fakeInstances[1]!.triggerLoad();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('fires ALL registered callbacks on load', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    registerRepaintCallback(cb1);
    registerRepaintCallback(cb2);
    getImage('/img.png');
    fakeInstances[0]!.triggerLoad();
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('returned unregister removes the callback — it is not called on subsequent loads', () => {
    const cb = vi.fn();
    const unregister = registerRepaintCallback(cb);
    // Load image A — callback fires
    getImage('/a.png');
    fakeInstances[0]!.triggerLoad();
    expect(cb).toHaveBeenCalledTimes(1);

    // Unregister, then load image B
    unregister();
    getImage('/b.png');
    fakeInstances[1]!.triggerLoad();
    // Still 1 — not called again
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire the callback on onerror (error does not trigger repaint)', () => {
    const cb = vi.fn();
    registerRepaintCallback(cb);
    getImage('/bad.png');
    fakeInstances[0]!.triggerError();
    expect(cb).not.toHaveBeenCalled();
  });

  it('a second registration of the same function only fires once (Set deduplication)', () => {
    const cb = vi.fn();
    registerRepaintCallback(cb);
    registerRepaintCallback(cb);
    getImage('/img.png');
    fakeInstances[0]!.triggerLoad();
    // Set deduplication: same reference is stored once
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// E. onerror path
// ---------------------------------------------------------------------------

describe('onerror path', () => {
  it('does not mark the URL as loaded after an error', () => {
    getImage('/bad.png');
    fakeInstances[0]!.triggerError();
    expect(isImageLoaded('/bad.png')).toBe(false);
    expect(peekImage('/bad.png')).toBeUndefined();
  });

  it('removes the URL from pending after an error (allows retry via getImage)', () => {
    const url = '/bad.png';
    getImage(url);
    fakeInstances[0]!.triggerError();
    // A retry call should create a new Image (not be a no-op)
    getImage(url);
    expect(fakeInstances).toHaveLength(2);
  });

  it('retry load can succeed after previous error', () => {
    const url = '/bad.png';
    getImage(url);
    fakeInstances[0]!.triggerError();
    getImage(url);
    fakeInstances[1]!.triggerLoad();
    expect(isImageLoaded(url)).toBe(true);
    expect(getImage(url)).toBe(fakeInstances[1]);
  });
});

// ---------------------------------------------------------------------------
// F. selectFurnitureImage — uses peekImage (never triggers a load)
// ---------------------------------------------------------------------------

describe('selectFurnitureImage', () => {
  it('returns undefined for an unknown URL without creating an Image', () => {
    const result = selectFurnitureImage('/furniture.png');
    expect(result).toBeUndefined();
    expect(fakeInstances).toHaveLength(0);
  });

  it('returns undefined while the image is still loading', () => {
    getImage('/furniture.png');
    expect(selectFurnitureImage('/furniture.png')).toBeUndefined();
  });

  it('returns the loaded image after onload fires', () => {
    const url = '/furniture.png';
    getImage(url);
    fakeInstances[0]!.triggerLoad();
    expect(selectFurnitureImage(url)).toBe(fakeInstances[0]);
  });

  it('does not create an Image when called on a URL never requested before', () => {
    selectFurnitureImage('/never-seen.png');
    expect(fakeInstances).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// G. _injectForTest
// ---------------------------------------------------------------------------

describe('_injectForTest', () => {
  it('injects an image as loaded without going through the load cycle', () => {
    const fakeImg = new FakeImage() as unknown as HTMLImageElement;
    // Reset so the FakeImage from constructor is not in the instances list
    fakeInstances = [];
    const url = '/injected.png';
    _injectForTest(url, fakeImg);
    expect(isImageLoaded(url)).toBe(true);
    expect(peekImage(url)).toBe(fakeImg);
    expect(getImage(url)).toBe(fakeImg);
    // getImage on an already-loaded url should create NO new Image
    expect(fakeInstances).toHaveLength(0);
  });

  it('removes URL from pending when injected', () => {
    const url = '/pending-then-inject.png';
    getImage(url); // starts load → pending
    const fakeImg = new FakeImage() as unknown as HTMLImageElement;
    fakeInstances = []; // reset count
    _injectForTest(url, fakeImg);
    // Now loaded; getImage should not spawn another Image
    getImage(url);
    expect(fakeInstances).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// H. No duplicate Image() per URL (explicit combined scenario)
// ---------------------------------------------------------------------------

describe('no duplicate Image per URL', () => {
  it('calling getImage 10 times for the same URL while pending creates only 1 Image', () => {
    const url = '/once.png';
    for (let i = 0; i < 10; i++) {
      getImage(url);
    }
    expect(fakeInstances).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// I. _clearForTest isolation — _repaintCallbacks must be reset between tests
// ---------------------------------------------------------------------------

describe('_clearForTest callback isolation', () => {
  it('a callback registered before _clearForTest does not fire after it', () => {
    // Register a callback in what would be "test N"
    const staleCallback = vi.fn();
    registerRepaintCallback(staleCallback);

    // _clearForTest() is called in beforeEach; simulate that here explicitly
    // to show that the fix is effective.
    _clearForTest();

    // Simulate "test N+1": load an image — the stale callback must NOT fire
    getImage('/after-clear.png');
    fakeInstances[0]!.triggerLoad();

    expect(staleCallback).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// J. Selective unregister — only the unregistered callback stops; others fire
// ---------------------------------------------------------------------------

describe('selective unregister', () => {
  it('unregistering one callback does not prevent other callbacks from firing', () => {
    const cbA = vi.fn();
    const cbB = vi.fn();
    registerRepaintCallback(cbA);
    const unregisterB = registerRepaintCallback(cbB);

    // Unregister only cbB
    unregisterB();

    getImage('/img.png');
    fakeInstances[0]!.triggerLoad();

    // cbA still fires; cbB does not
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// K. Read-only accessors never trigger a load (combined assertion)
// ---------------------------------------------------------------------------

describe('read-only accessors never trigger a load', () => {
  it('peekImage, isImageLoaded, and selectFurnitureImage all return empty for an unknown URL and create zero Images', () => {
    const url = '/never-loaded.png';

    expect(peekImage(url)).toBeUndefined();
    expect(isImageLoaded(url)).toBe(false);
    expect(selectFurnitureImage(url)).toBeUndefined();

    // None of the three should have triggered a new Image()
    expect(fakeInstances).toHaveLength(0);
  });
});
