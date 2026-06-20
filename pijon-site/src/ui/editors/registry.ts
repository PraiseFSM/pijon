/**
 * registry.ts — ordered list of available editors.
 *
 * §12.4: PreferenceEditor has been merged into StudentEditor and deleted.
 * The registry now contains exactly [FurnitureEditor, StudentEditor].
 * StudentEditor exposes both a SidePanel (roster) and a RightPanel (preferences),
 * so adding an editor still requires only one registry entry.
 *
 * LOCAL-FIRST: no network calls. Each editor is a plain EditorMode object.
 */

import type { EditorMode } from './EditorMode.js';
import { FurnitureEditor } from './FurnitureEditor.js';
import { StudentEditor } from './StudentEditor.js';

/**
 * The ordered list of editor tools available in the shell.
 * EditorSwitcher renders one tab per entry, in this order.
 * The first entry is the default active editor on load.
 */
export const EDITOR_REGISTRY: readonly EditorMode[] = [
  FurnitureEditor,
  StudentEditor,
];
