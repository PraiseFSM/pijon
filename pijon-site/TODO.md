# Pijon Web — TODO

## Deferred tests (write later)

Tests were paused to conserve usage. Code below was shipped WITHOUT tests and needs an
extensive Vitest suite added later (the project's standard is ~2:1 test:code). Append to this
list as more untested code lands.

### Phase 4 — IO layer
- `src/domain/io/csv.ts`
  - SIMPLE vs FULL format auto-detection
  - SIMPLE import: first-column extraction, header-row skip list, session-salted ids
  - FULL import: two-pass build, name→StudentId resolution, fixture id determinism
  - Warning emission: invalid weight, unknown pref type, empty file (parity with Python)
  - RFC-4180 parser edge cases: BOM, `\r\n`, quoted fields, doubled-quote escapes
  - Export: full-format round-trip, one-row-per-preference, no-preference row, idToname mapping
- `src/domain/io/projectFile.ts`
  - Zod schema validation: rejects malformed/partial `.pijon`, typed `ProjectParseError`
  - `serializeProject` / `parseProject` round-trip
  - `composeClassroom`: fixtures placed from geometry, real students from arrangement, stale fid/sid skipped
  - `extractProject`: inverse round-trip (classroom+roster+locks → ProjectFile)
  - `importLegacyClassroom`: prototype `data/classrooms/*.json` geometry, unknown kind fallback
  - version/migration entry point (`applyMigrations`)

### Phase 5 — Store + persistence

- `src/state/store.ts`
  - `hydrate`: restores classroom, roster, locks, resets history to single entry
  - `addFurniture` / `moveFurniture` / `removeFurniture`: marks dirty; removeFurniture cleans locks
  - `importRosterFromCsv`: id-dedup merge; warning passthrough from csv.ts
  - `allocate` / `smartShuffle`: SeatGraph build, lock pre-population, result applied via applyArrangement, history push
  - `clearArrangement`: vacates all real occupants, pushes history
  - `lockSeat` / `unlockSeat`: Set mutation, marks dirty
  - `manualReassign`: swap/move with fixture preservation, history push
  - `undo` / `redo`: historyPtr stepping, snapshot restoration
  - `eraseAll`: full state reset
  - `applyArrangement` helper: vacate real occupants then re-assign from map
  - `pushHistory` helper: discard-future, bounded ring at MAX_HISTORY (50)
  - `selectArrangement`, `selectCanUndo`, `selectCanRedo` selectors
  - Edge cases: empty classroom, no seats available, more students than seats, fixture furniture rejected for real students, lock on removed furniture

- `src/state/persistence.ts`
  - `initPersistence`: full flow — openDB → hydrate → subscribe → flush listeners
  - Debounced write (~400ms), verify only dirty state triggers writes
  - Flush on `visibilitychange → hidden` and `beforeunload`
  - Multi-record scan on startup (new install with different default classroom id)
  - IndexedDB key scheme: `project:<classroomId>` (string, always unique per class)
  - Corrupt record handling: JSON parse errors + Zod errors silently skipped, fresh start
  - `saveToFile` / FSA path: picker → write → remember handle → saveStatus = saved
  - `saveToFile` / fallback (Firefox/Safari): Blob + object URL download
  - `openFromFile` / FSA path: picker → read → parseProject → composeClassroom → hydrate → writeToIDB
  - `openFromFile` / fallback: `<input type="file">` + FileReader
  - `resaveToHandle`: write to remembered FileSystemFileHandle; falls back to saveToFile on stale handle
  - `eraseAll`: deletes all IndexedDB records then calls store.eraseAll()
  - `destroy`: unsubscribes, cancels debounce, removes event listeners
  - `getRecord` type-safe wrapper (idb's StoreValue resolves to any; narrowed with typeof check)
  - History stack NOT persisted across reloads (deferred — see design note in persistence.ts)

### Phase 6 — Canvas + EditorMode

- `src/ui/editors/EditorMode.ts`
  - `EditorContext` and `CanvasView` interface contracts (cellAt, furnitureAt, cellRect, requestRepaint)
  - `EditorMode` interface: id/label, Toolbar/SidePanel components, activate/deactivate lifecycle, all event hooks, paintOverlay
  - Verify that all Phases 7/8/10 editors satisfy the interface without cast

- `src/ui/canvas/hitTest.ts`
  - `clientToCell`: out-of-bounds returns undefined; clamped to grid; correct floor division
  - `cellToPixelRect`: correct x/y/w/h for given cellSize
  - `furnitureToPixelRect`: matches furniture pos × cellSize
  - `furnitureAtCell`: returns last matching furniture (topmost painter order); returns undefined when no match; correct for 1×1 and multi-cell furniture
  - `cellsEqual`: symmetric, reflexive

- `src/ui/canvas/render.ts`
  - `clearCanvas`: fills full cssW×cssH
  - `drawGrid`: correct number of lines for given gridW/gridH; line positions exact multiples of cellSize
  - `drawFurniture`: each furniture's fill colour matches kind; lock tint applied only for locked ids; stroke rect does not bleed into adjacent cells
  - `drawOccupants`: text centered within furniture rect; fixture occupants italic/purple vs student blue; clipped to furniture bounds; skips empty furniture and sub-MIN_TEXT_PX cells
  - `renderBasePass`: call order (clear → grid → furniture → occupants) verified via drawing-order test

- `src/ui/canvas/ClassroomCanvas.tsx`
  - DPR scaling: canvas.width = gridW * cellSize * dpr; CSS size = gridW * cellSize px
  - Repaint triggered on classroom change, locks change, and grid/cellSize change
  - `requestRepaint()` (from CanvasView) schedules at most one rAF per frame
  - Pointer capture set on pointerdown (events arrive outside canvas)
  - Editor lifecycle: deactivate(old) then activate(new) when activeEditor.id changes
  - Event forwarding: onPointerDown/Move/Up/KeyDown/Drop/ContextMenu all route to active editor
  - NoopEditor is the default when no editor prop is provided
  - dragOver handler calls e.preventDefault() to allow onDrop to fire

- `src/ui/editors/NoopEditor.ts`
  - Satisfies EditorMode interface; all methods are no-ops
  - paintOverlay draws nothing (canvas state unchanged after call)
  - Toolbar and SidePanel render null

### Phase 7 — FurnitureEditor

- `src/ui/editors/FurnitureEditor.tsx`

  **Palette drag-to-place (onDrop)**
  - Dragging each kind (single_desk, table, teacher_desk, whiteboard) from SidePanel sets correct DRAG_KIND_KEY + text/plain fallback on dataTransfer
  - Drop outside grid bounds → no furniture added, no error
  - Drop on an occupied cell → collision detected, red flash shown, no furniture added
  - Drop on a valid cell → furniture created with correct kind/w/h/pos, capacity derived from kind (single_desk=1, table=4, fixtures=0)
  - Newly placed piece auto-selected (selectedId + selectedRect updated)
  - makeFurniture: single_desk gets no numSeats field; table gets numSeats=4; teacher_desk/whiteboard have correct dims
  - Fresh crypto.randomUUID() id minted per drop; no two pieces share an id

  **Collision helper**
  - hasCollision returns true when any cell of candidate overlaps any existing piece (excluding excludeId)
  - hasCollision returns false when candidate fits in a gap next to existing furniture
  - excludeId exclusion: dragging a piece to its own position reports no collision with itself
  - cellSet encodes (x,y) consistently; no off-by-one errors

  **Grid drag-to-move (onPointerDown/Move/Up)**
  - pointerDown on furniture: sets selectedId, initialises dragState with correct offsetInFurniture
  - pointerDown on empty cell: clears selection
  - pointerMove: previewPos = cell - offsetInFurniture; valid=true only when in-bounds and no collision
  - pointerMove to invalid cell: valid=false, selectedRect shows red ghost
  - pointerUp after valid move: store.moveFurniture called with correct id and new pos; selectedRect updated
  - pointerUp after invalid move: reverts to original position (no store call)
  - pointerUp without move (click-select): no moveFurniture call; selection retained
  - Occupant rides along automatically (occupants are embedded in furniture — tested at domain level)

  **Delete**
  - Delete key with selection: store.removeFurniture called; selectedId/selectedRect/dragState cleared
  - Backspace key: same behaviour as Delete
  - Delete with no selection: no store call, no error
  - After delete, a re-press of Delete with nothing selected is safe

  **paintOverlay**
  - Selection highlight: dashed blue stroke rect drawn over selectedRect when selectedId non-null and not dragging
  - Drag preview valid: semi-transparent blue fill + solid blue stroke at previewPos
  - Drag preview invalid: semi-transparent red fill + red stroke at previewPos
  - Drop collision flash: red fill at target area for ~400ms, then cleared
  - paintOverlay does not clear the canvas or call save/restore across frames
  - Called with no selection and no drag: draws nothing

  **activate / deactivate**
  - activate: resets all module-level state (selectedId, selectedRect, dragState, dropCollisionFlash), captures repaintFn
  - deactivate: clears all module-level state including repaintFn; switching to another editor leaves no artefacts

  **Toolbar**
  - New: creates a fresh classroom with same gridW/gridH, calls setClassroom
  - Clear: calls removeFurniture for every piece in the classroom (including pieces with locks)
  - Save / Load: console.warn stubs confirmed (Phase 9 wiring not yet done)

  **FurnitureSidePanel (palette UI)**
  - Renders one draggable item per PALETTE_ITEMS entry (4 items)
  - Each item has correct label and dimension subtitle (w×h)
  - onDragStart sets DRAG_KIND_KEY and text/plain with correct kind string

  **Phase 9 integration notes (for shell wiring)**
  - Pass `editor={FurnitureEditor}` to `<ClassroomCanvas>` — already done in Phase 7 preview
  - Render `<FurnitureEditor.Toolbar ctx={editorCtx} />` in TopBar where `editorCtx.store` is the Zustand store snapshot and `editorCtx.canvas` is the CanvasView provided by ClassroomCanvas via a ref/callback
  - Render `<FurnitureEditor.SidePanel ctx={editorCtx} />` in SidePanel (ctx.canvas unused by SidePanel)
  - Wire Save/Load: add `onSave` / `onLoad` props to Toolbar (or pass via EditorContext extension) pointing to `persistenceHandle.saveToFile()` / `persistenceHandle.openFromFile()`; remove the console.warn stubs
  - Remove the Phase 7 preview layout from App.tsx and replace with the Phase 9 shell structure

### Phase 8 — StudentEditor

- `src/ui/editors/StudentEditor.tsx`

  **Roster import (SidePanel)**
  - `importRosterFromCsv`: FileReader.readAsText produces the CSV string passed to store; no network call at any point
  - Returned warnings are displayed in the panel
  - Student count and fixture count update after import
  - Re-importing the same file is allowed (file input reset after each read)
  - SIMPLE and FULL format CSVs both produce correct results (delegated to csv.ts — Phase 4 tests cover the parser)
  - Roster panel shows real students (name + pref count badge) and fixtures (italic/purple) in separate sections

  **Toolbar actions**
  - Allocate: constructs GreedyAllocator (or BogoAllocator per dropdown) and calls ctx.store.allocate(); clears graph cache
  - Smart Shuffle: same as Allocate but calls ctx.store.smartShuffle()
  - Clear: calls clearArrangement(), resets all drag/neighbor transient state, clears graph cache
  - Undo/Redo: buttons disabled when selectCanUndo/selectCanRedo is false; calls store.undo()/redo(); clears graph cache
  - Export CSV: exportCsv(roster) → Blob → `<a download>` click → URL.revokeObjectURL(); no network call
  - Show Violations toggle: sets module-level `showViolations`; triggers repaint
  - Nearness input: sets module-level `nearness`; clears graph cache; triggers repaint
  - Save/Load Arrangement: console.warn stubs (Phase 9 wiring needed)

  **Drag-between-desks (onPointerDown/Move/Up)**
  - onPointerDown on occupied non-fixture desk: sets dragSourceFid, dragStudent, dragCanvasPos, dragHoverFid
  - onPointerDown on empty desk, fixture, or non-furniture cell: no drag started
  - onPointerMove: updates dragCanvasPos (snapped to hovered cell center for ghost); updates dragHoverFid
  - dragHoverFid: set only for assignable non-fixture desks (capacity > 0, not isFurnitureFixture)
  - onPointerUp: if targetFid !== null and !== sourceFid: calls manualReassign(sourceFid, targetFid) then unlockSeat on both if locked (parity with prototype's manual drag lock clearing)
  - onPointerUp on same source or no target: no store call (no-op drop)
  - manualReassign swaps occupants if target is occupied; moves if target is empty (store handles the logic)
  - History pushed by manualReassign (undo available after each drag)

  **Lock/unlock (onContextMenu)**
  - Right-click on occupied non-fixture desk: toggles neighborPreviewFid (on/off); shows context menu via showContextMenuCallback
  - Context menu shows student name, neighbor count, lock/unlock action
  - Lock action: ctx.store.lockSeat(fid); Unlock: ctx.store.unlockSeat(fid)
  - Right-click on empty cell or non-furniture: clears neighborPreviewFid; no menu
  - Right-click on fixture desk: toggles neighborPreviewFid; no menu (fixture, not a lockable seat)

  **Neighbor preview**
  - Right-clicking a desk toggles it as the neighbor-preview source (neighborPreviewFid)
  - paintOverlay draws purple solid outline on source, dashed outline on all neighbors in SeatGraph
  - Neighbor set recomputed each paint call from the (cached) SeatGraph
  - Clearing (right-click same desk again, or right-click empty cell) removes highlight

  **Violation highlighting**
  - hasViolation() matches prototype's _has_violation() bidirectional logic:
      a) Student S's own avoid-prefs (weight < 0): if the targeted student/fixture is a neighbor → violation
      b) Reverse: any OTHER placed student with an avoid-pref for S, seated at a neighbor → violation
  - Positive-weight prefs are NOT flagged (matches prototype — only avoidances are violations)
  - hasViolation is called in paintOverlay per occupied non-fixture desk when showViolations=true
  - Violation desks get a red tint overlay (rgba(211,47,47,0.22)) and red stroke

  **SeatGraph caching**
  - getSeatGraph() rebuilds only when classroom reference or nearness threshold changes
  - Cache invalidated (clearGraphCache()) on: allocate, smartShuffle, clearArrangement, undo, redo, manual drag, nearness change, deactivate
  - paintOverlay reads from cache (no rebuild per frame for static state)

  **paintOverlay**
  - Lock badge: orange square + 🔒 at top-right corner of each locked occupied non-fixture desk
  - Violation tint: semi-transparent red fill + red stroke on violating desks (when showViolations=true)
  - Drag ghost: rounded blue pill with student name, centered on hovered cell
  - Drag source fade: grey overlay on the source desk while dragging
  - Drag target highlight: blue fill + blue stroke on hovered target desk
  - Neighbor source: purple solid border + light fill
  - Neighbor targets: purple dashed border + light fill
  - paintOverlay reads store via usePijonStore.getState() (Zustand singleton) since EditorMode.paintOverlay signature does not include EditorContext
  - save()/restore() called around all drawing; canvas NOT cleared

  **activate / deactivate**
  - activate: clears all transient state (drag, neighbor, graph cache); showViolations and nearness persist within session
  - deactivate: clears all transient state + showContextMenuCallback + graph cache

  **App.tsx changes (Phase 8 preview)**
  - Added editor toggle buttons (Furniture / Students) above the canvas
  - activeEditor drives SidePanel, Toolbar, and ClassroomCanvas editor prop
  - Phase 9 shell (EditorSwitcher) will replace this minimal toggle

  **Phase 9 integration notes (for shell wiring)**
  - Move the editor toggle out of App.tsx into EditorSwitcher (registry.ts pattern)
  - Provide real CanvasView from ClassroomCanvas via ref/callback to EditorContext (currently NOOP_CANVAS_VIEW for Toolbar/SidePanel)
  - Wire StudentEditor Save/Load Arrangement: pass PersistenceHandle callbacks via EditorContext extension or shell props; remove the console.warn stubs
  - The `showContextMenuCallback` bridge (module-level callback registered by StudentSidePanelWithMenu in useEffect) works for Phase 8 but Phase 9 should consider lifting context menu state to the shell for cleaner React separation
  - showViolations and nearness are module-level state (reset on page reload but persist across editor switches within a session); Phase 9 could lift these to the Zustand store if cross-session persistence is desired

### Phase 9 — Shell

- `src/ui/editors/registry.ts`
  - EDITOR_REGISTRY contains exactly [FurnitureEditor, StudentEditor] in order
  - First entry is the default active editor on startup
  - Adding PreferenceEditor in Phase 10 is a one-line change

- `src/ui/shell/EditorSwitcher.tsx`
  - Renders one tab button per EDITOR_REGISTRY entry
  - Reads activeEditorId from the store; sets it via getState().setActiveEditorId on click
  - Active tab gets distinct styling (blue border, bold, blue background)
  - role="tablist" / role="tab" / aria-selected for accessibility

- `src/ui/shell/TopBar.tsx`
  - Renders the active editor's Toolbar component
  - Save status indicator (saved/saving/dirty/error with appropriate colours) always visible in top-right
  - "Erase all" button triggers window.confirm → persistence.eraseAll() (falls back to store.eraseAll() if persistence not yet init'd)
  - Erase affordance is unobtrusive (small, red border, low opacity) but clearly labelled

- `src/ui/shell/SidePanel.tsx`
  - Thin delegation wrapper: renders activeEditor.SidePanel with the current EditorContext
  - No local state; height=100% so inner panel can scroll independently

- `src/ui/App.tsx` (rewrite)
  - Full shell layout: EditorSwitcher → TopBar → (SidePanel | ClassroomCanvas)
  - ONE ClassroomCanvas instance stays mounted for entire app lifetime (grid never swaps)
  - Switching editors only changes the `editor` prop passed to ClassroomCanvas
  - CanvasView exposed via ClassroomCanvas's `onViewReady` callback; stored in state so EditorContext rebuilds when geometry changes
  - initPersistence() called once on mount; returned PersistenceHandle stored in ref and state (state drives re-render so Toolbar Save/Load becomes live as soon as persistence is ready)
  - EditorContext = { store (full Zustand store snapshot), canvas (latest CanvasView), persistence (PersistenceHandle | null) }
  - activeEditorId defaulted to first registry entry in a useEffect on first render

- `src/ui/editors/EditorMode.ts` (surgical change)
  - `EditorContext` extended with `persistence: PersistenceHandle | null`
  - All internal EditorContext objects built inside ClassroomCanvas get `persistence: null`
    (canvas event handlers don't need file I/O)
  - Imported PersistenceHandle type from persistence.ts

- `src/ui/canvas/ClassroomCanvas.tsx` (surgical change)
  - Added `onViewReady?: (view: CanvasView) => void` prop
  - Calls onViewReady in a useEffect triggered by [classroom.gridW, classroom.gridH, cellSize]
  - Added persistence: null to the three internal EditorContext objects it builds

- `src/ui/editors/FurnitureEditor.tsx` (stub removal)
  - handleSave / handleLoad now call ctx.persistence.saveToFile() / openFromFile()
  - Guard against ctx.persistence === null (persistence not yet init'd)
  - Removed console.warn stubs; removed dim opacity from Save/Load buttons

- `src/ui/editors/StudentEditor.tsx` (stub removal)
  - Same pattern as FurnitureEditor: handleSave / handleLoad use ctx.persistence
  - Removed console.warn stubs; removed dim opacity

- Grid persistence guarantee test
  - Verify that switching from FurnitureEditor → StudentEditor and back does not
    reset classroom.furniture (Zustand store is the source of truth, not any
    per-editor component)
  - Verify ClassroomCanvas DOM node identity stays stable across editor switches
    (React key is not present; the element stays in the same tree position)

- Erase-all integration test
  - Confirm eraseAll deletes all IndexedDB records (check via idb's getAllKeys after erase)
  - Confirm store resets to empty state (no furniture, empty roster, empty locks)
  - Confirm UI reflects cleared state immediately after erase

### Phase 10 — PreferenceEditor

- `src/state/store.ts` (surgical addition — addPreference / removePreference)
  - `addPreference(studentId, pref)`: index-find, guard undefined, delegates to `studentAddPreference` (pure), replaces roster entry, marks dirty
  - `removePreference(studentId, targetId)`: same pattern, delegates to `removePreferencesFor` (pure), marks dirty
  - Both are immutable: they produce a new roster array without mutating existing Student records
  - Autosave picks them up automatically (saveStatus='dirty' triggers the existing debounced IndexedDB write)
  - Edge cases: studentId not in roster → no-op (findIndex returns -1); roster[idx] undefined guard

- `src/ui/editors/PreferenceEditor.tsx`

  **Marker mode (onPointerDown — port of SeatingGrid._handle_marker_click)**
  - First click on occupied non-fixture desk: sets markerFirstFid + markerFirstStudent (module-level)
  - Second click on different occupied desk: calls store.addPreference(student1.id, pref) using currentWeight; resets selection
  - Self-target (same desk twice): gentle no-op — selection stays; no preference created
  - Click on empty cell, fixture, or non-furniture: no action (all guards in findOccupiedFurnitureAt + occupant checks)
  - currentWeight module-level var is kept in sync with the toolbar weight input via useEffect

  **onKeyDown — ESC cancels**
  - ESC with an in-progress selection: clears markerFirstFid / markerFirstStudent, requests repaint
  - ESC with no selection: no-op (early return)

  **Toolbar (PreferenceToolbar)**
  - Weight numeric input (default −1.0; step 0.5); updates both React state and module-level `currentWeight`
  - Inline "Avoid / Prefer / Neutral" color label derived from weight sign
  - "Show Links" toggle: sets module-level `showLinks`; requests repaint
  - Hint label always visible: "Click a student, then another to link them. ESC to cancel."

  **SidePanel (PreferenceSidePanel)**
  - Lists all real (non-fixture) roster students with preference count badge
  - Click a student row to expand their preferences; click again to collapse
  - Expanded view: each preference shows direction (Avoid/Prefer), target name, weight with ✕ remove button
  - Remove button calls store.removePreference(studentId, targetId) then requests repaint
  - Location-kind preferences shown (read-only; no remove button since removePreference operates on targetId)
  - Inline "Add preference" form: target dropdown (excludes self) + weight input + Add button
  - Add form calls preferStudent/avoidStudent then store.addPreference; guards self-target and empty target
  - Dropdown filters out the selected student (no self-target)

  **paintOverlay**
  - save()/restore() wraps all drawing; canvas NOT cleared
  - Marker first-selection: amber ring (strokeStyle rgba(230,120,0,0.95), lineWidth 3) + light amber fill around the first-selected desk
  - Show Links (when showLinks=true): dashed lines between currently-seated students who share a student-kind preference
    - Green (rgba(46,125,50,0.55)) for prefer (weight > 0)
    - Red (rgba(183,28,28,0.55)) for avoid (weight < 0)
    - Small arrowhead at target end of each link
    - Only draws for currently-seated students (sidToFid reverse map built each frame)
  - Uses usePijonStore.getState() to read classroom (same pattern as StudentEditor)

  **activate / deactivate**
  - activate: clears markerFirstFid, markerFirstStudent; showLinks and currentWeight persist within session
  - deactivate: clears markerFirstFid, markerFirstStudent (no artifacts on tool-switch)

  **Registry change (the ONLY shell change)**
  - `src/ui/editors/registry.ts`: added `import { PreferenceEditor }` + appended to EDITOR_REGISTRY
  - No TopBar, SidePanel, EditorSwitcher, App.tsx, or ClassroomCanvas changes needed

  **Phase 11 notes**
  - PWA manifest and Workbox service-worker (vite-plugin-pwa) still needed for offline / installable use
  - All runtime code is already network-free (ESLint no-network enforced); PWA layer adds only caching/install metadata
  - Recommended: add a "saved locally" indicator animation (pulse on saveStatus='saving') to reinforce the local-first promise before shipping

### Phase 11 — PWA + deploy

- **Service worker (sw.js / workbox)**
  - Verify precache manifest lists all expected assets (JS bundle, HTML, icons, manifest.webmanifest) — no external URLs
  - Verify SW installs and activates in a fresh Chrome profile (DevTools → Application → Service Workers)
  - Confirm `skipWaiting` + `clientsClaim` take effect: open two tabs, trigger a rebuild-simulate update, both tabs receive the new SW
  - Verify `autoUpdate` prompt appears after a deployment (new revision hash in precache triggers update)
  - Offline smoke test: load app, go offline in DevTools Network throttle, reload — app loads from cache without errors

- **PWA install / manifest**
  - Chrome/Edge install prompt appears on first visit after SW activates (Lighthouse PWA audit: installable)
  - Manifest validates: `name`, `short_name`, `description`, `start_url /`, `display standalone`, `theme_color`, `background_color`, all three icons present (192, 512, 512-maskable)
  - 192×192 and 512×512 PNG icons are valid images (not corrupt; readable by the browser)
  - Maskable icon has `purpose: maskable`; passes Maskable.app safe-zone check
  - `apple-touch-icon` renders correctly on iOS Safari Add-to-Home-Screen
  - `apple-mobile-web-app-capable` + `apple-mobile-web-app-title` present in built index.html

- **index.html meta**
  - `<meta name="theme-color">` present with correct indigo value (#4f46e5)
  - `<link rel="icon" type="image/svg+xml">` points to favicon.svg
  - `<link rel="manifest">` injected by vite-plugin-pwa at build time (confirm in dist/index.html)
  - `<meta name="description">` present

- **Save-indicator pulse (TopBar)**
  - `pijon-saving-pulse` CSS class applied to the status span when `saveStatus === 'saving'`
  - Class removed when status changes to `saved`/`dirty`/`error`
  - Keyframe injected exactly once into `<head>` (idempotent guard with STYLE_ID check)

- **Static deploy validation**
  - `dist/` contains only static files (no server config, no .env, no secrets)
  - Running `npx serve dist` and opening localhost: app loads, SW registers, install prompt shows
  - Lighthouse PWA score ≥ 90 on the production build
  - Confirm zero outbound network requests in DevTools Network (filter by XHR/Fetch) after full load
