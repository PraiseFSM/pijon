// @vitest-environment jsdom
/**
 * iteration8_clusterA_layout.test.tsx — Cluster 8.A layout-bug coverage.
 *
 * Tests for two layout bugs fixed in Iteration 8 Cluster A:
 *
 *  8.A1 — FurnitureSidePanel stretches to fill full height of its container.
 *         Root cause: FurnitureSidePanel had no height:100% / flex:1, so its
 *         background only covered the area of its content, leaving an uncolored
 *         gap below the last palette item.
 *
 *  8.A2 — The shell SidePanel wrapper and the TopBar keep constant dimensions
 *         across Furniture and Students editor modes.
 *         Root cause (left panel): FurnitureSidePanel used width:160px and
 *         StudentEditor SidePanel used width:220px — different widths caused
 *         the layout to jump on mode switch.
 *         Root cause (top bar): both toolbar rows used flexWrap:wrap, so at
 *         narrow widths one toolbar might wrap to two rows while the other
 *         stayed single-line, changing the TopBar height.
 *
 * Test matrix:
 *   A. Shell SidePanel wrapper — constant width across editors.
 *   B. FurnitureSidePanel — fills full height.
 *   C. StudentEditor SidePanel — defers width to shell wrapper (no fixed px).
 *   D. FurnitureToolbar primary row — nowrap + minHeight constant.
 *   E. StudentEditor toolbar primary row — nowrap + minHeight constant.
 *   F. TopBar — constant minHeight present.
 *   G. App integration — renders both modes; left-panel wrapper width and
 *      top-bar minHeight are equal across Furniture and Students modes.
 *
 * LOCAL-FIRST: no network calls in any test path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';

import { SidePanel, SIDE_PANEL_WIDTH } from '../ui/shell/SidePanel.js';
import { TopBar } from '../ui/shell/TopBar.js';
import { FurnitureEditor } from '../ui/editors/FurnitureEditor.js';
import { StudentEditor } from '../ui/editors/StudentEditor.js';
import { EDITOR_REGISTRY } from '../ui/editors/registry.js';
import { usePijonStore } from '../state/store.js';
import App from '../ui/App.js';
import type { EditorContext, EditorMode, CanvasView } from '../ui/editors/EditorMode.js';
import type { Store } from '../state/store.js';
import type { FurnitureId } from '../domain/types.js';
import { DEFAULT_CELLS_PER_UNIT, DEFAULT_THRESHOLD_UNITS } from '../domain/classroom.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  act(() => { usePijonStore.getState().eraseAll(); });
}

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
    classroom: {
      id: 'test',
      name: 'Test',
      gridW: 5,
      gridH: 5,
      furniture: [],
      cellsPerUnit: DEFAULT_CELLS_PER_UNIT,
      thresholdUnits: DEFAULT_THRESHOLD_UNITS,
    },
    history: [],
    historyPtr: -1,
    saveStatus: 'saved' as const,
    activeEditorId: 'furniture',
    fileHandle: null,
    resizeGridWarning: null,
    showViolations: true,
    showLinks: false,
    uiScale: 1.2,
    themeId: 'classic',
    eraseAll: vi.fn(),
    setThreshold: vi.fn(),
    setShowViolations: vi.fn(),
    setShowLinks: vi.fn(),
    setUiScale: vi.fn(),
    setBackgroundImage: vi.fn(),
    setGridColor: vi.fn(),
    allocate: vi.fn(),
    smartShuffle: vi.fn(),
    clearArrangement: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    ...overrides,
  } as unknown as Store);

function makeCtx(storeOverrides?: Partial<Store>): EditorContext {
  return {
    store: makeStoreMock(storeOverrides),
    canvas: makeCanvasMock(),
    persistence: null,
  };
}

/** Minimal fake editor — SidePanel renders a div with a known testid. */
function makeFakeEditor(id: string, sidePanelTestId: string): EditorMode {
  return {
    id,
    label: id,
    Toolbar: () => React.createElement('div', {}, 'toolbar'),
    SidePanel: () => React.createElement('div', { 'data-testid': sidePanelTestId }, 'panel'),
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

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// A. Shell SidePanel wrapper — constant width across editors
// ---------------------------------------------------------------------------

describe('A. Shell SidePanel wrapper — constant width across editors', () => {
  beforeEach(() => { resetStore(); });

  it('A1: shell SidePanel wrapper exports the SIDE_PANEL_WIDTH constant', () => {
    // The constant must exist and be a positive integer
    expect(typeof SIDE_PANEL_WIDTH).toBe('number');
    expect(SIDE_PANEL_WIDTH).toBeGreaterThan(0);
  });

  it('A2: shell SidePanel wrapper has width equal to SIDE_PANEL_WIDTH for FurnitureEditor', () => {
    const { container } = render(
      React.createElement(SidePanel, {
        activeEditor: FurnitureEditor,
        ctx: makeCtx(),
      }),
    );
    const wrapper = container.firstElementChild as HTMLElement;
    // All three width properties should be set to the same constant
    expect(wrapper.style.width).toBe(`${SIDE_PANEL_WIDTH.toString()}px`);
    expect(wrapper.style.minWidth).toBe(`${SIDE_PANEL_WIDTH.toString()}px`);
    expect(wrapper.style.maxWidth).toBe(`${SIDE_PANEL_WIDTH.toString()}px`);
  });

  it('A3: shell SidePanel wrapper has the SAME width for FurnitureEditor and StudentEditor', () => {
    const { container: cFurniture } = render(
      React.createElement(SidePanel, {
        activeEditor: FurnitureEditor,
        ctx: makeCtx(),
      }),
    );
    const wrapperFurniture = cFurniture.firstElementChild as HTMLElement;

    cleanup();

    resetStore();
    act(() => { usePijonStore.getState().setActiveEditorId('student'); });

    const { container: cStudents } = render(
      React.createElement(SidePanel, {
        activeEditor: StudentEditor,
        ctx: makeCtx({ activeEditorId: 'student' }),
      }),
    );
    const wrapperStudents = cStudents.firstElementChild as HTMLElement;

    expect(wrapperFurniture.style.width).toBe(wrapperStudents.style.width);
    expect(wrapperFurniture.style.minWidth).toBe(wrapperStudents.style.minWidth);
    expect(wrapperFurniture.style.maxWidth).toBe(wrapperStudents.style.maxWidth);
  });

  it('A4: shell SidePanel wrapper width is identical across two arbitrary editors', () => {
    const editorA = makeFakeEditor('alpha', 'sp-alpha');
    const editorB = makeFakeEditor('beta', 'sp-beta');
    const ctx = makeCtx();

    const { container, rerender } = render(
      React.createElement(SidePanel, { activeEditor: editorA, ctx }),
    );
    const widthA = (container.firstElementChild as HTMLElement).style.width;

    rerender(React.createElement(SidePanel, { activeEditor: editorB, ctx }));
    const widthB = (container.firstElementChild as HTMLElement).style.width;

    expect(widthA).toBe(widthB);
    expect(widthA).toBe(`${SIDE_PANEL_WIDTH.toString()}px`);
  });

  it('A5: shell SidePanel wrapper has height:100%', () => {
    const { container } = render(
      React.createElement(SidePanel, {
        activeEditor: FurnitureEditor,
        ctx: makeCtx(),
      }),
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.height).toBe('100%');
  });

  it('A6: shell SidePanel has data-testid="shell-side-panel"', () => {
    render(
      React.createElement(SidePanel, {
        activeEditor: FurnitureEditor,
        ctx: makeCtx(),
      }),
    );
    expect(screen.getByTestId('shell-side-panel')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// B. FurnitureSidePanel — stretches to fill full height
// ---------------------------------------------------------------------------

describe('B. FurnitureSidePanel — fills full height of its container', () => {
  beforeEach(() => { resetStore(); });

  it('B1: FurnitureSidePanel root element has height:100%', () => {
    const { container } = render(
      React.createElement(SidePanel, {
        activeEditor: FurnitureEditor,
        ctx: makeCtx(),
      }),
    );
    // The shell wrapper is the first element; its first child is FurnitureSidePanel root
    const wrapper = container.firstElementChild as HTMLElement;
    const palettePanelRoot = wrapper.firstElementChild as HTMLElement;
    expect(palettePanelRoot.style.height).toBe('100%');
  });

  it('B2: FurnitureSidePanel root element has width:100% (defers to shell wrapper)', () => {
    const { container } = render(
      React.createElement(SidePanel, {
        activeEditor: FurnitureEditor,
        ctx: makeCtx(),
      }),
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const palettePanelRoot = wrapper.firstElementChild as HTMLElement;
    expect(palettePanelRoot.style.width).toBe('100%');
  });

  it('B3: FurnitureSidePanel root element has display:flex and flex-direction:column', () => {
    const { container } = render(
      React.createElement(SidePanel, {
        activeEditor: FurnitureEditor,
        ctx: makeCtx(),
      }),
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const palettePanelRoot = wrapper.firstElementChild as HTMLElement;
    expect(palettePanelRoot.style.display).toBe('flex');
    expect(palettePanelRoot.style.flexDirection).toBe('column');
  });
});

// ---------------------------------------------------------------------------
// C. StudentEditor SidePanel — defers width to shell wrapper
// ---------------------------------------------------------------------------

describe('C. StudentEditor SidePanel — defers width to shell wrapper', () => {
  beforeEach(() => { resetStore(); });

  it('C1: StudentEditor SidePanel root element has width:100% (no fixed px override)', () => {
    act(() => { usePijonStore.getState().setActiveEditorId('student'); });
    const { container } = render(
      React.createElement(SidePanel, {
        activeEditor: StudentEditor,
        ctx: makeCtx({ activeEditorId: 'student' }),
      }),
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const rosterRoot = wrapper.firstElementChild as HTMLElement;
    expect(rosterRoot.style.width).toBe('100%');
  });

  it('C2: StudentEditor SidePanel root element has height:100%', () => {
    act(() => { usePijonStore.getState().setActiveEditorId('student'); });
    const { container } = render(
      React.createElement(SidePanel, {
        activeEditor: StudentEditor,
        ctx: makeCtx({ activeEditorId: 'student' }),
      }),
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const rosterRoot = wrapper.firstElementChild as HTMLElement;
    expect(rosterRoot.style.height).toBe('100%');
  });
});

// ---------------------------------------------------------------------------
// D. FurnitureToolbar primary row — nowrap + minHeight
// ---------------------------------------------------------------------------

describe('D. FurnitureToolbar — primary row is nowrap with constant minHeight', () => {
  beforeEach(() => { resetStore(); });

  it('D1: FurnitureToolbar primary row has flex-wrap:nowrap', () => {
    const { container } = render(
      React.createElement(FurnitureEditor.Toolbar, { ctx: makeCtx() }),
    );
    // The outer container is flex-direction:column; find the main row (last flex child)
    const outerContainer = container.firstElementChild as HTMLElement;
    // Find the main toolbar row — it has padding:'5px 10px' and minHeight
    const mainRow = Array.from(outerContainer.children).find(
      (el) => (el as HTMLElement).style.minHeight === '40px',
    ) as HTMLElement | undefined;
    expect(mainRow).toBeDefined();
    expect(mainRow?.style.flexWrap).toBe('nowrap');
  });

  it('D2: FurnitureToolbar primary row has minHeight:40px', () => {
    const { container } = render(
      React.createElement(FurnitureEditor.Toolbar, { ctx: makeCtx() }),
    );
    const outerContainer = container.firstElementChild as HTMLElement;
    const mainRow = Array.from(outerContainer.children).find(
      (el) => (el as HTMLElement).style.minHeight === '40px',
    ) as HTMLElement | undefined;
    expect(mainRow).toBeDefined();
    expect(mainRow?.style.minHeight).toBe('40px');
  });
});

// ---------------------------------------------------------------------------
// E. StudentEditor toolbar primary row — nowrap + minHeight
// ---------------------------------------------------------------------------

describe('E. StudentEditor toolbar — primary row is nowrap with constant minHeight', () => {
  beforeEach(() => { resetStore(); });

  it('E1: StudentEditor Toolbar primary row has flex-wrap:nowrap', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'student' }); });
    const { container } = render(
      React.createElement(StudentEditor.Toolbar, { ctx: makeCtx({ activeEditorId: 'student' }) }),
    );
    // The toolbar is a React Fragment; container.firstElementChild is the first div
    const mainRow = container.firstElementChild as HTMLElement;
    expect(mainRow.style.flexWrap).toBe('nowrap');
  });

  it('E2: StudentEditor Toolbar primary row has minHeight:40px', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'student' }); });
    const { container } = render(
      React.createElement(StudentEditor.Toolbar, { ctx: makeCtx({ activeEditorId: 'student' }) }),
    );
    const mainRow = container.firstElementChild as HTMLElement;
    expect(mainRow.style.minHeight).toBe('40px');
  });

  it('E3: FurnitureToolbar and StudentEditor Toolbar primary rows have the same minHeight', () => {
    const { container: cFurniture } = render(
      React.createElement(FurnitureEditor.Toolbar, { ctx: makeCtx() }),
    );
    const furnitureOuter = cFurniture.firstElementChild as HTMLElement;
    const furnitureRow = Array.from(furnitureOuter.children).find(
      (el) => (el as HTMLElement).style.minHeight === '40px',
    ) as HTMLElement | undefined;

    cleanup();

    act(() => { usePijonStore.setState({ activeEditorId: 'student' }); });
    const { container: cStudents } = render(
      React.createElement(StudentEditor.Toolbar, { ctx: makeCtx({ activeEditorId: 'student' }) }),
    );
    const studentRow = cStudents.firstElementChild as HTMLElement;

    expect(furnitureRow?.style.minHeight).toBe(studentRow.style.minHeight);
  });
});

// ---------------------------------------------------------------------------
// F. TopBar — constant minHeight present
// ---------------------------------------------------------------------------

describe('F. TopBar — constant minHeight present', () => {
  beforeEach(() => { resetStore(); });

  it('F1: TopBar has minHeight:40px in Furniture mode', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'furniture' }); });
    render(
      React.createElement(TopBar, {
        activeEditor: FurnitureEditor,
        ctx: makeCtx(),
      }),
    );
    const topBar = screen.getByTestId('top-bar');
    expect(topBar.style.minHeight).toBe('40px');
  });

  it('F2: TopBar has minHeight:40px in Students mode', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'student' }); });
    render(
      React.createElement(TopBar, {
        activeEditor: StudentEditor,
        ctx: makeCtx({ activeEditorId: 'student' }),
      }),
    );
    const topBar = screen.getByTestId('top-bar');
    expect(topBar.style.minHeight).toBe('40px');
  });

  it('F3: TopBar minHeight is identical in Furniture and Students modes', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'furniture' }); });
    const { container: cFurniture } = render(
      React.createElement(TopBar, {
        activeEditor: FurnitureEditor,
        ctx: makeCtx(),
      }),
    );
    const topBarFurniture = cFurniture.querySelector<HTMLElement>('[data-testid="top-bar"]');
    expect(topBarFurniture).not.toBeNull();
    const minHeightFurniture = topBarFurniture!.style.minHeight;

    cleanup();
    resetStore();

    act(() => { usePijonStore.setState({ activeEditorId: 'student' }); });
    const { container: cStudents } = render(
      React.createElement(TopBar, {
        activeEditor: StudentEditor,
        ctx: makeCtx({ activeEditorId: 'student' }),
      }),
    );
    const topBarStudents = cStudents.querySelector<HTMLElement>('[data-testid="top-bar"]');
    expect(topBarStudents).not.toBeNull();
    const minHeightStudents = topBarStudents!.style.minHeight;

    expect(minHeightFurniture).toBe(minHeightStudents);
    expect(minHeightFurniture).toBe('40px');
  });
});

// ---------------------------------------------------------------------------
// G. App integration — both modes have same left-panel width and top-bar minHeight
// ---------------------------------------------------------------------------

describe('G. App integration — constant layout dimensions across editor modes', () => {
  beforeEach(() => { resetStore(); });

  it('G1: shell-side-panel wrapper has the same width in both editor modes', () => {
    // Start in default Furniture mode
    act(() => {
      usePijonStore.getState().eraseAll();
      usePijonStore.getState().setActiveEditorId(EDITOR_REGISTRY[0]?.id ?? 'furniture');
    });

    const { container } = render(React.createElement(App));

    const sidePanelFurniture = container.querySelector<HTMLElement>('[data-testid="shell-side-panel"]');
    expect(sidePanelFurniture).not.toBeNull();
    const widthFurniture = sidePanelFurniture!.style.width;

    // Switch to Students mode
    act(() => {
      usePijonStore.getState().setActiveEditorId(EDITOR_REGISTRY[1]?.id ?? 'student');
    });

    const sidePanelStudents = container.querySelector<HTMLElement>('[data-testid="shell-side-panel"]');
    expect(sidePanelStudents).not.toBeNull();
    const widthStudents = sidePanelStudents!.style.width;

    expect(widthFurniture).toBe(`${SIDE_PANEL_WIDTH.toString()}px`);
    expect(widthStudents).toBe(`${SIDE_PANEL_WIDTH.toString()}px`);
    expect(widthFurniture).toBe(widthStudents);
  });

  it('G2: top-bar minHeight is the same in both editor modes', () => {
    act(() => {
      usePijonStore.getState().eraseAll();
      usePijonStore.getState().setActiveEditorId(EDITOR_REGISTRY[0]?.id ?? 'furniture');
    });

    const { container } = render(React.createElement(App));

    const topBarFurniture = container.querySelector<HTMLElement>('[data-testid="top-bar"]');
    expect(topBarFurniture).not.toBeNull();
    const minHeightFurniture = topBarFurniture!.style.minHeight;

    act(() => {
      usePijonStore.getState().setActiveEditorId(EDITOR_REGISTRY[1]?.id ?? 'student');
    });

    const topBarStudents = container.querySelector<HTMLElement>('[data-testid="top-bar"]');
    expect(topBarStudents).not.toBeNull();
    const minHeightStudents = topBarStudents!.style.minHeight;

    expect(minHeightFurniture).toBe(minHeightStudents);
    expect(minHeightFurniture).toBe('40px');
  });

  it('G3: shell-side-panel minWidth and maxWidth also equal SIDE_PANEL_WIDTH in both modes', () => {
    act(() => {
      usePijonStore.getState().eraseAll();
      usePijonStore.getState().setActiveEditorId(EDITOR_REGISTRY[0]?.id ?? 'furniture');
    });

    const { container } = render(React.createElement(App));

    const spFurniture = container.querySelector<HTMLElement>('[data-testid="shell-side-panel"]');
    expect(spFurniture).not.toBeNull();
    expect(spFurniture!.style.minWidth).toBe(`${SIDE_PANEL_WIDTH.toString()}px`);
    expect(spFurniture!.style.maxWidth).toBe(`${SIDE_PANEL_WIDTH.toString()}px`);

    act(() => {
      usePijonStore.getState().setActiveEditorId(EDITOR_REGISTRY[1]?.id ?? 'student');
    });

    const spStudents = container.querySelector<HTMLElement>('[data-testid="shell-side-panel"]');
    expect(spStudents).not.toBeNull();
    expect(spStudents!.style.minWidth).toBe(`${SIDE_PANEL_WIDTH.toString()}px`);
    expect(spStudents!.style.maxWidth).toBe(`${SIDE_PANEL_WIDTH.toString()}px`);
  });
});

// ---------------------------------------------------------------------------
// H. Hardening — gap-filling tests
// ---------------------------------------------------------------------------

describe('H. Hardening — gap-filling layout tests', () => {
  beforeEach(() => { resetStore(); });

  it('H1: A3 value check — Furniture and Students wrappers both equal SIDE_PANEL_WIDTH exactly (not just equal to each other)', () => {
    const { container: cFurniture } = render(
      React.createElement(SidePanel, {
        activeEditor: FurnitureEditor,
        ctx: makeCtx(),
      }),
    );
    const wFurniture = cFurniture.firstElementChild as HTMLElement;
    expect(wFurniture.style.width).toBe(`${SIDE_PANEL_WIDTH.toString()}px`);

    cleanup();
    resetStore();

    act(() => { usePijonStore.getState().setActiveEditorId('student'); });
    const { container: cStudents } = render(
      React.createElement(SidePanel, {
        activeEditor: StudentEditor,
        ctx: makeCtx({ activeEditorId: 'student' }),
      }),
    );
    const wStudents = cStudents.firstElementChild as HTMLElement;
    expect(wStudents.style.width).toBe(`${SIDE_PANEL_WIDTH.toString()}px`);
  });

  it('H2: StudentEditor toolbar row uses overflowX:auto so controls scroll rather than being silently clipped at narrow widths', () => {
    act(() => { usePijonStore.setState({ activeEditorId: 'student' }); });
    const { container } = render(
      React.createElement(StudentEditor.Toolbar, { ctx: makeCtx({ activeEditorId: 'student' }) }),
    );
    const mainRow = container.firstElementChild as HTMLElement;
    // Must NOT use overflow:hidden which silently clips Export/Import/Assigner at narrow widths.
    // overflowX must be auto or scroll (allows horizontal scrolling).
    expect(['auto', 'scroll']).toContain(mainRow.style.overflowX);
    // Vertical overflow must still be hidden to prevent height bleed that undoes the fix.
    expect(mainRow.style.overflowY).toBe('hidden');
  });

  it('H3: toggle from Furniture to Students keeps shell-side-panel width, minWidth, and maxWidth unchanged', () => {
    act(() => {
      usePijonStore.getState().eraseAll();
      usePijonStore.getState().setActiveEditorId(EDITOR_REGISTRY[0]?.id ?? 'furniture');
    });

    const { container } = render(React.createElement(App));

    const beforeToggle = container.querySelector<HTMLElement>('[data-testid="shell-side-panel"]');
    expect(beforeToggle).not.toBeNull();
    const widthBefore = beforeToggle!.style.width;
    const minWidthBefore = beforeToggle!.style.minWidth;
    const maxWidthBefore = beforeToggle!.style.maxWidth;

    act(() => {
      usePijonStore.getState().setActiveEditorId(EDITOR_REGISTRY[1]?.id ?? 'student');
    });

    const afterToggle = container.querySelector<HTMLElement>('[data-testid="shell-side-panel"]');
    expect(afterToggle).not.toBeNull();
    expect(afterToggle!.style.width).toBe(widthBefore);
    expect(afterToggle!.style.minWidth).toBe(minWidthBefore);
    expect(afterToggle!.style.maxWidth).toBe(maxWidthBefore);
    expect(widthBefore).toBe(`${SIDE_PANEL_WIDTH.toString()}px`);
  });
});
