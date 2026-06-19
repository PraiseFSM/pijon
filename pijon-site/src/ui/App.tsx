/**
 * App.tsx — Phase 9 shell.
 *
 * Layout (from PROJECT_OUTLINE § "The Experience"):
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │  [ Furniture ] [ Students ]     ← EditorSwitcher     │
 *   ├──────────────────────────────────────────────────────┤
 *   │  tool-specific Toolbar + "saved locally" + Erase all │  TopBar
 *   ├──────────────┬───────────────────────────────────────┤
 *   │  tool-       │                                        │
 *   │  specific    │        the classroom grid              │
 *   │  SidePanel   │        (single ClassroomCanvas,        │
 *   │  (swaps)     │         never unmounted)               │
 *   └──────────────┴───────────────────────────────────────┘
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
import { usePijonStore } from '../state/store.js';
import { initPersistence, type PersistenceHandle } from '../state/persistence.js';
import { ClassroomCanvas } from './canvas/ClassroomCanvas.js';
import type { CanvasView } from './editors/EditorMode.js';
import { NoopEditor } from './editors/NoopEditor.js';
import { EDITOR_REGISTRY } from './editors/registry.js';
import { EditorSwitcher } from './shell/EditorSwitcher.js';
import { TopBar } from './shell/TopBar.js';
import { SidePanel } from './shell/SidePanel.js';

// ---------------------------------------------------------------------------
// Minimal no-op CanvasView — used before the canvas mounts and fires onViewReady.
// After the first render cycle the real view replaces this.
// ---------------------------------------------------------------------------

const NOOP_VIEW: CanvasView = {
  cellSize: 48,
  gridW: 10,
  gridH: 8,
  cellAt() { return undefined; },
  furnitureAt() { return undefined; },
  cellRect() { return { x: 0, y: 0, w: 48, h: 48 }; },
  requestRepaint() { /* pre-mount no-op */ },
};

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

  // ---- CanvasView from ClassroomCanvas --------------------------------------
  // ClassroomCanvas fires onViewReady whenever the canvas is ready / resized.
  // We keep the latest view in a ref AND a state slot so EditorContext rebuilds
  // when the view changes (e.g. on grid resize) without causing unnecessary
  // renders for every store change.
  const [canvasView, setCanvasView] = useState<CanvasView>(NOOP_VIEW);

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
      {/* Row 1 — EditorSwitcher (tabs) */}
      <EditorSwitcher editors={EDITOR_REGISTRY} />

      {/* Row 2 — TopBar: active editor's Toolbar + save status + erase */}
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
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            background: '#f0f0f0',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            padding: 12,
          }}
        >
          <div
            style={{
              border: '1px solid #ccc',
              display: 'inline-block',
              lineHeight: 0,
              background: '#fff',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            }}
          >
            <ClassroomCanvas
              editor={activeEditor}
              cellSize={48}
              onViewReady={handleViewReady}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
