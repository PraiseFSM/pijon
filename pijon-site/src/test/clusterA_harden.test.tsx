// @vitest-environment jsdom
/**
 * clusterA_harden.test.tsx — Hardening tests for Cluster A (§6.A1–§6.A4).
 *
 * Covers gaps not caught by clusterA.test.tsx:
 *
 * 1. Shared-component invariant: top-bar and pref-row WeightSelectors use the
 *    same component (verified by identical testid structure + shared import).
 * 2. Cursor listener "receives true when ON" is correctly scoped to the click,
 *    not the mount-time effect (distinguishes call ordering).
 * 3. Add-pref-select dropdown excludes self and already-linked students.
 * 4. Clicking Add after selecting a target uses currentWeight from toolbar.
 * 5. Row-selector weight reflects the pref.weight stored on the student.
 * 6. ASSIGNER_CURSOR is a CSS cursor string beginning with url() so it can be
 *    trivially swapped for a custom image.
 * 7. ClassroomCanvas receives ASSIGNER_CURSOR via its cursor prop when assigner
 *    is active; reverts to a non-ASSIGNER_CURSOR value when inactive.
 *
 * Local-first: no network calls.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WEIGHT_OPTIONS } from '../ui/components/WeightSelector.js';
import { StudentEditor, registerAssignerCursorListener } from '../ui/editors/StudentEditor.js';
import { ASSIGNER_CURSOR } from '../theme/colors.js';
import { ClassroomCanvas } from '../ui/canvas/ClassroomCanvas.js';
import type { EditorContext, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import type { FurnitureId } from '../domain/types.js';
import { studentId as mkStudentId } from '../domain/types.js';
import { DEFAULT_CELLS_PER_UNIT, DEFAULT_THRESHOLD_UNITS } from '../domain/classroom.js';

// ---------------------------------------------------------------------------
// Mock helpers (mirrors clusterA.test.tsx)
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

const makeCtx = (storeOverrides?: Partial<Store>): EditorContext => ({
  store: makeStoreMock(storeOverrides),
  canvas: makeCanvasMock(),
  persistence: null,
});

// ---------------------------------------------------------------------------
// §6.A1 — Shared-component invariant: ONE WeightSelector, used in two places
// ---------------------------------------------------------------------------

describe('§6.A1 Shared-component invariant', () => {
  const alice = {
    id: makeSid('alice-sc'),
    name: 'Alice',
    isFixture: false,
    preferences: [{ kind: 'student' as const, targetId: makeSid('bob-sc'), weight: 1 }],
    metadata: {} as Record<string, unknown>,
  };
  const bob = {
    id: makeSid('bob-sc'),
    name: 'Bob',
    isFixture: false,
    preferences: [] as typeof alice.preferences,
    metadata: {} as Record<string, unknown>,
  };

  afterEach(() => {
    StudentEditor.deactivate(makeCtx());
  });

  it('top-bar toolbar WeightSelector uses the same testid structure as WeightSelector component', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);
    render(<StudentEditor.Toolbar ctx={ctx} />);
    // WeightSelector component always renders weight-btn-{value} testids
    expect(screen.getByTestId('weight-btn--2')).toBeInTheDocument();
    expect(screen.getByTestId('weight-btn--1')).toBeInTheDocument();
    expect(screen.getByTestId('weight-btn-1')).toBeInTheDocument();
    expect(screen.getByTestId('weight-btn-2')).toBeInTheDocument();
    StudentEditor.deactivate(ctx);
  });

  it('pref-row WeightSelector uses the same testid structure as WeightSelector component (prefixed)', () => {
    const ctx = makeCtx({ roster: [alice, bob], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);
    // Prefix is 'pref-row-0-', structure matches WeightSelector with testIdPrefix
    for (const opt of WEIGHT_OPTIONS) {
      expect(
        screen.getByTestId(`pref-row-0-weight-btn-${opt.value.toString()}`),
      ).toBeInTheDocument();
    }
    StudentEditor.deactivate(ctx);
  });

  it('top-bar and pref-row WeightSelectors coexist without testid collision when both are rendered', () => {
    const ctx = makeCtx({ roster: [alice, bob], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);
    // Render both toolbar and side-panel simultaneously
    render(
      <>
        <StudentEditor.Toolbar ctx={ctx} />
        <StudentEditor.SidePanel ctx={ctx} />
      </>,
    );
    // Top-bar buttons have no prefix (default '')
    expect(screen.getByTestId('weight-btn-1')).toBeInTheDocument();
    // Row buttons are prefixed and distinct
    expect(screen.getByTestId('pref-row-0-weight-btn-1')).toBeInTheDocument();
    // They should be different elements
    expect(screen.getByTestId('weight-btn-1')).not.toBe(
      screen.getByTestId('pref-row-0-weight-btn-1'),
    );
    StudentEditor.deactivate(ctx);
  });

  it('WEIGHT_OPTIONS is the single source of truth: same values used by both render sites', () => {
    const ctx = makeCtx({ roster: [alice, bob], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);
    render(
      <>
        <StudentEditor.Toolbar ctx={ctx} />
        <StudentEditor.SidePanel ctx={ctx} />
      </>,
    );
    // Every option in WEIGHT_OPTIONS has a button in BOTH the toolbar and the pref row
    for (const opt of WEIGHT_OPTIONS) {
      expect(screen.getByTestId(`weight-btn-${opt.value.toString()}`)).toBeInTheDocument();
      expect(screen.getByTestId(`pref-row-0-weight-btn-${opt.value.toString()}`)).toBeInTheDocument();
    }
    StudentEditor.deactivate(ctx);
  });
});

// ---------------------------------------------------------------------------
// §6.A2 — Add-pref-select exclusion rules
// ---------------------------------------------------------------------------

describe('§6.A2 Add-pref-select exclusion rules', () => {
  const alice = {
    id: makeSid('alice-excl'),
    name: 'Alice',
    isFixture: false,
    preferences: [] as { kind: 'student'; targetId: ReturnType<typeof makeSid>; weight: number }[],
    metadata: {} as Record<string, unknown>,
  };
  const bob = {
    id: makeSid('bob-excl'),
    name: 'Bob',
    isFixture: false,
    preferences: [] as typeof alice.preferences,
    metadata: {} as Record<string, unknown>,
  };
  const carol = {
    id: makeSid('carol-excl'),
    name: 'Carol',
    isFixture: false,
    preferences: [] as typeof alice.preferences,
    metadata: {} as Record<string, unknown>,
  };

  afterEach(() => {
    StudentEditor.deactivate(makeCtx());
  });

  it('add-pref-select dropdown does NOT include the selected student (self)', () => {
    const ctx = makeCtx({ roster: [alice, bob, carol], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);

    const select = screen.getByTestId<HTMLSelectElement>('add-pref-select');
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).not.toContain(alice.id);
    StudentEditor.deactivate(ctx);
  });

  it('add-pref-select dropdown excludes already-linked students', () => {
    const aliceWithBobPref = {
      ...alice,
      preferences: [{ kind: 'student' as const, targetId: bob.id, weight: 1 }],
    };
    const ctx = makeCtx({ roster: [aliceWithBobPref, bob, carol], selectedStudentId: aliceWithBobPref.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);

    const select = screen.getByTestId<HTMLSelectElement>('add-pref-select');
    const optionValues = Array.from(select.options).map((o) => o.value);
    // Bob is already linked — should not appear
    expect(optionValues).not.toContain(bob.id);
    // Carol is not linked — should appear
    expect(optionValues).toContain(carol.id);
    StudentEditor.deactivate(ctx);
  });

  it('add-pref-select is absent when no addable students remain', () => {
    const aliceWithBothPrefs = {
      ...alice,
      preferences: [
        { kind: 'student' as const, targetId: bob.id, weight: 1 },
        { kind: 'student' as const, targetId: carol.id, weight: -1 },
      ],
    };
    const ctx = makeCtx({
      roster: [aliceWithBothPrefs, bob, carol],
      selectedStudentId: aliceWithBothPrefs.id,
    });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);
    // No addable students left — select should not appear
    expect(document.querySelector('[data-testid="add-pref-select"]')).toBeNull();
    StudentEditor.deactivate(ctx);
  });

  it('adding a student via Add button calls setMutualPreference with the toolbar weight', () => {
    const ctx = makeCtx({ roster: [alice, bob, carol], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);

    // Render toolbar first to set currentWeight to +2
    render(<StudentEditor.Toolbar ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByTestId('weight-btn-2')); });

    render(<StudentEditor.SidePanel ctx={ctx} />);

    const select = screen.getByTestId('add-pref-select');
    act(() => { fireEvent.change(select, { target: { value: carol.id } }); });
    act(() => { fireEvent.click(screen.getByTestId('add-pref-btn')); });

    // Must use weight 2 (the current toolbar weight)
    expect(ctx.store.setMutualPreference).toHaveBeenCalledWith(alice.id, carol.id, 2);
    StudentEditor.deactivate(ctx);
  });

  it('fixtures are excluded from the add-pref-select dropdown', () => {
    const fixture = {
      id: makeSid('fixture-excl'),
      name: 'Whiteboard',
      isFixture: true,
      preferences: [] as typeof alice.preferences,
      metadata: {} as Record<string, unknown>,
    };
    const ctx = makeCtx({ roster: [alice, bob, fixture], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);

    const select = screen.getByTestId<HTMLSelectElement>('add-pref-select');
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).not.toContain(fixture.id);
    StudentEditor.deactivate(ctx);
  });
});

// ---------------------------------------------------------------------------
// §6.A2 — Pref row weight reflects stored weight on render
// ---------------------------------------------------------------------------

describe('§6.A2 Pref-row weight reflects stored pref.weight', () => {
  afterEach(() => {
    StudentEditor.deactivate(makeCtx());
  });

  it('row WeightSelector active button matches the stored pref weight (-2)', () => {
    const alice = {
      id: makeSid('alice-w-2'),
      name: 'Alice',
      isFixture: false,
      preferences: [{ kind: 'student' as const, targetId: makeSid('bob-w-2'), weight: -2 }],
      metadata: {} as Record<string, unknown>,
    };
    const bob = { id: makeSid('bob-w-2'), name: 'Bob', isFixture: false, preferences: [], metadata: {} as Record<string, unknown> };
    const ctx = makeCtx({ roster: [alice, bob], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);

    expect(screen.getByTestId('pref-row-0-weight-btn--2').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('pref-row-0-weight-btn--1').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('pref-row-0-weight-btn-1').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('pref-row-0-weight-btn-2').getAttribute('aria-pressed')).toBe('false');
    StudentEditor.deactivate(ctx);
  });

  it('row WeightSelector active button matches the stored pref weight (+1)', () => {
    const alice = {
      id: makeSid('alice-w1'),
      name: 'Alice',
      isFixture: false,
      preferences: [{ kind: 'student' as const, targetId: makeSid('bob-w1'), weight: 1 }],
      metadata: {} as Record<string, unknown>,
    };
    const bob = { id: makeSid('bob-w1'), name: 'Bob', isFixture: false, preferences: [], metadata: {} as Record<string, unknown> };
    const ctx = makeCtx({ roster: [alice, bob], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);
    render(<StudentEditor.SidePanel ctx={ctx} />);

    expect(screen.getByTestId('pref-row-0-weight-btn-1').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('pref-row-0-weight-btn-2').getAttribute('aria-pressed')).toBe('false');
    StudentEditor.deactivate(ctx);
  });
});

// ---------------------------------------------------------------------------
// §6.A4 — Cursor listener: tighter ordering tests
// ---------------------------------------------------------------------------

describe('§6.A4 Cursor listener ordering (tighter assertions)', () => {
  afterEach(() => {
    StudentEditor.deactivate(makeCtx());
  });

  it('listener call sequence is: [false] on mount, [true] on click-ON', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);

    const calls: boolean[] = [];
    const unregister = registerAssignerCursorListener((v) => { calls.push(v); });

    act(() => { render(<StudentEditor.Toolbar ctx={ctx} />); });
    // After mount, the effect fires with false (initial state)
    expect(calls).toEqual([false]);

    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });
    // After click ON, should be false (mount) then true (click)
    expect(calls).toEqual([false, true]);

    unregister();
    StudentEditor.deactivate(ctx);
  });

  it('listener call sequence: false (mount), true (ON click), false (OFF click)', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);

    const calls: boolean[] = [];
    const unregister = registerAssignerCursorListener((v) => { calls.push(v); });

    act(() => { render(<StudentEditor.Toolbar ctx={ctx} />); });
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    expect(calls).toEqual([false, true, false]);

    unregister();
    StudentEditor.deactivate(ctx);
  });

  it('with inverted listener bug, the click-ON call would be false — this test would catch it', () => {
    // This test verifies that the SECOND call (index 1) is true (not false).
    // If assignerCursorListener were called with !assignerOn, the second call
    // would be false (inverted from the true we expect), and this test would fail.
    const ctx = makeCtx();
    StudentEditor.activate(ctx);

    const calls: boolean[] = [];
    const unregister = registerAssignerCursorListener((v) => { calls.push(v); });

    act(() => { render(<StudentEditor.Toolbar ctx={ctx} />); });
    act(() => { fireEvent.click(screen.getByTestId('assigner-toggle-lever')); });

    // Strictly: the click-ON call must be true, not false
    expect(calls[1]).toBe(true);

    unregister();
    StudentEditor.deactivate(ctx);
  });
});

// ---------------------------------------------------------------------------
// §6.A4 — ASSIGNER_CURSOR token structure
// ---------------------------------------------------------------------------

describe('§6.A4 ASSIGNER_CURSOR token structure', () => {
  it('ASSIGNER_CURSOR starts with url() so it can be swapped for a custom image', () => {
    expect(ASSIGNER_CURSOR.startsWith('url(')).toBe(true);
  });

  it('ASSIGNER_CURSOR includes a fallback cursor after the url()', () => {
    // CSS cursor: url(...) hotx hoty, fallback — the fallback must be present
    expect(ASSIGNER_CURSOR).toContain(',');
    const parts = ASSIGNER_CURSOR.split(',');
    const lastPart = parts[parts.length - 1];
    expect(typeof lastPart).toBe('string');
    expect(lastPart!.trim().length).toBeGreaterThan(0);
  });

  it('ASSIGNER_CURSOR is a non-empty string constant', () => {
    expect(typeof ASSIGNER_CURSOR).toBe('string');
    expect(ASSIGNER_CURSOR.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §6.A4 — ClassroomCanvas applies cursor prop to canvas element style
// ---------------------------------------------------------------------------

describe('§6.A4 ClassroomCanvas cursor prop applied to canvas style', () => {
  it('canvas element has cursor style matching the cursor prop (ASSIGNER_CURSOR)', () => {
    const { container } = render(
      <ClassroomCanvas cursor={ASSIGNER_CURSOR} />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    // The cursor is set via the style attribute
    expect(canvas!.style.cursor).toBe(ASSIGNER_CURSOR);
  });

  it('canvas element has default crosshair cursor when cursor prop is not set', () => {
    const { container } = render(<ClassroomCanvas />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas!.style.cursor).toBe('crosshair');
  });

  it('canvas cursor updates when cursor prop changes from default to ASSIGNER_CURSOR', () => {
    const { container, rerender } = render(<ClassroomCanvas cursor="crosshair" />);
    const canvas = container.querySelector('canvas');
    expect(canvas!.style.cursor).toBe('crosshair');

    rerender(<ClassroomCanvas cursor={ASSIGNER_CURSOR} />);
    expect(canvas!.style.cursor).toBe(ASSIGNER_CURSOR);
  });

  it('canvas cursor reverts to crosshair when assigner mode turns off', () => {
    const { container, rerender } = render(<ClassroomCanvas cursor={ASSIGNER_CURSOR} />);
    const canvas = container.querySelector('canvas');
    expect(canvas!.style.cursor).toBe(ASSIGNER_CURSOR);

    rerender(<ClassroomCanvas cursor="crosshair" />);
    expect(canvas!.style.cursor).toBe('crosshair');
  });
});
