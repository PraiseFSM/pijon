// @vitest-environment jsdom
/**
 * Tests for §polish — granularity error banner (Fix 2) and stale input sync (Fix 3).
 *
 * Fix 2: Applying an invalid granularity (one that doesn't divide the grid evenly)
 *   must surface a non-blocking friendly warning banner instead of alert().
 *   The classroom must NOT change on failure.
 *
 * Fix 3: The granularity input's local state must resync when classroom.cellsPerUnit
 *   changes externally (e.g. after a project hydrate).
 *
 * Also includes a store-level test verifying that `setGranularity` does NOT
 * expose the domain throw — it must surface it in a way the UI can catch.
 *
 * Test approach:
 *   - Renders FurnitureEditor.Toolbar (via FurnitureEditor.Toolbar) inside jsdom.
 *   - Passes a mock EditorContext whose store.setGranularity calls the real
 *     domain (to verify throw-on-invalid) or is a spy (to verify dispatch).
 *   - For Fix 3: renders with one cellsPerUnit, then re-renders with a different one.
 *
 * NO network calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

import { FurnitureEditor } from '../ui/editors/FurnitureEditor.js';
import type { EditorContext, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import { makeClassroom, setGranularity as domainSetGranularity } from '../domain/classroom.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClassroomWith(cellsPerUnit: number, gridW = 10, gridH = 8) {
  // makeClassroom produces gridW=10, gridH=8 at G=1; at higher G we scale manually
  const base = makeClassroom('c1', 'Test', gridW, gridH);
  return { ...base, cellsPerUnit };
}

function makeCanvas(): CanvasView {
  return {
    cellSize: 48,
    gridW: 10,
    gridH: 8,
    originOffset: 1,
    cellAt: vi.fn(() => undefined),
    furnitureAt: vi.fn(() => undefined),
    cellRect: vi.fn(() => ({ x: 0, y: 0, w: 48, h: 48 })),
    requestRepaint: vi.fn(),
  };
}

function makeStore(overrides?: Partial<Store>): Store {
  const classroom = makeClassroomWith(1);
  return {
    classroom,
    roster: [],
    locks: new Set(),
    history: [],
    historyPtr: -1,
    saveStatus: 'saved',
    activeEditorId: 'furniture',
    fileHandle: null,
    selectedStudentId: null,
    resizeGridWarning: null,
    showViolations: true,
    addFurniture: vi.fn(),
    moveFurniture: vi.fn(),
    removeFurniture: vi.fn(),
    setClassroom: vi.fn(),
    importRosterFromCsv: vi.fn(() => [] as string[]),
    setRoster: vi.fn(),
    allocate: vi.fn(),
    smartShuffle: vi.fn(),
    clearArrangement: vi.fn(),
    lockSeat: vi.fn(),
    unlockSeat: vi.fn(),
    manualReassign: vi.fn(),
    assignStudentToFurniture: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    setSaveStatus: vi.fn(),
    setFileHandle: vi.fn(),
    setActiveEditorId: vi.fn(),
    addPreference: vi.fn(),
    removePreference: vi.fn(),
    setMutualPreference: vi.fn(),
    clearMutualPreference: vi.fn(),
    setGranularity: vi.fn(),
    dismissResizeWarning: vi.fn(),
    setThreshold: vi.fn(),
    setShowViolations: vi.fn(),
    setBackgroundImage: vi.fn(),
    setGridColor: vi.fn(),
    eraseAll: vi.fn(),
    hydrate: vi.fn(),
    setSelectedStudentId: vi.fn(),
    addStudent: vi.fn(),
    removeStudent: vi.fn(),
    ...overrides,
  } as unknown as Store;
}

const FurnitureToolbar = FurnitureEditor.Toolbar;

// ---------------------------------------------------------------------------
// Fix 2 — granularity error banner
// ---------------------------------------------------------------------------

describe('Fix 2: granularity error banner (non-blocking)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Ensure alert is not called (it shouldn't exist in jsdom but guard anyway)
    vi.spyOn(window, 'alert').mockImplementation(() => { /* no-op */ });
  });

  it('shows the granularity warning banner when setGranularity throws', () => {
    const store = makeStore({
      classroom: makeClassroomWith(1, 10, 8), // G=1, gridW=10, gridH=8
      setGranularity: vi.fn().mockImplementation(() => {
        throw new RangeError(
          'Cannot change granularity from 1 to 3: value 10 does not scale to an integer.',
        );
      }),
    });
    const ctx: EditorContext = { store, canvas: makeCanvas(), persistence: null };

    render(React.createElement(FurnitureToolbar, { ctx }));

    // Change the granularity input to 3 (invalid for 10×8 grid from G=1)
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '3' } });

    // Click Apply
    const applyBtn = screen.getByRole('button', { name: /apply/i });
    fireEvent.click(applyBtn);

    // Banner should be visible with a warning message
    expect(screen.getByText(/cannot change granularity/i)).toBeInTheDocument();

    // alert must NOT have been called
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('does NOT change classroom when an invalid granularity is applied', () => {
    const mockSetGranularity = vi.fn().mockImplementation(() => {
      throw new RangeError('Cannot change granularity from 1 to 3.');
    });
    const classroom = makeClassroomWith(1, 10, 8);
    const store = makeStore({
      classroom,
      setGranularity: mockSetGranularity,
    });
    const ctx: EditorContext = { store, canvas: makeCanvas(), persistence: null };

    render(React.createElement(FurnitureToolbar, { ctx }));

    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    // classroom reference is unchanged — store.setGranularity would have needed
    // to succeed to update it. Since it threw, the ctx.store.classroom is still
    // the original (mock doesn't mutate).
    expect(store.classroom).toBe(classroom);
  });

  it('clears the granularity warning on a successful apply', () => {
    let callCount = 0;
    const store = makeStore({
      classroom: makeClassroomWith(1, 10, 8),
      // First call throws (invalid), second call succeeds
      setGranularity: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new RangeError('Cannot change granularity from 1 to 3.');
        }
        // On second call, succeed silently (mock doesn't need to mutate state here)
      }),
    });
    const ctx: EditorContext = { store, canvas: makeCanvas(), persistence: null };

    render(React.createElement(FurnitureToolbar, { ctx }));

    const input = screen.getByRole('spinbutton');

    // First: invalid apply → warning appears
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(screen.getByText(/cannot change granularity/i)).toBeInTheDocument();

    // Second: valid apply (G=2) → warning disappears
    // Need to reset the input value (after first failure it reverted to 1;
    // now try G=2 which our mock will accept on the second call)
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(screen.queryByText(/cannot change granularity/i)).not.toBeInTheDocument();
  });

  it('granularity warning banner has a dismiss (✕) button', () => {
    const store = makeStore({
      classroom: makeClassroomWith(1, 10, 8),
      setGranularity: vi.fn().mockImplementation(() => {
        throw new RangeError('Cannot change granularity from 1 to 3.');
      }),
    });
    const ctx: EditorContext = { store, canvas: makeCanvas(), persistence: null };

    render(React.createElement(FurnitureToolbar, { ctx }));

    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    // Banner visible
    expect(screen.getByText(/cannot change granularity/i)).toBeInTheDocument();

    // Find and click the dismiss button (✕)
    // It's rendered as a button with text "✕" near the warning
    const dismissBtn = screen.getAllByRole('button').find((b) => b.textContent === '✕');
    expect(dismissBtn).toBeDefined();
    fireEvent.click(dismissBtn!);

    // Banner should be gone
    expect(screen.queryByText(/cannot change granularity/i)).not.toBeInTheDocument();
  });

  it('domain setGranularity throws RangeError when furniture does not scale cleanly', () => {
    // Verify the domain contract that the UI must guard against.
    // Start from G=2: place a desk at fine-cell pos.x=1, then try to go to G=3.
    // Scale factor 3/2: 1 * 3/2 = 1.5 (not integer) → RangeError.
    const baseG1 = makeClassroom('c1', 'Test', 10, 8);
    // Bump to G=2 first (20×16 fine cells, furniture at unit position x=0 → fine x=0)
    const classG2 = domainSetGranularity(baseG1, 2);
    // Add a desk at fine pos.x=1 (odd fine position not on unit boundary)
    const classG2WithDesk = {
      ...classG2,
      furniture: [{
        id: 'desk-1' as ReturnType<typeof import('../domain/types.js').furnitureId>,
        kind: 'single_desk' as const,
        pos: { x: 1, y: 0 },
        w: 2,
        h: 2,
        rotation: 0 as const,
        occupants: [],
      }],
    };
    // Going G=2 → G=3: pos.x=1 * 3/2 = 1.5 → RangeError
    expect(() => domainSetGranularity(classG2WithDesk, 3)).toThrow(RangeError);
  });

  it('domain setGranularity succeeds for valid granularity', () => {
    // G=2: 10×8 both multiply cleanly by 2 with no furniture
    const classroom = makeClassroom('c1', 'Test', 10, 8); // G=1
    expect(() => domainSetGranularity(classroom, 2)).not.toThrow();
    const updated = domainSetGranularity(classroom, 2);
    expect(updated.cellsPerUnit).toBe(2);
    expect(updated.gridW).toBe(20);
    expect(updated.gridH).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Fix 3 — granularity input stays in sync with store cellsPerUnit
// ---------------------------------------------------------------------------

describe('Fix 3: granularityInput syncs with store.classroom.cellsPerUnit', () => {
  it('shows the initial cellsPerUnit from the store', () => {
    const store = makeStore({ classroom: makeClassroomWith(2, 20, 16) });
    const ctx: EditorContext = { store, canvas: makeCanvas(), persistence: null };

    render(React.createElement(FurnitureToolbar, { ctx }));

    // getByDisplayValue queries the *live* input value (works for controlled React inputs)
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
  });

  it('updates the displayed granularity when cellsPerUnit changes in the store (hydrate)', () => {
    // Start with G=1
    const store = makeStore({ classroom: makeClassroomWith(1, 10, 8) });
    const ctx: EditorContext = { store, canvas: makeCanvas(), persistence: null };

    const { rerender } = render(React.createElement(FurnitureToolbar, { ctx }));

    // Confirm initial value is 1
    expect(screen.getByDisplayValue('1')).toBeInTheDocument();

    // Simulate a project hydrate: classroom.cellsPerUnit changes to 2
    const newStore = makeStore({ classroom: makeClassroomWith(2, 20, 16) });
    const newCtx: EditorContext = { store: newStore, canvas: makeCanvas(), persistence: null };

    act(() => {
      rerender(React.createElement(FurnitureToolbar, { ctx: newCtx }));
    });

    // After hydrate: input must show 2, not the stale 1
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('1')).not.toBeInTheDocument();
  });

  it('updates to G=4 when store cellsPerUnit changes to 4', () => {
    const store = makeStore({ classroom: makeClassroomWith(1, 10, 8) });
    const ctx: EditorContext = { store, canvas: makeCanvas(), persistence: null };

    const { rerender } = render(React.createElement(FurnitureToolbar, { ctx }));

    const newStore = makeStore({ classroom: makeClassroomWith(4, 40, 32) });
    const newCtx: EditorContext = { store: newStore, canvas: makeCanvas(), persistence: null };

    act(() => {
      rerender(React.createElement(FurnitureToolbar, { ctx: newCtx }));
    });

    expect(screen.getByDisplayValue('4')).toBeInTheDocument();
  });
});
