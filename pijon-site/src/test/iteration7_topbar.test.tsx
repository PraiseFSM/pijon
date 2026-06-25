// @vitest-environment jsdom
/**
 * iteration7_topbar.test.tsx — Coverage for Cluster A (Iteration 7):
 * unified TopBar + shared Settings + AllocateSplitButton.
 *
 * Covers:
 *  A. Editor lever in TopBar
 *     A1. Lever renders with testid "editor-mode-lever"
 *     A2. Lever reflects current mode: Furniture mode → aria-pressed=false;
 *         Students mode → aria-pressed=true
 *     A3. Clicking lever switches from Furniture to Students
 *     A4. Clicking lever switches from Students back to Furniture
 *     A5. Lever shows correct labelOff/labelOn text based on EDITOR_REGISTRY
 *  B. Top-bar per-mode toolbar ordering
 *     B1. Furniture mode toolbar: New / Clear / Save / Load / Grid / Granularity
 *     B2. Students mode toolbar: Allocate btn / Clear / Undo / Redo / weight selectors
 *         / Assigner lever / Export / Import
 *     B3. Shared trailing group (Settings gear, saved-status, Erase) in BOTH modes
 *  C. Settings is shared across modes
 *     C1. Settings gear renders in both Furniture and Students mode (TopBar)
 *     C2. Opening Settings shows all controls: Nearness, Show Violations, Show Links,
 *         BG toggle, grid-color button
 *     C3. Nearness input calls setThreshold
 *     C4. Show Violations toggle calls setShowViolations
 *     C5. Show Links toggle calls setShowLinks
 *     C6. BG toggle calls setBackgroundImage
 *     C7. Algorithm/variant NOT in SettingsMenu (they moved to AllocateSplitButton)
 *  D. AllocateSplitButton in StudentEditor toolbar
 *     D1. Allocate primary button runs allocate() when variant is "allocate"
 *     D2. Allocate primary button runs smartShuffle() when variant is "smart_shuffle"
 *     D3. Dropdown toggle opens the dropdown menu
 *     D4. Selecting Greedy radio sets algorithmId to "greedy"
 *     D5. Selecting Random radio sets algorithmId to "bogo"
 *     D6. Selecting "smart_shuffle" variant changes button label to "Shuffle"
 *     D7. Selecting "allocate" variant changes button label to "Allocate"
 *
 * LOCAL-FIRST: no network calls in any test path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';
import { TopBar } from '../ui/shell/TopBar.js';
import { SettingsMenu } from '../ui/shell/SettingsMenu.js';
import { StudentEditor } from '../ui/editors/StudentEditor.js';
import { usePijonStore } from '../state/store.js';
import type { EditorContext, EditorMode, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import type { FurnitureId } from '../domain/types.js';
import { EDITOR_REGISTRY } from '../ui/editors/registry.js';
import { FurnitureEditor } from '../ui/editors/FurnitureEditor.js';
import { DEFAULT_CELLS_PER_UNIT, DEFAULT_THRESHOLD_UNITS } from '../domain/classroom.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  usePijonStore.getState().eraseAll();
}

const makeCanvasMock = (): CanvasView => ({
  cellSize: 48,
  gridW: 5,
  gridH: 5,
  originOffset: 0,
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
    classroom: {
      id: 'test',
      name: 'Test',
      gridW: 5,
      gridH: 5,
      furniture: [],
      cellsPerUnit: DEFAULT_CELLS_PER_UNIT,
      thresholdUnits: DEFAULT_THRESHOLD_UNITS,
    },
    history: [],
    historyPtr: -1,
    saveStatus: 'saved' as const,
    activeEditorId: 'furniture',
    fileHandle: null,
    resizeGridWarning: null,
    showViolations: true,
    showLinks: false,
    uiScale: 1.2,
    eraseAll: vi.fn(),
    setThreshold: vi.fn(),
    setShowViolations: vi.fn(),
    setShowLinks: vi.fn(),
    setUiScale: vi.fn(),
    setBackgroundImage: vi.fn(),
    setGridColor: vi.fn(),
    allocate: vi.fn(),
    smartShuffle: vi.fn(),
    clearArrangement: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    ...overrides,
  } as unknown as Store);

function makeCtx(
  storeOverrides?: Partial<Store>,
): EditorContext {
  return {
    store: makeStoreMock(storeOverrides),
    canvas: makeCanvasMock(),
    persistence: null,
  };
}

const fakeEditor: EditorMode = {
  id: 'fake',
  label: 'Fake',
  Toolbar: () => React.createElement('div', { 'data-testid': 'fake-toolbar' }, 'Fake Toolbar'),
  SidePanel: () => null,
  activate: vi.fn(),
  deactivate: vi.fn(),
  onPointerDown: vi.fn(),
  onPointerMove: vi.fn(),
  onPointerUp: vi.fn(),
  onKeyDown: vi.fn(),
  onDrop: vi.fn(),
  onContextMenu: vi.fn(),
  paintOverlay: vi.fn(),
};

// ---------------------------------------------------------------------------
// A. Editor lever in TopBar
// ---------------------------------------------------------------------------

describe('A. Editor lever — renders and reflects mode', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('A1: lever renders with testid "editor-mode-lever"', () => {
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    expect(screen.getByTestId('editor-mode-lever')).toBeInTheDocument();
  });

  it('A2a: lever has aria-pressed=false when active editor is the first (Furniture)', () => {
    act(() => { usePijonStore.setState({ activeEditorId: EDITOR_REGISTRY[0]?.id ?? 'furniture' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    expect(screen.getByTestId('editor-mode-lever').getAttribute('aria-pressed')).toBe('false');
  });

  it('A2b: lever has aria-pressed=true when active editor is the second (Students)', () => {
    act(() => { usePijonStore.setState({ activeEditorId: EDITOR_REGISTRY[1]?.id ?? 'student' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    expect(screen.getByTestId('editor-mode-lever').getAttribute('aria-pressed')).toBe('true');
  });

  it('A3: clicking lever from Furniture mode calls setActiveEditorId with students id', () => {
    act(() => { usePijonStore.setState({ activeEditorId: EDITOR_REGISTRY[0]?.id ?? 'furniture' }); });
    const setActiveEditorId = vi.spyOn(usePijonStore.getState(), 'setActiveEditorId');
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    act(() => { fireEvent.click(screen.getByTestId('editor-mode-lever')); });
    expect(setActiveEditorId).toHaveBeenCalledWith(EDITOR_REGISTRY[1]?.id ?? 'student');
    setActiveEditorId.mockRestore();
  });

  it('A4: clicking lever from Students mode calls setActiveEditorId with furniture id', () => {
    act(() => { usePijonStore.setState({ activeEditorId: EDITOR_REGISTRY[1]?.id ?? 'student' }); });
    const setActiveEditorId = vi.spyOn(usePijonStore.getState(), 'setActiveEditorId');
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    act(() => { fireEvent.click(screen.getByTestId('editor-mode-lever')); });
    expect(setActiveEditorId).toHaveBeenCalledWith(EDITOR_REGISTRY[0]?.id ?? 'furniture');
    setActiveEditorId.mockRestore();
  });

  it('A5: lever shows OFF label (Furniture) in Furniture mode', () => {
    act(() => { usePijonStore.setState({ activeEditorId: EDITOR_REGISTRY[0]?.id ?? 'furniture' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    const lever = screen.getByTestId('editor-mode-lever');
    // When OFF, ToggleLever shows labelOff which is EDITOR_REGISTRY[0].label = "Furniture"
    expect(lever.textContent).toContain(EDITOR_REGISTRY[0]?.label ?? 'Furniture');
  });

  it('A5b: lever shows ON label (Students) in Students mode', () => {
    act(() => { usePijonStore.setState({ activeEditorId: EDITOR_REGISTRY[1]?.id ?? 'student' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    const lever = screen.getByTestId('editor-mode-lever');
    // When ON, ToggleLever shows labelOn which is EDITOR_REGISTRY[1].label = "Students"
    expect(lever.textContent).toContain(EDITOR_REGISTRY[1]?.label ?? 'Students');
  });

  it('A: lever toggle is bidirectional — two clicks return to original mode', () => {
    act(() => { usePijonStore.setState({ activeEditorId: EDITOR_REGISTRY[0]?.id ?? 'furniture' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    const lever = screen.getByTestId('editor-mode-lever');
    // First click → Students
    act(() => { fireEvent.click(lever); });
    expect(usePijonStore.getState().activeEditorId).toBe(EDITOR_REGISTRY[1]?.id ?? 'student');
    // Second click → back to Furniture
    act(() => { fireEvent.click(lever); });
    expect(usePijonStore.getState().activeEditorId).toBe(EDITOR_REGISTRY[0]?.id ?? 'furniture');
  });

  it('A: lever is not a tab/tablist', () => {
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    // The lever must NOT be rendered as role="tab" or inside a role="tablist"
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(document.querySelector('[role="tab"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B. Top-bar per-mode toolbar ordering
// ---------------------------------------------------------------------------

describe('B. Top-bar per-mode toolbar content', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('B1: Furniture toolbar contains New, Clear, Save, Load, Grid readout, and Granularity group', () => {
    const ctx = makeCtx();
    FurnitureEditor.activate(ctx);
    render(React.createElement(FurnitureEditor.Toolbar, { ctx }));

    expect(screen.getByRole('button', { name: /^new$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /granularity/i })).toBeInTheDocument();
    // Grid readout
    expect(screen.getByText(/grid:/i)).toBeInTheDocument();

    FurnitureEditor.deactivate(ctx);
  });

  it('B2: Students toolbar contains Allocate btn, Clear, Undo, Redo, weight selectors, Assigner lever, Export, Import', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(React.createElement(StudentEditor.Toolbar, { ctx }));

    expect(screen.getByTestId('allocate-btn')).toBeInTheDocument();
    expect(screen.getByTestId('allocate-dropdown-toggle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /redo/i })).toBeInTheDocument();
    // weight buttons
    expect(screen.getByTestId('weight-btn--1')).toBeInTheDocument();
    expect(screen.getByTestId('weight-btn-1')).toBeInTheDocument();
    // assigner toggle lever
    expect(screen.getByTestId('assigner-toggle-lever')).toBeInTheDocument();
    // export / import
    expect(screen.getByTestId('toolbar-export-pijon')).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-import-pijon')).toBeInTheDocument();

    StudentEditor.deactivate(ctx);
  });

  it('B3: Shared trailing group (Settings gear, saved-status, Erase) renders in Furniture mode TopBar', () => {
    act(() => { usePijonStore.setState({ saveStatus: 'saved' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));

    expect(screen.getByTestId('settings-gear-button')).toBeInTheDocument();
    expect(screen.getByText(/saved locally/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /erase all/i })).toBeInTheDocument();
  });

  it('B3b: Shared trailing group renders in Students mode TopBar', () => {
    act(() => { usePijonStore.setState({ saveStatus: 'saved' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: StudentEditor, ctx }));

    expect(screen.getByTestId('settings-gear-button')).toBeInTheDocument();
    expect(screen.getByText(/saved locally/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /erase all/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// C. Settings is shared across modes
// ---------------------------------------------------------------------------

describe('C. SettingsMenu is shared and contains all controls', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('C1: Settings gear button renders in TopBar (shared)', () => {
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    expect(screen.getByTestId('settings-gear-button')).toBeInTheDocument();
  });

  it('C2: Opening Settings shows Nearness, Show Violations, Show Links, BG toggle, grid-color button', () => {
    const ctx = makeCtx();
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));

    expect(screen.getByTestId('settings-nearness-input')).toBeInTheDocument();
    expect(screen.getByTestId('settings-violations-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('settings-show-links-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('settings-bg-toggle')).toBeInTheDocument();
    // Grid color button should be present
    expect(document.querySelector('[data-testid="grid-color-button"]')).toBeInTheDocument();
  });

  it('C3: Changing Nearness input calls ctx.store.setThreshold with the new value', () => {
    const ctx = makeCtx();
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));

    const input = screen.getByTestId('settings-nearness-input');
    act(() => { fireEvent.change(input, { target: { value: '2.5' } }); });

    expect(ctx.store.setThreshold).toHaveBeenCalledWith(2.5);
  });

  it('C3b: Nearness change also calls ctx.canvas.requestRepaint', () => {
    const ctx = makeCtx();
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));

    const input = screen.getByTestId('settings-nearness-input');
    act(() => { fireEvent.change(input, { target: { value: '3' } }); });

    expect(ctx.canvas.requestRepaint).toHaveBeenCalled();
  });

  it('C4: Clicking Show Violations toggle calls ctx.store.setShowViolations with the flipped value', () => {
    // showViolations defaults to true in store mock
    act(() => { usePijonStore.setState({ showViolations: true }); });
    const ctx = makeCtx({ showViolations: true });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));

    act(() => { fireEvent.click(screen.getByTestId('settings-violations-toggle')); });

    expect(ctx.store.setShowViolations).toHaveBeenCalledWith(false);
  });

  it('C4b: Show Violations toggle calls setShowViolations(true) when currently false', () => {
    act(() => { usePijonStore.setState({ showViolations: false }); });
    const ctx = makeCtx({ showViolations: false });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));

    act(() => { fireEvent.click(screen.getByTestId('settings-violations-toggle')); });

    expect(ctx.store.setShowViolations).toHaveBeenCalledWith(true);
  });

  it('C5: Clicking Show Links toggle calls ctx.store.setShowLinks with the flipped value', () => {
    act(() => { usePijonStore.setState({ showLinks: false }); });
    const ctx = makeCtx({ showLinks: false });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));

    act(() => { fireEvent.click(screen.getByTestId('settings-show-links-toggle')); });

    expect(ctx.store.setShowLinks).toHaveBeenCalledWith(true);
  });

  it('C5b: Show Links toggle calls setShowLinks(false) when currently true', () => {
    act(() => { usePijonStore.setState({ showLinks: true }); });
    const ctx = makeCtx({ showLinks: true });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));

    act(() => { fireEvent.click(screen.getByTestId('settings-show-links-toggle')); });

    expect(ctx.store.setShowLinks).toHaveBeenCalledWith(false);
  });

  it('C6: Clicking BG toggle calls ctx.store.setBackgroundImage', () => {
    const ctx = makeCtx();
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));

    act(() => { fireEvent.click(screen.getByTestId('settings-bg-toggle')); });

    expect(ctx.store.setBackgroundImage).toHaveBeenCalled();
  });

  it('C6b: BG toggle also calls ctx.canvas.requestRepaint', () => {
    const ctx = makeCtx();
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));

    act(() => { fireEvent.click(screen.getByTestId('settings-bg-toggle')); });

    expect(ctx.canvas.requestRepaint).toHaveBeenCalled();
  });

  it('C7: SettingsMenu does NOT contain algorithm/variant radio buttons', () => {
    const ctx = makeCtx();
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));

    // Algorithm radio buttons (greedy/bogo) must NOT appear in Settings
    expect(document.querySelector('[name="allocate-algorithm"]')).toBeNull();
    expect(document.querySelector('[name="allocate-variant"]')).toBeNull();
    // Also no Allocate button in settings
    expect(document.querySelector('[data-testid="allocate-btn"]')).toBeNull();
  });

  it('C: SettingsMenu is closed when open=false (renders nothing)', () => {
    const ctx = makeCtx();
    const { container } = render(
      React.createElement(SettingsMenu, { ctx, open: false, onClose: vi.fn() }),
    );
    expect(container.firstChild).toBeNull();
  });

  it('C: Settings gear in TopBar opens SettingsMenu on click', () => {
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));

    // Initially closed
    expect(document.querySelector('[data-testid="settings-menu"]')).toBeNull();

    // Click gear to open
    act(() => { fireEvent.click(screen.getByTestId('settings-gear-button')); });

    expect(screen.getByTestId('settings-menu')).toBeInTheDocument();
  });

  it('C: Settings visible and functional in Furniture mode (via TopBar)', () => {
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: FurnitureEditor, ctx }));

    act(() => { fireEvent.click(screen.getByTestId('settings-gear-button')); });

    // All settings controls present in Furniture mode
    expect(screen.getByTestId('settings-nearness-input')).toBeInTheDocument();
    expect(screen.getByTestId('settings-violations-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('settings-show-links-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('settings-bg-toggle')).toBeInTheDocument();
  });

  it('C: Settings visible and functional in Students mode (via TopBar)', () => {
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: StudentEditor, ctx }));

    act(() => { fireEvent.click(screen.getByTestId('settings-gear-button')); });

    // All settings controls present in Students mode
    expect(screen.getByTestId('settings-nearness-input')).toBeInTheDocument();
    expect(screen.getByTestId('settings-violations-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('settings-show-links-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('settings-bg-toggle')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// D. AllocateSplitButton in StudentEditor toolbar
// ---------------------------------------------------------------------------

describe('D. AllocateSplitButton — algorithm and variant', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('D1: clicking Allocate primary button calls store.allocate() when variant is "allocate"', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(React.createElement(StudentEditor.Toolbar, { ctx }));

    // Default variant is "allocate"
    act(() => { fireEvent.click(screen.getByTestId('allocate-btn')); });

    expect(ctx.store.allocate).toHaveBeenCalled();
    expect(ctx.store.smartShuffle).not.toHaveBeenCalled();

    StudentEditor.deactivate(ctx);
  });

  it('D2: clicking Allocate primary button calls store.smartShuffle() when variant is "smart_shuffle"', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(React.createElement(StudentEditor.Toolbar, { ctx }));

    // Open dropdown and select smart_shuffle
    act(() => { fireEvent.click(screen.getByTestId('allocate-dropdown-toggle')); });
    act(() => { fireEvent.click(screen.getByTestId('allocate-variant-smart_shuffle')); });

    // Now run — should call smartShuffle
    act(() => { fireEvent.click(screen.getByTestId('allocate-btn')); });

    expect(ctx.store.smartShuffle).toHaveBeenCalled();
    expect(ctx.store.allocate).not.toHaveBeenCalled();

    StudentEditor.deactivate(ctx);
  });

  it('D3: clicking dropdown toggle opens the dropdown menu', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(React.createElement(StudentEditor.Toolbar, { ctx }));

    expect(document.querySelector('[data-testid="allocate-dropdown-menu"]')).toBeNull();

    act(() => { fireEvent.click(screen.getByTestId('allocate-dropdown-toggle')); });

    expect(screen.getByTestId('allocate-dropdown-menu')).toBeInTheDocument();

    StudentEditor.deactivate(ctx);
  });

  it('D4: selecting Greedy radio via dropdown sets algorithm to greedy', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(React.createElement(StudentEditor.Toolbar, { ctx }));

    act(() => { fireEvent.click(screen.getByTestId('allocate-dropdown-toggle')); });

    const greedyRadio = screen.getByTestId('allocate-algorithm-greedy');
    act(() => { fireEvent.click(greedyRadio); });

    // Radio should be checked
    expect((greedyRadio as HTMLInputElement).checked).toBe(true);

    StudentEditor.deactivate(ctx);
  });

  it('D5: selecting Random (bogo) radio via dropdown sets algorithm to bogo', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(React.createElement(StudentEditor.Toolbar, { ctx }));

    act(() => { fireEvent.click(screen.getByTestId('allocate-dropdown-toggle')); });

    const bogoRadio = screen.getByTestId('allocate-algorithm-bogo');
    act(() => { fireEvent.click(bogoRadio); });

    expect((bogoRadio as HTMLInputElement).checked).toBe(true);

    StudentEditor.deactivate(ctx);
  });

  it('D6: selecting smart_shuffle variant changes primary button label to "Shuffle"', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(React.createElement(StudentEditor.Toolbar, { ctx }));

    act(() => { fireEvent.click(screen.getByTestId('allocate-dropdown-toggle')); });
    act(() => { fireEvent.click(screen.getByTestId('allocate-variant-smart_shuffle')); });

    // Button text should now be "Shuffle"
    expect(screen.getByTestId('allocate-btn').textContent).toContain('Shuffle');

    StudentEditor.deactivate(ctx);
  });

  it('D7: selecting allocate variant changes primary button label back to "Allocate"', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(React.createElement(StudentEditor.Toolbar, { ctx }));

    // First switch to smart_shuffle
    act(() => { fireEvent.click(screen.getByTestId('allocate-dropdown-toggle')); });
    act(() => { fireEvent.click(screen.getByTestId('allocate-variant-smart_shuffle')); });
    expect(screen.getByTestId('allocate-btn').textContent).toContain('Shuffle');

    // Now switch back to allocate
    act(() => { fireEvent.click(screen.getByTestId('allocate-dropdown-toggle')); });
    act(() => { fireEvent.click(screen.getByTestId('allocate-variant-allocate')); });

    expect(screen.getByTestId('allocate-btn').textContent).toContain('Allocate');

    StudentEditor.deactivate(ctx);
  });

  it('D: Algorithm and variant are NOT present in SettingsMenu', () => {
    const ctx = makeCtx();
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));

    expect(document.querySelector('[name="allocate-algorithm"]')).toBeNull();
    expect(document.querySelector('[data-testid="allocate-variant-allocate"]')).toBeNull();
    expect(document.querySelector('[data-testid="allocate-variant-smart_shuffle"]')).toBeNull();
  });

  it('D: Allocate with greedy algorithm calls store.allocate with a GreedyAllocator', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(React.createElement(StudentEditor.Toolbar, { ctx }));

    // Default: greedy + allocate
    act(() => { fireEvent.click(screen.getByTestId('allocate-btn')); });

    expect(ctx.store.allocate).toHaveBeenCalledTimes(1);
    const [allocatorArg] = (ctx.store.allocate as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown];
    // GreedyAllocator instance
    expect(allocatorArg).toBeDefined();
    expect(typeof (allocatorArg as { allocate?: unknown }).allocate).toBe('function');

    StudentEditor.deactivate(ctx);
  });
});

// ---------------------------------------------------------------------------
// E. Lever vs tab — accessibility semantics
// ---------------------------------------------------------------------------

describe('E. Lever accessibility semantics', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('E1: editor-mode-lever has role button (not tab)', () => {
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    const lever = screen.getByTestId('editor-mode-lever');
    // HTMLButtonElement has implicit role="button"
    expect(lever.tagName.toLowerCase()).toBe('button');
  });

  it('E2: editor-mode-lever has aria-pressed attribute (switch semantics)', () => {
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    const lever = screen.getByTestId('editor-mode-lever');
    const pressed = lever.getAttribute('aria-pressed');
    // Must be "true" or "false" (not null)
    expect(pressed === 'true' || pressed === 'false').toBe(true);
  });

  it('E3: lever container uses role="group" with aria-label="Editor mode"', () => {
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    const group = screen.getByRole('group', { name: /editor mode/i });
    expect(group).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// F. Mutation-test probes — confirm these behaviors are not vacuous
// ---------------------------------------------------------------------------

describe('F. Mutation-test probes (would fail if logic was inverted)', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('F1: lever is aria-pressed=false for Furniture, NOT true', () => {
    // If the logic were inverted (on=activeId===firstEditor), this would give "true"
    act(() => { usePijonStore.setState({ activeEditorId: EDITOR_REGISTRY[0]?.id ?? 'furniture' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    expect(screen.getByTestId('editor-mode-lever').getAttribute('aria-pressed')).not.toBe('true');
    expect(screen.getByTestId('editor-mode-lever').getAttribute('aria-pressed')).toBe('false');
  });

  it('F2: clicking lever from Students sets Furniture, NOT null', () => {
    act(() => { usePijonStore.setState({ activeEditorId: EDITOR_REGISTRY[1]?.id ?? 'student' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    act(() => { fireEvent.click(screen.getByTestId('editor-mode-lever')); });
    // Must be furniture id, not null
    expect(usePijonStore.getState().activeEditorId).not.toBeNull();
    expect(usePijonStore.getState().activeEditorId).toBe(EDITOR_REGISTRY[0]?.id ?? 'furniture');
  });

  it('F3: allocate() is called, NOT smartShuffle(), on default click', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(React.createElement(StudentEditor.Toolbar, { ctx }));

    act(() => { fireEvent.click(screen.getByTestId('allocate-btn')); });

    // allocate must be called; smartShuffle must NOT be called
    expect(ctx.store.allocate).toHaveBeenCalledTimes(1);
    expect(ctx.store.smartShuffle).toHaveBeenCalledTimes(0);

    StudentEditor.deactivate(ctx);
  });

  it('F4: Show Violations toggle calls setShowViolations(false) when currently true — not true', () => {
    act(() => { usePijonStore.setState({ showViolations: true }); });
    const ctx = makeCtx({ showViolations: true });
    render(React.createElement(SettingsMenu, { ctx, open: true, onClose: vi.fn() }));

    act(() => { fireEvent.click(screen.getByTestId('settings-violations-toggle')); });

    // Must call with false (the flip), NOT true (no-op)
    expect(ctx.store.setShowViolations).toHaveBeenCalledWith(false);
    expect(ctx.store.setShowViolations).not.toHaveBeenCalledWith(true);
  });
});
