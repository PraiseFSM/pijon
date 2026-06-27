/**
 * TopBar — §7.A1/7.A2/7.A3 unified single top bar.
 *
 * Layout (left → right):
 *   Logo · Furniture/Students lever · [editor Toolbar] · [flex gap] · Settings gear · saved-status · Erase all
 *
 * The Furniture/Students lever (§7.A1) replaces the separate EditorSwitcher row.
 * The editor Toolbar fills the middle section (mode-specific controls).
 * The trailing group (Settings, save status, Erase all) is identical in both modes.
 *
 * §7.A3: Settings gear lives here (not inside the editor toolbar), so Settings is
 * shared across modes. The SettingsMenu is rendered by this component.
 *
 * Erase all: clicking the button shows a browser confirm dialog before wiping
 * — supports the shared-computer privacy goal (PROJECT_OUTLINE § Design Goals).
 *
 * LOCAL-FIRST: no network. Reads saveStatus from the store; triggers
 * persistence.eraseAll() (IndexedDB delete + store reset) on confirm.
 */

import { useState, useCallback } from 'react';
import { usePijonStore } from '../../state/store.js';
import type { EditorContext, EditorMode } from '../editors/EditorMode.js';
import { EDITOR_REGISTRY } from '../editors/registry.js';
import { SettingsMenu, GearButton } from './SettingsMenu.js';
import { ToggleLever } from '../components/ToggleLever.js';
import { getActiveThemeColors } from '../../theme/themes.js';
import {
  toolbarBackground,
  toolbarBorder,
  panelBorder,
  logoText,
  tabActiveBackground,
  tabActiveBorder,
  tabActiveText,
  topBarRightBackground,
  topBarRightText,
  textMuted,
} from '../../theme/colors.js';

// Inject a tiny keyframe for the "saving…" pulse — done once, idempotent
if (typeof document !== 'undefined') {
  const STYLE_ID = '__pijon-saving-pulse';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
@keyframes pijon-saving-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
.pijon-saving-pulse {
  animation: pijon-saving-pulse 1.2s ease-in-out infinite;
}
    `.trim();
    document.head.appendChild(style);
  }
}

// ---------------------------------------------------------------------------
// Save status label / colour map
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  saved: '● Saved locally',
  saving: '● Saving…',
  dirty: '● Unsaved changes',
  error: '● Save error',
};

// ---------------------------------------------------------------------------
// TopBar
// ---------------------------------------------------------------------------

export interface TopBarProps {
  activeEditor: EditorMode;
  ctx: EditorContext;
}

export function TopBar({ activeEditor, ctx }: TopBarProps) {
  const saveStatus = usePijonStore((s) => s.saveStatus);
  const activeEditorId = usePijonStore((s) => s.activeEditorId);
  const label = STATUS_LABEL[saveStatus] ?? `● ${saveStatus}`;
  // §8.B3 — Re-render when theme changes so logo/text updates immediately.
  // themeId is read from the store so this component re-renders on theme change;
  // getActiveThemeColors() is then called to obtain the resolved logo path.
  const themeId = usePijonStore((s) => s.themeId);
  const activeLogoPath = themeId ? getActiveThemeColors().logo : null;

  // §7.A3 — Settings menu state lives here (shared across modes)
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const handleEraseAll = () => {
    const ok = window.confirm(
      'Erase all class data from this device?\n\n' +
        'This will delete the saved classroom, roster, and seating arrangement ' +
        'from local storage. This cannot be undone.\n\n' +
        'Use "Save…" first if you want to keep a copy.',
    );
    if (!ok) return;

    if (ctx.persistence !== null) {
      void ctx.persistence.eraseAll();
    } else {
      // persistence not yet initialised — still reset the store
      ctx.store.eraseAll();
    }
  };

  return (
    <div
      data-testid="top-bar"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        borderBottom: `1px solid ${toolbarBorder}`,
        background: toolbarBackground,
        minHeight: 40,
      }}
    >
      {/* §8.B3 — Logo: image when scheme provides a path; "Pijon" text otherwise */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          borderRight: `1px solid ${panelBorder}`,
          flexShrink: 0,
        }}
      >
        {activeLogoPath !== null ? (
          <img
            src={activeLogoPath}
            alt="Pijon"
            data-testid="logo-image"
            style={{ height: 24, maxWidth: 80, objectFit: 'contain' }}
            onError={(e) => {
              // Graceful fallback: hide the broken image; show the sibling text span
              e.currentTarget.style.display = 'none';
              const sibling = e.currentTarget.nextElementSibling;
              if (sibling instanceof HTMLElement) sibling.style.display = '';
            }}
          />
        ) : null}
        {/* Always in the DOM; visible when logo=null, hidden when logo is set */}
        <span
          data-testid="logo-text"
          style={{
            fontWeight: 700,
            fontSize: '0.9rem',
            color: logoText,
            letterSpacing: '-0.01em',
            display: activeLogoPath !== null ? 'none' : undefined,
          }}
        >
          Pijon
        </span>
      </div>

      {/* §11.B1 — Furniture [lever] Students — labelled-switch layout.
           Both side labels are clickable; the lever knob also toggles.
           Furniture = lever OFF/left; Students = lever ON/right.
           Active side is bold + selectedBox accent; inactive side is muted. */}
      <div
        role="group"
        aria-label="Editor mode"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 8px',
          borderRight: `1px solid ${panelBorder}`,
          flexShrink: 0,
        }}
      >
        {/* Left label — Furniture (active when lever is OFF) */}
        <button
          type="button"
          data-testid="editor-mode-furniture"
          onClick={() => {
            usePijonStore.getState().setActiveEditorId(EDITOR_REGISTRY[0]?.id ?? 'furniture');
          }}
          title={`Switch to ${EDITOR_REGISTRY[0]?.label ?? 'Furniture'} editor`}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.82rem',
            fontWeight: activeEditorId === (EDITOR_REGISTRY[0]?.id ?? 'furniture') ? 700 : 400,
            color:
              activeEditorId === (EDITOR_REGISTRY[0]?.id ?? 'furniture')
                ? tabActiveBorder /* selectedBox accent */
                : textMuted,
            padding: '1px 2px',
            whiteSpace: 'nowrap',
          }}
        >
          {EDITOR_REGISTRY[0]?.label ?? 'Furniture'}
        </button>

        {/* Center lever knob — toggles between the two editors */}
        <ToggleLever
          labelOff=""
          labelOn=""
          on={activeEditorId === (EDITOR_REGISTRY[1]?.id ?? 'student')}
          onToggle={() => {
            const current = usePijonStore.getState().activeEditorId;
            const next =
              current === (EDITOR_REGISTRY[0]?.id ?? 'furniture')
                ? (EDITOR_REGISTRY[1]?.id ?? 'student')
                : (EDITOR_REGISTRY[0]?.id ?? 'furniture');
            usePijonStore.getState().setActiveEditorId(next);
          }}
          activeBackground={tabActiveBackground}
          activeColor={tabActiveText}
          activeBorderColor={tabActiveBorder}
          testId="editor-mode-lever"
          ariaPressed={activeEditorId === (EDITOR_REGISTRY[1]?.id ?? 'student')}
          title={
            activeEditorId === (EDITOR_REGISTRY[1]?.id ?? 'student')
              ? `Switch to ${EDITOR_REGISTRY[0]?.label ?? 'Furniture'} editor`
              : `Switch to ${EDITOR_REGISTRY[1]?.label ?? 'Students'} editor`
          }
          extraStyle={{ padding: '3px 6px', gap: 0 }}
        />

        {/* Right label — Students (active when lever is ON) */}
        <button
          type="button"
          data-testid="editor-mode-students"
          onClick={() => {
            usePijonStore.getState().setActiveEditorId(EDITOR_REGISTRY[1]?.id ?? 'student');
          }}
          title={`Switch to ${EDITOR_REGISTRY[1]?.label ?? 'Students'} editor`}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.82rem',
            fontWeight: activeEditorId === (EDITOR_REGISTRY[1]?.id ?? 'student') ? 700 : 400,
            color:
              activeEditorId === (EDITOR_REGISTRY[1]?.id ?? 'student')
                ? tabActiveBorder /* selectedBox accent */
                : textMuted,
            padding: '1px 2px',
            whiteSpace: 'nowrap',
          }}
        >
          {EDITOR_REGISTRY[1]?.label ?? 'Students'}
        </button>
      </div>

      {/* Active editor's Toolbar — fills remaining horizontal space */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <activeEditor.Toolbar ctx={ctx} />
      </div>

      {/* §11.A4 — Global right-side trailing group: Settings · saved-status · Erase all.
           Sits on its own `topBarRight` surface, separated by a 1px vertical divider.
           Erase-all and Saved-locally have transparent backgrounds (they sit on this surface). */}
      <div
        data-testid="top-bar-right"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 12px',
          borderLeft: `1px solid ${panelBorder}`,
          background: topBarRightBackground,
          flexShrink: 0,
          whiteSpace: 'nowrap',
          position: 'relative',
        }}
      >
        {/* §7.A3 — Settings gear (shared, always visible) */}
        <div style={{ position: 'relative' }}>
          <GearButton
            open={settingsOpen}
            onClick={() => { setSettingsOpen((prev) => !prev); }}
          />
          <SettingsMenu
            ctx={ctx}
            open={settingsOpen}
            onClose={handleCloseSettings}
          />
        </div>

        {/* §11.A4/11.A5 — "Saved locally" indicator — transparent background on topBarRight
             surface. Text uses topBarRightText (scheme-aware) for WCAG AA legibility:
             classic = #333 (12.6:1 on #f5f5f5), purpleGreen = #fff (4.87:1 on #84659a). */}
        <span
          className={saveStatus === 'saving' ? 'pijon-saving-pulse' : undefined}
          data-testid="saved-indicator"
          style={{
            fontSize: '0.78rem',
            color: topBarRightText,
            fontWeight: 500,
            background: 'transparent',
            padding: '1px 7px',
            borderRadius: 3,
          }}
          title="All data is saved only on this device — nothing is uploaded"
        >
          {label}
        </span>

        {/* §11.A4/11.A5 — Erase all — transparent background on topBarRight surface.
             Text + border use topBarRightText (scheme-aware, WCAG AA) so the button
             remains readable on both light (classic) and dark (purpleGreen) surfaces.
             The border identifies it as an interactive element; the label communicates danger. */}
        <button
          type="button"
          onClick={handleEraseAll}
          data-testid="erase-all-button"
          title="Erase all class data from this device (for shared computers)"
          style={{
            padding: '2px 8px',
            fontSize: '0.72rem',
            color: topBarRightText,
            background: 'transparent',
            border: `1px solid ${topBarRightText}`,
            borderRadius: 3,
            cursor: 'pointer',
            opacity: 0.85,
          }}
        >
          Erase all
        </button>
      </div>
    </div>
  );
}
