/**
 * Safe React hooks for the Pijon store.
 *
 * This file wraps selectors that return freshly-allocated objects (which would
 * cause infinite render loops under Zustand v5's reference-equality default) into
 * hooks that subscribe to the stable primitive inputs and derive the result with
 * `useMemo`.
 *
 * Import from here instead of calling `usePijonStore(selectSeatingIssues)` directly.
 */

import { useMemo } from 'react';
import { usePijonStore } from './store.js';
import { validateSeating } from '../domain/validateSeating.js';
import type { SeatingValidationResult } from '../domain/validateSeating.js';

// ---------------------------------------------------------------------------
// useSeatingIssues
// ---------------------------------------------------------------------------

/**
 * Subscribe to the live seating-validation result.
 *
 * Safe to use in any React component: subscribes to `classroom` and `roster`
 * as stable object references (Zustand replaces them by reference on every
 * mutation) and runs `validateSeating` inside `useMemo` so the result is only
 * recomputed when the inputs actually change.
 *
 * This avoids the infinite-render footgun that
 * `usePijonStore(selectSeatingIssues)` would cause in Zustand v5 (every call
 * returns a fresh object, so reference equality never holds, so every store tick
 * triggers a re-render).
 *
 * @example
 *   const { valid, issues } = useSeatingIssues();
 */
export function useSeatingIssues(): SeatingValidationResult {
  const classroom = usePijonStore((s) => s.classroom);
  const roster    = usePijonStore((s) => s.roster);
  return useMemo(() => validateSeating(classroom, roster), [classroom, roster]);
}
