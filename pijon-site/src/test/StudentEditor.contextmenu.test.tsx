/**
 * Tests for §12.1 — context menu dismiss on left-click (outside vs inside menu).
 *
 * Strategy: render StudentSidePanelWithMenu with a minimal mocked EditorContext,
 * trigger the showContextMenuCallback to open the menu, then fire capture-phase
 * pointerdown events and assert the menu's presence in the DOM.
 *
 * We do NOT import the module-level callbacks directly (they're unexported); instead
 * we reach them via the side-effect the component registers: after the component
 * mounts it sets showContextMenuCallback / closeContextMenuCallback on the module.
 * We simulate those by calling the exported StudentEditor's onContextMenu mock path
 * — but actually the simplest and most direct route is to grab the callbacks that
 * StudentSidePanelWithMenu registers and call them.
 *
 * Since the callbacks are module-level and unexported, we use a small trick: we
 * import the StudentEditor object and check that its onPointerDown calls
 * closeContextMenuCallback by verifying the menu disappears.  For the window
 * listener path we dispatch a real pointerdown event on window.
 */

import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// We import the SidePanel indirectly via the editor's exported SidePanel property
// to keep the test coupled only to public surface.
import { StudentEditor } from '../ui/editors/StudentEditor.js';
import type { EditorContext, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import type { FurnitureId } from '../domain/types.js';
import { DEFAULT_CELLS_PER_UNIT, DEFAULT_THRESHOLD_UNITS } from '../domain/classroom.js';

// ---------------------------------------------------------------------------
// Minimal mocks
// ---------------------------------------------------------------------------

/** Bare-minimum Store mock — only the fields StudentSidePanelWithMenu reads. */
const makeStoreMock = (): Store =>
  ({
    roster: [],
    locks: new Set<FurnitureId>(),
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
  } as unknown as Store);

/** Bare-minimum CanvasView mock. */
const makeCanvasViewMock = (): CanvasView => ({
  cellSize: 48,
  gridW: 5,
  gridH: 5,
  cellAt: vi.fn(() => undefined),
  furnitureAt: vi.fn(() => undefined),
  cellRect: vi.fn(() => ({ x: 0, y: 0, w: 48, h: 48 })),
  requestRepaint: vi.fn(),
});

// ---------------------------------------------------------------------------
// Helper to open the context menu by activating the registered callback
// ---------------------------------------------------------------------------

/**
 * After StudentSidePanelWithMenu mounts it registers showContextMenuCallback.
 * StudentEditor.onContextMenu calls that callback, but in tests we don't have
 * a real canvas.  Instead we call it directly through a tiny React wrapper
 * that captures the registered callback via a rendered side-effect.
 *
 * The trick: render the SidePanel, wait for effects to run (act), then fire the
 * callback we know was registered by checking that the menu appears in the DOM
 * after calling StudentEditor.onContextMenu with a crafted event.
 *
 * Actually the cleanest approach: we expose the callback indirectly by having
 * StudentEditor.onContextMenu call it — so we craft a fake MouseEvent that hits
 * an occupied desk.  But that requires a real store with furniture.
 *
 * Simpler and more direct: we just fire `act(() => { showCb(state) })` where
 * showCb is a reference we grabbed before the test.  Since showContextMenuCallback
 * is module-level and unexported we cannot import it, but we CAN drive it through
 * the component by simulating what onContextMenu does — except we'd need a real
 * canvas.
 *
 * RESOLUTION: we expose show/close callbacks indirectly by checking the DOM.
 * We call StudentEditor's SidePanel component.  After mount + act, we reach the
 * registered callback by calling `StudentEditor.onContextMenu` with a mocked
 * MouseEvent, relying on a mocked ctx.canvas.cellAt that returns a cell, and a
 * ctx.store.classroom.furniture containing one occupied desk.
 */

// Furniture id helper — mirrors how the domain builds ids, but for the test we
// just use a plain string cast.
const fid = 'desk-1' as FurnitureId;

const makeCtxWithDesk = (): EditorContext => {
  const store = makeStoreMock();
  // One occupied, non-fixture desk at cell (0,0)
  (store as { classroom: typeof store.classroom }).classroom = {
    id: 'test-classroom',
    name: 'Test',
    gridW: 5,
    gridH: 5,
    cellsPerUnit: DEFAULT_CELLS_PER_UNIT,
    thresholdUnits: DEFAULT_THRESHOLD_UNITS,
    furniture: [
      {
        id: fid,
        kind: 'single_desk',
        pos: { x: 0, y: 0 },
        w: 1,
        h: 1,
        rotation: 0,
        occupants: [
          {
            id: 'student-1' as import('../domain/types.js').StudentId,
            name: 'Alice',
            isFixture: false,
            preferences: [],
            metadata: {},
          },
        ],
      },
    ],
  };

  const canvas = makeCanvasViewMock();
  // cellAt always returns cell (0,0) so onContextMenu hits the desk
  (canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0, y: 0 });

  return { store, canvas, persistence: null };
};

/** Fire a synthetic MouseEvent that onContextMenu receives. */
const makeContextMenuEvent = (clientX = 100, clientY = 100): MouseEvent =>
  new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY });

// ---------------------------------------------------------------------------
// Activate the StudentEditor so its module-level callbacks are wired.
// We call activate() to ensure any internal state is reset before each test.
// ---------------------------------------------------------------------------

const SidePanel = StudentEditor.SidePanel;

describe('StudentEditor — context menu dismiss (§12.1)', () => {
  let ctx: EditorContext;

  beforeEach(() => {
    ctx = makeCtxWithDesk();
    // Reset the editor (clears module-level state & callbacks)
    StudentEditor.activate(ctx);
  });

  afterEach(() => {
    StudentEditor.deactivate(ctx);
  });

  // -------------------------------------------------------------------------
  // 1. Opening the menu
  // -------------------------------------------------------------------------

  it('shows the context menu after a right-click on an occupied desk', async () => {
    render(<SidePanel ctx={ctx} />);

    // Trigger context menu via StudentEditor.onContextMenu (registered callback fires)
    act(() => {
      StudentEditor.onContextMenu(makeContextMenuEvent(), ctx);
    });

    expect(await screen.findByRole('menuitem')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 2. Dismiss on left-click OUTSIDE the menu (window pointerdown, capture)
  // -------------------------------------------------------------------------

  it('closes the menu when a pointerdown fires outside the menu element', async () => {
    render(<SidePanel ctx={ctx} />);

    act(() => {
      StudentEditor.onContextMenu(makeContextMenuEvent(), ctx);
    });

    // Wait for the menu to appear
    const menuItem = await screen.findByRole('menuitem');
    expect(menuItem).toBeInTheDocument();

    // Dispatch a pointerdown from document.body (outside the menu).
    // We dispatch on body rather than window so event.target is set correctly
    // (window.dispatchEvent doesn't set a meaningful target in jsdom).
    act(() => {
      document.body.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
      );
    });

    // The menu should be gone
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 3. Do NOT dismiss when clicking INSIDE the menu
  // -------------------------------------------------------------------------

  it('keeps the menu open when a pointerdown fires inside the menu element', async () => {
    render(<SidePanel ctx={ctx} />);

    act(() => {
      StudentEditor.onContextMenu(makeContextMenuEvent(), ctx);
    });

    const menuItem = await screen.findByRole('menuitem');
    expect(menuItem).toBeInTheDocument();

    // Dispatch a pointerdown event whose target IS the menu item itself.
    // We dispatch from the menuItem element so `event.target` is inside the menu.
    act(() => {
      menuItem.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // Menu must still be present — the action hasn't fired yet
    expect(screen.queryByRole('menuitem')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 4. Dismiss via canvas left-click (onPointerDown path)
  // -------------------------------------------------------------------------

  it('closes the menu when onPointerDown fires on the canvas (left-click)', async () => {
    render(<SidePanel ctx={ctx} />);

    act(() => {
      StudentEditor.onContextMenu(makeContextMenuEvent(), ctx);
    });

    const menuItem = await screen.findByRole('menuitem');
    expect(menuItem).toBeInTheDocument();

    // Simulate a left-click on the canvas (button 0).
    // cellAt returns undefined (default mock) so no drag begins — only dismiss fires.
    (ctx.canvas.cellAt as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);

    act(() => {
      StudentEditor.onPointerDown(
        new PointerEvent('pointerdown', { button: 0, bubbles: true }),
        ctx,
      );
    });

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 5. deactivate() closes any open menu and unregisters callbacks
  // -------------------------------------------------------------------------

  it('closes the menu and clears callbacks on deactivate', async () => {
    render(<SidePanel ctx={ctx} />);

    act(() => {
      StudentEditor.onContextMenu(makeContextMenuEvent(), ctx);
    });

    await screen.findByRole('menuitem');

    act(() => {
      StudentEditor.deactivate(ctx);
    });

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });
});
