// @vitest-environment jsdom
/**
 * Tests for TopBar — the active editor's Toolbar slot + save-status + Erase all.
 *
 * Coverage:
 *   1. Renders the active editor's Toolbar (identified by a test marker).
 *   2. Passes ctx to the Toolbar component.
 *   3. Save-status indicator text: all four values ('saved'|'saving'|'dirty'|'error').
 *   4. 'saving' status applies 'pijon-saving-pulse' className; others do not.
 *   5. <style id="__pijon-saving-pulse"> is injected into document.head on import.
 *   6. Injecting is idempotent — importing twice does not duplicate the style tag.
 *   7. "Erase all" button is present.
 *   8. Clicking "Erase all" triggers window.confirm.
 *   9. On confirm=true + persistence non-null → calls persistence.eraseAll().
 *  10. On confirm=true + persistence null    → calls ctx.store.eraseAll().
 *  11. On confirm=false → neither eraseAll is called.
 *
 * LOCAL-FIRST: no network calls anywhere in this file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';
import { TopBar } from './TopBar.js';
import { usePijonStore } from '../../state/store.js';
import type { EditorContext, EditorMode, CanvasView } from '../editors/EditorMode.js';
import type { Store } from '../../state/store.js';
import type { PersistenceHandle } from '../../state/persistence.js';
import type { FurnitureId } from '../../domain/types.js';

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function resetStore() {
  usePijonStore.getState().eraseAll();
}

// ---------------------------------------------------------------------------
// Minimal helpers
// ---------------------------------------------------------------------------

const TOOLBAR_MARKER = 'fake-toolbar-marker';

/** A fake EditorMode whose Toolbar renders an identifiable element. */
const fakeEditor: EditorMode = {
  id: 'fake',
  label: 'Fake',
  Toolbar: ({ ctx }: { ctx: EditorContext }) =>
    React.createElement(
      'div',
      { 'data-testid': TOOLBAR_MARKER, 'data-ctx-defined': String(ctx !== undefined) },
      'Fake Toolbar',
    ),
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
    classroom: { id: 'test', name: 'Test', gridW: 5, gridH: 5, furniture: [] },
    history: [],
    historyPtr: -1,
    saveStatus: 'saved' as const,
    activeEditorId: 'fake',
    fileHandle: null,
    resizeGridWarning: null,
    showViolations: true,
    eraseAll: vi.fn(),
    ...overrides,
  } as unknown as Store);

const makePersistenceMock = (): PersistenceHandle => ({
  resaveToHandle: vi.fn(async () => { /* noop */ }),
  saveToFile: vi.fn(async () => { /* noop */ }),
  openFromFile: vi.fn(async () => { /* noop */ }),
  eraseAll: vi.fn(async () => { /* noop */ }),
  destroy: vi.fn(),
});

function makeCtx(
  storeOverrides?: Partial<Store>,
  persistence: PersistenceHandle | null = null,
): EditorContext {
  return {
    store: makeStoreMock(storeOverrides),
    canvas: makeCanvasMock(),
    persistence,
  };
}

// ---------------------------------------------------------------------------
// 1 & 2. Toolbar rendering
// ---------------------------------------------------------------------------

describe('TopBar — renders active editor Toolbar', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('renders the active editor\'s Toolbar component', () => {
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    expect(screen.getByTestId(TOOLBAR_MARKER)).toBeInTheDocument();
    expect(screen.getByText('Fake Toolbar')).toBeInTheDocument();
  });

  it('passes ctx to the Toolbar component', () => {
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    const marker = screen.getByTestId(TOOLBAR_MARKER);
    expect(marker.getAttribute('data-ctx-defined')).toBe('true');
  });

  it('renders a different Toolbar when a different editor is passed', () => {
    const otherEditor: EditorMode = {
      ...fakeEditor,
      id: 'other',
      Toolbar: () => React.createElement('div', { 'data-testid': 'other-toolbar' }, 'Other'),
    };
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: otherEditor, ctx }));
    expect(screen.getByTestId('other-toolbar')).toBeInTheDocument();
    expect(screen.queryByTestId(TOOLBAR_MARKER)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. Save-status indicator labels
// ---------------------------------------------------------------------------

describe('TopBar — save-status indicator labels', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('shows "Saved locally" when saveStatus is "saved"', () => {
    act(() => { usePijonStore.setState({ saveStatus: 'saved' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    expect(screen.getByText(/saved locally/i)).toBeInTheDocument();
  });

  it('shows "Saving" indicator when saveStatus is "saving"', () => {
    act(() => { usePijonStore.setState({ saveStatus: 'saving' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    expect(screen.getByText(/saving/i)).toBeInTheDocument();
  });

  it('shows "Unsaved changes" when saveStatus is "dirty"', () => {
    act(() => { usePijonStore.setState({ saveStatus: 'dirty' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
  });

  it('shows "Save error" when saveStatus is "error"', () => {
    act(() => { usePijonStore.setState({ saveStatus: 'error' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    expect(screen.getByText(/save error/i)).toBeInTheDocument();
  });

  it('status indicator includes the bullet character for each status', () => {
    const statuses = ['saved', 'saving', 'dirty', 'error'] as const;
    for (const status of statuses) {
      cleanup();
      act(() => { usePijonStore.setState({ saveStatus: status }); });
      const ctx = makeCtx();
      render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
      // Each status label starts with "●"
      const spans = document.querySelectorAll('span');
      const indicator = Array.from(spans).find((s) => s.textContent?.startsWith('●'));
      expect(indicator, `status=${status}`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. 'saving' class for pulse animation
// ---------------------------------------------------------------------------

describe('TopBar — pijon-saving-pulse class', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('applies pijon-saving-pulse class when saveStatus is "saving"', () => {
    act(() => { usePijonStore.setState({ saveStatus: 'saving' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    const savingSpan = screen.getByText(/saving/i);
    expect(savingSpan.className).toContain('pijon-saving-pulse');
  });

  it('does NOT apply pijon-saving-pulse when saveStatus is "saved"', () => {
    act(() => { usePijonStore.setState({ saveStatus: 'saved' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    const savedSpan = screen.getByText(/saved locally/i);
    expect(savedSpan.className ?? '').not.toContain('pijon-saving-pulse');
  });

  it('does NOT apply pijon-saving-pulse when saveStatus is "dirty"', () => {
    act(() => { usePijonStore.setState({ saveStatus: 'dirty' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    const dirtySpan = screen.getByText(/unsaved changes/i);
    expect(dirtySpan.className ?? '').not.toContain('pijon-saving-pulse');
  });

  it('does NOT apply pijon-saving-pulse when saveStatus is "error"', () => {
    act(() => { usePijonStore.setState({ saveStatus: 'error' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    const errorSpan = screen.getByText(/save error/i);
    expect(errorSpan.className ?? '').not.toContain('pijon-saving-pulse');
  });
});

// ---------------------------------------------------------------------------
// NEW: unknown/garbage saveStatus falls back to ● <status> and default colour
// ---------------------------------------------------------------------------

describe('TopBar — unknown saveStatus fallback', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renders "● <status>" label for an unrecognised saveStatus', () => {
    // Cast needed to bypass TypeScript's SaveStatus union
    act(() => { usePijonStore.setState({ saveStatus: 'unknown-garbage' as 'saved' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));

    // The fallback label is `● ${saveStatus}`
    expect(screen.getByText('● unknown-garbage')).toBeInTheDocument();
  });

  it('uses topBarRightText (themed) color for an unrecognised saveStatus (§11.A5)', () => {
    act(() => { usePijonStore.setState({ saveStatus: 'unknown-garbage' as 'saved' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));

    const span = screen.getByText('● unknown-garbage');
    // §11.A5 — color is now always the themed topBarRightText token (CSS var),
    // guaranteed legible on topBarRight in all schemes.
    expect(span.style.color).toContain('--pj-topBarRightText');
  });

  it('does NOT apply pijon-saving-pulse for an unrecognised saveStatus', () => {
    act(() => { usePijonStore.setState({ saveStatus: 'unknown-garbage' as 'saved' }); });
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));

    const span = screen.getByText('● unknown-garbage');
    expect(span.className ?? '').not.toContain('pijon-saving-pulse');
  });
});

// ---------------------------------------------------------------------------
// NEW: ctx is the SAME object reference forwarded to activeEditor.Toolbar
// ---------------------------------------------------------------------------

describe('TopBar — ctx reference forwarded to Toolbar', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('passes the exact ctx object reference to the Toolbar component', () => {
    let capturedCtx: EditorContext | undefined;

    const capturingEditor: EditorMode = {
      ...fakeEditor,
      id: 'capturing',
      Toolbar: ({ ctx: receivedCtx }: { ctx: EditorContext }) => {
        capturedCtx = receivedCtx;
        return null;
      },
    };

    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: capturingEditor, ctx }));

    // The Toolbar must receive the exact same ctx object, not a copy/wrapper
    expect(capturedCtx).toBe(ctx);
  });
});

// ---------------------------------------------------------------------------
// NEW: window.confirm called exactly once per click (not 0 or 2+ times)
// ---------------------------------------------------------------------------

describe('TopBar — window.confirm called exactly once per click', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('window.confirm is called exactly once when "Erase all" is clicked', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));

    act(() => { fireEvent.click(screen.getByRole('button', { name: /erase all/i })); });

    // Exactly one confirm, not zero (no-op) and not two (double-dialog)
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('a second click triggers confirm exactly once more (total 2)', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));

    const btn = screen.getByRole('button', { name: /erase all/i });
    act(() => { fireEvent.click(btn); });
    act(() => { fireEvent.click(btn); });

    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 5 & 6. <style id="__pijon-saving-pulse"> injection
// ---------------------------------------------------------------------------

describe('TopBar — saving-pulse keyframe style injection', () => {
  it('injects a <style id="__pijon-saving-pulse"> into document.head', () => {
    // TopBar.tsx injects this style at module evaluation time (top-level if block).
    // Since this test runs in the same jsdom context that already imported TopBar,
    // the style element must already be present.
    const styleEl = document.getElementById('__pijon-saving-pulse');
    expect(styleEl).not.toBeNull();
    expect(styleEl?.tagName.toLowerCase()).toBe('style');
  });

  it('style element contains the pijon-saving-pulse keyframe rule', () => {
    const styleEl = document.getElementById('__pijon-saving-pulse');
    expect(styleEl?.textContent).toContain('pijon-saving-pulse');
  });

  it('injects the style tag exactly once (idempotent)', () => {
    // TopBar module-level code guards with getElementById — manually simulate
    // what the guard does: running the injection logic again should not add a
    // second tag. Count matching elements in head.
    const STYLE_ID = '__pijon-saving-pulse';
    const stylesBefore = document.querySelectorAll(`#${STYLE_ID}`).length;

    // Simulate the injection block (same code as TopBar.tsx)
    if (typeof document !== 'undefined') {
      if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = '@keyframes pijon-saving-pulse {}';
        document.head.appendChild(style);
      }
    }

    const stylesAfter = document.querySelectorAll(`#${STYLE_ID}`).length;
    // Should still be the same count (guard prevented a second injection)
    expect(stylesAfter).toBe(stylesBefore);
    // And there should be exactly one
    expect(stylesAfter).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. "Erase all" button presence
// ---------------------------------------------------------------------------

describe('TopBar — Erase all button', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('renders an "Erase all" button', () => {
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    expect(screen.getByRole('button', { name: /erase all/i })).toBeInTheDocument();
  });

  it('button has a title attribute describing the action', () => {
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    const btn = screen.getByRole('button', { name: /erase all/i });
    expect(btn.getAttribute('title')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 8. Clicking "Erase all" triggers window.confirm
// ---------------------------------------------------------------------------

describe('TopBar — "Erase all" triggers window.confirm', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('calls window.confirm when "Erase all" is clicked', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));

    act(() => { fireEvent.click(screen.getByRole('button', { name: /erase all/i })); });

    expect(confirmSpy).toHaveBeenCalledOnce();
  });

  it('confirm dialog message mentions erasing class data', () => {
    let capturedMessage = '';
    vi.spyOn(window, 'confirm').mockImplementation((msg) => {
      capturedMessage = String(msg);
      return false;
    });

    const ctx = makeCtx();
    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    act(() => { fireEvent.click(screen.getByRole('button', { name: /erase all/i })); });

    expect(capturedMessage.toLowerCase()).toMatch(/erase|delete|class data/);
  });
});

// ---------------------------------------------------------------------------
// 9. confirm=true + persistence non-null → calls persistence.eraseAll()
// ---------------------------------------------------------------------------

describe('TopBar — Erase all: confirm=true with persistence', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('calls persistence.eraseAll() when confirmed and persistence is non-null', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const persistence = makePersistenceMock();
    const ctx = makeCtx(undefined, persistence);

    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    act(() => { fireEvent.click(screen.getByRole('button', { name: /erase all/i })); });

    expect(persistence.eraseAll).toHaveBeenCalledOnce();
  });

  it('does NOT call store.eraseAll() when persistence is non-null', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const persistence = makePersistenceMock();
    const storeEraseAll = vi.fn();
    const ctx = makeCtx({ eraseAll: storeEraseAll }, persistence);

    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    act(() => { fireEvent.click(screen.getByRole('button', { name: /erase all/i })); });

    expect(storeEraseAll).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 10. confirm=true + persistence null → calls ctx.store.eraseAll()
// ---------------------------------------------------------------------------

describe('TopBar — Erase all: confirm=true without persistence', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('calls ctx.store.eraseAll() when confirmed and persistence is null', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const storeEraseAll = vi.fn();
    const ctx = makeCtx({ eraseAll: storeEraseAll }, null);

    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    act(() => { fireEvent.click(screen.getByRole('button', { name: /erase all/i })); });

    expect(storeEraseAll).toHaveBeenCalledOnce();
  });

  it('does NOT call persistence.eraseAll() when persistence is null', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // Verify the null path doesn't try to call anything on a null object
    // (would throw if it did). This test just confirms no error is thrown.
    const storeEraseAll = vi.fn();
    const ctx = makeCtx({ eraseAll: storeEraseAll }, null);

    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    expect(() => {
      act(() => { fireEvent.click(screen.getByRole('button', { name: /erase all/i })); });
    }).not.toThrow();
    expect(storeEraseAll).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 11. confirm=false → neither eraseAll is called
// ---------------------------------------------------------------------------

describe('TopBar — Erase all: confirm=false', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('does NOT call persistence.eraseAll() when confirm=false', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    const persistence = makePersistenceMock();
    const ctx = makeCtx(undefined, persistence);

    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    act(() => { fireEvent.click(screen.getByRole('button', { name: /erase all/i })); });

    expect(persistence.eraseAll).not.toHaveBeenCalled();
  });

  it('does NOT call store.eraseAll() when confirm=false with null persistence', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    const storeEraseAll = vi.fn();
    const ctx = makeCtx({ eraseAll: storeEraseAll }, null);

    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    act(() => { fireEvent.click(screen.getByRole('button', { name: /erase all/i })); });

    expect(storeEraseAll).not.toHaveBeenCalled();
  });

  it('does NOT call store.eraseAll() when confirm=false with non-null persistence', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    const storeEraseAll = vi.fn();
    const persistence = makePersistenceMock();
    const ctx = makeCtx({ eraseAll: storeEraseAll }, persistence);

    render(React.createElement(TopBar, { activeEditor: fakeEditor, ctx }));
    act(() => { fireEvent.click(screen.getByRole('button', { name: /erase all/i })); });

    expect(storeEraseAll).not.toHaveBeenCalled();
    expect(persistence.eraseAll).not.toHaveBeenCalled();
  });
});
