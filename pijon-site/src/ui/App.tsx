/**
 * App.tsx — Phase 9 shell (updated §12.4 for right panel).
 *
 * Layout (from PROJECT_OUTLINE § "The Experience"):
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  [ Furniture ] [ Students ]          ← EditorSwitcher            │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │  tool-specific Toolbar + "saved locally" + Erase all             │  TopBar
 *   ├──────────────┬──────────────────────────────────┬────────────────┤
 *   │  tool-       │                                  │ tool-specific   │
 *   │  specific    │        the classroom grid        │ RightPanel      │
 *   │  SidePanel   │        (single ClassroomCanvas,  │ (optional, swaps│
 *   │  (swaps)     │         never unmounted)         │  with editor)   │
 *   └──────────────┴──────────────────────────────────┴────────────────┘
 *
 * Grid persistence guarantee:
 *   ONE <ClassroomCanvas> instance remains mounted for the entire app lifetime.
 *   Switching editors only changes the `editor` prop (so overlay / event
 *   routing swaps) while the Zustand store and the canvas DOM node are stable.
 *   Furniture and seating live in the store, not in any per-editor component.
 *
 * CanvasView exposure:
 *   ClassroomCanvas accepts an `onViewReady` callback (surgical Phase 9 addition).
 *   App keeps the latest CanvasView in a ref and rebuilds the EditorContext
 *   whenever it changes, so Toolbar and SidePanel always get a live view.
 *
 * Persistence:
 *   initPersistence() is called once on mount. The returned PersistenceHandle
 *   is stored in a ref and threaded into EditorContext as `ctx.persistence`.
 *   Editors use it for Save/Load file dialogs; the shell uses it for eraseAll.
 *
 * LOCAL-FIRST: no fetch(), no XHR, no WebSocket. All persistence goes through
 * IndexedDB (autosave) and the File System Access API / Blob fallback (explicit
 * save/open). See PROJECT_OUTLINE.md § Design Goals.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appBackground,
  canvasCardBackground,
  canvasCardBorder,
  canvasCardShadow,
  ASSIGNER_CURSOR,
} from '../theme/colors.js';
import { THEMES, applyThemeVars } from '../theme/themes.js';
import { usePijonStore, UI_SCALE_DEFAULT } from '../state/store.js';
import { initPersistence, type PersistenceHandle } from '../state/persistence.js';
import { ClassroomCanvas } from './canvas/ClassroomCanvas.js';
import type { CanvasView } from './editors/EditorMode.js';
import { NoopEditor } from './editors/NoopEditor.js';
import { EDITOR_REGISTRY } from './editors/registry.js';
import { TopBar } from './shell/TopBar.js';
import { SidePanel } from './shell/SidePanel.js';
import { RightPanel } from './shell/RightPanel.js';
import { registerAssignerCursorListener } from './editors/StudentEditor.js';

// ---------------------------------------------------------------------------
// §7.B1 — Base cell size constant (pixels per grid unit at scale 1.0).
// The on-screen cell size that ClassroomCanvas receives is:
//   cellSize = UI_BASE_CELL_SIZE * uiScale
// At the default uiScale of 1.2 this is 48 * 1.2 = 57.6 → ClassroomCanvas
// receives 57.6 and renders at ~58 px/unit. The scroll-wheel zoom factor then
// composes on top inside ClassroomCanvas (zoom × cellSize).
// ---------------------------------------------------------------------------

export const UI_BASE_CELL_SIZE = 48;

/** Padding (in px) between the viewport scroll area and the canvas card. */
const CANVAS_CARD_PADDING = 12;

// ---------------------------------------------------------------------------
// Minimal no-op CanvasView — used before the canvas mounts and fires onViewReady.
// After the first render cycle the real view replaces this.
// ---------------------------------------------------------------------------

function makeNoopView(cellSizePx: number): CanvasView {
  return {
    cellSize: cellSizePx,
    gridW: 10,
    gridH: 8,
    originOffset: 0,
    cellAt() { return undefined; },
    furnitureAt() { return undefined; },
    cellRect() { return { x: 0, y: 0, w: cellSizePx, h: cellSizePx }; },
    requestRepaint() { /* pre-mount no-op */ },
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  // ---- Persistence -----------------------------------------------------------
  const persistenceRef = useRef<PersistenceHandle | null>(null);
  const [persistenceHandle, setPersistenceHandle] = useState<PersistenceHandle | null>(null);

  useEffect(() => {
    let alive = true;
    void initPersistence()
      .then((p) => {
        if (!alive) {
          p.destroy();
          return;
        }
        persistenceRef.current = p;
        setPersistenceHandle(p);
      })
      .catch((err: unknown) => {
        // Persistence is best-effort; the app still runs in-memory if it fails.
        console.error('[Pijon] persistence init failed:', err);
      });

    return () => {
      alive = false;
      persistenceRef.current?.destroy();
      persistenceRef.current = null;
    };
  }, []);

  // ---- §7.C1 — Color theme --------------------------------------------------
  // Apply CSS custom properties to document.documentElement whenever the
  // active theme changes (including on first render = mount).
  // This covers DOM colors; canvas colors are handled via getActiveThemeColors()
  // in render.ts which reads the module-level cache kept in sync by setTheme.
  const themeId = usePijonStore((s) => s.themeId);

  useEffect(() => {
    const palette = THEMES[themeId];
    // Guard: palette may be undefined if the stored themeId is stale
    if (palette !== undefined) applyThemeVars(palette);
  }, [themeId]);

  // ---- §7.B1 — UI scale (on-screen base unit px) ----------------------------
  // uiScale is persisted in localStorage and read back on first load.
  // cellSizePx is passed to ClassroomCanvas as the base unit; wheel zoom
  // composes on top inside ClassroomCanvas.
  const uiScale = usePijonStore((s) => s.uiScale);
  const cellSizePx = UI_BASE_CELL_SIZE * uiScale;

  // ---- Active editor resolution ---------------------------------------------
  const activeEditorId = usePijonStore((s) => s.activeEditorId);

  // On first load, default to the first editor in the registry.
  useEffect(() => {
    const firstEditor = EDITOR_REGISTRY[0];
    if (activeEditorId === null && firstEditor !== undefined) {
      usePijonStore.getState().setActiveEditorId(firstEditor.id);
    }
  }, [activeEditorId]);

  // Resolve the active EditorMode object from the registry.
  // Falls back to NoopEditor if the registry is empty (shouldn't happen in practice).
  const activeEditor =
    EDITOR_REGISTRY.find((e) => e.id === activeEditorId) ??
    EDITOR_REGISTRY[0] ??
    NoopEditor;

  // ---- §6.A4 — Assigner cursor -----------------------------------------------
  // Register a listener so StudentEditor can notify App when assigner mode
  // toggles. App lifts this into state so ClassroomCanvas re-renders with the
  // correct CSS cursor value (ASSIGNER_CURSOR vs default 'crosshair').
  const [assignerActive, setAssignerActive] = useState(false);

  useEffect(() => {
    const unregister = registerAssignerCursorListener(setAssignerActive);
    // Reset cursor on unmount (edge case: SSR / test teardown)
    return () => {
      setAssignerActive(false);
      unregister();
    };
  }, []);

  // ---- §10.B1 — Canvas-area backdrop ref ------------------------------------
  // The scroll-wheel zoom listener is attached to this div (the grey backdrop
  // that fills the space to the right of the side panel).  Attaching here — not
  // to the canvas element itself — means wheeling anywhere in the backdrop
  // (including the grey margin around the canvas card) also zooms.
  // The top bar and left panel are siblings OUTSIDE this div, so they are
  // unaffected.
  const canvasBackdropRef = useRef<HTMLDivElement>(null);

  // ---- CanvasView from ClassroomCanvas --------------------------------------
  // ClassroomCanvas fires onViewReady whenever the canvas is ready / resized.
  // We keep the latest view in a ref AND a state slot so EditorContext rebuilds
  // when the view changes (e.g. on grid resize) without causing unnecessary
  // renders for every store change.
  const [canvasView, setCanvasView] = useState<CanvasView>(() => makeNoopView(UI_BASE_CELL_SIZE * UI_SCALE_DEFAULT));

  const handleViewReady = useCallback((view: CanvasView) => {
    setCanvasView(view);
  }, []);

  // ---- EditorContext ---------------------------------------------------------
  // Rebuild the context object on each render. The store snapshot is read at
  // render time so Toolbar/SidePanel always see current state. Zustand action
  // functions are stable references; they don't change between renders.
  //
  // Note: usePijonStore.getState() is the live store (not a subscription); this
  // is intentional — the context is re-created on every render triggered by
  // either the store subscription above (via usePijonStore selectors used in
  // child components) or our own state. Editors dispatch through the store's
  // stable action functions, so the context object only needs to be fresh at
  // the time of render, not on every action.
  const store = usePijonStore();
  const editorCtx = {
    store,
    canvas: canvasView,
    persistence: persistenceHandle,
  };

  // ---- Layout ---------------------------------------------------------------

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Row 1 — TopBar: logo + editor lever + active editor toolbar + settings + save status + erase */}
      <TopBar activeEditor={activeEditor} ctx={editorCtx} />

      {/* Row 3 — SidePanel (left) + ClassroomCanvas (fills remaining space) */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* Left side panel — swaps per editor */}
        <SidePanel activeEditor={activeEditor} ctx={editorCtx} />

        {/* Canvas area — single instance, never unmounts, fills remaining space */}
        {/* §10.B1: ref attached so ClassroomCanvas can receive wheel events fired
            anywhere in this backdrop (not just over the canvas element). */}
        <div
          ref={canvasBackdropRef}
          data-testid="canvas-area-backdrop"
          style={{
            flex: 1,
            overflow: 'auto',
            background: appBackground,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            padding: CANVAS_CARD_PADDING,
          }}
        >
          <div
            style={{
              border: `1px solid ${canvasCardBorder}`,
              display: 'inline-block',
              lineHeight: 0,
              background: canvasCardBackground,
              boxShadow: `0 1px 4px ${canvasCardShadow}`,
            }}
          >
            {/* §14.7 / 5.A4 — in Furniture mode the ghost ring is ONE UNIT wide
                 (cellsPerUnit cells) so the one-unit PLUS resize buttons live
                 fully outside the grid at any granularity. */}
            {/* §10.B1: pass the backdrop ref so wheel events anywhere in the
                grey area behind the canvas card also zoom. The canvas is inside
                the backdrop, so backdrop-level events cover canvas-level events
                too — no double-handling. */}
            <ClassroomCanvas
              editor={activeEditor}
              cellSize={cellSizePx}
              ghostMargin={activeEditor.id === 'furniture' ? store.classroom.cellsPerUnit : 0}
              onViewReady={handleViewReady}
              cursor={assignerActive ? ASSIGNER_CURSOR : 'crosshair'}
              wheelTargetRef={canvasBackdropRef}
            />
          </div>
        </div>

        {/* Right panel — optional, present only for editors that define RightPanel */}
        <RightPanel activeEditor={activeEditor} ctx={editorCtx} />
      </div>
    </div>
  );
}
