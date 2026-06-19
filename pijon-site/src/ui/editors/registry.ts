/**
 * registry.ts — ordered list of available editors (Phase 9).
 *
 * Adding an editor in a future phase is a one-line change here.
 * PreferenceEditor appended in Phase 10.
 *
 * LOCAL-FIRST: no network calls. Each editor is a plain EditorMode object.
 */

import type { EditorMode } from './EditorMode.js';
import { FurnitureEditor } from './FurnitureEditor.js';
import { StudentEditor } from './StudentEditor.js';
import { PreferenceEditor } from './PreferenceEditor.js';

/**
 * The ordered list of editor tools available in the shell.
 * EditorSwitcher renders one tab per entry, in this order.
 * The first entry is the default active editor on load.
 */
export const EDITOR_REGISTRY: readonly EditorMode[] = [
  FurnitureEditor,
  StudentEditor,
  PreferenceEditor,
];
