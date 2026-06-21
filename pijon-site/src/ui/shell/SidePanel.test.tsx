// @vitest-environment jsdom
/**
 * Tests for SidePanel — the delegation wrapper that renders the active
 * editor's SidePanel component (Phase 9).
 *
 * Coverage:
 *   1. Renders the active editor's SidePanel component (identified by a
 *      test-id marker).
 *   2. Passes the ctx prop as the SAME reference to the inner component.
 *   3. The outer wrapper div has height: 100%.
 *   4. Switching the activeEditor prop renders the new editor's SidePanel.
 *
 * LOCAL-FIRST: no network calls anywhere in this file.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { SidePanel } from './SidePanel.js';
import type { EditorMode, EditorContext, CanvasView } from '../editors/EditorMode.js';
import type { Store } from '../../state/store.js';

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Fake helpers
// ---------------------------------------------------------------------------

const SIDE_PANEL_MARKER_A = 'fake-side-panel-a';
const SIDE_PANEL_MARKER_B = 'fake-side-panel-b';

/**
 * Captured ctx references from the inner SidePanel renders.
 * Reset between tests by re-assigning before render.
 */
let capturedCtx: EditorContext | undefined;

/** Fake EditorMode whose SidePanel renders an identifiable marker. */
function makeEditor(id: string, markerId: string): EditorMode {
  return {
    id,
    label: id,
    Toolbar: () => null,
    SidePanel: ({ ctx }: { ctx: EditorContext }) => {
      capturedCtx = ctx;
      return React.createElement('div', { 'data-testid': markerId }, markerId);
    },
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
}

/** Minimal CanvasView stub — methods are never called in these tests. */
const fakeCanvas: CanvasView = {
  cellSize: 48,
  gridW: 5,
  gridH: 5,
  originOffset: 0,
  cellAt: vi.fn(),
  furnitureAt: vi.fn(),
  cellRect: vi.fn(),
  requestRepaint: vi.fn(),
};

/** Minimal Store stub. */
const fakeStore = {} as unknown as Store;

/** A complete, stable EditorContext. */
function makeCtx(): EditorContext {
  return {
    store: fakeStore,
    canvas: fakeCanvas,
    persistence: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SidePanel', () => {
  it('renders the active editor SidePanel component', () => {
    const editor = makeEditor('fake-a', SIDE_PANEL_MARKER_A);
    const ctx = makeCtx();
    capturedCtx = undefined;

    render(React.createElement(SidePanel, { activeEditor: editor, ctx }));

    expect(screen.getByTestId(SIDE_PANEL_MARKER_A)).toBeDefined();
  });

  it('passes the ctx prop as the same reference to the inner SidePanel', () => {
    const editor = makeEditor('fake-a', SIDE_PANEL_MARKER_A);
    const ctx = makeCtx();
    capturedCtx = undefined;

    render(React.createElement(SidePanel, { activeEditor: editor, ctx }));

    expect(capturedCtx).toBe(ctx);
  });

  it('outer wrapper div has height: 100%', () => {
    const editor = makeEditor('fake-a', SIDE_PANEL_MARKER_A);
    const ctx = makeCtx();

    const { container } = render(React.createElement(SidePanel, { activeEditor: editor, ctx }));

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.height).toBe('100%');
  });

  it('renders the new editor SidePanel when activeEditor changes', () => {
    const editorA = makeEditor('fake-a', SIDE_PANEL_MARKER_A);
    const editorB = makeEditor('fake-b', SIDE_PANEL_MARKER_B);
    const ctx = makeCtx();

    const { rerender } = render(React.createElement(SidePanel, { activeEditor: editorA, ctx }));
    expect(screen.getByTestId(SIDE_PANEL_MARKER_A)).toBeDefined();
    expect(screen.queryByTestId(SIDE_PANEL_MARKER_B)).toBeNull();

    rerender(React.createElement(SidePanel, { activeEditor: editorB, ctx }));
    expect(screen.getByTestId(SIDE_PANEL_MARKER_B)).toBeDefined();
    expect(screen.queryByTestId(SIDE_PANEL_MARKER_A)).toBeNull();
  });
});
