// @vitest-environment jsdom
/**
 * Tests for EditorSwitcher — the tab strip that switches editor tools.
 *
 * Coverage:
 *   1. Renders the "Pijon" brand label.
 *   2. Renders one <button role="tab"> per editor in the `editors` prop.
 *   3. role="tablist" container present with aria-label="Editor tools".
 *   4. Active tab (matching store.activeEditorId) has aria-selected=true.
 *   5. Inactive tabs have aria-selected=false.
 *   6. Active tab has distinct styling vs inactive (border-width check).
 *   7. Clicking a tab calls store.setActiveEditorId with the editor's id.
 *   8. When the store's activeEditorId changes, the active tab updates.
 *   9. Works with zero editors (renders only the Pijon label).
 *  10. Works with a single editor.
 *
 * LOCAL-FIRST: no network calls anywhere in this file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';
import { EditorSwitcher } from './EditorSwitcher.js';
import { usePijonStore } from '../../state/store.js';
import type { EditorMode, EditorContext } from '../editors/EditorMode.js';

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function resetStore() {
  usePijonStore.getState().eraseAll();
  usePijonStore.setState({ activeEditorId: null });
}

// ---------------------------------------------------------------------------
// Minimal editor mocks
// ---------------------------------------------------------------------------

const EmptyToolbar: React.FC<{ ctx: EditorContext }> = () => null;
const EmptySidePanel: React.FC<{ ctx: EditorContext }> = () => null;

function makeEditor(id: string, label: string): EditorMode {
  return {
    id,
    label,
    Toolbar: EmptyToolbar,
    SidePanel: EmptySidePanel,
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

const editorA = makeEditor('furniture', 'Furniture');
const editorB = makeEditor('student', 'Students');
const editorC = makeEditor('third', 'Third Tool');
const ALL_EDITORS = [editorA, editorB, editorC] as const;

// ---------------------------------------------------------------------------
// 1. Pijon label
// ---------------------------------------------------------------------------

describe('EditorSwitcher — Pijon label', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('renders the "Pijon" brand label', () => {
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));
    expect(screen.getByText('Pijon')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. One tab per editor
// ---------------------------------------------------------------------------

describe('EditorSwitcher — tab count', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('renders one tab button per editor', () => {
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
  });

  it('tab labels match the editor.label values', () => {
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));
    expect(screen.getByRole('tab', { name: 'Furniture' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Students' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Third Tool' })).toBeInTheDocument();
  });

  it('renders zero tabs when editors list is empty', () => {
    render(React.createElement(EditorSwitcher, { editors: [] }));
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    // But the Pijon label should still appear
    expect(screen.getByText('Pijon')).toBeInTheDocument();
  });

  it('renders exactly one tab for a single editor', () => {
    render(React.createElement(EditorSwitcher, { editors: [editorA] }));
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Furniture' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. role="tablist" with aria-label
// ---------------------------------------------------------------------------

describe('EditorSwitcher — tablist container', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('has role="tablist"', () => {
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('tablist has aria-label="Editor tools"', () => {
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));
    expect(screen.getByRole('tablist', { name: 'Editor tools' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4 & 5. aria-selected — active / inactive
// ---------------------------------------------------------------------------

describe('EditorSwitcher — aria-selected on tabs', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('active tab has aria-selected=true', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'furniture' }); });
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));
    const activeTab = screen.getByRole('tab', { name: 'Furniture' });
    expect(activeTab).toHaveAttribute('aria-selected', 'true');
  });

  it('inactive tabs have aria-selected=false', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'furniture' }); });
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));
    const inactiveTab = screen.getByRole('tab', { name: 'Students' });
    expect(inactiveTab).toHaveAttribute('aria-selected', 'false');
  });

  it('all tabs are inactive when activeEditorId is null', () => {
    act(() => { usePijonStore.setState({ activeEditorId: null }); });
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));
    const tabs = screen.getAllByRole('tab');
    for (const tab of tabs) {
      expect(tab).toHaveAttribute('aria-selected', 'false');
    }
  });

  it('only the matching tab is active when one id matches', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'student' }); });
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));

    expect(screen.getByRole('tab', { name: 'Students' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Furniture' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Third Tool' })).toHaveAttribute('aria-selected', 'false');
  });
});

// ---------------------------------------------------------------------------
// 6. Active tab has distinct styling (border-width)
// ---------------------------------------------------------------------------

describe('EditorSwitcher — active tab styling', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('active tab has a thicker border than inactive tabs', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'furniture' }); });
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));

    const activeTab = screen.getByRole('tab', { name: 'Furniture' });
    const inactiveTab = screen.getByRole('tab', { name: 'Students' });

    // Active tab uses 2px border; inactive uses 1px border (from source)
    const activeBorder = activeTab.style.border;
    const inactiveBorder = inactiveTab.style.border;

    // The borders are different strings
    expect(activeBorder).not.toBe(inactiveBorder);
    // Active tab border contains "2px"
    expect(activeBorder).toContain('2px');
  });

  it('active tab has fontWeight 700', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'furniture' }); });
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));

    const activeTab = screen.getByRole('tab', { name: 'Furniture' });
    expect(activeTab.style.fontWeight).toBe('700');
  });

  it('inactive tab has fontWeight 400', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'furniture' }); });
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));

    const inactiveTab = screen.getByRole('tab', { name: 'Students' });
    expect(inactiveTab.style.fontWeight).toBe('400');
  });
});

// ---------------------------------------------------------------------------
// 7. Clicking a tab calls setActiveEditorId
// ---------------------------------------------------------------------------

describe('EditorSwitcher — clicking a tab calls setActiveEditorId', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('clicking the Furniture tab calls setActiveEditorId("furniture")', () => {
    act(() => { usePijonStore.setState({ activeEditorId: null }); });
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));

    const setActiveEditorId = vi.spyOn(usePijonStore.getState(), 'setActiveEditorId');

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: 'Furniture' }));
    });

    expect(setActiveEditorId).toHaveBeenCalledWith('furniture');
    setActiveEditorId.mockRestore();
  });

  it('clicking the Students tab calls setActiveEditorId("student")', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'furniture' }); });
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));

    const setActiveEditorId = vi.spyOn(usePijonStore.getState(), 'setActiveEditorId');

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: 'Students' }));
    });

    expect(setActiveEditorId).toHaveBeenCalledWith('student');
    setActiveEditorId.mockRestore();
  });

  it('clicking a tab passes the exact editor id', () => {
    act(() => { usePijonStore.setState({ activeEditorId: null }); });
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));

    const setActiveEditorId = vi.spyOn(usePijonStore.getState(), 'setActiveEditorId');

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: 'Third Tool' }));
    });

    expect(setActiveEditorId).toHaveBeenCalledWith('third');
    setActiveEditorId.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// NEW: activeEditorId that matches NO editor in the list → all tabs inactive
// ---------------------------------------------------------------------------

describe('EditorSwitcher — orphan activeEditorId leaves all tabs inactive', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('all tabs are aria-selected=false when activeEditorId is a non-existent id', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'does-not-exist' }); });
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));
    const tabs = screen.getAllByRole('tab');
    for (const tab of tabs) {
      expect(tab).toHaveAttribute('aria-selected', 'false');
    }
  });

  it('none of the tab labels become active when id is a garbage string', () => {
    act(() => { usePijonStore.setState({ activeEditorId: '!!garbage!!' }); });
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));
    expect(screen.getByRole('tab', { name: 'Furniture' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Students' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Third Tool' })).toHaveAttribute('aria-selected', 'false');
  });
});

// ---------------------------------------------------------------------------
// NEW: clicking the already-active tab still calls setActiveEditorId
// ---------------------------------------------------------------------------

describe('EditorSwitcher — clicking already-active tab still fires setActiveEditorId', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('clicking the active tab re-fires setActiveEditorId with its id', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'furniture' }); });
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));

    const setActiveEditorId = vi.spyOn(usePijonStore.getState(), 'setActiveEditorId');

    // Click on the ALREADY active tab
    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: 'Furniture' }));
    });

    expect(setActiveEditorId).toHaveBeenCalledWith('furniture');
    setActiveEditorId.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// NEW: tab order in the DOM matches the editors prop order
// ---------------------------------------------------------------------------

describe('EditorSwitcher — tab DOM order matches editors prop order', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('tabs appear in the same order as the editors array', () => {
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    // Text content of each tab must match the editors array in order
    expect(tabs[0]?.textContent).toBe('Furniture');
    expect(tabs[1]?.textContent).toBe('Students');
    expect(tabs[2]?.textContent).toBe('Third Tool');
  });

  it('tab order respects a reversed editors array', () => {
    const reversed = [...ALL_EDITORS].reverse();
    render(React.createElement(EditorSwitcher, { editors: reversed }));
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]?.textContent).toBe('Third Tool');
    expect(tabs[1]?.textContent).toBe('Students');
    expect(tabs[2]?.textContent).toBe('Furniture');
  });
});

// ---------------------------------------------------------------------------
// 8. Active tab updates when store.activeEditorId changes
// ---------------------------------------------------------------------------

describe('EditorSwitcher — reacts to store activeEditorId changes', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('updates aria-selected when activeEditorId changes in the store', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'furniture' }); });
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));

    // Initially Furniture is active
    expect(screen.getByRole('tab', { name: 'Furniture' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Students' })).toHaveAttribute('aria-selected', 'false');

    // Switch to Students via the real store
    act(() => { usePijonStore.getState().setActiveEditorId('student'); });

    expect(screen.getByRole('tab', { name: 'Students' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Furniture' })).toHaveAttribute('aria-selected', 'false');
  });

  it('all tabs become inactive when store sets activeEditorId to null', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'furniture' }); });
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));

    act(() => { usePijonStore.getState().setActiveEditorId(null); });

    const tabs = screen.getAllByRole('tab');
    for (const tab of tabs) {
      expect(tab).toHaveAttribute('aria-selected', 'false');
    }
  });

  it('clicking a tab updates the displayed active tab (integration)', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'furniture' }); });
    render(React.createElement(EditorSwitcher, { editors: ALL_EDITORS }));

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: 'Students' }));
    });

    // The real store should now reflect 'student'
    expect(usePijonStore.getState().activeEditorId).toBe('student');
    expect(screen.getByRole('tab', { name: 'Students' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Furniture' })).toHaveAttribute('aria-selected', 'false');
  });
});
