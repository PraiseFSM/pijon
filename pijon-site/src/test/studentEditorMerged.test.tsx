/**
 * Tests for §12.4 — merged StudentEditor (roster + preferences).
 *
 * Coverage:
 *   1. Store actions: addStudent, removeStudent (orphan-pref pruning + seat vacate + sync),
 *      setSelectedStudentId.
 *   2. Registry: PreferenceEditor gone, StudentEditor present.
 *   3. EditorMode shape: StudentEditor exposes both SidePanel and RightPanel.
 *   4. Assigner-mode toggle routing: when assigner mode is ON pointer-down does the
 *      marker flow (setMutualPreference), not the drag flow; when OFF, drag flow runs.
 *   5. Left panel UI: manual add, remove button, student selection, CSV at bottom.
 *   6. Right panel UI: assigner toggle, add-pref form, remove-pref button.
 *
 * LOCAL-FIRST: no network calls in any test path.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StudentEditor } from '../ui/editors/StudentEditor.js';
import { EDITOR_REGISTRY } from '../ui/editors/registry.js';
import type { EditorContext, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import type { FurnitureId } from '../domain/types.js';
import { studentId as mkStudentId } from '../domain/types.js';
import { usePijonStore } from '../state/store.js';
import { makeStudent } from '../domain/student.js';
import { DEFAULT_CELLS_PER_UNIT, DEFAULT_THRESHOLD_UNITS } from '../domain/classroom.js';

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

/**
 * Reset the Zustand store to empty state before each test that uses the real store.
 * We call eraseAll() which is the store's own reset path.
 */
function resetStore() {
  usePijonStore.getState().eraseAll();
}

// ---------------------------------------------------------------------------
// Mock helpers for component tests
// ---------------------------------------------------------------------------

const makeFid = (raw: string) => raw as FurnitureId;
const makeSid = (raw: string) => mkStudentId(raw);

/** Minimal Store mock for component tests that don't need the real store. */
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
    },
    history: [],
    historyPtr: 0,
    lockSeat: vi.fn(),
    unlockSeat: vi.fn(),
    importRosterFromCsv: vi.fn(() => [] as string[]),
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

const makeCtx = (overrides?: Partial<Store>): EditorContext => ({
  store: makeStoreMock(overrides),
  canvas: makeCanvasMock(),
  persistence: null,
});

// ---------------------------------------------------------------------------
// 1. Store — addStudent
// ---------------------------------------------------------------------------

describe('store.addStudent', () => {
  beforeEach(() => { resetStore(); });

  it('appends a new student to the roster', () => {
    const store = usePijonStore.getState();
    store.addStudent('Alice');
    const { roster } = usePijonStore.getState();
    expect(roster).toHaveLength(1);
    expect(roster[0]?.name).toBe('Alice');
    expect(roster[0]?.isFixture).toBe(false);
    expect(roster[0]?.preferences).toHaveLength(0);
  });

  it('trims whitespace and ignores blank names', () => {
    const store = usePijonStore.getState();
    store.addStudent('  ');
    expect(usePijonStore.getState().roster).toHaveLength(0);

    store.addStudent('  Bob  ');
    expect(usePijonStore.getState().roster[0]?.name).toBe('Bob');
  });

  it('mints a unique StudentId (no collision between two adds)', () => {
    const store = usePijonStore.getState();
    store.addStudent('Alice');
    store.addStudent('Bob');
    const { roster } = usePijonStore.getState();
    expect(roster).toHaveLength(2);
    expect(roster[0]?.id).not.toBe(roster[1]?.id);
  });

  it('marks saveStatus dirty', () => {
    usePijonStore.getState().addStudent('Charlie');
    expect(usePijonStore.getState().saveStatus).toBe('dirty');
  });
});

// ---------------------------------------------------------------------------
// 2. Store — removeStudent: basic removal
// ---------------------------------------------------------------------------

describe('store.removeStudent — basic', () => {
  beforeEach(() => { resetStore(); });

  it('removes the student from the roster', () => {
    const store = usePijonStore.getState();
    store.addStudent('Alice');
    const { roster } = usePijonStore.getState();
    const aliceId = roster[0]?.id;
    expect(aliceId).toBeDefined();

    store.removeStudent(aliceId!);
    expect(usePijonStore.getState().roster).toHaveLength(0);
  });

  it('is a no-op when studentId is not in the roster', () => {
    const store = usePijonStore.getState();
    store.addStudent('Alice');
    const before = usePijonStore.getState().roster.length;

    store.removeStudent(makeSid('nonexistent'));
    expect(usePijonStore.getState().roster).toHaveLength(before);
  });

  it('marks saveStatus dirty after removal', () => {
    const store = usePijonStore.getState();
    store.addStudent('Alice');
    const { roster } = usePijonStore.getState();
    store.removeStudent(roster[0]!.id);
    expect(usePijonStore.getState().saveStatus).toBe('dirty');
  });
});

// ---------------------------------------------------------------------------
// 3. Store — removeStudent: orphan-pref pruning (§12.5 reuse)
// ---------------------------------------------------------------------------

describe('store.removeStudent — orphan-pref pruning', () => {
  beforeEach(() => { resetStore(); });

  it('removes mutual prefs on the other student when a student is deleted', () => {
    const store = usePijonStore.getState();
    store.addStudent('Alice');
    store.addStudent('Bob');

    const { roster } = usePijonStore.getState();
    const alice = roster.find((s) => s.name === 'Alice')!;
    const bob = roster.find((s) => s.name === 'Bob')!;

    // Create a mutual preference between Alice and Bob
    store.setMutualPreference(alice.id, bob.id, -1.0);

    // Verify prefs were set
    const afterPref = usePijonStore.getState().roster;
    expect(afterPref.find((s) => s.id === bob.id)?.preferences).toHaveLength(1);
    expect(afterPref.find((s) => s.id === alice.id)?.preferences).toHaveLength(1);

    // Remove Alice — Bob's pref targeting Alice must be pruned
    store.removeStudent(alice.id);

    const afterRemove = usePijonStore.getState().roster;
    const bobAfter = afterRemove.find((s) => s.id === bob.id);
    expect(bobAfter).toBeDefined();
    // Bob should have zero prefs now (Alice is gone — orphan pruned)
    expect(bobAfter?.preferences).toHaveLength(0);
  });

  it('prunes prefs from multiple students when one is removed', () => {
    const store = usePijonStore.getState();
    store.addStudent('Alice');
    store.addStudent('Bob');
    store.addStudent('Carol');

    const { roster } = usePijonStore.getState();
    const alice = roster.find((s) => s.name === 'Alice')!;
    const bob = roster.find((s) => s.name === 'Bob')!;
    const carol = roster.find((s) => s.name === 'Carol')!;

    store.setMutualPreference(alice.id, bob.id, 1.0);
    store.setMutualPreference(alice.id, carol.id, -1.0);

    // Remove Alice; both Bob and Carol should have their prefs pruned
    store.removeStudent(alice.id);

    const after = usePijonStore.getState().roster;
    expect(after.find((s) => s.id === bob.id)?.preferences).toHaveLength(0);
    expect(after.find((s) => s.id === carol.id)?.preferences).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Store — removeStudent: clears selectedStudentId when removing selected student
// ---------------------------------------------------------------------------

describe('store.removeStudent — selectedStudentId clearing', () => {
  beforeEach(() => { resetStore(); });

  it('clears selectedStudentId when the selected student is removed', () => {
    const store = usePijonStore.getState();
    store.addStudent('Alice');
    const aliceId = usePijonStore.getState().roster[0]!.id;

    store.setSelectedStudentId(aliceId);
    expect(usePijonStore.getState().selectedStudentId).toBe(aliceId);

    store.removeStudent(aliceId);
    expect(usePijonStore.getState().selectedStudentId).toBeNull();
  });

  it('preserves selectedStudentId when a DIFFERENT student is removed', () => {
    const store = usePijonStore.getState();
    store.addStudent('Alice');
    store.addStudent('Bob');

    const { roster } = usePijonStore.getState();
    const alice = roster.find((s) => s.name === 'Alice')!;
    const bob = roster.find((s) => s.name === 'Bob')!;

    store.setSelectedStudentId(alice.id);
    store.removeStudent(bob.id);
    expect(usePijonStore.getState().selectedStudentId).toBe(alice.id);
  });
});

// ---------------------------------------------------------------------------
// 5. Store — setSelectedStudentId
// ---------------------------------------------------------------------------

describe('store.setSelectedStudentId', () => {
  beforeEach(() => { resetStore(); });

  it('sets a student id', () => {
    const sid = makeSid('test-id');
    usePijonStore.getState().setSelectedStudentId(sid);
    expect(usePijonStore.getState().selectedStudentId).toBe(sid);
  });

  it('accepts null to deselect', () => {
    const sid = makeSid('test-id');
    usePijonStore.getState().setSelectedStudentId(sid);
    usePijonStore.getState().setSelectedStudentId(null);
    expect(usePijonStore.getState().selectedStudentId).toBeNull();
  });

  it('does NOT mark saveStatus dirty (UI-only state)', () => {
    // setSelectedStudentId is UI state — it shouldn't trigger autosave
    usePijonStore.getState().setSaveStatus('saved');
    usePijonStore.getState().setSelectedStudentId(makeSid('x'));
    // saveStatus is NOT changed by setSelectedStudentId
    expect(usePijonStore.getState().saveStatus).toBe('saved');
  });
});

// ---------------------------------------------------------------------------
// 6. Registry — no PreferenceEditor, StudentEditor present
// ---------------------------------------------------------------------------

describe('EDITOR_REGISTRY (§12.4)', () => {
  it('contains exactly FurnitureEditor and StudentEditor', () => {
    expect(EDITOR_REGISTRY).toHaveLength(2);
    expect(EDITOR_REGISTRY[0]?.id).toBe('furniture');
    expect(EDITOR_REGISTRY[1]?.id).toBe('student');
  });

  it('does NOT contain a preference editor', () => {
    const ids = EDITOR_REGISTRY.map((e) => e.id);
    expect(ids).not.toContain('preference');
  });
});

// ---------------------------------------------------------------------------
// 7. EditorMode shape — StudentEditor exposes SidePanel AND RightPanel
// ---------------------------------------------------------------------------

describe('StudentEditor EditorMode shape', () => {
  it('has id="student" and label="Students"', () => {
    expect(StudentEditor.id).toBe('student');
    expect(StudentEditor.label).toBe('Students');
  });

  it('exposes a SidePanel component', () => {
    expect(typeof StudentEditor.SidePanel).toBe('function');
  });

  it('exposes a RightPanel component', () => {
    expect(typeof StudentEditor.RightPanel).toBe('function');
  });

  it('exposes a Toolbar component', () => {
    expect(typeof StudentEditor.Toolbar).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 8. Assigner-mode vs drag-mode pointer routing
// ---------------------------------------------------------------------------

describe('StudentEditor — assigner mode vs drag routing', () => {
  let ctx: EditorContext;

  // Build a context with one occupied desk
  const deskFid = makeFid('desk-1');
  const desk2Fid = makeFid('desk-2');
  const alice: ReturnType<typeof makeStudent> = {
    id: makeSid('alice'),
    name: 'Alice',
    isFixture: false,
    preferences: [],
    metadata: {},
  };
  const bob: ReturnType<typeof makeStudent> = {
    id: makeSid('bob'),
    name: 'Bob',
    isFixture: false,
    preferences: [],
    metadata: {},
  };

  beforeEach(() => {
    const store = makeStoreMock();
    (store as { classroom: typeof store.classroom }).classroom = {
      id: 'test-classroom',
      name: 'Test',
      gridW: 5,
      gridH: 5,
      cellsPerUnit: DEFAULT_CELLS_PER_UNIT,
      thresholdUnits: DEFAULT_THRESHOLD_UNITS,
      furniture: [
        {
          id: deskFid,
          kind: 'single_desk',
          pos: { x: 0, y: 0 },
          w: 1,
          h: 1,
          rotation: 0,
          occupants: [alice],
        },
        {
          id: desk2Fid,
          kind: 'single_desk',
          pos: { x: 1, y: 0 },
          w: 1,
          h: 1,
          rotation: 0,
          occupants: [bob],
        },
      ],
    };

    const canvas = makeCanvasMock();
    // cellAt returns (0,0) → hits desk-1
    (canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0, y: 0 });

    ctx = { store, canvas, persistence: null };
    StudentEditor.activate(ctx);
  });

  afterEach(() => {
    StudentEditor.deactivate(ctx);
  });

  it('in drag mode (default), onPointerDown does NOT call setMutualPreference', () => {
    // Assigner mode is OFF by default after activate()
    StudentEditor.onPointerDown(
      new PointerEvent('pointerdown', { button: 0, bubbles: true }),
      ctx,
    );
    expect(ctx.store.setMutualPreference).not.toHaveBeenCalled();
  });

  it('in assigner mode (ON), two sequential clicks call setMutualPreference', () => {
    // Simulate the RightPanel toggling assigner mode on via the module-level var
    // We cannot reach it via React; instead we drive the canvas events directly.
    // The module-level `assignerModeActive` is set by the RightPanel's useEffect.
    // For a unit test we render the RightPanel and click the toggle, then fire events.

    // Render the right panel so the toggle is wired
    const RightPanel = StudentEditor.RightPanel!;
    render(<RightPanel ctx={ctx} />);

    // Click the "Enable Assigner" button
    const toggleBtn = screen.getByRole('button', { name: /enable assigner/i });
    act(() => { fireEvent.click(toggleBtn); });

    // Now simulate first click (desk 1 — Alice)
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0, y: 0 });
    act(() => {
      StudentEditor.onPointerDown(
        new PointerEvent('pointerdown', { button: 0, bubbles: true }),
        ctx,
      );
    });

    // setMutualPreference should NOT have been called yet (only first click)
    expect(ctx.store.setMutualPreference).not.toHaveBeenCalled();

    // Simulate second click (desk 2 — Bob)
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 1, y: 0 });
    act(() => {
      StudentEditor.onPointerDown(
        new PointerEvent('pointerdown', { button: 0, bubbles: true }),
        ctx,
      );
    });

    // setMutualPreference should have been called with alice+bob ids
    expect(ctx.store.setMutualPreference).toHaveBeenCalledWith(
      alice.id,
      bob.id,
      expect.any(Number),
    );
  });

  it('in assigner mode, ESC cancels the in-progress selection', () => {
    const RightPanel = StudentEditor.RightPanel!;
    render(<RightPanel ctx={ctx} />);

    act(() => { fireEvent.click(screen.getByRole('button', { name: /enable assigner/i })); });

    // First click
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0, y: 0 });
    act(() => {
      StudentEditor.onPointerDown(
        new PointerEvent('pointerdown', { button: 0, bubbles: true }),
        ctx,
      );
    });

    // ESC — should cancel without calling setMutualPreference
    act(() => {
      StudentEditor.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }), ctx);
    });

    // Second click — would have completed the pair, but first click was cancelled
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 1, y: 0 });
    act(() => {
      StudentEditor.onPointerDown(
        new PointerEvent('pointerdown', { button: 0, bubbles: true }),
        ctx,
      );
    });

    // setMutualPreference must NOT have been called (ESC reset step 1; second click becomes new step 1)
    expect(ctx.store.setMutualPreference).not.toHaveBeenCalled();
  });

  it('self-target in assigner mode is a no-op', () => {
    const RightPanel = StudentEditor.RightPanel!;
    render(<RightPanel ctx={ctx} />);

    act(() => { fireEvent.click(screen.getByRole('button', { name: /enable assigner/i })); });

    // Click Alice twice (same desk)
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0, y: 0 });
    act(() => {
      StudentEditor.onPointerDown(
        new PointerEvent('pointerdown', { button: 0, bubbles: true }),
        ctx,
      );
    });
    act(() => {
      StudentEditor.onPointerDown(
        new PointerEvent('pointerdown', { button: 0, bubbles: true }),
        ctx,
      );
    });

    expect(ctx.store.setMutualPreference).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9. Left panel — manual add student form
// ---------------------------------------------------------------------------

describe('StudentEditor SidePanel — manual add student', () => {
  let ctx: EditorContext;

  beforeEach(() => {
    ctx = makeCtx();
    StudentEditor.activate(ctx);
  });

  afterEach(() => {
    StudentEditor.deactivate(ctx);
  });

  it('renders an add-student text input and Add button', () => {
    render(<StudentEditor.SidePanel ctx={ctx} />);
    expect(screen.getByRole('textbox', { name: /new student name/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add student/i })).toBeInTheDocument();
  });

  it('calls store.addStudent when Add button is clicked with a name', () => {
    render(<StudentEditor.SidePanel ctx={ctx} />);
    const input = screen.getByRole('textbox', { name: /new student name/i });
    const btn = screen.getByRole('button', { name: /add student/i });

    act(() => { fireEvent.change(input, { target: { value: 'New Student' } }); });
    act(() => { fireEvent.click(btn); });

    expect(ctx.store.addStudent).toHaveBeenCalledWith('New Student');
  });

  it('calls store.addStudent on Enter key in the name input', () => {
    render(<StudentEditor.SidePanel ctx={ctx} />);
    const input = screen.getByRole('textbox', { name: /new student name/i });

    act(() => { fireEvent.change(input, { target: { value: 'Jane' } }); });
    act(() => { fireEvent.keyDown(input, { key: 'Enter' }); });

    expect(ctx.store.addStudent).toHaveBeenCalledWith('Jane');
  });

  it('does NOT call store.addStudent when the name is blank', () => {
    render(<StudentEditor.SidePanel ctx={ctx} />);
    const btn = screen.getByRole('button', { name: /add student/i });

    act(() => { fireEvent.click(btn); });
    expect(ctx.store.addStudent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 10. Left panel — student list: click to select, × to remove
// ---------------------------------------------------------------------------

describe('StudentEditor SidePanel — student list', () => {
  const alice: ReturnType<typeof makeStudent> = {
    id: makeSid('alice-id'),
    name: 'Alice',
    isFixture: false,
    preferences: [],
    metadata: {},
  };

  let ctx: EditorContext;

  beforeEach(() => {
    ctx = makeCtx({ roster: [alice] });
    StudentEditor.activate(ctx);
  });

  afterEach(() => {
    StudentEditor.deactivate(ctx);
  });

  it('renders each real student by name', () => {
    render(<StudentEditor.SidePanel ctx={ctx} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('calls store.setSelectedStudentId when a student row is clicked', () => {
    render(<StudentEditor.SidePanel ctx={ctx} />);
    // The student rows are role=button divs. Use getAllByRole and find the one
    // whose textContent contains "Alice" (not the Remove button).
    const rows = screen.getAllByRole('button');
    const aliceRow = rows.find(
      (el) => el.textContent?.includes('Alice') && el.getAttribute('aria-label') === null,
    );
    expect(aliceRow).toBeDefined();
    act(() => { fireEvent.click(aliceRow!); });
    expect(ctx.store.setSelectedStudentId).toHaveBeenCalledWith(alice.id);
  });

  it('renders a × remove button for each student', () => {
    render(<StudentEditor.SidePanel ctx={ctx} />);
    expect(screen.getByRole('button', { name: /remove alice/i })).toBeInTheDocument();
  });

  it('calls store.removeStudent when × is clicked', () => {
    render(<StudentEditor.SidePanel ctx={ctx} />);
    const removeBtn = screen.getByRole('button', { name: /remove alice/i });
    act(() => { fireEvent.click(removeBtn); });
    expect(ctx.store.removeStudent).toHaveBeenCalledWith(alice.id);
  });
});

// ---------------------------------------------------------------------------
// 11. Left panel — Import CSV is the bottom-most control
// ---------------------------------------------------------------------------

describe('StudentEditor SidePanel — Import CSV at bottom', () => {
  it('renders the Import CSV button', () => {
    const ctx = makeCtx();
    render(<StudentEditor.SidePanel ctx={ctx} />);
    expect(screen.getByRole('button', { name: /import csv/i })).toBeInTheDocument();
  });

  it('Import CSV button appears AFTER the Add student form in DOM order', () => {
    const ctx = makeCtx();
    const { container } = render(<StudentEditor.SidePanel ctx={ctx} />);

    // Find both elements in DOM order
    const allButtons = Array.from(container.querySelectorAll('button'));
    const addBtn = allButtons.find((b) => b.getAttribute('aria-label') === 'Add student');
    const csvBtn = allButtons.find((b) => b.textContent?.includes('Import CSV'));

    expect(addBtn).toBeDefined();
    expect(csvBtn).toBeDefined();

    // CSV button must come after Add button in document order
    const addPos = addBtn!.compareDocumentPosition(csvBtn!);
    // DOCUMENT_POSITION_FOLLOWING = 4
    expect(addPos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 12. Right panel — preferences panel renders for selected student
// ---------------------------------------------------------------------------

describe('StudentEditor RightPanel — preferences panel', () => {
  const alice: ReturnType<typeof makeStudent> = {
    id: makeSid('alice-id'),
    name: 'Alice',
    isFixture: false,
    preferences: [{ kind: 'student', targetId: makeSid('bob-id'), weight: -1.0 }],
    metadata: {},
  };
  const bob: ReturnType<typeof makeStudent> = {
    id: makeSid('bob-id'),
    name: 'Bob',
    isFixture: false,
    preferences: [{ kind: 'student', targetId: makeSid('alice-id'), weight: -1.0 }],
    metadata: {},
  };

  let ctx: EditorContext;

  beforeEach(() => {
    ctx = makeCtx({ roster: [alice, bob], selectedStudentId: alice.id });
    StudentEditor.activate(ctx);
  });

  afterEach(() => {
    StudentEditor.deactivate(ctx);
  });

  it('renders without crashing', () => {
    const RightPanel = StudentEditor.RightPanel!;
    render(<RightPanel ctx={ctx} />);
    expect(screen.getByText(/preferences/i)).toBeInTheDocument();
  });

  it('shows the selected student\'s name', () => {
    const RightPanel = StudentEditor.RightPanel!;
    render(<RightPanel ctx={ctx} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows the Assigner toggle button at the top', () => {
    const RightPanel = StudentEditor.RightPanel!;
    render(<RightPanel ctx={ctx} />);
    expect(screen.getByRole('button', { name: /enable assigner/i })).toBeInTheDocument();
  });

  it('shows the Show Links toggle button', () => {
    const RightPanel = StudentEditor.RightPanel!;
    render(<RightPanel ctx={ctx} />);
    expect(screen.getByRole('button', { name: /show links/i })).toBeInTheDocument();
  });

  it('shows the student\'s preference entries', () => {
    const RightPanel = StudentEditor.RightPanel!;
    render(<RightPanel ctx={ctx} />);
    // '↓ Avoid' direction label should appear (Alice has an avoid-pref toward Bob)
    expect(screen.getByText('↓ Avoid')).toBeInTheDocument();
  });

  it('renders a ✕ remove button for each preference', () => {
    const RightPanel = StudentEditor.RightPanel!;
    render(<RightPanel ctx={ctx} />);
    // The ✕ button has title="Remove this preference"
    const removeButtons = screen.getAllByTitle('Remove this preference');
    expect(removeButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('calls clearMutualPreference when ✕ is clicked for a student-kind pref', () => {
    const RightPanel = StudentEditor.RightPanel!;
    render(<RightPanel ctx={ctx} />);
    const removeBtn = screen.getAllByTitle('Remove this preference')[0]!;
    act(() => { fireEvent.click(removeBtn); });
    expect(ctx.store.clearMutualPreference).toHaveBeenCalledWith(alice.id, bob.id);
  });

  it('shows a "target student" dropdown excluding self', () => {
    const RightPanel = StudentEditor.RightPanel!;
    render(<RightPanel ctx={ctx} />);
    const select = screen.getByRole('combobox');
    // Alice should NOT be an option (self-exclusion)
    expect(select.innerHTML).not.toContain('Alice');
    // Bob SHOULD be an option
    expect(select.innerHTML).toContain('Bob');
  });

  it('calls setMutualPreference when Add pref is submitted', () => {
    const RightPanel = StudentEditor.RightPanel!;
    render(<RightPanel ctx={ctx} />);

    const select = screen.getByRole('combobox');
    act(() => { fireEvent.change(select, { target: { value: bob.id } }); });

    const addBtn = screen.getByRole('button', { name: /^add$/i });
    act(() => { fireEvent.click(addBtn); });

    expect(ctx.store.setMutualPreference).toHaveBeenCalledWith(
      alice.id,
      bob.id,
      expect.any(Number),
    );
  });

  it('shows a placeholder when no student is selected', () => {
    const ctxNoSelection = makeCtx({ roster: [alice, bob], selectedStudentId: null });
    const RightPanel = StudentEditor.RightPanel!;
    render(<RightPanel ctx={ctxNoSelection} />);
    expect(screen.getByText(/click a student/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 13. Store — removeStudent vacates the student's seat
// ---------------------------------------------------------------------------

describe('store.removeStudent — seat vacate via syncRosterToClassroom', () => {
  beforeEach(() => { resetStore(); });

  it('vacates the student\'s seat in the classroom after removal', () => {
    const store = usePijonStore.getState();

    // Build a minimal student + furniture setup
    const aliceStudentId = makeSid('alice-fixed-id');
    const deskFid = makeFid('desk-fixed-id');

    // Manually set state with an occupied desk using setRoster + setClassroom
    // (we can't use the real allocator here since it needs a full classroom)
    // We'll use the store's setRoster path and inject classroom directly.
    const alice = makeStudent(aliceStudentId, 'Alice');

    // Set the roster via setRoster so pruning path is tested
    store.setRoster([alice]);

    // Manually put Alice in a seat by patching classroom — use the low-level setClassroom
    usePijonStore.setState((s) => ({
      classroom: {
        ...s.classroom,
        furniture: [
          {
            id: deskFid,
            kind: 'single_desk' as const,
            pos: { x: 0, y: 0 },
            w: 1,
            h: 1,
            rotation: 0 as const,
            occupants: [alice],
          },
        ],
      },
    }));

    // Confirm Alice is seated
    const beforeDesk = usePijonStore
      .getState()
      .classroom.furniture.find((f) => f.id === deskFid);
    expect(beforeDesk?.occupants[0]?.id).toBe(aliceStudentId);

    // Remove Alice
    store.removeStudent(aliceStudentId);

    // The desk should now be empty
    const afterDesk = usePijonStore
      .getState()
      .classroom.furniture.find((f) => f.id === deskFid);
    expect(afterDesk?.occupants).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 14. Mutual-preference symmetry integration (setMutualPreference correctness)
// ---------------------------------------------------------------------------

describe('store.setMutualPreference symmetry', () => {
  beforeEach(() => { resetStore(); });

  it('sets the pref on BOTH students', () => {
    const store = usePijonStore.getState();
    store.addStudent('Alice');
    store.addStudent('Bob');

    const { roster } = usePijonStore.getState();
    const alice = roster.find((s) => s.name === 'Alice')!;
    const bob = roster.find((s) => s.name === 'Bob')!;

    store.setMutualPreference(alice.id, bob.id, -1.0);

    const after = usePijonStore.getState().roster;
    const aliceAfter = after.find((s) => s.id === alice.id)!;
    const bobAfter = after.find((s) => s.id === bob.id)!;

    expect(aliceAfter.preferences).toHaveLength(1);
    expect(aliceAfter.preferences[0]).toMatchObject({ kind: 'student', targetId: bob.id, weight: -1.0 });
    expect(bobAfter.preferences).toHaveLength(1);
    expect(bobAfter.preferences[0]).toMatchObject({ kind: 'student', targetId: alice.id, weight: -1.0 });
  });
});

// ---------------------------------------------------------------------------
// 15. pruneOrphanStudentPrefs (domain function) used by removeStudent
// ---------------------------------------------------------------------------

describe('pruneOrphanStudentPrefs via removeStudent', () => {
  beforeEach(() => { resetStore(); });

  it('leaves non-student prefs intact when removing a student', () => {
    const store = usePijonStore.getState();
    store.addStudent('Alice');
    store.addStudent('Bob');

    const { roster } = usePijonStore.getState();
    const alice = roster.find((s) => s.name === 'Alice')!;
    const bob = roster.find((s) => s.name === 'Bob')!;

    // Give Bob a location pref (non-student kind)
    store.addPreference(bob.id, { kind: 'location', target: 'front', weight: 1.0 });

    // Also give Bob a student pref toward Alice
    store.setMutualPreference(alice.id, bob.id, 1.0);

    // Remove Alice
    store.removeStudent(alice.id);

    const bobAfter = usePijonStore.getState().roster.find((s) => s.id === bob.id)!;
    // Location pref should survive; student pref to Alice should be pruned
    expect(bobAfter.preferences.filter((p) => p.kind === 'location')).toHaveLength(1);
    expect(bobAfter.preferences.filter((p) => p.kind === 'student')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 16. Store — removeStudent: clears the lock when removing a locked+seated student
// ---------------------------------------------------------------------------

describe('store.removeStudent — lock clearing', () => {
  beforeEach(() => { resetStore(); });

  it('clears the lock when a locked, seated student is removed', () => {
    const store = usePijonStore.getState();
    const aliceStudentId = makeSid('alice-lock-test');
    const deskFid = makeFid('desk-lock-test');

    const alice = makeStudent(aliceStudentId, 'Alice');
    store.setRoster([alice]);

    // Inject Alice into a desk and lock that desk
    usePijonStore.setState((s) => ({
      classroom: {
        ...s.classroom,
        furniture: [
          {
            id: deskFid,
            kind: 'single_desk' as const,
            pos: { x: 0, y: 0 },
            w: 1,
            h: 1,
            rotation: 0 as const,
            occupants: [alice],
          },
        ],
      },
    }));
    store.lockSeat(deskFid);
    expect(usePijonStore.getState().locks.has(deskFid)).toBe(true);

    // Remove Alice — the lock on her desk must be cleared automatically
    store.removeStudent(aliceStudentId);

    const after = usePijonStore.getState();
    // Seat should be vacant
    expect(after.classroom.furniture.find((f) => f.id === deskFid)?.occupants).toHaveLength(0);
    // Lock should be cleared (dangling lock on an empty desk is a bug)
    expect(after.locks.has(deskFid)).toBe(false);
  });

  it('preserves locks on OTHER desks when an unlocked student is removed', () => {
    const store = usePijonStore.getState();
    const aliceId = makeSid('alice-no-lock');
    const bobId = makeSid('bob-locked');
    const aliceDeskFid = makeFid('desk-alice');
    const bobDeskFid = makeFid('desk-bob');

    const alice = makeStudent(aliceId, 'Alice');
    const bob = makeStudent(bobId, 'Bob');
    store.setRoster([alice, bob]);

    usePijonStore.setState((s) => ({
      classroom: {
        ...s.classroom,
        furniture: [
          {
            id: aliceDeskFid,
            kind: 'single_desk' as const,
            pos: { x: 0, y: 0 },
            w: 1,
            h: 1,
            rotation: 0 as const,
            occupants: [alice],
          },
          {
            id: bobDeskFid,
            kind: 'single_desk' as const,
            pos: { x: 1, y: 0 },
            w: 1,
            h: 1,
            rotation: 0 as const,
            occupants: [bob],
          },
        ],
      },
    }));
    store.lockSeat(bobDeskFid); // only Bob's desk is locked

    // Remove Alice (not locked)
    store.removeStudent(aliceId);

    // Bob's lock must survive
    expect(usePijonStore.getState().locks.has(bobDeskFid)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 17. Module-state bleed — assigner/showLinks reset across activate/deactivate
// ---------------------------------------------------------------------------

describe('StudentEditor module-state bleed — activate/deactivate cycle', () => {
  it('deactivate resets showLinks so re-mounting RightPanel starts with links OFF', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);

    // Mount the RightPanel and turn showLinks ON
    const RightPanel = StudentEditor.RightPanel!;
    const { unmount } = render(<RightPanel ctx={ctx} />);

    const linksBtn = screen.getByRole('button', { name: /show links/i });
    act(() => { fireEvent.click(linksBtn); });
    // Button should now say "Links ON"
    expect(screen.getByRole('button', { name: /links on/i })).toBeInTheDocument();

    unmount();

    // Deactivate (simulates switching editors)
    StudentEditor.deactivate(ctx);

    // Re-activate and re-mount (simulates switching back)
    StudentEditor.activate(ctx);
    render(<RightPanel ctx={ctx} />);

    // The RightPanel should show "Show Links" (OFF), not "Links ON"
    expect(screen.getByRole('button', { name: /show links/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /links on/i })).not.toBeInTheDocument();
  });

  it('deactivate resets assignerModeActive so no stale assigner flow on re-activate', () => {
    const ctx = makeCtx();
    StudentEditor.activate(ctx);

    // Mount the RightPanel and turn assigner mode ON
    const RightPanel = StudentEditor.RightPanel!;
    const { unmount } = render(<RightPanel ctx={ctx} />);
    act(() => { fireEvent.click(screen.getByRole('button', { name: /enable assigner/i })); });
    // Assigner is now ON
    expect(screen.getByRole('button', { name: /assigner on/i })).toBeInTheDocument();

    unmount();
    StudentEditor.deactivate(ctx);

    // After deactivate, any pointer event must NOT use the assigner flow
    // (even before the RightPanel re-mounts, because the module var should be false).
    // We just fire a pointer event and check setMutualPreference is NOT called.
    const ctxMock = makeCtx();
    (ctxMock.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0, y: 0 });
    StudentEditor.activate(ctxMock);

    // Build a classroom with one occupied desk so the assigner flow could theoretically run
    (ctxMock.store as { classroom: typeof ctxMock.store.classroom }).classroom = {
      id: 'test',
      name: 'Test',
      gridW: 5,
      gridH: 5,
      cellsPerUnit: DEFAULT_CELLS_PER_UNIT,
      thresholdUnits: DEFAULT_THRESHOLD_UNITS,
      furniture: [
        {
          id: makeFid('d1'),
          kind: 'single_desk',
          pos: { x: 0, y: 0 },
          w: 1,
          h: 1,
          rotation: 0,
          occupants: [{ id: makeSid('s1'), name: 'Alice', isFixture: false, preferences: [], metadata: {} }],
        },
      ],
    };

    act(() => {
      StudentEditor.onPointerDown(
        new PointerEvent('pointerdown', { button: 0, bubbles: true }),
        ctxMock,
      );
    });

    // Must NOT have called setMutualPreference (assigner mode was reset by deactivate)
    expect(ctxMock.store.setMutualPreference).not.toHaveBeenCalled();

    StudentEditor.deactivate(ctxMock);
  });
});

// ---------------------------------------------------------------------------
// 18. addStudent: duplicate names create distinct students (ids are unique)
// ---------------------------------------------------------------------------

describe('store.addStudent — name uniqueness vs id uniqueness', () => {
  beforeEach(() => { resetStore(); });

  it('allows two students with the same name (they get distinct ids)', () => {
    const store = usePijonStore.getState();
    store.addStudent('Alex');
    store.addStudent('Alex');
    const { roster } = usePijonStore.getState();
    expect(roster).toHaveLength(2);
    // Different ids
    expect(roster[0]?.id).not.toBe(roster[1]?.id);
    // Both named Alex
    expect(roster[0]?.name).toBe('Alex');
    expect(roster[1]?.name).toBe('Alex');
  });

  it('marks dirty after addStudent', () => {
    usePijonStore.getState().setSaveStatus('saved');
    usePijonStore.getState().addStudent('Zara');
    expect(usePijonStore.getState().saveStatus).toBe('dirty');
  });
});
