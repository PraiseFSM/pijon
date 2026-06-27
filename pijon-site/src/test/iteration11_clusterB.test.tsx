// @vitest-environment jsdom
/**
 * iteration11_clusterB.test.tsx — Cluster B (Iteration 11): Editor toggle layout.
 *
 * §11.B1: Render the Furniture/Students toggle as `Furniture [lever] Students` —
 * a label on EACH side of the lever (like a physical switch), instead of one
 * changing label inside the lever.
 *
 * Mapping: Furniture = lever OFF/left; Students = lever ON/right.
 *
 * Covers:
 *  A. Both labels render flanking the lever
 *     A1. "Furniture" label (testid="editor-mode-furniture") is always present
 *     A2. "Students" label (testid="editor-mode-students") is always present
 *     A3. The lever (testid="editor-mode-lever") is always present
 *     A4. The group contains all three elements in left-to-right order
 *  B. Active side reflects activeEditorId
 *     B1. Furniture active -> Furniture label is bold (fontWeight 700)
 *     B2. Students active -> Students label is bold (fontWeight 700)
 *     B3. Furniture active -> Students label is not bold (fontWeight 400)
 *     B4. Students active -> Furniture label is not bold (fontWeight 400)
 *  C. Lever aria-pressed reflects activeEditorId
 *     C1. Furniture active -> lever aria-pressed="false"
 *     C2. Students active -> lever aria-pressed="true"
 *  D. Clicking side labels switches the editor
 *     D1. Clicking "Students" label calls setActiveEditorId with students id
 *     D2. Clicking "Furniture" label calls setActiveEditorId with furniture id
 *     D3. Clicking "Students" label from Students mode is a no-op (already there)
 *     D4. Clicking "Furniture" label from Furniture mode is a no-op (already there)
 *  E. Lever toggle still switches editor
 *     E1. Clicking lever from Furniture mode switches to Students
 *     E2. Clicking lever from Students mode switches to Furniture
 *  F. Accessibility
 *     F1. Group has role="group" and aria-label="Editor mode"
 *     F2. Lever has aria-pressed attribute (switch semantics)
 *     F3. Side labels are button elements (interactive, accessible)
 *     F4. No tablist / tab roles (lever is not a tab-based switcher)
 *  G. Assigner lever (StudentEditor) is UNCHANGED
 *     G1. Assigner lever still renders with testid="assigner-toggle-lever"
 *     G2. Assigner lever still shows "Assigner" / "Assigner ON" label text
 *     G3. Assigner lever is still a single on/off toggle (aria-pressed)
 *     G4. Assigner lever toggle still works
 *  H. Mutation probes
 *     H1. Active side is NOT muted when Furniture is active
 *     H2. Inactive side is NOT bold when Furniture is active
 *     H3. Lever position is consistent: Furniture active = OFF, Students active = ON
 *
 * LOCAL-FIRST: no network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';
import { TopBar } from '../ui/shell/TopBar.js';
import { StudentEditor } from '../ui/editors/StudentEditor.js';
import { usePijonStore } from '../state/store.js';
import type { EditorContext, EditorMode, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import type { FurnitureId } from '../domain/types.js';
import { EDITOR_REGISTRY } from '../ui/editors/registry.js';
import { DEFAULT_CELLS_PER_UNIT, DEFAULT_THRESHOLD_UNITS } from '../domain/classroom.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FURNITURE_ID = EDITOR_REGISTRY[0]?.id ?? 'furniture';
const STUDENT_ID = EDITOR_REGISTRY[1]?.id ?? 'student';
const FURNITURE_LABEL = EDITOR_REGISTRY[0]?.label ?? 'Furniture';
const STUDENT_LABEL = EDITOR_REGISTRY[1]?.label ?? 'Students';

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

function makeCtx(storeOverrides?: Partial<Store>): EditorContext {
  return {
    store: makeStoreMock(storeOverrides),
    canvas: makeCanvasMock(),
    persistence: null,
  };
}

const fakeEditor: EditorMode = {
  id: 'fake',
  label: 'Fake',
  Toolbar: () => React.createElement('div', { 'data-testid': 'fake-toolbar' }),
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
// A. Both labels render flanking the lever
// ---------------------------------------------------------------------------

describe('A. Both labels always render flanking the lever', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('A1: "Furniture" label is always present (testid="editor-mode-furniture")', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    expect(screen.getByTestId('editor-mode-furniture')).toBeInTheDocument();
  });

  it('A1b: "Furniture" label also present in Students mode', () => {
    act(() => { usePijonStore.setState({ activeEditorId: STUDENT_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    expect(screen.getByTestId('editor-mode-furniture')).toBeInTheDocument();
  });

  it('A2: "Students" label is always present (testid="editor-mode-students")', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    expect(screen.getByTestId('editor-mode-students')).toBeInTheDocument();
  });

  it('A2b: "Students" label also present in Students mode', () => {
    act(() => { usePijonStore.setState({ activeEditorId: STUDENT_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    expect(screen.getByTestId('editor-mode-students')).toBeInTheDocument();
  });

  it('A3: lever (testid="editor-mode-lever") is always present', () => {
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    expect(screen.getByTestId('editor-mode-lever')).toBeInTheDocument();
  });

  it('A4: "Furniture" label text matches EDITOR_REGISTRY[0].label', () => {
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const furnitureLabel = screen.getByTestId('editor-mode-furniture');
    expect(furnitureLabel.textContent).toContain(FURNITURE_LABEL);
  });

  it('A4b: "Students" label text matches EDITOR_REGISTRY[1].label', () => {
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const studentsLabel = screen.getByTestId('editor-mode-students');
    expect(studentsLabel.textContent).toContain(STUDENT_LABEL);
  });
});

// ---------------------------------------------------------------------------
// B. Active side reflects activeEditorId
// ---------------------------------------------------------------------------

describe('B. Active side emphasis reflects activeEditorId', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('B1: Furniture active -> Furniture label has fontWeight 700 (bold)', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const furnitureLabel = screen.getByTestId('editor-mode-furniture');
    expect((furnitureLabel as HTMLButtonElement).style.fontWeight).toBe('700');
  });

  it('B2: Students active -> Students label has fontWeight 700 (bold)', () => {
    act(() => { usePijonStore.setState({ activeEditorId: STUDENT_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const studentsLabel = screen.getByTestId('editor-mode-students');
    expect((studentsLabel as HTMLButtonElement).style.fontWeight).toBe('700');
  });

  it('B3: Furniture active -> Students label has fontWeight 400 (not bold)', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const studentsLabel = screen.getByTestId('editor-mode-students');
    expect((studentsLabel as HTMLButtonElement).style.fontWeight).toBe('400');
  });

  it('B4: Students active -> Furniture label has fontWeight 400 (not bold)', () => {
    act(() => { usePijonStore.setState({ activeEditorId: STUDENT_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const furnitureLabel = screen.getByTestId('editor-mode-furniture');
    expect((furnitureLabel as HTMLButtonElement).style.fontWeight).toBe('400');
  });
});

// ---------------------------------------------------------------------------
// C. Lever aria-pressed reflects activeEditorId
// ---------------------------------------------------------------------------

describe('C. Lever aria-pressed reflects activeEditorId', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('C1: Furniture active -> lever aria-pressed="false" (lever OFF = Furniture)', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    expect(screen.getByTestId('editor-mode-lever').getAttribute('aria-pressed')).toBe('false');
  });

  it('C2: Students active -> lever aria-pressed="true" (lever ON = Students)', () => {
    act(() => { usePijonStore.setState({ activeEditorId: STUDENT_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    expect(screen.getByTestId('editor-mode-lever').getAttribute('aria-pressed')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// D. Clicking side labels switches the editor
// ---------------------------------------------------------------------------

describe('D. Clicking side labels switches the editor', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('D1: clicking "Students" label calls setActiveEditorId with students id', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    const spy = vi.spyOn(usePijonStore.getState(), 'setActiveEditorId');
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    act(() => { fireEvent.click(screen.getByTestId('editor-mode-students')); });
    expect(spy).toHaveBeenCalledWith(STUDENT_ID);
    spy.mockRestore();
  });

  it('D2: clicking "Furniture" label calls setActiveEditorId with furniture id', () => {
    act(() => { usePijonStore.setState({ activeEditorId: STUDENT_ID }); });
    const spy = vi.spyOn(usePijonStore.getState(), 'setActiveEditorId');
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    act(() => { fireEvent.click(screen.getByTestId('editor-mode-furniture')); });
    expect(spy).toHaveBeenCalledWith(FURNITURE_ID);
    spy.mockRestore();
  });

  it('D3: clicking Students label updates store activeEditorId to students id', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    act(() => { fireEvent.click(screen.getByTestId('editor-mode-students')); });
    expect(usePijonStore.getState().activeEditorId).toBe(STUDENT_ID);
  });

  it('D4: clicking Furniture label updates store activeEditorId to furniture id', () => {
    act(() => { usePijonStore.setState({ activeEditorId: STUDENT_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    act(() => { fireEvent.click(screen.getByTestId('editor-mode-furniture')); });
    expect(usePijonStore.getState().activeEditorId).toBe(FURNITURE_ID);
  });
});

// ---------------------------------------------------------------------------
// E. Lever toggle still switches editor
// ---------------------------------------------------------------------------

describe('E. Lever toggle still switches editor', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('E1: clicking lever from Furniture mode switches to Students', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    act(() => { fireEvent.click(screen.getByTestId('editor-mode-lever')); });
    expect(usePijonStore.getState().activeEditorId).toBe(STUDENT_ID);
  });

  it('E2: clicking lever from Students mode switches to Furniture', () => {
    act(() => { usePijonStore.setState({ activeEditorId: STUDENT_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    act(() => { fireEvent.click(screen.getByTestId('editor-mode-lever')); });
    expect(usePijonStore.getState().activeEditorId).toBe(FURNITURE_ID);
  });

  it('E3: two lever clicks return to original mode', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const lever = screen.getByTestId('editor-mode-lever');
    act(() => { fireEvent.click(lever); });
    expect(usePijonStore.getState().activeEditorId).toBe(STUDENT_ID);
    act(() => { fireEvent.click(lever); });
    expect(usePijonStore.getState().activeEditorId).toBe(FURNITURE_ID);
  });
});

// ---------------------------------------------------------------------------
// F. Accessibility
// ---------------------------------------------------------------------------

describe('F. Accessibility', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('F1: group has role="group" and aria-label="Editor mode"', () => {
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const group = screen.getByRole('group', { name: /editor mode/i });
    expect(group).toBeInTheDocument();
  });

  it('F2: lever has aria-pressed attribute (switch semantics)', () => {
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const lever = screen.getByTestId('editor-mode-lever');
    const pressed = lever.getAttribute('aria-pressed');
    expect(pressed === 'true' || pressed === 'false').toBe(true);
  });

  it('F3: Furniture label is a button element', () => {
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const furnitureLabel = screen.getByTestId('editor-mode-furniture');
    expect(furnitureLabel.tagName.toLowerCase()).toBe('button');
  });

  it('F3b: Students label is a button element', () => {
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const studentsLabel = screen.getByTestId('editor-mode-students');
    expect(studentsLabel.tagName.toLowerCase()).toBe('button');
  });

  it('F4: no tablist / tab roles (not a tab-based switcher)', () => {
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(document.querySelector('[role="tab"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// G. Assigner lever (StudentEditor) is UNCHANGED
// ---------------------------------------------------------------------------

describe('G. Assigner toggle lever in StudentEditor is unchanged', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('G1: assigner lever still renders with testid="assigner-toggle-lever"', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(React.createElement(StudentEditor.Toolbar, { ctx }));
    expect(screen.getByTestId('assigner-toggle-lever')).toBeInTheDocument();
    StudentEditor.deactivate(ctx);
  });

  it('G2: assigner lever shows "Assigner" text when OFF', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(React.createElement(StudentEditor.Toolbar, { ctx }));
    const lever = screen.getByTestId('assigner-toggle-lever');
    // When OFF it shows labelOff = "Assigner"
    expect(lever.textContent).toContain('Assigner');
    StudentEditor.deactivate(ctx);
  });

  it('G3: assigner lever has aria-pressed attribute (toggle semantics)', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(React.createElement(StudentEditor.Toolbar, { ctx }));
    const lever = screen.getByTestId('assigner-toggle-lever');
    const pressed = lever.getAttribute('aria-pressed');
    // Must be "true" or "false"
    expect(pressed === 'true' || pressed === 'false').toBe(true);
    StudentEditor.deactivate(ctx);
  });

  it('G3b: assigner lever starts with aria-pressed="false" (off by default)', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(React.createElement(StudentEditor.Toolbar, { ctx }));
    const lever = screen.getByTestId('assigner-toggle-lever');
    expect(lever.getAttribute('aria-pressed')).toBe('false');
    StudentEditor.deactivate(ctx);
  });

  it('G4: clicking assigner lever toggles it to aria-pressed="true"', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(React.createElement(StudentEditor.Toolbar, { ctx }));
    const lever = screen.getByTestId('assigner-toggle-lever');
    act(() => { fireEvent.click(lever); });
    expect(lever.getAttribute('aria-pressed')).toBe('true');
    StudentEditor.deactivate(ctx);
  });

  it('G4b: clicking assigner lever twice returns to aria-pressed="false"', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(React.createElement(StudentEditor.Toolbar, { ctx }));
    const lever = screen.getByTestId('assigner-toggle-lever');
    act(() => { fireEvent.click(lever); });
    act(() => { fireEvent.click(lever); });
    expect(lever.getAttribute('aria-pressed')).toBe('false');
    StudentEditor.deactivate(ctx);
  });

  it('G: assigner lever is visually distinct (editor-mode-lever absent in StudentEditor toolbar)', () => {
    // The editor-mode-lever is in TopBar, NOT in StudentEditor.Toolbar
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    const { container } = render(React.createElement(StudentEditor.Toolbar, { ctx }));
    expect(container.querySelector('[data-testid="editor-mode-lever"]')).toBeNull();
    expect(container.querySelector('[data-testid="editor-mode-furniture"]')).toBeNull();
    expect(container.querySelector('[data-testid="editor-mode-students"]')).toBeNull();
    StudentEditor.deactivate(ctx);
  });
});

// ---------------------------------------------------------------------------
// H. Mutation probes — confirm emphasis logic is not vacuous
// ---------------------------------------------------------------------------

describe('H. Mutation probes (would fail if emphasis logic were inverted)', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('H1: when Furniture is active, Furniture label is bold (NOT 400)', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const furnitureLabel = screen.getByTestId('editor-mode-furniture');
    expect((furnitureLabel as HTMLButtonElement).style.fontWeight).not.toBe('400');
    expect((furnitureLabel as HTMLButtonElement).style.fontWeight).toBe('700');
  });

  it('H2: when Furniture is active, Students label is NOT bold', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const studentsLabel = screen.getByTestId('editor-mode-students');
    expect((studentsLabel as HTMLButtonElement).style.fontWeight).not.toBe('700');
    expect((studentsLabel as HTMLButtonElement).style.fontWeight).toBe('400');
  });

  it('H3a: Furniture active = lever aria-pressed false (OFF), not true', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    expect(screen.getByTestId('editor-mode-lever').getAttribute('aria-pressed')).not.toBe('true');
  });

  it('H3b: Students active = lever aria-pressed true (ON), not false', () => {
    act(() => { usePijonStore.setState({ activeEditorId: STUDENT_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    expect(screen.getByTestId('editor-mode-lever').getAttribute('aria-pressed')).not.toBe('false');
  });

  it('H4: clicking Students label from Furniture mode sets Students active (not null, not furniture)', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    act(() => { fireEvent.click(screen.getByTestId('editor-mode-students')); });
    const newId = usePijonStore.getState().activeEditorId;
    expect(newId).not.toBeNull();
    expect(newId).not.toBe(FURNITURE_ID);
    expect(newId).toBe(STUDENT_ID);
  });

  it('H5: lever knob position (on prop) is OFF when Furniture is active — not always ON', () => {
    // Catches mutation: on={true} always. The ToggleLever knob left position is
    // 2px when off, 16px when on. We check the knob span style.left directly.
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const lever = screen.getByTestId('editor-mode-lever');
    // Lever is OFF: background of the track should be #ccc (not the activeColor)
    // The knob child (inner span of the track span) has left:2 when OFF, left:16 when ON.
    const trackSpan = lever.querySelector('span');
    expect(trackSpan).not.toBeNull();
    const knobSpan = trackSpan?.querySelector('span');
    expect(knobSpan).not.toBeNull();
    // When OFF: knob left=2px
    expect((knobSpan as HTMLElement).style.left).toBe('2px');
  });

  it('H6: lever knob position (on prop) is ON when Students is active — not always OFF', () => {
    act(() => { usePijonStore.setState({ activeEditorId: STUDENT_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const lever = screen.getByTestId('editor-mode-lever');
    const trackSpan = lever.querySelector('span');
    expect(trackSpan).not.toBeNull();
    const knobSpan = trackSpan?.querySelector('span');
    expect(knobSpan).not.toBeNull();
    // When ON: knob left=16px
    expect((knobSpan as HTMLElement).style.left).toBe('16px');
  });
});

// ---------------------------------------------------------------------------
// I. DOM order — Furniture left, lever center, Students right
// ---------------------------------------------------------------------------

describe('I. DOM order: Furniture [lever] Students flanking layout', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('I1: within the editor-mode group, Furniture label precedes the lever in the DOM', () => {
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const group = screen.getByRole('group', { name: /editor mode/i });
    const children = Array.from(group.children);
    const furnitureIdx = children.findIndex((el) => el.getAttribute('data-testid') === 'editor-mode-furniture');
    const leverIdx = children.findIndex((el) => el.getAttribute('data-testid') === 'editor-mode-lever');
    expect(furnitureIdx).toBeGreaterThanOrEqual(0);
    expect(leverIdx).toBeGreaterThanOrEqual(0);
    expect(furnitureIdx).toBeLessThan(leverIdx);
  });

  it('I2: within the editor-mode group, Students label follows the lever in the DOM', () => {
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const group = screen.getByRole('group', { name: /editor mode/i });
    const children = Array.from(group.children);
    const leverIdx = children.findIndex((el) => el.getAttribute('data-testid') === 'editor-mode-lever');
    const studentsIdx = children.findIndex((el) => el.getAttribute('data-testid') === 'editor-mode-students');
    expect(leverIdx).toBeGreaterThanOrEqual(0);
    expect(studentsIdx).toBeGreaterThanOrEqual(0);
    expect(studentsIdx).toBeGreaterThan(leverIdx);
  });

  it('I3: the editor-mode group appears after the logo and before the trailing group in the top-bar', () => {
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const topBar = screen.getByTestId('top-bar');
    const children = Array.from(topBar.children);
    const logoIdx = children.findIndex((el) => el.querySelector('[data-testid="logo-text"]') !== null);
    const groupIdx = children.findIndex(
      (el) => el.getAttribute('role') === 'group' && el.getAttribute('aria-label') === 'Editor mode',
    );
    const trailingIdx = children.findIndex((el) => el.getAttribute('data-testid') === 'top-bar-right');
    expect(logoIdx).toBeGreaterThanOrEqual(0);
    expect(groupIdx).toBeGreaterThan(logoIdx);
    expect(trailingIdx).toBeGreaterThan(groupIdx);
  });
});

// ---------------------------------------------------------------------------
// J. Idempotency — clicking already-active label does not break state
// ---------------------------------------------------------------------------

describe('J. Idempotency: clicking the already-active label is safe', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('J1: clicking Furniture label when already in Furniture mode keeps Furniture active', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    act(() => { fireEvent.click(screen.getByTestId('editor-mode-furniture')); });
    expect(usePijonStore.getState().activeEditorId).toBe(FURNITURE_ID);
  });

  it('J2: clicking Students label when already in Students mode keeps Students active', () => {
    act(() => { usePijonStore.setState({ activeEditorId: STUDENT_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    act(() => { fireEvent.click(screen.getByTestId('editor-mode-students')); });
    expect(usePijonStore.getState().activeEditorId).toBe(STUDENT_ID);
  });

  it('J3: clicking Furniture when active does NOT switch to Students', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    act(() => { fireEvent.click(screen.getByTestId('editor-mode-furniture')); });
    expect(usePijonStore.getState().activeEditorId).not.toBe(STUDENT_ID);
  });
});

// ---------------------------------------------------------------------------
// K. Themed accent — active label color references the selectedBox CSS var
// ---------------------------------------------------------------------------

describe('K. Themed accent: active label uses selectedBox CSS variable', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('K1: active Furniture label color contains --pj-selectedBox (not a hardcoded blue)', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const furnitureLabel = screen.getByTestId('editor-mode-furniture');
    // The color is set via CSS var string: 'var(--pj-selectedBox, #1565c0)'
    // jsdom preserves the var() token in element.style
    expect(furnitureLabel.style.color).toContain('--pj-selectedBox');
  });

  it('K2: active Students label color contains --pj-selectedBox (not a hardcoded blue)', () => {
    act(() => { usePijonStore.setState({ activeEditorId: STUDENT_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const studentsLabel = screen.getByTestId('editor-mode-students');
    expect(studentsLabel.style.color).toContain('--pj-selectedBox');
  });

  it('K3: inactive label color does NOT use the selectedBox accent (uses textMuted)', () => {
    act(() => { usePijonStore.setState({ activeEditorId: FURNITURE_ID }); });
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx: makeCtx() }));
    const studentsLabel = screen.getByTestId('editor-mode-students');
    // Inactive: not using the accent
    expect(studentsLabel.style.color).not.toContain('--pj-selectedBox');
  });
});
