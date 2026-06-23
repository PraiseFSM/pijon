// @vitest-environment jsdom
/**
 * Tests for Cluster B — Students editor restructure (§5.B1–§5.B4).
 *
 * §5.B1  No RightPanel; assigner toggle + pref list live inline in SidePanel.
 * §5.B2  No add-preference form; prefs created only via assigner mode + drag.
 * §5.B3  Weight selector = four fixed options {-2,-1,+1,+2} in the toolbar.
 * §5.B4  Toolbar: single Allocate button, weight selectors, Export/Import .pijon,
 *         Settings gear (algorithm, variant, Show Links).
 *
 * Local-first: no network calls in any test path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { StudentEditor } from '../ui/editors/StudentEditor.js';
import type { EditorContext, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import type { FurnitureId } from '../domain/types.js';
import type { PersistenceHandle } from '../state/persistence.js';
import { studentId as mkStudentId } from '../domain/types.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const makeSid = (raw: string) => mkStudentId(raw);

const makeStoreMock = (overrides?: Partial<Store>): Store =>
  ({
    roster: [],
    locks: new Set<FurnitureId>(),
    selectedStudentId: null,
    classroom: {
      id: 'test-classroom',
      name: 'Test',
      gridW: 5,
      gridH: 5,
      furniture: [],
      cellsPerUnit: 1,
      thresholdUnits: 1.5,
    },
    history: [],
    historyPtr: 0,
    showViolations: true,
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
    ...overrides,
  } as unknown as Store);

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

const makePersistenceMock = (): PersistenceHandle => ({
  resaveToHandle: vi.fn(() => Promise.resolve()),
  saveToFile: vi.fn(() => Promise.resolve()),
  openFromFile: vi.fn(() => Promise.resolve()),
  eraseAll: vi.fn(() => Promise.resolve()),
  destroy: vi.fn(),
});

const makeCtx = (overrides?: Partial<Store>, persistence?: PersistenceHandle | null): EditorContext => ({
  store: makeStoreMock(overrides),
  canvas: makeCanvasMock(),
  persistence: persistence ?? null,
});

// ---------------------------------------------------------------------------
// §5.B1 — No RightPanel; assigner toggle in SidePanel
// ---------------------------------------------------------------------------

describe('§5.B1 RightPanel removal', () => {
  it('StudentEditor.RightPanel is undefined', () => {
    expect(StudentEditor.RightPanel).toBeUndefined();
  });

  it('StudentEditor.SidePanel is defined', () => {
    expect(StudentEditor.SidePanel).toBeDefined();
  });
});

describe('§6.A3 Assigner toggle lever in Toolbar (moved from SidePanel)', () => {
  // §6.A3: assigner toggle is now a lever in the top bar, NOT in the SidePanel.
  const alice = {
    id: makeSid('alice-b1'),
    name: 'Alice',
    isFixture: false,
    preferences: [] as { kind: 'student'; targetId: ReturnType<typeof makeSid>; weight: number }[],
    metadata: {} as Record<string, unknown>,
  };

  let ctx: EditorContext;

  beforeEach(() => {
    ctx = makeCtx({ roster: [alice], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);
  });

  afterEach(() => {
    StudentEditor.deactivate(ctx);
  });

  it('shows the assigner toggle lever in the Toolbar regardless of selection', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    expect(screen.getByTestId('assigner-toggle-lever')).toBeInTheDocument();
  });

  it('assigner lever is NOT inside the SidePanel student-pref-detail section', () => {
    render(<StudentEditor.SidePanel ctx={ctx} />);
    const detail = document.querySelector('[data-testid="student-pref-detail"]');
    expect(detail).toBeTruthy();
    // Assigner toggle should NOT be inside the pref detail
    const leverInDetail = detail?.querySelector('[data-testid="assigner-toggle-lever"]');
    expect(leverInDetail).toBeNull();
  });

  it('toggling assigner lever ON sets aria-pressed=true', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    const lever = screen.getByTestId('assigner-toggle-lever');
    expect(lever.getAttribute('aria-pressed')).toBe('false');
    act(() => { fireEvent.click(lever); });
    expect(lever.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows pref detail section (data-testid="student-pref-detail") for selected student', () => {
    render(<StudentEditor.SidePanel ctx={ctx} />);
    expect(document.querySelector('[data-testid="student-pref-detail"]')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// §5.B1 Inline pref list under selected student
// ---------------------------------------------------------------------------

describe('§5.B1 Inline pref list in SidePanel', () => {
  const bob = { id: makeSid('bob-b1'), name: 'Bob', isFixture: false, preferences: [], metadata: {} as Record<string, unknown> };
  const alice = {
    id: makeSid('alice-pref-b1'),
    name: 'Alice',
    isFixture: false,
    preferences: [{ kind: 'student' as const, targetId: bob.id, weight: -1.0 }],
    metadata: {} as Record<string, unknown>,
  };

  let ctx: EditorContext;

  beforeEach(() => {
    ctx = makeCtx({ roster: [alice, bob], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);
  });

  afterEach(() => {
    StudentEditor.deactivate(ctx);
  });

  it('renders preference entries inline below selected student', () => {
    render(<StudentEditor.SidePanel ctx={ctx} />);
    // §6.A2: pref rows now show WeightSelector buttons + target name (no "↓ Avoid" label)
    // Bob appears as the target name in the pref row (also in roster, so use getAllByText)
    expect(screen.getAllByText('Bob').length).toBeGreaterThan(0);
    // Weight selector buttons should appear in the pref row
    expect(document.querySelector('[data-testid="pref-row-0-weight-btn--1"]')).toBeTruthy();
  });

  it('renders ✕ remove buttons for each pref', () => {
    render(<StudentEditor.SidePanel ctx={ctx} />);
    const removeBtns = screen.getAllByTitle('Remove this preference');
    expect(removeBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('calls clearMutualPreference when ✕ is clicked', () => {
    render(<StudentEditor.SidePanel ctx={ctx} />);
    const removeBtn = screen.getAllByTitle('Remove this preference')[0]!;
    act(() => { fireEvent.click(removeBtn); });
    expect(ctx.store.clearMutualPreference).toHaveBeenCalledWith(alice.id, bob.id);
  });
});

// ---------------------------------------------------------------------------
// §5.B2 — No add-preference form
// ---------------------------------------------------------------------------

describe('§6.A2 Add-preference control in SidePanel', () => {
  // §6.A2: the redesigned pref detail includes an add-student select + Add button
  // when there are students not yet linked.
  const alice = { id: makeSid('alice-b2'), name: 'Alice', isFixture: false, preferences: [], metadata: {} as Record<string, unknown> };
  const bob = { id: makeSid('bob-b2'), name: 'Bob', isFixture: false, preferences: [], metadata: {} as Record<string, unknown> };

  let ctx: EditorContext;

  beforeEach(() => {
    ctx = makeCtx({ roster: [alice, bob], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);
  });

  afterEach(() => {
    StudentEditor.deactivate(ctx);
  });

  it('shows an add-pref combobox when there are linkable students', () => {
    render(<StudentEditor.SidePanel ctx={ctx} />);
    // Bob is not yet linked to Alice — select should appear
    expect(screen.queryByTestId('add-pref-select')).toBeInTheDocument();
  });

  it('has an Add button for adding a preference', () => {
    render(<StudentEditor.SidePanel ctx={ctx} />);
    expect(screen.queryByTestId('add-pref-btn')).toBeInTheDocument();
  });

  it('selecting a student and clicking Add calls setMutualPreference', () => {
    render(<StudentEditor.SidePanel ctx={ctx} />);
    const select = screen.getByTestId('add-pref-select');
    act(() => { fireEvent.change(select, { target: { value: bob.id } }); });
    const addBtn = screen.getByTestId('add-pref-btn');
    act(() => { fireEvent.click(addBtn); });
    expect(ctx.store.setMutualPreference).toHaveBeenCalledWith(alice.id, bob.id, expect.any(Number));
  });
});

// ---------------------------------------------------------------------------
// §5.B3 — Weight selector in toolbar: four fixed buttons {-2,-1,+1,+2}
// ---------------------------------------------------------------------------

describe('§5.B3 Weight selector in toolbar', () => {
  let ctx: EditorContext;

  beforeEach(() => {
    ctx = makeCtx();
    StudentEditor.activate(ctx);
  });

  afterEach(() => {
    StudentEditor.deactivate(ctx);
  });

  it('renders four weight buttons: -2, -1, +1, +2', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    expect(screen.getByTestId('weight-btn--2')).toBeInTheDocument();
    expect(screen.getByTestId('weight-btn--1')).toBeInTheDocument();
    expect(screen.getByTestId('weight-btn-1')).toBeInTheDocument();
    expect(screen.getByTestId('weight-btn-2')).toBeInTheDocument();
  });

  it('weight button -1 is active by default (aria-pressed=true)', () => {
    // Default currentWeight is -1.0 (Avoid)
    render(<StudentEditor.Toolbar ctx={ctx} />);
    const btn = screen.getByTestId('weight-btn--1');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('other weight buttons are not active by default', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    const btn2 = screen.getByTestId('weight-btn-2');
    expect(btn2.getAttribute('aria-pressed')).toBe('false');
    const btn1 = screen.getByTestId('weight-btn-1');
    expect(btn1.getAttribute('aria-pressed')).toBe('false');
    const btnN2 = screen.getByTestId('weight-btn--2');
    expect(btnN2.getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking -2 makes it active (aria-pressed=true) and deactivates others', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('weight-btn--2')); });
    const btnN2 = screen.getByTestId('weight-btn--2');
    expect(btnN2.getAttribute('aria-pressed')).toBe('true');
    // -1 (the previous default) should no longer be active
    const btnN1 = screen.getByTestId('weight-btn--1');
    expect(btnN1.getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking -1 makes it active', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('weight-btn--1')); });
    const btnN1 = screen.getByTestId('weight-btn--1');
    expect(btnN1.getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking +2 makes it active', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('weight-btn-2')); });
    const btn2 = screen.getByTestId('weight-btn-2');
    expect(btn2.getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking a weight button updates active weight (reflected by aria-pressed)', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    // Start at -1 (default)
    expect((screen.getByTestId('weight-btn--1')).getAttribute('aria-pressed')).toBe('true');
    // Click +2
    act(() => { fireEvent.click(screen.getByTestId('weight-btn-2')); });
    expect((screen.getByTestId('weight-btn-2')).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByTestId('weight-btn--1')).getAttribute('aria-pressed')).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// §5.B4 — Toolbar order and single Allocate button
// ---------------------------------------------------------------------------

describe('§5.B4 Toolbar: single Allocate button', () => {
  let ctx: EditorContext;

  beforeEach(() => {
    ctx = makeCtx();
    StudentEditor.activate(ctx);
  });

  afterEach(() => {
    StudentEditor.deactivate(ctx);
  });

  it('renders a single Allocate button (data-testid="allocate-btn")', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    expect(screen.getByTestId('allocate-btn')).toBeInTheDocument();
  });

  it('clicking Allocate calls store.allocate', () => {
    const allocate = vi.fn();
    const ctxA = makeCtx({ allocate });
    StudentEditor.activate(ctxA);
    render(<StudentEditor.Toolbar ctx={ctxA} />);
    act(() => { fireEvent.click(screen.getByTestId('allocate-btn')); });
    expect(allocate).toHaveBeenCalledTimes(1);
    StudentEditor.deactivate(ctxA);
  });

  it('no SplitButton caret (split-btn-caret) exists', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    expect(screen.queryByTestId('split-btn-caret')).not.toBeInTheDocument();
  });

  it('no SplitButton dropdown (split-btn-dropdown) exists', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    expect(screen.queryByTestId('split-btn-dropdown')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// §5.B4 — Export/Import .pijon buttons
// ---------------------------------------------------------------------------

describe('§5.B4 Export/Import .pijon project file', () => {
  it('Export button calls persistence.saveToFile()', async () => {
    const persistence = makePersistenceMock();
    const ctx = makeCtx({}, persistence);
    StudentEditor.activate(ctx);

    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('toolbar-export-pijon')); });

    // saveToFile should have been called once
    expect(persistence.saveToFile).toHaveBeenCalledTimes(1);

    StudentEditor.deactivate(ctx);
  });

  it('Import button calls persistence.openFromFile()', async () => {
    const persistence = makePersistenceMock();
    const ctx = makeCtx({}, persistence);
    StudentEditor.activate(ctx);

    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('toolbar-import-pijon')); });

    // openFromFile should have been called once
    expect(persistence.openFromFile).toHaveBeenCalledTimes(1);

    StudentEditor.deactivate(ctx);
  });

  it('Export button is rendered in the toolbar', () => {
    const persistence = makePersistenceMock();
    const ctx = makeCtx({}, persistence);
    StudentEditor.activate(ctx);
    render(<StudentEditor.Toolbar ctx={ctx} />);
    expect(screen.getByTestId('toolbar-export-pijon')).toBeInTheDocument();
    StudentEditor.deactivate(ctx);
  });

  it('Import button is rendered in the toolbar', () => {
    const persistence = makePersistenceMock();
    const ctx = makeCtx({}, persistence);
    StudentEditor.activate(ctx);
    render(<StudentEditor.Toolbar ctx={ctx} />);
    expect(screen.getByTestId('toolbar-import-pijon')).toBeInTheDocument();
    StudentEditor.deactivate(ctx);
  });

  it('Export button does not crash when persistence is null', () => {
    const ctx = makeCtx({}, null);
    StudentEditor.activate(ctx);
    render(<StudentEditor.Toolbar ctx={ctx} />);
    // Should not throw (warns to console instead)
    expect(() => {
      act(() => { fireEvent.click(screen.getByTestId('toolbar-export-pijon')); });
    }).not.toThrow();
    StudentEditor.deactivate(ctx);
  });
});

// ---------------------------------------------------------------------------
// §5.B4 — Settings menu: algorithm, variant, Show Links
// ---------------------------------------------------------------------------

describe('§5.B4 SettingsMenu controls', () => {
  let ctx: EditorContext;

  beforeEach(() => {
    ctx = makeCtx();
    StudentEditor.activate(ctx);
  });

  afterEach(() => {
    StudentEditor.deactivate(ctx);
  });

  function openSettings() {
    fireEvent.click(screen.getByTestId('settings-gear-button'));
  }

  it('settings gear button renders in toolbar', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    expect(screen.getByTestId('settings-gear-button')).toBeInTheDocument();
  });

  it('settings menu is hidden initially', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    expect(screen.queryByTestId('settings-menu')).not.toBeInTheDocument();
  });

  it('clicking gear opens settings menu', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    openSettings();
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument();
  });

  it('algorithm greedy radio is checked by default', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    openSettings();
    // Use getAllByRole to get typed HTMLInputElement so .checked is available
    const radios = screen.getAllByRole('radio');
    const greedyRadio = radios.find((r) => r.getAttribute('data-testid') === 'settings-algorithm-greedy');
    expect((greedyRadio as HTMLInputElement | undefined)?.checked).toBe(true);
  });

  it('switching algorithm to bogo marks bogo as checked', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    openSettings();
    fireEvent.click(screen.getByTestId('settings-algorithm-bogo'));
    const radios = screen.getAllByRole('radio');
    const bogoRadio = radios.find((r) => r.getAttribute('data-testid') === 'settings-algorithm-bogo');
    expect((bogoRadio as HTMLInputElement | undefined)?.checked).toBe(true);
  });

  it('variant allocate radio is checked by default', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    openSettings();
    const radios = screen.getAllByRole('radio');
    const allocateRadio = radios.find((r) => r.getAttribute('data-testid') === 'settings-variant-allocate');
    expect((allocateRadio as HTMLInputElement | undefined)?.checked).toBe(true);
  });

  it('switching variant to smart_shuffle marks smart_shuffle as checked', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    openSettings();
    fireEvent.click(screen.getByTestId('settings-variant-smart_shuffle'));
    const radios = screen.getAllByRole('radio');
    const shuffleRadio = radios.find((r) => r.getAttribute('data-testid') === 'settings-variant-smart_shuffle');
    expect((shuffleRadio as HTMLInputElement | undefined)?.checked).toBe(true);
  });

  it('switching variant to smart_shuffle and clicking Allocate calls store.smartShuffle', () => {
    const smartShuffle = vi.fn();
    const ctxS = makeCtx({ smartShuffle });
    StudentEditor.activate(ctxS);
    render(<StudentEditor.Toolbar ctx={ctxS} />);
    openSettings();
    fireEvent.click(screen.getByTestId('settings-variant-smart_shuffle'));
    fireEvent.click(screen.getByTestId('allocate-btn'));
    expect(smartShuffle).toHaveBeenCalledTimes(1);
    StudentEditor.deactivate(ctxS);
  });

  it('Show Links toggle starts OFF', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    openSettings();
    const toggle = screen.getByTestId('settings-show-links-toggle');
    expect(toggle.textContent).toBe('OFF');
  });

  it('clicking Show Links toggle flips it to ON', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    openSettings();
    act(() => { fireEvent.click(screen.getByTestId('settings-show-links-toggle')); });
    expect(screen.getByTestId('settings-show-links-toggle').textContent).toBe('ON');
  });

  it('toggling Show Links ON then OFF returns to OFF', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    openSettings();
    act(() => { fireEvent.click(screen.getByTestId('settings-show-links-toggle')); });
    act(() => { fireEvent.click(screen.getByTestId('settings-show-links-toggle')); });
    expect(screen.getByTestId('settings-show-links-toggle').textContent).toBe('OFF');
  });

  it('aria-pressed on Show Links toggle matches state', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    openSettings();
    const toggle = screen.getByTestId('settings-show-links-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    act(() => { fireEvent.click(toggle); });
    expect(screen.getByTestId('settings-show-links-toggle').getAttribute('aria-pressed')).toBe('true');
  });
});
