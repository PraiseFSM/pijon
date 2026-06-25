/**
 * ToggleLever — §7.A1 shared lever component.
 *
 * A two-position toggle lever used for:
 *   1. The editor switcher (Furniture / Students) in the top bar.
 *   2. The assigner-mode toggle in the Students toolbar.
 *
 * Extracts the visual style from AssignerToggleLever so both levers look
 * identical (single source of truth for the lever design).
 *
 * Props:
 *   labelOff   — label shown when the lever is in the OFF/left position.
 *   labelOn    — label shown when the lever is in the ON/right position.
 *   on         — current state.
 *   onToggle   — called when the user clicks the lever.
 *   activeBackground / activeColor — colours for the ON state.
 *   testId     — data-testid to attach to the button.
 *   title      — tooltip for the button (optional).
 *   role       — ARIA role override (defaults to undefined; pass "tab" for the editor lever).
 *   ariaSelected — aria-selected value (for role="tab" variant).
 *   ariaPressed  — aria-pressed value (for toggle variant); one of ariaSelected or ariaPressed should be set.
 *
 * LOCAL-FIRST: no network calls.
 */

import React from 'react';
import {
  btnBackground,
  btnBorder,
  textDark,
} from '../../theme/colors.js';

export interface ToggleLeverProps {
  /** Label when OFF / left */
  labelOff: string;
  /** Label when ON / right */
  labelOn: string;
  /** Current state */
  on: boolean;
  /** Click handler */
  onToggle: () => void;
  /** Background colour when ON. Defaults to a blue accent. */
  activeBackground?: string;
  /** Text colour when ON. Defaults to white. */
  activeColor?: string;
  /** Border colour when ON. Defaults to activeBackground. */
  activeBorderColor?: string;
  /** data-testid attribute */
  testId?: string;
  /** Tooltip text */
  title?: string;
  /**
   * ARIA role. Pass "tab" when used as the editor switcher;
   * omit or pass undefined for a regular toggle button.
   */
  role?: string;
  /** aria-selected (when role="tab") */
  ariaSelected?: boolean;
  /** aria-pressed (when used as a toggle button) */
  ariaPressed?: boolean;
  /** Extra styles to merge into the button's style */
  extraStyle?: React.CSSProperties;
}

export const ToggleLever: React.FC<ToggleLeverProps> = ({
  labelOff,
  labelOn,
  on,
  onToggle,
  activeBackground = '#1565c0',
  activeColor = '#fff',
  activeBorderColor,
  testId,
  title,
  role,
  ariaSelected,
  ariaPressed,
  extraStyle,
}) => {
  const resolvedActiveBorder = activeBorderColor ?? activeBackground;

  return (
    <button
      type="button"
      data-testid={testId}
      role={role}
      aria-selected={ariaSelected}
      aria-pressed={ariaPressed}
      onClick={onToggle}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 10px',
        borderRadius: 4,
        border: `1px solid ${on ? resolvedActiveBorder : btnBorder}`,
        background: on ? activeBackground : btnBackground,
        color: on ? activeColor : textDark,
        cursor: 'pointer',
        fontSize: '0.82rem',
        fontWeight: on ? 700 : 400,
        whiteSpace: 'nowrap',
        transition: 'background 0.12s, color 0.12s',
        ...extraStyle,
      }}
    >
      {/* Lever track + knob */}
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 28,
          height: 14,
          borderRadius: 7,
          background: on ? activeColor : '#ccc',
          position: 'relative',
          transition: 'background 0.12s',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: 'block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: on ? activeBackground : '#888',
            position: 'absolute',
            top: 2,
            left: on ? 16 : 2,
            transition: 'left 0.12s, background 0.12s',
          }}
        />
      </span>
      {on ? labelOn : labelOff}
    </button>
  );
};
