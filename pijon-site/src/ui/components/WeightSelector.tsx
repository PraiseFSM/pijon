/**
 * WeightSelector — §6.A1 single shared component.
 *
 * Renders the four fixed preference-weight buttons {-2, -1, +1, +2}.
 * Used in BOTH the Students toolbar (top bar) AND each preference row in the
 * roster detail section, so a style change here updates every instance.
 *
 * Props:
 *   value          — the currently active weight (one of -2/-1/1/2)
 *   onChange       — called when the user clicks a different weight button
 *   testIdPrefix   — optional prefix for data-testid (default ''); the testid
 *                    is `${testIdPrefix}weight-btn-${value}`, so top-bar buttons
 *                    are "weight-btn-{v}" and row buttons can be "row-{idx}-weight-btn-{v}"
 *   compact        — when true, renders smaller buttons for dense roster rows
 *
 * LOCAL-FIRST: no network calls.
 */

import React from 'react';
import {
  activeButtonBackground,
  activeButtonBorder,
  activeButtonText,
  btnBackground,
  btnBorder,
  textDark,
} from '../../theme/colors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The four fixed preference weight options. Order: most-avoid → most-prefer. */
export const WEIGHT_OPTIONS: readonly { value: number; label: string }[] = [
  { value: -2, label: '−2' },
  { value: -1, label: '−1' },
  { value: 1, label: '+1' },
  { value: 2, label: '+2' },
] as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WeightSelectorProps {
  /** Currently active weight — one of -2, -1, 1, 2. */
  value: number;
  /** Called with the new weight when a button is clicked. */
  onChange: (value: number) => void;
  /**
   * Prefix for data-testid attributes. The final testid is
   * `${testIdPrefix}weight-btn-${value}` (e.g. "" → "weight-btn-1";
   * "row-0-" → "row-0-weight-btn-1"). Defaults to "".
   */
  testIdPrefix?: string;
  /**
   * Compact variant for dense roster rows.
   * When true uses smaller padding + font.
   * Defaults to false (normal toolbar size).
   */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const WeightSelector: React.FC<WeightSelectorProps> = ({
  value,
  onChange,
  testIdPrefix = '',
  compact = false,
}) => {
  return (
    <>
      {WEIGHT_OPTIONS.map(({ value: optVal, label }) => {
        const isActive = value === optVal;
        const padding = compact ? '1px 5px' : '3px 8px';
        const fontSize = compact ? '0.72rem' : '0.82rem';
        return (
          <button
            key={optVal}
            type="button"
            data-testid={`${testIdPrefix}weight-btn-${optVal.toString()}`}
            aria-pressed={isActive}
            title={`Set preference weight to ${optVal > 0 ? '+' : ''}${optVal.toString()}`}
            onClick={() => { onChange(optVal); }}
            style={{
              padding,
              borderRadius: 4,
              border: `1px solid ${isActive ? activeButtonBorder : btnBorder}`,
              background: isActive ? activeButtonBackground : btnBackground,
              color: isActive ? activeButtonText : textDark,
              cursor: 'pointer',
              fontSize,
              fontWeight: isActive ? 700 : 400,
            }}
          >
            {label}
          </button>
        );
      })}
    </>
  );
};
