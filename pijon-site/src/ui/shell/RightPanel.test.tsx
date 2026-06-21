// @vitest-environment jsdom
/**
 * Tests for RightPanel — the optional right-side delegation wrapper (§12.4).
 *
 * Coverage:
 *   1. Renders null (nothing in the DOM) when activeEditor.RightPanel is
 *      undefined.
 *   2. Renders the active editor's RightPanel component (identified by a
 *      test-id marker) when RightPanel is defined.
 *   3. Passes the ctx prop as the SAME reference to the inner component.
 *   4. The outer wrapper div has height: 100% when RightPanel is present.
 *   5. Switching from an editor with a RightPanel to one without renders null.
 *   6. Switching from an editor without a RightPanel to one with one renders
 *      the component.
 *
 * LOCAL-FIRST: no network calls anywhere in this file.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { RightPanel } from './RightPanel.js';
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

const RIGHT_PANEL_MARKER = 'fake-right-panel';
const RIGHT_PANEL_MARKER_B = 'fake-right-panel-b';

/** Captured ctx from the inner RightPanel render. Reset before each render. */
let capturedCtx: EditorContext | undefined;

/** Minimal CanvasView stub. */
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

const fakeStore = {} as unknown as Store;

function makeCtx(): EditorContext {
  return {
    store: fakeStore,
    canvas: fakeCanvas,
    persistence: null,
  };
}

/** Build a base EditorMode WITHOUT a RightPanel. */
function makeEditorNoRight(id: string): EditorMode {
  return {
    id,
    label: id,
    Toolbar: () => null,
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
    // RightPanel intentionally omitted
  };
}

/** Build a base EditorMode WITH a RightPanel that renders a marker. */
function makeEditorWithRight(id: string, markerId: string): EditorMode {
  return {
    ...makeEditorNoRight(id),
    RightPanel: ({ ctx }: { ctx: EditorContext }) => {
      capturedCtx = ctx;
      return React.createElement('div', { 'data-testid': markerId }, markerId);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RightPanel', () => {
  it('renders nothing when activeEditor.RightPanel is undefined', () => {
    const editor = makeEditorNoRight('no-right');
    const ctx = makeCtx();

    const { container } = render(React.createElement(RightPanel, { activeEditor: editor, ctx }));

    // The container itself should be empty — no child nodes
    expect(container.firstChild).toBeNull();
  });

  it('renders the active editor RightPanel component when present', () => {
    const editor = makeEditorWithRight('with-right', RIGHT_PANEL_MARKER);
    const ctx = makeCtx();
    capturedCtx = undefined;

    render(React.createElement(RightPanel, { activeEditor: editor, ctx }));

    expect(screen.getByTestId(RIGHT_PANEL_MARKER)).toBeDefined();
  });

  it('passes ctx as the same reference to the inner RightPanel', () => {
    const editor = makeEditorWithRight('with-right', RIGHT_PANEL_MARKER);
    const ctx = makeCtx();
    capturedCtx = undefined;

    render(React.createElement(RightPanel, { activeEditor: editor, ctx }));

    expect(capturedCtx).toBe(ctx);
  });

  it('outer wrapper div has height: 100% when RightPanel is present', () => {
    const editor = makeEditorWithRight('with-right', RIGHT_PANEL_MARKER);
    const ctx = makeCtx();

    const { container } = render(React.createElement(RightPanel, { activeEditor: editor, ctx }));

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.height).toBe('100%');
  });

  it('renders null when switching from an editor with RightPanel to one without', () => {
    const editorWith = makeEditorWithRight('with-right', RIGHT_PANEL_MARKER);
    const editorWithout = makeEditorNoRight('no-right');
    const ctx = makeCtx();

    const { rerender, container } = render(
      React.createElement(RightPanel, { activeEditor: editorWith, ctx }),
    );
    expect(screen.getByTestId(RIGHT_PANEL_MARKER)).toBeDefined();

    rerender(React.createElement(RightPanel, { activeEditor: editorWithout, ctx }));
    expect(container.firstChild).toBeNull();
  });

  it('renders the component when switching from an editor without to one with RightPanel', () => {
    const editorWithout = makeEditorNoRight('no-right');
    const editorWith = makeEditorWithRight('with-right', RIGHT_PANEL_MARKER);
    const ctx = makeCtx();

    const { rerender, container } = render(
      React.createElement(RightPanel, { activeEditor: editorWithout, ctx }),
    );
    expect(container.firstChild).toBeNull();

    rerender(React.createElement(RightPanel, { activeEditor: editorWith, ctx }));
    expect(screen.getByTestId(RIGHT_PANEL_MARKER)).toBeDefined();
  });

  it('renders a different editor RightPanel when activeEditor changes (both have RightPanel)', () => {
    const editorA = makeEditorWithRight('a', RIGHT_PANEL_MARKER);
    const editorB = makeEditorWithRight('b', RIGHT_PANEL_MARKER_B);
    const ctx = makeCtx();

    const { rerender } = render(React.createElement(RightPanel, { activeEditor: editorA, ctx }));
    expect(screen.getByTestId(RIGHT_PANEL_MARKER)).toBeDefined();
    expect(screen.queryByTestId(RIGHT_PANEL_MARKER_B)).toBeNull();

    rerender(React.createElement(RightPanel, { activeEditor: editorB, ctx }));
    expect(screen.getByTestId(RIGHT_PANEL_MARKER_B)).toBeDefined();
    expect(screen.queryByTestId(RIGHT_PANEL_MARKER)).toBeNull();
  });
});
