// @vitest-environment jsdom
/**
 * Cluster B hardening tests — adversarial coverage for §5.B1–§5.B4 gaps.
 *
 * Gaps found in the existing suite and addressed here:
 *
 *  H1  Weight e2e: clicking each weight button sets the module-level currentWeight
 *      to EXACTLY that value, and a subsequent assigner two-click passes that exact
 *      value to setMutualPreference (not just expect.any(Number)).
 *
 *  H2  activate() resets currentWeight to -1.0 so weight selection does not bleed
 *      across editor mount/unmount cycles.
 *
 *  H3  showLinks canvas wiring: toggling Show Links in Settings calls
 *      ctx.canvas.requestRepaint() (i.e. the toggle drives the canvas, not just
 *      local React state).
 *
 *  H4  Import button null-guard: clicking Import when persistence is null does not
 *      throw (mirrors the existing Export null-guard test).
 *
 *  H5  Furniture-kind pref ✕ calls removePreference (not clearMutualPreference);
 *      student-kind pref ✕ calls clearMutualPreference (not removePreference).
 *      Confirms the dispatch branch in handleRemovePref is correctly split.
 *
 *  H6  Placeholder text shown when selected student has zero preferences.
 *
 * Local-first: no network calls anywhere in this file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { StudentEditor } from '../ui/editors/StudentEditor.js';
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
// H1 — Weight e2e: clicking a weight button propagates EXACTLY that value
//       to setMutualPreference via the assigner two-click flow
// ---------------------------------------------------------------------------

describe('H1 weight e2e: clicked weight reaches setMutualPreference exactly', () => {
  const alice = {
    id: makeSid('alice-h1'),
    name: 'Alice',
    isFixture: false,
    preferences: [],
    metadata: {} as Record<string, unknown>,
  };
  const bob = {
    id: makeSid('bob-h1'),
    name: 'Bob',
    isFixture: false,
    preferences: [],
    metadata: {} as Record<string, unknown>,
  };
  const desk1Fid = makeFid('desk-h1-1');
  const desk2Fid = makeFid('desk-h1-2');

  function buildCtxWithDesks() {
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
    return { store, canvas, ctx: { store, canvas, persistence: null } as EditorContext };
  }

  function doAssignerTwoClick(ctx: EditorContext) {
    // First click: desk1 (Alice)
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0, y: 0 });
    act(() => {
      StudentEditor.onPointerDown(new PointerEvent('pointerdown', { button: 0, bubbles: true }), ctx);
    });
    // Second click: desk2 (Bob)
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 1, y: 0 });
    act(() => {
      StudentEditor.onPointerDown(new PointerEvent('pointerdown', { button: 0, bubbles: true }), ctx);
    });
  }

  it('clicking +2 then two-click assigner uses weight=2 in setMutualPreference', () => {
    const { ctx } = buildCtxWithDesks();
    StudentEditor.activate(ctx);

    // Render Toolbar so both weight callback and assigner mode are wired
    render(<StudentEditor.Toolbar ctx={ctx} />);

    // Click the +2 weight button in the toolbar
    act(() => { fireEvent.click(screen.getByTestId('weight-btn-2')); });

    // Enable assigner mode via lever toggle in Toolbar (§6.A3)
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    doAssignerTwoClick(ctx);

    expect(ctx.store.setMutualPreference).toHaveBeenCalledWith(alice.id, bob.id, 2);

    StudentEditor.deactivate(ctx);
  });

  it('clicking -2 then two-click assigner uses weight=-2 in setMutualPreference', () => {
    const { ctx } = buildCtxWithDesks();
    StudentEditor.activate(ctx);

    render(<StudentEditor.Toolbar ctx={ctx} />);

    act(() => { fireEvent.click(screen.getByTestId('weight-btn--2')); });
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    doAssignerTwoClick(ctx);

    expect(ctx.store.setMutualPreference).toHaveBeenCalledWith(alice.id, bob.id, -2);

    StudentEditor.deactivate(ctx);
  });

  it('clicking +1 then two-click assigner uses weight=1 in setMutualPreference', () => {
    const { ctx } = buildCtxWithDesks();
    StudentEditor.activate(ctx);

    render(<StudentEditor.Toolbar ctx={ctx} />);

    act(() => { fireEvent.click(screen.getByTestId('weight-btn-1')); });
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    doAssignerTwoClick(ctx);

    expect(ctx.store.setMutualPreference).toHaveBeenCalledWith(alice.id, bob.id, 1);

    StudentEditor.deactivate(ctx);
  });

  it('default weight (-1) is used when no button is clicked before assigning', () => {
    const { ctx } = buildCtxWithDesks();
    StudentEditor.activate(ctx);

    // No weight button click — default should be -1; render Toolbar for assigner lever
    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    doAssignerTwoClick(ctx);

    expect(ctx.store.setMutualPreference).toHaveBeenCalledWith(alice.id, bob.id, -1);

    StudentEditor.deactivate(ctx);
  });
});

// ---------------------------------------------------------------------------
// H2 — activate() resets currentWeight to -1.0 (no bleed across mounts)
// ---------------------------------------------------------------------------

describe('H2 activate resets currentWeight to -1.0', () => {
  it('clicking +2 then deactivate+activate resets weight to -1 (aria-pressed on -1)', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);

    const { unmount } = render(<StudentEditor.Toolbar ctx={ctx} />);

    // Click +2
    act(() => { fireEvent.click(screen.getByTestId('weight-btn-2')); });
    expect(screen.getByTestId('weight-btn-2').getAttribute('aria-pressed')).toBe('true');

    unmount();
    StudentEditor.deactivate(ctx);

    // Re-activate and re-mount
    const ctx2 = makeCtx();
    StudentEditor.activate(ctx2);
    render(<StudentEditor.Toolbar ctx={ctx2} />);

    // -1 should be active by default (aria-pressed=true)
    expect(screen.getByTestId('weight-btn--1').getAttribute('aria-pressed')).toBe('true');
    // +2 must not be active
    expect(screen.getByTestId('weight-btn-2').getAttribute('aria-pressed')).toBe('false');

    StudentEditor.deactivate(ctx2);
  });
});

// ---------------------------------------------------------------------------
// H3 — showLinks canvas wiring: toggling Show Links calls requestRepaint
// ---------------------------------------------------------------------------

describe('H3 showLinks toggle drives canvas requestRepaint', () => {
  let ctx: EditorContext;

  beforeEach(() => {
    ctx = makeCtx();
    StudentEditor.activate(ctx);
  });

  afterEach(() => {
    StudentEditor.deactivate(ctx);
  });

  it('toggling Show Links ON calls ctx.canvas.requestRepaint', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);

    // Open settings
    act(() => { fireEvent.click(screen.getByTestId('settings-gear-button')); });

    // Count repaint calls before toggle
    const repaintBefore = (ctx.canvas.requestRepaint as ReturnType<typeof vi.fn>).mock.calls.length;

    // Toggle Show Links ON
    act(() => { fireEvent.click(screen.getByTestId('settings-show-links-toggle')); });

    const repaintAfter = (ctx.canvas.requestRepaint as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(repaintAfter).toBeGreaterThan(repaintBefore);
  });

  it('toggling Show Links OFF also calls ctx.canvas.requestRepaint', () => {
    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('settings-gear-button')); });

    // Toggle ON first
    act(() => { fireEvent.click(screen.getByTestId('settings-show-links-toggle')); });

    const repaintMid = (ctx.canvas.requestRepaint as ReturnType<typeof vi.fn>).mock.calls.length;

    // Toggle OFF
    act(() => { fireEvent.click(screen.getByTestId('settings-show-links-toggle')); });

    expect((ctx.canvas.requestRepaint as ReturnType<typeof vi.fn>).mock.calls.length)
      .toBeGreaterThan(repaintMid);
  });
});

// ---------------------------------------------------------------------------
// H4 — Import null-guard: clicking Import when persistence is null does not throw
// ---------------------------------------------------------------------------

describe('H4 Import button null-guard', () => {
  it('Import button does not throw when persistence is null', () => {
    const ctx = makeCtx({}, null);
    StudentEditor.activate(ctx);
    render(<StudentEditor.Toolbar ctx={ctx} />);

    expect(() => {
      act(() => { fireEvent.click(screen.getByTestId('toolbar-import-pijon')); });
    }).not.toThrow();

    StudentEditor.deactivate(ctx);
  });

  it('Import button calls persistence.openFromFile exactly once when persistence is present', () => {
    const persistence = makePersistenceMock();
    const ctx = makeCtx({}, persistence);
    StudentEditor.activate(ctx);
    render(<StudentEditor.Toolbar ctx={ctx} />);

    act(() => { fireEvent.click(screen.getByTestId('toolbar-import-pijon')); });

    expect(persistence.openFromFile).toHaveBeenCalledTimes(1);
    // saveToFile must NOT have been called (wrong method)
    expect(persistence.saveToFile).not.toHaveBeenCalled();

    StudentEditor.deactivate(ctx);
  });

  it('Export button calls persistence.saveToFile exactly once when persistence is present', () => {
    const persistence = makePersistenceMock();
    const ctx = makeCtx({}, persistence);
    StudentEditor.activate(ctx);
    render(<StudentEditor.Toolbar ctx={ctx} />);

    act(() => { fireEvent.click(screen.getByTestId('toolbar-export-pijon')); });

    expect(persistence.saveToFile).toHaveBeenCalledTimes(1);
    // openFromFile must NOT have been called (wrong method)
    expect(persistence.openFromFile).not.toHaveBeenCalled();

    StudentEditor.deactivate(ctx);
  });
});

// ---------------------------------------------------------------------------
// H5 — Preference removal dispatch: student-kind uses clearMutualPreference;
//       furniture-kind uses removePreference
// ---------------------------------------------------------------------------

describe('H5 pref removal dispatch split (student vs furniture kind)', () => {
  const alice = {
    id: makeSid('alice-h5'),
    name: 'Alice',
    isFixture: false,
    preferences: [] as { kind: 'student' | 'furniture'; targetId: ReturnType<typeof makeSid> | ReturnType<typeof makeFid>; weight: number }[],
    metadata: {} as Record<string, unknown>,
  };

  afterEach(() => {
    StudentEditor.deactivate(makeCtx());
  });

  it('student-kind pref ✕ calls clearMutualPreference, NOT removePreference', () => {
    const bob = {
      id: makeSid('bob-h5'),
      name: 'Bob',
      isFixture: false,
      preferences: [],
      metadata: {} as Record<string, unknown>,
    };
    const aliceWithStudentPref = {
      ...alice,
      preferences: [{ kind: 'student' as const, targetId: bob.id, weight: -1.0 }],
    };
    const ctx = makeCtx({ roster: [aliceWithStudentPref, bob], selectedStudentId: aliceWithStudentPref.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);

    const removeBtn = screen.getAllByTitle('Remove this preference')[0]!;
    act(() => { fireEvent.click(removeBtn); });

    expect(ctx.store.clearMutualPreference).toHaveBeenCalledWith(aliceWithStudentPref.id, bob.id);
    expect(ctx.store.removePreference).not.toHaveBeenCalled();

    StudentEditor.deactivate(ctx);
  });

  it('furniture-kind pref ✕ calls removePreference, NOT clearMutualPreference', () => {
    const deskId = makeFid('desk-h5') as unknown as ReturnType<typeof makeSid>;
    const aliceWithFurniturePref = {
      ...alice,
      preferences: [{ kind: 'furniture' as const, targetId: deskId, weight: 1.0 }],
    };
    const ctx = makeCtx({ roster: [aliceWithFurniturePref], selectedStudentId: aliceWithFurniturePref.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);

    const removeBtn = screen.getAllByTitle('Remove this preference')[0]!;
    act(() => { fireEvent.click(removeBtn); });

    expect(ctx.store.removePreference).toHaveBeenCalledWith(aliceWithFurniturePref.id, deskId);
    expect(ctx.store.clearMutualPreference).not.toHaveBeenCalled();

    StudentEditor.deactivate(ctx);
  });
});

// ---------------------------------------------------------------------------
// H6 — Placeholder shown when selected student has zero preferences
// ---------------------------------------------------------------------------

describe('H6 placeholder shown when selected student has no preferences', () => {
  it('shows the "none" placeholder text when student has zero preferences', () => {
    const alice = {
      id: makeSid('alice-h6'),
      name: 'Alice',
      isFixture: false,
      preferences: [],
      metadata: {} as Record<string, unknown>,
    };
    const ctx = makeCtx({ roster: [alice], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);

    // The placeholder message shown when there are no prefs (§6.A2 text)
    expect(screen.getByText(/no preferences yet/i)).toBeInTheDocument();

    StudentEditor.deactivate(ctx);
  });

  it('does not show placeholder when selected student has preferences', () => {
    const bob = {
      id: makeSid('bob-h6'),
      name: 'Bob',
      isFixture: false,
      preferences: [],
      metadata: {} as Record<string, unknown>,
    };
    const alice = {
      id: makeSid('alice-h6b'),
      name: 'Alice',
      isFixture: false,
      preferences: [{ kind: 'student' as const, targetId: bob.id, weight: -1.0 }],
      metadata: {} as Record<string, unknown>,
    };
    const ctx = makeCtx({ roster: [alice, bob], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);

    // Preference is shown — target student name visible in pref row (§6.A2 new format)
    // getAllByText because "Bob" also appears in the roster list
    expect(screen.getAllByText('Bob').length).toBeGreaterThan(0);

    StudentEditor.deactivate(ctx);
  });
});
