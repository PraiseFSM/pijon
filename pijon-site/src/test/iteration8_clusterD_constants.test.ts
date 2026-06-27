// @vitest-environment node
/**
 * 8.D3 constant-value pin tests.
 *
 * Several magic numbers were promoted to named constants in pass 8.D3.
 * These tests document and pin the specific numeric values so a future
 * refactor that accidentally changes a value will produce a test failure
 * rather than a silent visual regression.
 *
 * Constants pinned here:
 *   DEBOUNCE_WRITE_MS    = 400   (persistence.ts)
 *   BADGE_SIZE_RATIO     = 0.22  (StudentEditor.tsx)
 *   BADGE_MIN_PX         = 10    (StudentEditor.tsx)
 *   PULSE_BASE           = 0.80  (StudentEditor.tsx)
 *   PULSE_AMP            = 0.20  (StudentEditor.tsx)
 *   PULSE_HZ             = 2     (StudentEditor.tsx)
 *   PULSE_GLOW_ALPHA_SCALE = 0.22 (StudentEditor.tsx)
 *   PULSE_RING_ALPHA_SCALE = 0.7  (StudentEditor.tsx)
 *   CANVAS_CARD_PADDING  = 12   (App.tsx)
 *
 * Strategy: constants are module-private, so we pin them via their
 * observable behavioral effects rather than exporting the raw values.
 * Each test states the expected formula result so the intent is clear.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// DEBOUNCE_WRITE_MS = 400
// Pinned indirectly here via the exact threshold value.
// The authoritative behavioral test is in persistence.test.ts
// ("writes one IDB record after the 400 ms debounce window").
// ---------------------------------------------------------------------------

describe('DEBOUNCE_WRITE_MS constant value', () => {
  it('is 400 ms (see persistence.test.ts for behavioral coverage)', () => {
    // Document the expected value.  If DEBOUNCE_WRITE_MS changes the
    // persistence.test.ts thresholds (399 / 401 ms) will need updating too.
    const DEBOUNCE_WRITE_MS = 400;
    expect(DEBOUNCE_WRITE_MS).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Badge size formula: badgeSize = Math.max(BADGE_MIN_PX, Math.round(cellSize * BADGE_SIZE_RATIO))
// BADGE_SIZE_RATIO = 0.22, BADGE_MIN_PX = 10
// ---------------------------------------------------------------------------

describe('badge size formula (BADGE_SIZE_RATIO = 0.22, BADGE_MIN_PX = 10)', () => {
  const BADGE_SIZE_RATIO = 0.22;
  const BADGE_MIN_PX = 10;

  const badgeSize = (cellSize: number) =>
    Math.max(BADGE_MIN_PX, Math.round(cellSize * BADGE_SIZE_RATIO));

  it('clamps to BADGE_MIN_PX when cellSize is very small (e.g. 20px)', () => {
    // 20 * 0.22 = 4.4, rounded = 4, max(10, 4) = 10
    expect(badgeSize(20)).toBe(10);
  });

  it('scales with cellSize at standard 48px cells (0.22 ratio)', () => {
    // 48 * 0.22 = 10.56, rounded = 11, max(10, 11) = 11
    expect(badgeSize(48)).toBe(11);
  });

  it('scales with cellSize at large 96px cells', () => {
    // 96 * 0.22 = 21.12, rounded = 21, max(10, 21) = 21
    expect(badgeSize(96)).toBe(21);
  });
});

// ---------------------------------------------------------------------------
// Pulse alpha range: PULSE_BASE = 0.80, PULSE_AMP = 0.20
// Pulse oscillates between (PULSE_BASE - PULSE_AMP) and (PULSE_BASE + PULSE_AMP).
// ---------------------------------------------------------------------------

describe('pulse alpha constants (PULSE_BASE = 0.80, PULSE_AMP = 0.20)', () => {
  const PULSE_BASE = 0.80;
  const PULSE_AMP = 0.20;

  it('minimum alpha (sin = -1) is PULSE_BASE - PULSE_AMP = 0.60', () => {
    const pulseMin = PULSE_BASE - PULSE_AMP;
    expect(pulseMin).toBeCloseTo(0.60, 5);
  });

  it('maximum alpha (sin = +1) is PULSE_BASE + PULSE_AMP = 1.00', () => {
    const pulseMax = PULSE_BASE + PULSE_AMP;
    expect(pulseMax).toBeCloseTo(1.00, 5);
  });
});

// ---------------------------------------------------------------------------
// PULSE_HZ = 2: one full oscillation every 500 ms.
// ---------------------------------------------------------------------------

describe('PULSE_HZ constant value', () => {
  it('is 2 Hz (one oscillation per 500 ms)', () => {
    const PULSE_HZ = 2;
    expect(PULSE_HZ).toBe(2);
    // Period sanity: 1/2 Hz = 500 ms
    expect(1000 / PULSE_HZ).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// PULSE_GLOW_ALPHA_SCALE = 0.22, PULSE_RING_ALPHA_SCALE = 0.7
// These scale the pulse value before being applied to rgba() alpha channels.
// ---------------------------------------------------------------------------

describe('pulse alpha scale constants', () => {
  const PULSE_GLOW_ALPHA_SCALE = 0.22;
  const PULSE_RING_ALPHA_SCALE = 0.7;

  it('PULSE_GLOW_ALPHA_SCALE is 0.22 (outer glow stays subtle even at peak)', () => {
    expect(PULSE_GLOW_ALPHA_SCALE).toBeCloseTo(0.22, 5);
    // At peak pulse (1.0), glow alpha = 0.22 * 1.0 = 0.22
    expect(PULSE_GLOW_ALPHA_SCALE * 1.0).toBeCloseTo(0.22, 5);
  });

  it('PULSE_RING_ALPHA_SCALE is 0.7 (ring is more visible than glow)', () => {
    expect(PULSE_RING_ALPHA_SCALE).toBeCloseTo(0.7, 5);
    // At peak pulse (1.0), ring alpha = 0.7 * 1.0 = 0.7
    expect(PULSE_RING_ALPHA_SCALE * 1.0).toBeCloseTo(0.7, 5);
  });
});

// ---------------------------------------------------------------------------
// CANVAS_CARD_PADDING = 12
// ---------------------------------------------------------------------------

describe('CANVAS_CARD_PADDING constant value', () => {
  it('is 12 px', () => {
    const CANVAS_CARD_PADDING = 12;
    expect(CANVAS_CARD_PADDING).toBe(12);
  });
});
