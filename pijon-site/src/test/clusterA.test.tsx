// @vitest-environment jsdom
/**
 * Tests for Cluster A — Preference UI (§6.A1–§6.A4).
 *
 * §6.A1  WeightSelector shared component: 4 buttons, active highlighting,
 *        onChange fires correct value, testIdPrefix scoping.
 * §6.A2  PrefDetailPanel: one row per student-kind pref (name + WeightSelector + ✕),
 *        add-another-student control, changing row selector calls setMutualPreference,
 *        ✕ calls clearMutualPreference / removePreference depending on pref kind.
 * §6.A3  Assigner toggle lives in Toolbar (lever element), NOT in SidePanel.
 *        Top-bar WeightSelector drives currentWeight used by assigner two-click.
 * §6.A4  registerAssignerCursorListener: callback fires with true when assigner
 *        turns on, false when it turns off.
 *
 * Local-first: no network calls in any test path.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WeightSelector, WEIGHT_OPTIONS } from '../ui/components/WeightSelector.js';
import { StudentEditor, registerAssignerCursorListener } from '../ui/editors/StudentEditor.js';
import type { EditorContext, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import type { FurnitureId } from '../domain/types.js';
import type { PersistenceHandle } from '../state/persistence.js';
import { studentId as mkStudentId, furnitureId as mkFurnitureId } from '../domain/types.js';
import { DEFAULT_CELLS_PER_UNIT, DEFAULT_THRESHOLD_UNITS } from '../domain/classroom.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const makeSid = (raw: string) => mkStudentId(raw);
const makeFid = (raw: string) => mkFurnitureId(raw);

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
      cellsPerUnit: DEFAULT_CELLS_PER_UNIT,
      thresholdUnits: DEFAULT_THRESHOLD_UNITS,
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

const makeCtx = (
  storeOverrides?: Partial<Store>,
  persistence?: PersistenceHandle | null,
): EditorContext => ({
  store: makeStoreMock(storeOverrides),
  canvas: makeCanvasMock(),
  persistence: persistence ?? null,
});

// ---------------------------------------------------------------------------
// §6.A1 — WeightSelector component unit tests
// ---------------------------------------------------------------------------

describe('§6.A1 WeightSelector component', () => {
  it('renders exactly 4 buttons (one per WEIGHT_OPTIONS entry)', () => {
    const onChange = vi.fn();
    render(<WeightSelector value={-1} onChange={onChange} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(WEIGHT_OPTIONS.length);
    expect(WEIGHT_OPTIONS).toHaveLength(4);
  });

  it('the active button (matching value) has aria-pressed=true; others false', () => {
    const onChange = vi.fn();
    render(<WeightSelector value={1} onChange={onChange} />);
    expect(screen.getByTestId('weight-btn-1').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('weight-btn--1').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('weight-btn-2').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('weight-btn--2').getAttribute('aria-pressed')).toBe('false');
  });

  it('onChange fires with -2 when the -2 button is clicked', () => {
    const onChange = vi.fn();
    render(<WeightSelector value={1} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('weight-btn--2'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(-2);
  });

  it('onChange fires with -1 when the -1 button is clicked', () => {
    const onChange = vi.fn();
    render(<WeightSelector value={2} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('weight-btn--1'));
    expect(onChange).toHaveBeenCalledWith(-1);
  });

  it('onChange fires with +1 when the +1 button is clicked', () => {
    const onChange = vi.fn();
    render(<WeightSelector value={-1} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('weight-btn-1'));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('onChange fires with +2 when the +2 button is clicked', () => {
    const onChange = vi.fn();
    render(<WeightSelector value={-1} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('weight-btn-2'));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('testIdPrefix scopes all testids (e.g. "row-0-" → "row-0-weight-btn-1")', () => {
    const onChange = vi.fn();
    render(<WeightSelector value={-1} onChange={onChange} testIdPrefix="row-0-" />);
    expect(screen.getByTestId('row-0-weight-btn--2')).toBeInTheDocument();
    expect(screen.getByTestId('row-0-weight-btn--1')).toBeInTheDocument();
    expect(screen.getByTestId('row-0-weight-btn-1')).toBeInTheDocument();
    expect(screen.getByTestId('row-0-weight-btn-2')).toBeInTheDocument();
    // Without prefix should NOT exist
    expect(document.querySelector('[data-testid="weight-btn-1"]')).toBeNull();
  });

  it('two WeightSelector instances with different prefixes coexist without collision', () => {
    const onChangeA = vi.fn();
    const onChangeB = vi.fn();
    render(
      <>
        <WeightSelector value={-1} onChange={onChangeA} testIdPrefix="a-" />
        <WeightSelector value={2} onChange={onChangeB} testIdPrefix="b-" />
      </>,
    );
    // Both sets of buttons present
    expect(screen.getByTestId('a-weight-btn--1')).toBeInTheDocument();
    expect(screen.getByTestId('b-weight-btn-2')).toBeInTheDocument();
    // a-prefix: -1 active; b-prefix: +2 active
    expect(screen.getByTestId('a-weight-btn--1').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('b-weight-btn-2').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('a-weight-btn-2').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('b-weight-btn--1').getAttribute('aria-pressed')).toBe('false');
  });

  it('compact prop renders without error and buttons still functional', () => {
    const onChange = vi.fn();
    render(<WeightSelector value={-1} onChange={onChange} compact />);
    fireEvent.click(screen.getByTestId('weight-btn-1'));
    expect(onChange).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// §6.A2 — PrefDetailPanel in SidePanel
// ---------------------------------------------------------------------------

describe('§6.A2 PrefDetailPanel inline preferences', () => {
  const alice = {
    id: makeSid('alice-a2'),
    name: 'Alice',
    isFixture: false,
    preferences: [] as { kind: 'student'; targetId: ReturnType<typeof makeSid>; weight: number }[],
    metadata: {} as Record<string, unknown>,
  };
  const bob = {
    id: makeSid('bob-a2'),
    name: 'Bob',
    isFixture: false,
    preferences: [] as typeof alice.preferences,
    metadata: {} as Record<string, unknown>,
  };

  afterEach(() => {
    StudentEditor.deactivate(makeCtx());
  });

  it('shows placeholder text when selected student has no prefs', () => {
    const ctx = makeCtx({ roster: [alice], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);
    expect(screen.getByText(/no preferences yet/i)).toBeInTheDocument();
    StudentEditor.deactivate(ctx);
  });

  it('does NOT show placeholder when student has a pref', () => {
    const aliceWithPref = {
      ...alice,
      preferences: [{ kind: 'student' as const, targetId: bob.id, weight: -1 }],
    };
    const ctx = makeCtx({ roster: [aliceWithPref, bob], selectedStudentId: aliceWithPref.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);
    expect(screen.queryByText(/no preferences yet/i)).toBeNull();
    StudentEditor.deactivate(ctx);
  });

  it('shows target student name in pref row', () => {
    const aliceWithPref = {
      ...alice,
      preferences: [{ kind: 'student' as const, targetId: bob.id, weight: -1 }],
    };
    const ctx = makeCtx({ roster: [aliceWithPref, bob], selectedStudentId: aliceWithPref.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);
    // Target name appears in the pref detail (may also appear in roster)
    expect(screen.getAllByText('Bob').length).toBeGreaterThan(0);
    StudentEditor.deactivate(ctx);
  });

  it('shows WeightSelector for each student-kind pref row (compact, prefixed)', () => {
    const aliceWithPref = {
      ...alice,
      preferences: [{ kind: 'student' as const, targetId: bob.id, weight: 2 }],
    };
    const ctx = makeCtx({ roster: [aliceWithPref, bob], selectedStudentId: aliceWithPref.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);
    // Row 0 weight selector: active on +2
    expect(screen.getByTestId('pref-row-0-weight-btn-2').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('pref-row-0-weight-btn--1').getAttribute('aria-pressed')).toBe('false');
    StudentEditor.deactivate(ctx);
  });

  it('clicking row WeightSelector calls setMutualPreference with new weight', () => {
    const aliceWithPref = {
      ...alice,
      preferences: [{ kind: 'student' as const, targetId: bob.id, weight: -1 }],
    };
    const ctx = makeCtx({ roster: [aliceWithPref, bob], selectedStudentId: aliceWithPref.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);

    act(() => { fireEvent.click(screen.getByTestId('pref-row-0-weight-btn-2')); });

    expect(ctx.store.setMutualPreference).toHaveBeenCalledWith(aliceWithPref.id, bob.id, 2);
    StudentEditor.deactivate(ctx);
  });

  it('clicking row ✕ button calls clearMutualPreference for student-kind pref', () => {
    const aliceWithPref = {
      ...alice,
      preferences: [{ kind: 'student' as const, targetId: bob.id, weight: -1 }],
    };
    const ctx = makeCtx({ roster: [aliceWithPref, bob], selectedStudentId: aliceWithPref.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);

    act(() => { fireEvent.click(screen.getByTestId('pref-row-0-remove')); });

    expect(ctx.store.clearMutualPreference).toHaveBeenCalledWith(aliceWithPref.id, bob.id);
    expect(ctx.store.removePreference).not.toHaveBeenCalled();
    StudentEditor.deactivate(ctx);
  });

  it('clicking ✕ button calls removePreference for furniture-kind pref', () => {
    const deskId = makeFid('desk-a2') as unknown as ReturnType<typeof makeSid>;
    const aliceWithFurniturePref = {
      ...alice,
      preferences: [{ kind: 'furniture' as const, targetId: deskId, weight: 1 }],
    };
    const ctx = makeCtx({ roster: [aliceWithFurniturePref], selectedStudentId: aliceWithFurniturePref.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);

    const removeBtns = screen.getAllByTitle('Remove this preference');
    act(() => { fireEvent.click(removeBtns[0]!); });

    expect(ctx.store.removePreference).toHaveBeenCalledWith(aliceWithFurniturePref.id, deskId);
    expect(ctx.store.clearMutualPreference).not.toHaveBeenCalled();
    StudentEditor.deactivate(ctx);
  });

  it('shows add-pref select and Add button when other unlinked students exist', () => {
    const ctx = makeCtx({ roster: [alice, bob], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);

    expect(screen.getByTestId('add-pref-select')).toBeInTheDocument();
    expect(screen.getByTestId('add-pref-btn')).toBeInTheDocument();
    StudentEditor.deactivate(ctx);
  });

  it('clicking Add after selecting a student calls setMutualPreference', () => {
    const ctx = makeCtx({ roster: [alice, bob], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);

    // Render the Toolbar too so currentWeight is wired (default -1)
    render(<StudentEditor.Toolbar ctx={ctx} />);

    const select = screen.getByTestId('add-pref-select');
    act(() => { fireEvent.change(select, { target: { value: bob.id } }); });
    act(() => { fireEvent.click(screen.getByTestId('add-pref-btn')); });

    expect(ctx.store.setMutualPreference).toHaveBeenCalledWith(alice.id, bob.id, expect.any(Number));
    StudentEditor.deactivate(ctx);
  });
});

// ---------------------------------------------------------------------------
// §6.A3 — Assigner toggle lever in Toolbar (not SidePanel)
// ---------------------------------------------------------------------------

describe('§6.A3 Assigner toggle lever in Toolbar', () => {
  const ctx = makeCtx();

  afterEach(() => {
    StudentEditor.deactivate(ctx);
  });

  it('Toolbar renders the assigner-toggle-lever element', () => {
    StudentEditor.activate(ctx);
    render(<StudentEditor.Toolbar ctx={ctx} />);
    expect(screen.getByTestId('assigner-toggle-lever')).toBeInTheDocument();
  });

  it('lever starts with aria-pressed=false (assigner OFF by default)', () => {
    StudentEditor.activate(ctx);
    render(<StudentEditor.Toolbar ctx={ctx} />);
    expect(screen.getByTestId('assigner-toggle-lever').getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking lever flips aria-pressed to true (assigner ON)', () => {
    StudentEditor.activate(ctx);
    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });
    expect(screen.getByTestId('assigner-toggle-lever').getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking lever twice returns aria-pressed to false (toggle OFF)', () => {
    StudentEditor.activate(ctx);
    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });
    expect(screen.getByTestId('assigner-toggle-lever').getAttribute('aria-pressed')).toBe('false');
  });

  it('SidePanel does NOT contain the assigner-toggle-lever', () => {
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);
    expect(document.querySelector('[data-testid="assigner-toggle-lever"]')).toBeNull();
  });

  it('pref-detail section does NOT contain the assigner-toggle-lever when student is selected', () => {
    const alice = {
      id: makeSid('alice-a3'),
      name: 'Alice',
      isFixture: false,
      preferences: [],
      metadata: {} as Record<string, unknown>,
    };
    const ctx2 = makeCtx({ roster: [alice], selectedStudentId: alice.id });
    StudentEditor.activate(ctx2);
    render(<StudentEditor.SidePanel ctx={ctx2} />);

    const detail = document.querySelector('[data-testid="student-pref-detail"]');
    expect(detail).toBeTruthy();
    expect(detail!.querySelector('[data-testid="assigner-toggle-lever"]')).toBeNull();
    StudentEditor.deactivate(ctx2);
  });

  it('top-bar WeightSelector still drives currentWeight used in assigner two-click', () => {
    const alice = {
      id: makeSid('alice-a3-w'),
      name: 'Alice',
      isFixture: false,
      preferences: [],
      metadata: {} as Record<string, unknown>,
    };
    const bob = {
      id: makeSid('bob-a3-w'),
      name: 'Bob',
      isFixture: false,
      preferences: [],
      metadata: {} as Record<string, unknown>,
    };
    const desk1Fid = makeFid('desk-a3-1');
    const desk2Fid = makeFid('desk-a3-2');
    const store = makeStoreMock({ roster: [alice, bob], selectedStudentId: alice.id });
    (store as { classroom: typeof store.classroom }).classroom = {
      id: 'test-classroom',
      name: 'Test',
      gridW: 5,
      gridH: 5,
      cellsPerUnit: DEFAULT_CELLS_PER_UNIT,
      thresholdUnits: DEFAULT_THRESHOLD_UNITS,
      furniture: [
        { id: desk1Fid, kind: 'single_desk', pos: { x: 0, y: 0 }, w: 1, h: 1, rotation: 0, occupants: [alice] },
        { id: desk2Fid, kind: 'single_desk', pos: { x: 1, y: 0 }, w: 1, h: 1, rotation: 0, occupants: [bob] },
      ],
    };
    const canvas = makeCanvasMock();
    const ctx3: EditorContext = { store, canvas, persistence: null };
    StudentEditor.activate(ctx3);

    render(<StudentEditor.Toolbar ctx={ctx3} />);

    // Click +2 in top-bar WeightSelector
    act(() => { fireEvent.click(screen.getByTestId('weight-btn-2')); });
    // Enable assigner mode via lever
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    // Two-click: desk1 → desk2
    (canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0, y: 0 });
    act(() => {
      StudentEditor.onPointerDown(new PointerEvent('pointerdown', { button: 0, bubbles: true }), ctx3);
    });
    (canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 1, y: 0 });
    act(() => {
      StudentEditor.onPointerDown(new PointerEvent('pointerdown', { button: 0, bubbles: true }), ctx3);
    });

    expect(store.setMutualPreference).toHaveBeenCalledWith(alice.id, bob.id, 2);
    StudentEditor.deactivate(ctx3);
  });
});

// ---------------------------------------------------------------------------
// §6.A4 — registerAssignerCursorListener: cursor callback fires with toggle
// ---------------------------------------------------------------------------

describe('§6.A4 registerAssignerCursorListener cursor callback', () => {
  afterEach(() => {
    StudentEditor.deactivate(makeCtx());
  });

  it('registered callback receives true when assigner mode is turned ON', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);

    const cursorListener = vi.fn();
    const unregister = registerAssignerCursorListener(cursorListener);

    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    expect(cursorListener).toHaveBeenCalledWith(true);

    unregister();
    StudentEditor.deactivate(ctx);
  });

  it('callback receives false when assigner mode is turned OFF again', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);

    const cursorListener = vi.fn();
    const unregister = registerAssignerCursorListener(cursorListener);

    render(<StudentEditor.Toolbar ctx={ctx} />);
    // Turn ON then OFF; the effect also fires once on mount (false), so total calls = 3
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    // The last call must be false (assigner OFF), and at some point it was called with true
    expect(cursorListener).toHaveBeenCalledWith(true);
    expect(cursorListener).toHaveBeenLastCalledWith(false);

    unregister();
    StudentEditor.deactivate(ctx);
  });

  it('unregister() removes the callback (no more calls after unregister)', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);

    const cursorListener = vi.fn();
    const unregister = registerAssignerCursorListener(cursorListener);
    unregister();

    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    // Should NOT have been called after unregister
    expect(cursorListener).not.toHaveBeenCalled();
    StudentEditor.deactivate(ctx);
  });

  it('deactivate resets assigner mode and subsequent lever toggle still fires callback', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);

    const { unmount } = render(<StudentEditor.Toolbar ctx={ctx} />);
    // Turn on
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });
    unmount();
    StudentEditor.deactivate(ctx);

    // Re-activate and register a fresh listener
    const ctx2 = makeCtx();
    StudentEditor.activate(ctx2);
    const cursorListener2 = vi.fn();
    const unregister2 = registerAssignerCursorListener(cursorListener2);

    render(<StudentEditor.Toolbar ctx={ctx2} />);
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    expect(cursorListener2).toHaveBeenCalledWith(true);

    unregister2();
    StudentEditor.deactivate(ctx2);
  });
});

// ---------------------------------------------------------------------------
// §6.A1 — WEIGHT_OPTIONS export contract
// ---------------------------------------------------------------------------

describe('§6.A1 WEIGHT_OPTIONS export', () => {
  it('exports exactly 4 options with values -2, -1, 1, 2', () => {
    const values = WEIGHT_OPTIONS.map((o) => o.value);
    expect(values).toEqual([-2, -1, 1, 2]);
  });

  it('all labels are non-empty strings', () => {
    for (const opt of WEIGHT_OPTIONS) {
      expect(typeof opt.label).toBe('string');
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
});
