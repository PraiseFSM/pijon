// @vitest-environment jsdom
/**
 * UI tests for §14.5 — Grid color picker component behavior.
 *
 * Tests:
 *   - GridColorButton renders and responds to clicks.
 *   - GridColorPickerPopover shows/hides correctly.
 *   - Color input fires onChange (onInput event).
 *   - Swatch click fires onChange with correct color.
 *   - Reset button fires onChange with null.
 *   - Clicking outside the popover calls onClose.
 *   - FurnitureEditor toolbar renders the grid color button.
 *   - FurnitureEditor toolbar: clicking button opens the popover.
 *   - FurnitureEditor toolbar: changing color calls store.setGridColor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

import { GridColorButton, GridColorPickerPopover, SWATCHES } from '../ui/editors/GridColorPicker.js';
import { FurnitureEditor } from '../ui/editors/FurnitureEditor.js';
import { makeClassroom, setGridColor as domainSetGridColor } from '../domain/classroom.js';
import { gridLine } from '../theme/colors.js';
import type { EditorContext, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import type { FurnitureId } from '../domain/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeCanvasMock = (): CanvasView => ({
  cellSize: 48,
  gridW: 5,
  gridH: 5,
  cellAt: vi.fn(() => undefined),
  furnitureAt: vi.fn(() => undefined),
  cellRect: vi.fn(() => ({ x: 0, y: 0, w: 48, h: 48 })),
  requestRepaint: vi.fn(),
});

const makeStoreMock = (overrides?: Partial<Store>): Store =>
  ({
    roster: [],
    locks: new Set<FurnitureId>(),
    selectedStudentId: null,
    resizeGridWarning: null,
    showViolations: true,
    classroom: {
      id: 'test-classroom',
      name: 'Test',
      gridW: 5,
      gridH: 5,
      furniture: [],
      cellsPerUnit: 1,
      thresholdUnits: 1.5,
      backgroundImage: null,
      gridColor: null,
    },
    history: [],
    historyPtr: 0,
    allocate: vi.fn(),
    smartShuffle: vi.fn(),
    clearArrangement: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    manualReassign: vi.fn(),
    setSelectedStudentId: vi.fn(),
    addStudent: vi.fn(),
    removeStudent: vi.fn(),
    setMutualPreference: vi.fn(),
    clearMutualPreference: vi.fn(),
    removePreference: vi.fn(),
    importRosterFromCsv: vi.fn(() => [] as string[]),
    lockSeat: vi.fn(),
    unlockSeat: vi.fn(),
    setThreshold: vi.fn(),
    setShowViolations: vi.fn(),
    setBackgroundImage: vi.fn(),
    setGridColor: vi.fn(),
    resizeGrid: vi.fn(),
    setGranularity: vi.fn(),
    dismissResizeWarning: vi.fn(),
    setClassroom: vi.fn(),
    addFurniture: vi.fn(),
    moveFurniture: vi.fn(),
    removeFurniture: vi.fn(),
    ...overrides,
  } as unknown as Store);

const makeCtx = (overrides?: Partial<Store>): EditorContext => ({
  store: makeStoreMock(overrides),
  canvas: makeCanvasMock(),
  persistence: null,
});

// ---------------------------------------------------------------------------
// GridColorButton
// ---------------------------------------------------------------------------

describe('GridColorButton (§14.5)', () => {
  it('renders the button with data-testid', () => {
    const onClick = vi.fn();
    render(
      React.createElement(GridColorButton, {
        open: false,
        currentColor: null,
        onClick,
      }),
    );
    const btn = screen.getByTestId('grid-color-button');
    expect(btn).toBeDefined();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(
      React.createElement(GridColorButton, {
        open: false,
        currentColor: null,
        onClick,
      }),
    );
    fireEvent.click(screen.getByTestId('grid-color-button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows aria-expanded=true when open', () => {
    render(
      React.createElement(GridColorButton, {
        open: true,
        currentColor: null,
        onClick: vi.fn(),
      }),
    );
    expect(screen.getByTestId('grid-color-button').getAttribute('aria-expanded')).toBe('true');
  });

  it('shows aria-expanded=false when closed', () => {
    render(
      React.createElement(GridColorButton, {
        open: false,
        currentColor: null,
        onClick: vi.fn(),
      }),
    );
    expect(screen.getByTestId('grid-color-button').getAttribute('aria-expanded')).toBe('false');
  });

  it('renders the grid-color-button img', () => {
    render(
      React.createElement(GridColorButton, {
        open: false,
        currentColor: null,
        onClick: vi.fn(),
      }),
    );
    // The img should be present inside the button
    const img = screen.getByRole('img', { name: /grid color/i });
    expect(img.getAttribute('src')).toContain('grid-color-button.png');
  });
});

// ---------------------------------------------------------------------------
// GridColorPickerPopover
// ---------------------------------------------------------------------------

describe('GridColorPickerPopover (§14.5)', () => {
  it('renders nothing when open=false', () => {
    render(
      React.createElement(GridColorPickerPopover, {
        open: false,
        currentColor: null,
        onChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    expect(screen.queryByTestId('grid-color-picker-popover')).toBeNull();
  });

  it('renders the popover when open=true', () => {
    render(
      React.createElement(GridColorPickerPopover, {
        open: true,
        currentColor: null,
        onChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    expect(screen.getByTestId('grid-color-picker-popover')).toBeDefined();
  });

  it('renders the color input', () => {
    render(
      React.createElement(GridColorPickerPopover, {
        open: true,
        currentColor: null,
        onChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    const input = screen.getByTestId('grid-color-input');
    expect(input.tagName.toLowerCase()).toBe('input');
    expect(input.getAttribute('type')).toBe('color');
  });

  it('color input value defaults to the theme gridLine color when currentColor is null', () => {
    render(
      React.createElement(GridColorPickerPopover, {
        open: true,
        currentColor: null,
        onChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    const input = screen.getByTestId<HTMLInputElement>('grid-color-input');
    expect(input.value).toBe(gridLine);
  });

  it('color input value reflects currentColor when set', () => {
    render(
      React.createElement(GridColorPickerPopover, {
        open: true,
        currentColor: '#ff0000',
        onChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    const input = screen.getByTestId<HTMLInputElement>('grid-color-input');
    expect(input.value).toBe('#ff0000');
  });

  it('onChange is called when color input fires input event', () => {
    const onChange = vi.fn();
    render(
      React.createElement(GridColorPickerPopover, {
        open: true,
        currentColor: null,
        onChange,
        onClose: vi.fn(),
      }),
    );
    const input = screen.getByTestId('grid-color-input');
    // Simulate the input event (fires continuously while dragging in native picker)
    fireEvent.input(input, { target: { value: '#123456' } });
    expect(onChange).toHaveBeenCalledWith('#123456');
  });

  it('onChange is also called when color input fires change event (keyboard entry)', () => {
    const onChange = vi.fn();
    render(
      React.createElement(GridColorPickerPopover, {
        open: true,
        currentColor: null,
        onChange,
        onClose: vi.fn(),
      }),
    );
    const input = screen.getByTestId('grid-color-input');
    fireEvent.change(input, { target: { value: '#abcdef' } });
    expect(onChange).toHaveBeenCalledWith('#abcdef');
  });

  it('renders the reset button', () => {
    render(
      React.createElement(GridColorPickerPopover, {
        open: true,
        currentColor: '#ff0000',
        onChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    expect(screen.getByTestId('grid-color-reset')).toBeDefined();
  });

  it('reset button calls onChange with null', () => {
    const onChange = vi.fn();
    render(
      React.createElement(GridColorPickerPopover, {
        open: true,
        currentColor: '#ff0000',
        onChange,
        onClose: vi.fn(),
      }),
    );
    fireEvent.click(screen.getByTestId('grid-color-reset'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('reset button is disabled when currentColor is already null', () => {
    render(
      React.createElement(GridColorPickerPopover, {
        open: true,
        currentColor: null,
        onChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    const resetBtn = screen.getByTestId<HTMLButtonElement>('grid-color-reset');
    expect(resetBtn.disabled).toBe(true);
  });

  it('reset button is enabled when currentColor is set', () => {
    render(
      React.createElement(GridColorPickerPopover, {
        open: true,
        currentColor: '#ff0000',
        onChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    const resetBtn = screen.getByTestId<HTMLButtonElement>('grid-color-reset');
    expect(resetBtn.disabled).toBe(false);
  });

  it('renders swatches for every SWATCHES entry', () => {
    render(
      React.createElement(GridColorPickerPopover, {
        open: true,
        currentColor: null,
        onChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    for (const color of SWATCHES) {
      const swatch = screen.getByTestId(`grid-color-swatch-${color}`);
      expect(swatch).toBeDefined();
    }
  });

  it('clicking a swatch calls onChange with the swatch color (non-default)', () => {
    const onChange = vi.fn();
    render(
      React.createElement(GridColorPickerPopover, {
        open: true,
        currentColor: null,
        onChange,
        onClose: vi.fn(),
      }),
    );
    // Click the second swatch (#b0b0b0 — non-default)
    const secondSwatch = SWATCHES[1];
    if (secondSwatch === undefined) throw new Error('SWATCHES must have at least 2 entries');
    fireEvent.click(screen.getByTestId(`grid-color-swatch-${secondSwatch}`));
    expect(onChange).toHaveBeenCalledWith(secondSwatch);
  });

  it('clicking the first swatch (theme default) calls onChange with null', () => {
    // The first swatch IS the theme default; clicking it → reset to null
    const onChange = vi.fn();
    render(
      React.createElement(GridColorPickerPopover, {
        open: true,
        currentColor: '#ff0000',
        onChange,
        onClose: vi.fn(),
      }),
    );
    // SWATCHES[0] === gridLine (the theme default)
    fireEvent.click(screen.getByTestId(`grid-color-swatch-${gridLine}`));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('calls onClose when clicking outside the popover', () => {
    const onClose = vi.fn();
    render(
      React.createElement('div', null,
        React.createElement('button', { 'data-testid': 'outside-btn' }, 'outside'),
        React.createElement(GridColorPickerPopover, {
          open: true,
          currentColor: null,
          onChange: vi.fn(),
          onClose,
        }),
      ),
    );
    // Fire a capture-phase pointerdown on the outside button
    act(() => {
      const outsideBtn = screen.getByTestId('outside-btn');
      outsideBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// FurnitureEditor.Toolbar renders grid color button
// ---------------------------------------------------------------------------

describe('FurnitureEditor Toolbar — grid color (§14.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the grid color button in the toolbar', () => {
    const ctx = makeCtx();
    render(React.createElement(FurnitureEditor.Toolbar, { ctx }));
    expect(screen.getByTestId('grid-color-button')).toBeDefined();
  });

  it('clicking the grid color button opens the popover', () => {
    const ctx = makeCtx();
    render(React.createElement(FurnitureEditor.Toolbar, { ctx }));

    // Popover not shown initially
    expect(screen.queryByTestId('grid-color-picker-popover')).toBeNull();

    // Click the button
    fireEvent.click(screen.getByTestId('grid-color-button'));

    // Popover now shown
    expect(screen.getByTestId('grid-color-picker-popover')).toBeDefined();
  });

  it('clicking the grid color button again closes the popover (toggle)', () => {
    const ctx = makeCtx();
    render(React.createElement(FurnitureEditor.Toolbar, { ctx }));

    // Open
    fireEvent.click(screen.getByTestId('grid-color-button'));
    expect(screen.getByTestId('grid-color-picker-popover')).toBeDefined();

    // Close (toggle)
    fireEvent.click(screen.getByTestId('grid-color-button'));
    expect(screen.queryByTestId('grid-color-picker-popover')).toBeNull();
  });

  it('changing the color input calls store.setGridColor', () => {
    const setGridColor = vi.fn();
    const ctx = makeCtx({ setGridColor });

    render(React.createElement(FurnitureEditor.Toolbar, { ctx }));

    // Open the picker
    fireEvent.click(screen.getByTestId('grid-color-button'));

    // Fire input event (the live-drag event)
    const input = screen.getByTestId('grid-color-input');
    fireEvent.input(input, { target: { value: '#ff6600' } });

    expect(setGridColor).toHaveBeenCalledWith('#ff6600');
  });

  it('changing the color input also calls canvas.requestRepaint', () => {
    const requestRepaint = vi.fn();
    const setGridColor = vi.fn();

    const canvas = makeCanvasMock();
    // Override requestRepaint on the canvas mock
    (canvas.requestRepaint as ReturnType<typeof vi.fn>) = requestRepaint;

    const ctx: EditorContext = {
      store: makeStoreMock({ setGridColor }),
      canvas,
      persistence: null,
    };

    render(React.createElement(FurnitureEditor.Toolbar, { ctx }));

    // Open the picker
    fireEvent.click(screen.getByTestId('grid-color-button'));

    // Fire input event
    const input = screen.getByTestId('grid-color-input');
    fireEvent.input(input, { target: { value: '#0000ff' } });

    expect(requestRepaint).toHaveBeenCalled();
  });

  it('resetting color calls store.setGridColor(null)', () => {
    const setGridColor = vi.fn();
    // Store has a non-null gridColor so reset button is enabled
    const ctx = makeCtx({
      setGridColor,
      classroom: domainSetGridColor(makeClassroom('test-classroom', 'Test', 5, 5), '#ff0000'),
    });

    render(React.createElement(FurnitureEditor.Toolbar, { ctx }));

    // Open the picker
    fireEvent.click(screen.getByTestId('grid-color-button'));

    // Click reset
    fireEvent.click(screen.getByTestId('grid-color-reset'));

    expect(setGridColor).toHaveBeenCalledWith(null);
  });
});
