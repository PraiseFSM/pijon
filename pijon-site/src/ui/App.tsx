/**
 * App.tsx — top-level shell (Phase 1 scaffold: heading only)
 *
 * Later phases will wire in EditorSwitcher, TopBar, SidePanel, and
 * ClassroomCanvas here. For now this confirms the React tree renders.
 *
 * LOCAL-FIRST reminder: no fetch(), no XHR, no WebSocket anywhere in this app.
 * All persistence goes through IndexedDB (autosave) or the File System Access API
 * (explicit save/open). See PROJECT_OUTLINE.md § Design Goals.
 */
export default function App() {
  return (
    <div>
      <h1>Pijon</h1>
    </div>
  );
}
