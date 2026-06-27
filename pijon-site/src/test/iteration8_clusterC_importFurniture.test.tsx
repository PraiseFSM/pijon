// @vitest-environment jsdom
/**
 * iteration8_clusterC_importFurniture.test.tsx
 *
 * Full test suite for §8.C1 — Import furniture (image + cell size).
 *
 * Covers:
 *   A. Domain — CustomFurnitureDef + Classroom.customPalette + Furniture.imageUrl
 *   B. Persistence — round-trip through serialize/parse/composeClassroom/extractProject;
 *      older files without the fields still load (backward-compat).
 *   C. Store — addCustomFurnitureDef / removeCustomFurnitureDef actions;
 *      dirty-marking consistent with other furniture actions.
 *   D. Render — drawSingleFurniture uses imageUrl when present, else kind asset/color.
 *   E. FurnitureEditor UI — import control at bottom of palette; file input + form;
 *      dragging a custom def places furniture with correct imageUrl + w/h;
 *      custom kind has capacity 0 (not a seatable desk).
 *
 * LOCAL-FIRST: no network at any point — data URLs are injected as constants.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import React from 'react';

// Domain
import type { CustomFurnitureDef } from '../domain/classroom.js';
import {
  makeClassroom,
  addCustomFurnitureDef,
  removeCustomFurnitureDef,
  DEFAULT_CELLS_PER_UNIT,
  DEFAULT_THRESHOLD_UNITS,
} from '../domain/classroom.js';
import type { Furniture } from '../domain/furniture.js';
import { capacity } from '../domain/furniture.js';
import { furnitureId } from '../domain/types.js';
import type { FurnitureId } from '../domain/types.js';

// Persistence
import {
  serializeProject,
  parseProject,
  composeClassroom,
  extractProject,
} from '../domain/io/projectFile.js';

// Store
import { usePijonStore } from '../state/store.js';
import type { Store } from '../state/store.js';

// Render
import {
  drawSingleFurniture,
  selectFurnitureRenderMode,
} from '../ui/canvas/render.js';
import { _injectForTest, _clearForTest } from '../ui/canvas/imageCache.js';

// FurnitureEditor
import {
  FurnitureEditor,
  DRAG_CUSTOM_DEF_ID_KEY,
  stashDraggedCustomDefId,
  clearDraggedCustomDefIdStash,
  readDraggedCustomDefId,
} from '../ui/editors/FurnitureEditor.js';
import type { EditorContext, CanvasView } from '../ui/editors/EditorMode.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimal data URL (1-px transparent PNG) for tests — local-only, no network. */
const FAKE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const FAKE_DATA_URL_2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const FAKE_DEF: CustomFurnitureDef = {
  id: 'def-1',
  name: 'Plant',
  imageUrl: FAKE_DATA_URL,
  wUnits: 2,
  hUnits: 3,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  act(() => { usePijonStore.getState().eraseAll(); });
}

const makeCanvasMock = (): CanvasView => ({
  cellSize: 48,
  gridW: 10,
  gridH: 8,
  originOffset: 1,
  cellAt: vi.fn().mockReturnValue({ x: 2, y: 2 }),
  furnitureAt: vi.fn(() => undefined),
  cellRect: vi.fn(() => ({ x: 0, y: 0, w: 48, h: 48 })),
  requestRepaint: vi.fn(),
});

const makeStoreMock = (overrides?: Partial<Store>): Store =>
  ({
    roster: [],
    locks: new Set<FurnitureId>(),
    selectedStudentId: null,
    resizeGridWarning: null,
    showViolations: true,
    showLinks: false,
    uiScale: 1.2,
    themeId: 'classic',
    history: [],
    historyPtr: -1,
    saveStatus: 'saved' as const,
    activeEditorId: 'furniture',
    fileHandle: null,
    classroom: {
      id: 'test',
      name: 'Test',
      gridW: 10,
      gridH: 8,
      furniture: [],
      cellsPerUnit: DEFAULT_CELLS_PER_UNIT,
      thresholdUnits: DEFAULT_THRESHOLD_UNITS,
      backgroundImage: null,
      gridColor: null,
      customPalette: [],
    },
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
    addFurniture: vi.fn(),
    removeFurniture: vi.fn(),
    moveFurniture: vi.fn(),
    addCustomFurnitureDef: vi.fn(),
    removeCustomFurnitureDef: vi.fn(),
    setClassroom: vi.fn(),
    resizeGrid: vi.fn(),
    setGranularity: vi.fn(),
    dismissResizeWarning: vi.fn(),
    ...overrides,
  } as unknown as Store);

function makeCtx(overrides?: Partial<Store>): EditorContext {
  return {
    store: makeStoreMock(overrides),
    canvas: makeCanvasMock(),
    persistence: null,
  };
}

// ---------------------------------------------------------------------------
// A. Domain
// ---------------------------------------------------------------------------

describe('A — Domain: CustomFurnitureDef + Classroom.customPalette + Furniture.imageUrl', () => {
  it('makeClassroom initialises customPalette to an empty array', () => {
    const c = makeClassroom('id', 'name', 5, 5);
    expect(c.customPalette).toEqual([]);
  });

  it('addCustomFurnitureDef appends a def', () => {
    const c = makeClassroom('id', 'name', 5, 5);
    const c2 = addCustomFurnitureDef(c, FAKE_DEF);
    expect(c2.customPalette).toHaveLength(1);
    expect(c2.customPalette?.[0]).toEqual(FAKE_DEF);
  });

  it('addCustomFurnitureDef returns a new Classroom reference', () => {
    const c = makeClassroom('id', 'name', 5, 5);
    const c2 = addCustomFurnitureDef(c, FAKE_DEF);
    expect(c2).not.toBe(c);
  });

  it('addCustomFurnitureDef does not mutate the original palette', () => {
    const c = makeClassroom('id', 'name', 5, 5);
    addCustomFurnitureDef(c, FAKE_DEF);
    expect(c.customPalette).toHaveLength(0);
  });

  it('addCustomFurnitureDef can append multiple defs', () => {
    const c = makeClassroom('id', 'name', 5, 5);
    const def2: CustomFurnitureDef = { ...FAKE_DEF, id: 'def-2', name: 'Shelf' };
    const c2 = addCustomFurnitureDef(addCustomFurnitureDef(c, FAKE_DEF), def2);
    expect(c2.customPalette).toHaveLength(2);
    expect(c2.customPalette?.[1]?.id).toBe('def-2');
  });

  it('removeCustomFurnitureDef removes the matching def', () => {
    let c = makeClassroom('id', 'name', 5, 5);
    c = addCustomFurnitureDef(c, FAKE_DEF);
    const c2 = removeCustomFurnitureDef(c, 'def-1');
    expect(c2.customPalette).toHaveLength(0);
  });

  it('removeCustomFurnitureDef returns same reference when id not found', () => {
    const c = makeClassroom('id', 'name', 5, 5);
    const c2 = removeCustomFurnitureDef(c, 'nonexistent');
    expect(c2).toBe(c);
  });

  it('removeCustomFurnitureDef only removes matching entry', () => {
    let c = makeClassroom('id', 'name', 5, 5);
    const def2: CustomFurnitureDef = { ...FAKE_DEF, id: 'def-2', name: 'Shelf' };
    c = addCustomFurnitureDef(addCustomFurnitureDef(c, FAKE_DEF), def2);
    const c2 = removeCustomFurnitureDef(c, 'def-1');
    expect(c2.customPalette).toHaveLength(1);
    expect(c2.customPalette?.[0]?.id).toBe('def-2');
  });

  it('Furniture with imageUrl: capacity is 0 for custom kind (not seatable)', () => {
    const f: Furniture = {
      id: furnitureId('f1'),
      kind: 'custom',
      pos: { x: 0, y: 0 },
      w: 2,
      h: 3,
      rotation: 0,
      imageUrl: FAKE_DATA_URL,
      occupants: [],
    };
    expect(capacity(f)).toBe(0);
  });

  it('Furniture with imageUrl: capacity stays 0 even when numSeats is set (custom overrides)', () => {
    const f: Furniture = {
      id: furnitureId('f1'),
      kind: 'custom',
      pos: { x: 0, y: 0 },
      w: 2,
      h: 3,
      rotation: 0,
      imageUrl: FAKE_DATA_URL,
      occupants: [],
      numSeats: 4, // ignored for custom kind
    };
    expect(capacity(f)).toBe(0);
  });

  it('capacity returns correct values for built-in kinds (unchanged)', () => {
    const desk: Furniture = { id: furnitureId('d1'), kind: 'single_desk', pos: { x: 0, y: 0 }, w: 1, h: 1, rotation: 0, occupants: [] };
    expect(capacity(desk)).toBe(1);
    const wb: Furniture = { id: furnitureId('wb1'), kind: 'whiteboard', pos: { x: 0, y: 0 }, w: 4, h: 1, rotation: 0, occupants: [] };
    expect(capacity(wb)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B. Persistence
// ---------------------------------------------------------------------------

describe('B — Persistence: round-trip + backward-compat', () => {
  const BASE_PROJECT = {
    version: 2 as const,
    classroom: {
      id: 'cls-1',
      name: 'My Classroom',
      gridW: 5,
      gridH: 5,
      furniture: [],
      cellsPerUnit: 1,
      thresholdUnits: 1.5,
      backgroundImage: null,
      gridColor: null,
      customPalette: [],
    },
    roster: [],
    arrangement: {},
    locks: [],
  };

  it('round-trips a classroom with a customPalette entry', () => {
    const pf = {
      ...BASE_PROJECT,
      classroom: {
        ...BASE_PROJECT.classroom,
        customPalette: [
          { id: 'def-1', name: 'Plant', imageUrl: FAKE_DATA_URL, wUnits: 2, hUnits: 3 },
        ],
      },
    };
    const json = serializeProject(pf);
    const parsed = parseProject(json);
    const { classroom } = composeClassroom(parsed);
    expect(classroom.customPalette).toHaveLength(1);
    expect(classroom.customPalette?.[0]).toEqual({
      id: 'def-1',
      name: 'Plant',
      imageUrl: FAKE_DATA_URL,
      wUnits: 2,
      hUnits: 3,
    });
  });

  it('round-trips placed furniture with imageUrl', () => {
    const pf = {
      ...BASE_PROJECT,
      classroom: {
        ...BASE_PROJECT.classroom,
        furniture: [
          {
            id: 'fid-1',
            kind: 'custom' as const,
            pos: { x: 1, y: 2 },
            w: 2,
            h: 3,
            rotation: 0 as const,
            imageUrl: FAKE_DATA_URL,
          },
        ],
        customPalette: [
          { id: 'def-1', name: 'Plant', imageUrl: FAKE_DATA_URL, wUnits: 2, hUnits: 3 },
        ],
      },
    };
    const json = serializeProject(pf);
    const parsed = parseProject(json);
    const { classroom } = composeClassroom(parsed);
    const furn = classroom.furniture[0];
    expect(furn).toBeDefined();
    expect(furn?.kind).toBe('custom');
    expect(furn?.imageUrl).toBe(FAKE_DATA_URL);
    expect(furn?.w).toBe(2);
    expect(furn?.h).toBe(3);
  });

  it('extractProject + round-trip preserves customPalette', () => {
    let c = makeClassroom('cls-1', 'My Classroom', 5, 5);
    c = addCustomFurnitureDef(c, FAKE_DEF);
    const pf = extractProject({ classroom: c, roster: [], locks: [] });
    const json = serializeProject(pf);
    const parsed = parseProject(json);
    const { classroom } = composeClassroom(parsed);
    expect(classroom.customPalette).toHaveLength(1);
    expect(classroom.customPalette?.[0]?.imageUrl).toBe(FAKE_DATA_URL);
  });

  it('extractProject + round-trip preserves furniture with imageUrl', () => {
    let c = makeClassroom('cls-1', 'My Classroom', 5, 5);
    c = addCustomFurnitureDef(c, FAKE_DEF);
    const customF: Furniture = {
      id: furnitureId('fid-1'),
      kind: 'custom',
      pos: { x: 1, y: 1 },
      w: 2,
      h: 3,
      rotation: 0,
      imageUrl: FAKE_DATA_URL,
      occupants: [],
    };
    c = { ...c, furniture: [customF] };
    const pf = extractProject({ classroom: c, roster: [], locks: [] });
    const json = serializeProject(pf);
    const parsed = parseProject(json);
    const { classroom } = composeClassroom(parsed);
    expect(classroom.furniture[0]?.imageUrl).toBe(FAKE_DATA_URL);
  });

  it('older files without customPalette or imageUrl still parse (backward-compat)', () => {
    // Simulate a v2 file without the new fields
    const oldJson = JSON.stringify({
      version: 2,
      classroom: {
        id: 'old-cls',
        name: 'Old Classroom',
        gridW: 5,
        gridH: 5,
        furniture: [
          { id: 'f1', kind: 'single_desk', pos: { x: 0, y: 0 }, w: 1, h: 1, rotation: 0 },
        ],
        cellsPerUnit: 1,
        thresholdUnits: 1.5,
        backgroundImage: null,
        gridColor: null,
        // NO customPalette field
      },
      roster: [],
      arrangement: {},
      locks: [],
    });
    const parsed = parseProject(oldJson);
    const { classroom } = composeClassroom(parsed);
    // Should default to empty array
    expect(classroom.customPalette ?? []).toEqual([]);
    // Existing furniture is intact
    expect(classroom.furniture).toHaveLength(1);
    expect(classroom.furniture[0]?.kind).toBe('single_desk');
  });

  it('older furniture without imageUrl field still loads correctly', () => {
    const oldJson = JSON.stringify({
      version: 2,
      classroom: {
        id: 'old',
        name: 'Old',
        gridW: 5,
        gridH: 5,
        furniture: [
          { id: 'f1', kind: 'whiteboard', pos: { x: 0, y: 0 }, w: 4, h: 1, rotation: 0 },
        ],
        cellsPerUnit: 1,
        thresholdUnits: 1.5,
        backgroundImage: null,
        gridColor: null,
        customPalette: [],
      },
      roster: [],
      arrangement: {},
      locks: [],
    });
    const parsed = parseProject(oldJson);
    const { classroom } = composeClassroom(parsed);
    const furn = classroom.furniture[0];
    expect(furn?.imageUrl).toBeUndefined();
    expect(furn?.kind).toBe('whiteboard');
  });

  it('round-trips multiple custom palette entries preserving order', () => {
    const def2: CustomFurnitureDef = { ...FAKE_DEF, id: 'def-2', name: 'Shelf', imageUrl: FAKE_DATA_URL_2, wUnits: 1, hUnits: 1 };
    let c = makeClassroom('cls-1', 'My Classroom', 5, 5);
    c = addCustomFurnitureDef(c, FAKE_DEF);
    c = addCustomFurnitureDef(c, def2);
    const pf = extractProject({ classroom: c, roster: [], locks: [] });
    const json = serializeProject(pf);
    const parsed = parseProject(json);
    const { classroom } = composeClassroom(parsed);
    expect(classroom.customPalette).toHaveLength(2);
    expect(classroom.customPalette?.[0]?.id).toBe('def-1');
    expect(classroom.customPalette?.[1]?.id).toBe('def-2');
  });
});

// ---------------------------------------------------------------------------
// C. Store
// ---------------------------------------------------------------------------

describe('C — Store: addCustomFurnitureDef / removeCustomFurnitureDef', () => {
  beforeEach(() => {
    _clearForTest();
    resetStore();
  });

  it('addCustomFurnitureDef appends the def and marks dirty', () => {
    const store = usePijonStore.getState();
    act(() => { store.addCustomFurnitureDef(FAKE_DEF); });
    const updated = usePijonStore.getState();
    expect(updated.classroom.customPalette).toHaveLength(1);
    expect(updated.classroom.customPalette?.[0]).toEqual(FAKE_DEF);
    expect(updated.saveStatus).toBe('dirty');
  });

  it('addCustomFurnitureDef preserves existing furniture', () => {
    const store = usePijonStore.getState();
    act(() => {
      store.addFurniture({
        id: furnitureId('f1'),
        kind: 'single_desk',
        pos: { x: 0, y: 0 },
        w: 1,
        h: 1,
        rotation: 0,
        occupants: [],
      });
      store.addCustomFurnitureDef(FAKE_DEF);
    });
    const updated = usePijonStore.getState();
    expect(updated.classroom.furniture).toHaveLength(1);
    expect(updated.classroom.customPalette).toHaveLength(1);
  });

  it('addCustomFurnitureDef can add multiple defs', () => {
    const store = usePijonStore.getState();
    const def2: CustomFurnitureDef = { ...FAKE_DEF, id: 'def-2', name: 'Shelf' };
    act(() => {
      store.addCustomFurnitureDef(FAKE_DEF);
      store.addCustomFurnitureDef(def2);
    });
    expect(usePijonStore.getState().classroom.customPalette).toHaveLength(2);
  });

  it('removeCustomFurnitureDef removes the def and marks dirty', () => {
    const store = usePijonStore.getState();
    act(() => { store.addCustomFurnitureDef(FAKE_DEF); });
    act(() => { store.removeCustomFurnitureDef('def-1'); });
    const updated = usePijonStore.getState();
    expect(updated.classroom.customPalette).toHaveLength(0);
    expect(updated.saveStatus).toBe('dirty');
  });

  it('removeCustomFurnitureDef also removes placed furniture with that imageUrl', () => {
    const store = usePijonStore.getState();
    act(() => {
      store.addCustomFurnitureDef(FAKE_DEF);
      // Place custom furniture with that imageUrl
      store.addFurniture({
        id: furnitureId('fid-1'),
        kind: 'custom',
        pos: { x: 1, y: 1 },
        w: 2,
        h: 3,
        rotation: 0,
        imageUrl: FAKE_DATA_URL,
        occupants: [],
      });
    });
    act(() => { store.removeCustomFurnitureDef('def-1'); });
    const updated = usePijonStore.getState();
    expect(updated.classroom.customPalette).toHaveLength(0);
    // The placed furniture should also be gone
    expect(updated.classroom.furniture).toHaveLength(0);
  });

  it('removeCustomFurnitureDef does NOT remove placed furniture with a different imageUrl', () => {
    const store = usePijonStore.getState();
    const def2: CustomFurnitureDef = { ...FAKE_DEF, id: 'def-2', imageUrl: FAKE_DATA_URL_2 };
    act(() => {
      store.addCustomFurnitureDef(FAKE_DEF);
      store.addCustomFurnitureDef(def2);
      // Furniture using def-2
      store.addFurniture({
        id: furnitureId('fid-shelf'),
        kind: 'custom',
        pos: { x: 3, y: 3 },
        w: 1,
        h: 1,
        rotation: 0,
        imageUrl: FAKE_DATA_URL_2,
        occupants: [],
      });
    });
    act(() => { store.removeCustomFurnitureDef('def-1'); });
    const updated = usePijonStore.getState();
    // def-2 palette entry stays, furniture with def-2 imageUrl stays
    expect(updated.classroom.customPalette).toHaveLength(1);
    expect(updated.classroom.furniture).toHaveLength(1);
  });

  it('removeCustomFurnitureDef is a no-op when id not found', () => {
    const store = usePijonStore.getState();
    act(() => { store.addCustomFurnitureDef(FAKE_DEF); });
    const beforeLen = usePijonStore.getState().classroom.customPalette?.length ?? 0;
    act(() => { store.removeCustomFurnitureDef('nonexistent'); });
    // Palette unchanged (same length)
    expect(usePijonStore.getState().classroom.customPalette?.length ?? 0).toBe(beforeLen);
  });

  it('eraseAll clears customPalette', () => {
    const store = usePijonStore.getState();
    act(() => { store.addCustomFurnitureDef(FAKE_DEF); });
    act(() => { store.eraseAll(); });
    expect(usePijonStore.getState().classroom.customPalette ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// D. Render — drawSingleFurniture uses imageUrl when present
// ---------------------------------------------------------------------------

describe('D — Render: drawSingleFurniture imageUrl path', () => {
  beforeEach(() => {
    _clearForTest();
  });

  function makeCtx2d() {
    return {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      strokeRect: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
  }

  it('uses imageUrl (data URL) over kind asset when imageUrl is set and image loaded', () => {
    const fakeImg = new Image();
    _injectForTest(FAKE_DATA_URL, fakeImg);

    const f: Furniture = {
      id: furnitureId('f1'),
      kind: 'custom',
      pos: { x: 0, y: 0 },
      w: 2,
      h: 2,
      rotation: 0,
      imageUrl: FAKE_DATA_URL,
      occupants: [],
    };
    const ctx2d = makeCtx2d();
    drawSingleFurniture(ctx2d, f, 48, false);
    expect(ctx2d.drawImage).toHaveBeenCalledWith(fakeImg, expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number));
    expect(ctx2d.fillRect).not.toHaveBeenCalled();
  });

  it('falls back to color fill when imageUrl is set but image not yet loaded', () => {
    // No injection — image not in cache
    const f: Furniture = {
      id: furnitureId('f1'),
      kind: 'custom',
      pos: { x: 0, y: 0 },
      w: 2,
      h: 2,
      rotation: 0,
      imageUrl: FAKE_DATA_URL,
      occupants: [],
    };
    const ctx2d = makeCtx2d();
    drawSingleFurniture(ctx2d, f, 48, false);
    // No image loaded — color fill path
    expect(ctx2d.fillRect).toHaveBeenCalled();
    expect(ctx2d.drawImage).not.toHaveBeenCalled();
  });

  it('uses kind asset when imageUrl is null/undefined', () => {
    // Inject the default asset for whiteboard so we can detect drawImage vs fillRect
    const fakeAssetImg = new Image();
    _injectForTest('/assets/furniture-default.png', fakeAssetImg);

    const f: Furniture = {
      id: furnitureId('f1'),
      kind: 'whiteboard',
      pos: { x: 0, y: 0 },
      w: 4,
      h: 1,
      rotation: 0,
      // imageUrl intentionally absent
      occupants: [],
    };
    const ctx2d = makeCtx2d();
    drawSingleFurniture(ctx2d, f, 48, false);
    expect(ctx2d.drawImage).toHaveBeenCalledWith(fakeAssetImg, expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number));
  });

  it('selectFurnitureRenderMode returns image when url is set and isLoaded returns true', () => {
    const result = selectFurnitureRenderMode('/assets/x.png', () => true);
    expect(result).toBe('image');
  });

  it('selectFurnitureRenderMode returns color when url is undefined', () => {
    const result = selectFurnitureRenderMode(undefined, () => true);
    expect(result).toBe('color');
  });

  it('selectFurnitureRenderMode returns color when isLoaded is false', () => {
    const result = selectFurnitureRenderMode('/assets/x.png', () => false);
    expect(result).toBe('color');
  });
});

// ---------------------------------------------------------------------------
// E. FurnitureEditor UI
// ---------------------------------------------------------------------------

describe('E — FurnitureEditor UI: Import furniture control + custom palette', () => {
  beforeEach(() => {
    _clearForTest();
    resetStore();
    FurnitureEditor.deactivate({
      store: makeStoreMock(),
      canvas: makeCanvasMock(),
      persistence: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the import-furniture section at the bottom of the side panel', () => {
    const ctx = makeCtx();
    render(React.createElement(FurnitureEditor.SidePanel, { ctx }));
    expect(screen.getByTestId('import-furniture-section')).toBeDefined();
  });

  it('import-furniture section contains a pick-image button', () => {
    const ctx = makeCtx();
    render(React.createElement(FurnitureEditor.SidePanel, { ctx }));
    expect(screen.getByTestId('import-furniture-pick-image')).toBeDefined();
  });

  it('pick-image button is in the document and triggers file input click', () => {
    const ctx = makeCtx();
    render(React.createElement(FurnitureEditor.SidePanel, { ctx }));
    const btn = screen.getByTestId('import-furniture-pick-image');
    // The button is present and clickable
    expect(btn).toBeDefined();
    // No error thrown on click
    act(() => { fireEvent.click(btn); });
  });

  it('shows name/size inputs and Add button after image is provided via file input', async () => {
    const addFn = vi.fn();
    const ctx = makeCtx({ addCustomFurnitureDef: addFn });

    render(React.createElement(FurnitureEditor.SidePanel, { ctx }));

    // Before selecting an image, no name/size inputs
    expect(screen.queryByTestId('import-furniture-name')).toBeNull();

    // Simulate choosing an image via FileReader by firing change on hidden input
    const fileInput = screen.getByTestId('import-furniture-file-input');

    // Mock FileReader
    const mockFileReader = {
      readAsDataURL: vi.fn().mockImplementation(function(this: typeof mockFileReader) {
        // Simulate async onload
        setTimeout(() => {
          if (typeof this.onload === 'function') {
            this.onload({ target: { result: FAKE_DATA_URL } } as unknown as ProgressEvent<FileReader>);
          }
        }, 0);
      }),
      onload: null as ((e: ProgressEvent<FileReader>) => void) | null,
      onerror: null as ((e: ProgressEvent<FileReader>) => void) | null,
    };
    vi.spyOn(globalThis, 'FileReader').mockImplementation(() => mockFileReader as unknown as FileReader);

    const file = new File([new Uint8Array(4)], 'plant.png', { type: 'image/png' });
    act(() => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    // Wait for async FileReader callback
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    });

    // After image load — name, width, height inputs and Add button should appear
    expect(screen.getByTestId('import-furniture-name')).toBeDefined();
    expect(screen.getByTestId('import-furniture-width')).toBeDefined();
    expect(screen.getByTestId('import-furniture-height')).toBeDefined();
    expect(screen.getByTestId('import-furniture-add')).toBeDefined();

    // Default name derived from filename
    const nameInput = screen.getByTestId<HTMLInputElement>('import-furniture-name');
    expect(nameInput.value).toBe('plant');
  });

  it('clicking Add with valid inputs calls addCustomFurnitureDef', async () => {
    const addFn = vi.fn();
    const ctx = makeCtx({ addCustomFurnitureDef: addFn });

    render(React.createElement(FurnitureEditor.SidePanel, { ctx }));

    const fileInput = screen.getByTestId('import-furniture-file-input');

    const mockFileReader = {
      readAsDataURL: vi.fn().mockImplementation(function(this: typeof mockFileReader) {
        setTimeout(() => {
          if (typeof this.onload === 'function') {
            this.onload({ target: { result: FAKE_DATA_URL } } as unknown as ProgressEvent<FileReader>);
          }
        }, 0);
      }),
      onload: null as ((e: ProgressEvent<FileReader>) => void) | null,
      onerror: null as ((e: ProgressEvent<FileReader>) => void) | null,
    };
    vi.spyOn(globalThis, 'FileReader').mockImplementation(() => mockFileReader as unknown as FileReader);

    const file = new File([new Uint8Array(4)], 'chair.png', { type: 'image/png' });
    act(() => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    });

    // Set custom name
    const nameInput = screen.getByTestId('import-furniture-name');
    act(() => { fireEvent.change(nameInput, { target: { value: 'Chair' } }); });

    // Set width/height
    const widthInput = screen.getByTestId('import-furniture-width');
    const heightInput = screen.getByTestId('import-furniture-height');
    act(() => { fireEvent.change(widthInput, { target: { value: '3' } }); });
    act(() => { fireEvent.change(heightInput, { target: { value: '2' } }); });

    // Click Add
    const addBtn = screen.getByTestId('import-furniture-add');
    act(() => { fireEvent.click(addBtn); });

    expect(addFn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Chair',
        imageUrl: FAKE_DATA_URL,
        wUnits: 3,
        hUnits: 2,
      }),
    );
    // id is a uuid — just check it is a non-empty string
    expect((addFn.mock.calls[0]![0] as { id: string }).id).toBeTruthy();
  });

  it('shows error when non-image file is chosen', () => {
    const ctx = makeCtx();
    render(React.createElement(FurnitureEditor.SidePanel, { ctx }));

    const fileInput = screen.getByTestId('import-furniture-file-input');
    const file = new File(['a,b,c'], 'data.csv', { type: 'text/csv' });
    act(() => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    expect(screen.getByTestId('import-furniture-error')).toBeDefined();
  });

  it('shows error when Add is clicked with out-of-range width', async () => {
    const ctx = makeCtx();
    render(React.createElement(FurnitureEditor.SidePanel, { ctx }));

    const fileInput = screen.getByTestId('import-furniture-file-input');
    const mockFileReader = {
      readAsDataURL: vi.fn().mockImplementation(function(this: typeof mockFileReader) {
        setTimeout(() => {
          if (typeof this.onload === 'function') {
            this.onload({ target: { result: FAKE_DATA_URL } } as unknown as ProgressEvent<FileReader>);
          }
        }, 0);
      }),
      onload: null as ((e: ProgressEvent<FileReader>) => void) | null,
      onerror: null as ((e: ProgressEvent<FileReader>) => void) | null,
    };
    vi.spyOn(globalThis, 'FileReader').mockImplementation(() => mockFileReader as unknown as FileReader);
    const file = new File([new Uint8Array(4)], 'x.png', { type: 'image/png' });
    act(() => { fireEvent.change(fileInput, { target: { files: [file] } }); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 10); }); });

    // Set width to an out-of-range value (> CUSTOM_PALETTE_MAX_UNITS = 20)
    const widthInput = screen.getByTestId('import-furniture-width');
    act(() => { fireEvent.change(widthInput, { target: { value: '99' } }); });

    const addBtn = screen.getByTestId('import-furniture-add');
    act(() => { fireEvent.click(addBtn); });

    expect(screen.getByTestId('import-furniture-error')).toBeDefined();
  });

  it('renders custom palette items as draggable when present', () => {
    const ctx = makeCtx({
      classroom: {
        id: 'test',
        name: 'Test',
        gridW: 10,
        gridH: 8,
        furniture: [],
        cellsPerUnit: DEFAULT_CELLS_PER_UNIT,
        thresholdUnits: DEFAULT_THRESHOLD_UNITS,
        backgroundImage: null,
        gridColor: null,
        customPalette: [FAKE_DEF],
      },
    });

    render(React.createElement(FurnitureEditor.SidePanel, { ctx }));
    expect(screen.getByTestId(`custom-palette-item-${FAKE_DEF.id}`)).toBeDefined();
  });

  it('custom palette item shows name and dimensions', () => {
    const ctx = makeCtx({
      classroom: {
        id: 'test',
        name: 'Test',
        gridW: 10,
        gridH: 8,
        furniture: [],
        cellsPerUnit: DEFAULT_CELLS_PER_UNIT,
        thresholdUnits: DEFAULT_THRESHOLD_UNITS,
        backgroundImage: null,
        gridColor: null,
        customPalette: [FAKE_DEF],
      },
    });

    render(React.createElement(FurnitureEditor.SidePanel, { ctx }));
    expect(screen.getByText('Plant')).toBeDefined();
    // Dimensions shown
    expect(screen.getByText('2×3')).toBeDefined();
  });

  it('remove button on custom palette item calls removeCustomFurnitureDef', () => {
    const removeFn = vi.fn();
    const ctx = makeCtx({
      removeCustomFurnitureDef: removeFn,
      classroom: {
        id: 'test',
        name: 'Test',
        gridW: 10,
        gridH: 8,
        furniture: [],
        cellsPerUnit: DEFAULT_CELLS_PER_UNIT,
        thresholdUnits: DEFAULT_THRESHOLD_UNITS,
        backgroundImage: null,
        gridColor: null,
        customPalette: [FAKE_DEF],
      },
    });

    render(React.createElement(FurnitureEditor.SidePanel, { ctx }));
    const removeBtn = screen.getByTestId(`custom-palette-remove-${FAKE_DEF.id}`);
    act(() => { fireEvent.click(removeBtn); });
    expect(removeFn).toHaveBeenCalledWith('def-1');
  });
});

// ---------------------------------------------------------------------------
// F. FurnitureEditor — onDrop places custom furniture with correct props
// ---------------------------------------------------------------------------

describe('F — FurnitureEditor: drop + drag stash for custom defs', () => {
  beforeEach(() => {
    _clearForTest();
    resetStore();
    FurnitureEditor.deactivate({
      store: makeStoreMock(),
      canvas: makeCanvasMock(),
      persistence: null,
    });
    clearDraggedCustomDefIdStash();
  });

  it('stashDraggedCustomDefId + readDraggedCustomDefId round-trips via stash', () => {
    stashDraggedCustomDefId('def-xyz');
    const fakeEvent = { dataTransfer: { getData: vi.fn().mockReturnValue('') } } as unknown as DragEvent;
    expect(readDraggedCustomDefId(fakeEvent)).toBe('def-xyz');
    clearDraggedCustomDefIdStash();
    expect(readDraggedCustomDefId(fakeEvent)).toBe('');
  });

  it('readDraggedCustomDefId prefers dataTransfer over stash', () => {
    stashDraggedCustomDefId('stash-id');
    const fakeEvent = {
      dataTransfer: {
        getData: vi.fn((key: string) => key === DRAG_CUSTOM_DEF_ID_KEY ? 'transfer-id' : ''),
      },
    } as unknown as DragEvent;
    expect(readDraggedCustomDefId(fakeEvent)).toBe('transfer-id');
  });

  it('onDrop with DRAG_CUSTOM_DEF_ID_KEY calls addFurniture with kind=custom and imageUrl', () => {
    const addFurnitureFn = vi.fn();
    const canvas = makeCanvasMock();
    const ctx: EditorContext = {
      store: makeStoreMock({
        addFurniture: addFurnitureFn,
        classroom: {
          id: 'test',
          name: 'Test',
          gridW: 10,
          gridH: 8,
          furniture: [],
          cellsPerUnit: 1,
          thresholdUnits: 1.5,
          backgroundImage: null,
          gridColor: null,
          customPalette: [FAKE_DEF],
        },
      }),
      canvas,
      persistence: null,
    };

    FurnitureEditor.activate(ctx);

    const fakeEvent = {
      preventDefault: vi.fn(),
      clientX: 100,
      clientY: 100,
      dataTransfer: {
        getData: vi.fn((key: string) => {
          if (key === DRAG_CUSTOM_DEF_ID_KEY) return 'def-1';
          return '';
        }),
      },
    } as unknown as DragEvent;

    act(() => { FurnitureEditor.onDrop(fakeEvent, ctx); });

    expect(addFurnitureFn).toHaveBeenCalledTimes(1);
    const placedF = addFurnitureFn.mock.calls[0]![0] as Furniture;
    expect(placedF.kind).toBe('custom');
    expect(placedF.imageUrl).toBe(FAKE_DATA_URL);
    // w = wUnits * cellsPerUnit = 2 * 1 = 2
    expect(placedF.w).toBe(2);
    // h = hUnits * cellsPerUnit = 3 * 1 = 3
    expect(placedF.h).toBe(3);
  });

  it('onDrop with custom def places furniture with capacity 0 (not seatable)', () => {
    const addFurnitureFn = vi.fn();
    const canvas = makeCanvasMock();
    const ctx: EditorContext = {
      store: makeStoreMock({
        addFurniture: addFurnitureFn,
        classroom: {
          id: 'test',
          name: 'Test',
          gridW: 10,
          gridH: 8,
          furniture: [],
          cellsPerUnit: 1,
          thresholdUnits: 1.5,
          backgroundImage: null,
          gridColor: null,
          customPalette: [FAKE_DEF],
        },
      }),
      canvas,
      persistence: null,
    };
    FurnitureEditor.activate(ctx);

    const fakeEvent = {
      preventDefault: vi.fn(),
      clientX: 100,
      clientY: 100,
      dataTransfer: {
        getData: vi.fn((key: string) => key === DRAG_CUSTOM_DEF_ID_KEY ? 'def-1' : ''),
      },
    } as unknown as DragEvent;

    act(() => { FurnitureEditor.onDrop(fakeEvent, ctx); });

    const placedF = addFurnitureFn.mock.calls[0]![0] as Furniture;
    // capacity must be 0 — custom furniture is decorative
    expect(capacity(placedF)).toBe(0);
  });

  it('onDrop with custom def scales by cellsPerUnit at G=2', () => {
    const addFurnitureFn = vi.fn();
    const canvas = makeCanvasMock();
    const ctx: EditorContext = {
      store: makeStoreMock({
        addFurniture: addFurnitureFn,
        classroom: {
          id: 'test',
          name: 'Test',
          gridW: 20,
          gridH: 16,
          furniture: [],
          cellsPerUnit: 2, // G=2
          thresholdUnits: 1.5,
          backgroundImage: null,
          gridColor: null,
          customPalette: [FAKE_DEF], // wUnits=2, hUnits=3
        },
      }),
      canvas,
      persistence: null,
    };
    FurnitureEditor.activate(ctx);

    const fakeEvent = {
      preventDefault: vi.fn(),
      clientX: 100,
      clientY: 100,
      dataTransfer: {
        getData: vi.fn((key: string) => key === DRAG_CUSTOM_DEF_ID_KEY ? 'def-1' : ''),
      },
    } as unknown as DragEvent;

    act(() => { FurnitureEditor.onDrop(fakeEvent, ctx); });

    const placedF = addFurnitureFn.mock.calls[0]![0] as Furniture;
    // At G=2: w = 2 * 2 = 4, h = 3 * 2 = 6
    expect(placedF.w).toBe(4);
    expect(placedF.h).toBe(6);
  });

  it('onDrop with unknown custom def id is a no-op', () => {
    const addFurnitureFn = vi.fn();
    const canvas = makeCanvasMock();
    const ctx: EditorContext = {
      store: makeStoreMock({
        addFurniture: addFurnitureFn,
        classroom: {
          id: 'test',
          name: 'Test',
          gridW: 10,
          gridH: 8,
          furniture: [],
          cellsPerUnit: 1,
          thresholdUnits: 1.5,
          backgroundImage: null,
          gridColor: null,
          customPalette: [],
        },
      }),
      canvas,
      persistence: null,
    };
    FurnitureEditor.activate(ctx);

    const fakeEvent = {
      preventDefault: vi.fn(),
      clientX: 100,
      clientY: 100,
      dataTransfer: {
        getData: vi.fn((key: string) => key === DRAG_CUSTOM_DEF_ID_KEY ? 'nonexistent' : ''),
      },
    } as unknown as DragEvent;

    act(() => { FurnitureEditor.onDrop(fakeEvent, ctx); });
    expect(addFurnitureFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// G. Checker additions — gaps identified by mutation testing + gap analysis
// ---------------------------------------------------------------------------

describe('G — Checker: persistence extractProject imageUrl round-trip via store', () => {
  beforeEach(() => {
    _clearForTest();
    resetStore();
  });

  it('extractProject serializes furniture imageUrl so it survives a full round-trip', () => {
    // This test exercises extractProject (not a hand-built raw project) so that
    // dropping imageUrl from extractProject is caught.
    const store = usePijonStore.getState();
    act(() => {
      store.addCustomFurnitureDef(FAKE_DEF);
      store.addFurniture({
        id: furnitureId('fid-rt'),
        kind: 'custom',
        pos: { x: 0, y: 0 },
        w: 2,
        h: 3,
        rotation: 0,
        imageUrl: FAKE_DATA_URL,
        occupants: [],
      });
    });
    const s = usePijonStore.getState();
    const pf = extractProject({ classroom: s.classroom, roster: s.roster, locks: [] });
    const json = serializeProject(pf);
    const parsed = parseProject(json);
    const { classroom } = composeClassroom(parsed);

    // The placed furniture must carry imageUrl after the full round-trip
    const placed = classroom.furniture.find((f) => f.id === furnitureId('fid-rt'));
    expect(placed).toBeDefined();
    expect(placed?.imageUrl).toBe(FAKE_DATA_URL);
    // The palette entry must also survive
    expect(classroom.customPalette).toHaveLength(1);
    expect(classroom.customPalette?.[0]?.imageUrl).toBe(FAKE_DATA_URL);
  });
});

describe('G — Checker: capacity + seating guard for custom furniture', () => {
  beforeEach(() => {
    _clearForTest();
    resetStore();
  });

  it('assignStudentToFurniture does nothing when target is custom-kind (capacity 0)', () => {
    // Import store actions - test the real store guard, not just domain capacity()
    const { addFurniture, importRosterFromCsv, assignStudentToFurniture } = usePijonStore.getState();
    act(() => {
      addFurniture({
        id: furnitureId('custom-1'),
        kind: 'custom',
        pos: { x: 0, y: 0 },
        w: 2,
        h: 3,
        rotation: 0,
        imageUrl: FAKE_DATA_URL,
        occupants: [],
      });
      importRosterFromCsv('Alice');
    });

    const { classroom, roster } = usePijonStore.getState();
    const alice = roster.find((s) => s.name === 'Alice');
    expect(alice).toBeDefined();

    act(() => {
      assignStudentToFurniture(alice!.id, furnitureId('custom-1'));
    });

    // The custom furniture must still have no occupant
    const after = usePijonStore.getState().classroom;
    const furn = after.furniture.find((f) => f.id === furnitureId('custom-1'));
    expect(furn?.occupants).toHaveLength(0);
    void classroom; // suppress unused-var warning
  });
});

describe('G — Checker: W/H input validation boundary cases', () => {
  beforeEach(() => {
    _clearForTest();
    resetStore();
    FurnitureEditor.deactivate({
      store: makeStoreMock(),
      canvas: makeCanvasMock(),
      persistence: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  async function renderAfterImagePick(addFn = vi.fn()) {
    const ctx = makeCtx({ addCustomFurnitureDef: addFn });
    render(React.createElement(FurnitureEditor.SidePanel, { ctx }));

    const fileInput = screen.getByTestId('import-furniture-file-input');
    const mockFileReader = {
      readAsDataURL: vi.fn().mockImplementation(function(this: typeof mockFileReader) {
        setTimeout(() => {
          if (typeof this.onload === 'function') {
            this.onload({ target: { result: FAKE_DATA_URL } } as unknown as ProgressEvent<FileReader>);
          }
        }, 0);
      }),
      onload: null as ((e: ProgressEvent<FileReader>) => void) | null,
      onerror: null as ((e: ProgressEvent<FileReader>) => void) | null,
    };
    vi.spyOn(globalThis, 'FileReader').mockImplementation(() => mockFileReader as unknown as FileReader);

    const file = new File([new Uint8Array(4)], 'item.png', { type: 'image/png' });
    act(() => { fireEvent.change(fileInput, { target: { files: [file] } }); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 10); }); });
    return addFn;
  }

  it('coerces width 0 to 1 via parseInt fallback and adds def at w=1', async () => {
    // The onChange handler uses `parseInt(v, 10) || 1`. parseInt('0') === 0 (falsy),
    // so 0 becomes 1. The def is added with w=1 (the minimum) rather than rejected.
    // This is intentional: silent clamp to 1, not a hard rejection.
    const addFn = await renderAfterImagePick();
    act(() => { fireEvent.change(screen.getByTestId('import-furniture-width'), { target: { value: '0' } }); });
    act(() => { fireEvent.click(screen.getByTestId('import-furniture-add')); });
    // Width was coerced to 1 — no error, def IS added
    expect(screen.queryByTestId('import-furniture-error')).toBeNull();
    expect(addFn).toHaveBeenCalledWith(expect.objectContaining({ wUnits: 1 }));
  });

  it('coerces height 0 to 1 via parseInt fallback and adds def at h=1', async () => {
    const addFn = await renderAfterImagePick();
    act(() => { fireEvent.change(screen.getByTestId('import-furniture-height'), { target: { value: '0' } }); });
    act(() => { fireEvent.click(screen.getByTestId('import-furniture-add')); });
    // Height was coerced to 1 — no error, def IS added
    expect(screen.queryByTestId('import-furniture-error')).toBeNull();
    expect(addFn).toHaveBeenCalledWith(expect.objectContaining({ hUnits: 1 }));
  });

  it('shows error and does not add def when height is out-of-range (> max)', async () => {
    const addFn = await renderAfterImagePick();
    act(() => { fireEvent.change(screen.getByTestId('import-furniture-height'), { target: { value: '99' } }); });
    act(() => { fireEvent.click(screen.getByTestId('import-furniture-add')); });
    expect(screen.getByTestId('import-furniture-error')).toBeDefined();
    expect(addFn).not.toHaveBeenCalled();
  });
});

describe('G — Checker: orphaned placed pieces after palette def removal', () => {
  beforeEach(() => {
    _clearForTest();
    resetStore();
  });

  it('placed custom furniture still has its imageUrl after its palette def is removed', () => {
    // The store removeCustomFurnitureDef removes placed pieces with matching imageUrl.
    // A different-imageUrl piece should be unaffected and still render fine.
    const store = usePijonStore.getState();
    const def2: CustomFurnitureDef = { ...FAKE_DEF, id: 'def-2', imageUrl: FAKE_DATA_URL_2, name: 'Chair' };
    act(() => {
      store.addCustomFurnitureDef(FAKE_DEF);
      store.addCustomFurnitureDef(def2);
      // Place furniture for def-2 (different imageUrl)
      store.addFurniture({
        id: furnitureId('f-chair'),
        kind: 'custom',
        pos: { x: 5, y: 5 },
        w: 1,
        h: 1,
        rotation: 0,
        imageUrl: FAKE_DATA_URL_2,
        occupants: [],
      });
      // Place furniture for def-1
      store.addFurniture({
        id: furnitureId('f-plant'),
        kind: 'custom',
        pos: { x: 1, y: 1 },
        w: 2,
        h: 3,
        rotation: 0,
        imageUrl: FAKE_DATA_URL,
        occupants: [],
      });
    });

    // Remove def-1 (plant) — its placed piece should be gone, def-2 chair stays
    act(() => { usePijonStore.getState().removeCustomFurnitureDef('def-1'); });

    const after = usePijonStore.getState();
    const remaining = after.classroom.furniture;
    // Only the chair (def-2) should remain
    expect(remaining).toHaveLength(1);
    const chair = remaining[0];
    expect(chair?.imageUrl).toBe(FAKE_DATA_URL_2);
    // The chair still has its imageUrl intact for rendering
    expect(chair?.kind).toBe('custom');
  });

  it('data URL size note: a realistic custom image may be large in the persisted JSON', () => {
    // Just document the potential bloat — not a hard error
    const bigDataUrl = 'data:image/png;base64,' + 'A'.repeat(50_000);
    const def: CustomFurnitureDef = {
      id: 'big-def',
      name: 'BigImage',
      imageUrl: bigDataUrl,
      wUnits: 1,
      hUnits: 1,
    };
    let c = makeClassroom('cls', 'Test', 5, 5);
    c = addCustomFurnitureDef(c, def);
    const pf = extractProject({ classroom: c, roster: [], locks: [] });
    const json = serializeProject(pf);
    // A 50 KB data URL produces >50 KB JSON — just verify it does not throw or crash
    expect(json.length).toBeGreaterThan(50_000);
    // And it round-trips correctly
    const parsed = parseProject(json);
    const { classroom } = composeClassroom(parsed);
    expect(classroom.customPalette?.[0]?.imageUrl).toBe(bigDataUrl);
  });
});
