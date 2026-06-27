/**
 * Persistence — Phase 5.
 *
 * Three layers of persistence:
 *
 * 1. IndexedDB autosave (crash recovery)
 *    - Debounced ~400ms write on every store change.
 *    - Flush immediately on `visibilitychange → hidden` and `beforeunload`.
 *    - Uses the `idb` library for a typed, Promise-based IndexedDB wrapper.
 *    - One record per class under key `project:<classroomId>`.
 *    - Hydrates the store on startup from the most recently saved record.
 *    - saveStatus: dirty → saving → saved (or error).
 *
 * 2. Explicit save/open via File System Access API (teacher-owned .pijon file)
 *    - `saveToFile()` — write the current project to a .pijon file.
 *      On browsers with FSA: uses showSaveFilePicker; remembers the handle for
 *      one-tap re-save. On fallback (Firefox/Safari): Blob download.
 *    - `openFromFile()` — read a .pijon file and hydrate the store.
 *      On browsers with FSA: uses showOpenFilePicker; remembers handle.
 *      On fallback: triggers a hidden <input type="file"> read.
 *    - `resaveToHandle()` — write to the remembered handle without a picker
 *      (one-tap re-save). Falls back to saveToFile() if no handle is stored.
 *
 * 3. eraseAll
 *    - Deletes the IndexedDB record(s) for the current classroom.
 *    - Also calls store.eraseAll() to reset runtime state.
 *    - Used on shared/school computers to wipe student data.
 *
 * History persistence:
 *    The undo stack is NOT persisted to IndexedDB (reload starts fresh).
 *    The rationale: serialising potentially 50 large classroom snapshots adds
 *    write overhead and complexity for marginal benefit (the durable project is
 *    always saved; a reload just loses the undo stack, not the last state).
 *    Deferred in TODO.md.
 *
 * Privacy guarantee:
 *    No network call of any kind. Writes go only to:
 *      a) IndexedDB on the user's own device.
 *      b) A file the user explicitly picks from their own disk.
 *    The ESLint no-restricted-globals rule enforces this at build time.
 *
 * No React/DOM imports (except the minimal DOM types used for FSA + input).
 */

import { openDB, type IDBPDatabase } from 'idb';
import { usePijonStore } from './store.js';
import {
  extractProject,
  serializeProject,
  parseProject,
  composeClassroom,
} from '../domain/io/projectFile.js';

// ---------------------------------------------------------------------------
// IndexedDB schema
// ---------------------------------------------------------------------------

const DB_NAME = 'pijon';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

/** How long to wait after the last store change before writing to IndexedDB (ms). */
const DEBOUNCE_WRITE_MS = 400;

/**
 * The shape stored in IndexedDB.
 * Key: `project:<classroomId>`
 * Value: JSON string (serialized ProjectFile)
 */
interface PijonDB {
  [STORE_NAME]: {
    key: string;
    value: string;
  };
}

/**
 * Open (or create) the IndexedDB database.
 * Returns null when IndexedDB is unavailable (private-browsing in some browsers,
 * locked-down contexts, or non-DOM test environments). Callers must degrade
 * gracefully: the app runs in-memory and explicit file save/open still work.
 */
async function openPijonDB(): Promise<IDBPDatabase<PijonDB> | null> {
  if (typeof indexedDB === 'undefined') return null;
  return openDB<PijonDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
}

/** Build the stable per-class IndexedDB key. */
function idbKey(classroomId: string): string {
  return `project:${classroomId}`;
}

// ---------------------------------------------------------------------------
// Debounce helper
// ---------------------------------------------------------------------------

/**
 * Returns a debounced version of `fn` that waits `delayMs` after the last
 * call before executing. Also exposes `.flush()` to run immediately (used for
 * visibilitychange + beforeunload).
 */
interface Debounced {
  (): void;
  flush(): void;
  cancel(): void;
}

function debounce(fn: () => void, delayMs: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    fn();
  };

  const debounced = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(run, delayMs);
  };
  debounced.flush = run;
  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}

// ---------------------------------------------------------------------------
// Internal write helper
// ---------------------------------------------------------------------------

/** Serialize and write the current store state to IndexedDB. */
async function writeToIDB(db: IDBPDatabase<PijonDB> | null): Promise<void> {
  if (!db) return;
  const state = usePijonStore.getState();
  const pf = extractProject({
    classroom: state.classroom,
    roster: state.roster,
    locks: Array.from(state.locks),
  });
  const json = serializeProject(pf);
  const key = idbKey(state.classroom.id);
  await db.put(STORE_NAME, json, key);
}

// ---------------------------------------------------------------------------
// File System Access API feature detection
// ---------------------------------------------------------------------------

/**
 * True when the browser supports the File System Access API (Chrome/Edge/Chromebooks).
 * Firefox and Safari fall back to Blob download + <input type="file">.
 */
function hasFSA(): boolean {
  return (
    typeof window !== 'undefined' &&
    'showSaveFilePicker' in window &&
    'showOpenFilePicker' in window
  );
}

// ---------------------------------------------------------------------------
// Persistence handle (returned by initPersistence)
// ---------------------------------------------------------------------------

export interface PersistenceHandle {
  /** Save to the currently remembered FileSystemFileHandle (or trigger picker). */
  resaveToHandle(): Promise<void>;
  /** Trigger save-to-file dialog / fallback download. */
  saveToFile(): Promise<void>;
  /** Trigger open-file dialog / fallback input, then hydrate the store. */
  openFromFile(): Promise<void>;
  /**
   * Delete the IndexedDB record(s) for the current classroom and reset the store.
   * Call this for the one-tap erase on shared computers.
   */
  eraseAll(): Promise<void>;
  /** Tear down listeners (call on unmount if hot-reloading). */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// FSA type shims
// (The DOM lib shipped with TS targets does not include FSA in all versions.)
// ---------------------------------------------------------------------------

type ShowSaveFilePickerFn = (opts: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

type ShowOpenFilePickerFn = (opts: {
  types?: { description: string; accept: Record<string, string[]> }[];
  multiple?: boolean;
}) => Promise<FileSystemFileHandle[]>;

// ---------------------------------------------------------------------------
// initPersistence — wire autosave and return explicit-save API
// ---------------------------------------------------------------------------

/**
 * Wire up all persistence. Call once at app startup (e.g. in App's useEffect).
 *
 * Steps:
 *   1. Opens (or creates) the IndexedDB database.
 *   2. Attempts to hydrate the store from the most recently saved record.
 *      If none found, the store stays in its default empty state.
 *   3. Subscribes to store changes and schedules debounced writes.
 *   4. Registers visibilitychange + beforeunload flush listeners.
 *   5. Returns a PersistenceHandle for explicit save/open/erase.
 */
export async function initPersistence(): Promise<PersistenceHandle> {
  // 1. Open the database
  const db = await openPijonDB();

  // 2. Hydrate from IndexedDB
  //    We look for the record whose key matches the current classroom id.
  //    On a fresh install there's nothing, so we also do a scan for ANY project
  //    and load the first one found (so returning users see their last class).
  let hydrated = false;

  /**
   * Type-safe IDB get wrapper.
   * idb's StoreValue resolves to `any` via its DBSchemaValue base type, so we
   * narrow the result here with a runtime typeof check to satisfy strict-any lint.
   */
  async function getRecord(key: string): Promise<string | undefined> {
    if (!db) return undefined;
    const raw: unknown = await db.get(STORE_NAME, key);
    return typeof raw === 'string' ? raw : undefined;
  }

  // Try current classroom id first (fastest path after the first load)
  const currentKey = idbKey(usePijonStore.getState().classroom.id);
  const existingJson = await getRecord(currentKey);

  if (existingJson !== undefined) {
    try {
      const pf = parseProject(existingJson);
      const loaded = composeClassroom(pf);
      usePijonStore.getState().hydrate(loaded);
      hydrated = true;
    } catch {
      // Corrupted record — ignore and start fresh
    }
  }

  if (!hydrated && db) {
    // Scan for any saved project (user had a different default classroom id)
    const allKeys = await db.getAllKeys(STORE_NAME);
    for (const key of allKeys) {
      // Our keys are always strings (project:<id>); skip any non-string keys
      // that might exist from future schema changes or corruption.
      if (typeof key !== 'string') continue;
      const json = await getRecord(key);
      if (json === undefined) continue;
      try {
        const pf = parseProject(json);
        const loaded = composeClassroom(pf);
        usePijonStore.getState().hydrate(loaded);
        hydrated = true;
        break;
      } catch {
        // Skip corrupt records
      }
    }
  }

  if (hydrated) {
    usePijonStore.getState().setSaveStatus('saved');
  }

  // 3. Subscribe and debounce writes
  const debouncedWrite = debounce(() => {
    usePijonStore.getState().setSaveStatus('saving');
    writeToIDB(db)
      .then(() => {
        usePijonStore.getState().setSaveStatus('saved');
      })
      .catch(() => {
        usePijonStore.getState().setSaveStatus('error');
      });
  }, DEBOUNCE_WRITE_MS);

  // Zustand subscribe — called on every state change.
  // usePijonStore.subscribe receives the full store state.
  const unsubscribe = usePijonStore.subscribe((state) => {
    if (state.saveStatus === 'dirty') {
      debouncedWrite();
    }
  });

  // 4. Flush handlers for tab close / background transitions
  const handleVisibility = () => {
    if (document.visibilityState === 'hidden' && usePijonStore.getState().saveStatus === 'dirty') {
      debouncedWrite.flush();
    }
  };

  const handleBeforeUnload = () => {
    if (usePijonStore.getState().saveStatus === 'dirty') {
      debouncedWrite.flush();
    }
  };

  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('beforeunload', handleBeforeUnload);

  // ---------------------------------------------------------------------------
  // Serialise current state to a JSON string (shared by save paths)
  // ---------------------------------------------------------------------------

  function currentJson(): string {
    const s = usePijonStore.getState();
    const pf = extractProject({
      classroom: s.classroom,
      roster: s.roster,
      locks: Array.from(s.locks),
    });
    return serializeProject(pf);
  }

  // ---------------------------------------------------------------------------
  // Save helpers
  // ---------------------------------------------------------------------------

  /** FSA save: show picker, write, remember handle. */
  async function saveViaFSA(): Promise<void> {
    const showSave = (window as unknown as { showSaveFilePicker: ShowSaveFilePickerFn })
      .showSaveFilePicker;

    const handle = await showSave({
      suggestedName: `${usePijonStore.getState().classroom.name}.pijon`,
      types: [
        {
          description: 'Pijon class file',
          accept: { 'application/json': ['.pijon'] },
        },
      ],
    });

    const writable = await handle.createWritable();
    await writable.write(currentJson());
    await writable.close();
    usePijonStore.getState().setFileHandle(handle);
    usePijonStore.getState().setSaveStatus('saved');
  }

  /** Fallback save: Blob download (Firefox / Safari). */
  function saveViaDownload(): void {
    const json = currentJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${usePijonStore.getState().classroom.name}.pijon`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a short delay to allow the download to start
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    usePijonStore.getState().setSaveStatus('saved');
  }

  /** FSA open: show picker, read, hydrate. */
  async function openViaFSA(): Promise<void> {
    const showOpen = (window as unknown as { showOpenFilePicker: ShowOpenFilePickerFn })
      .showOpenFilePicker;

    const handles = await showOpen({
      types: [
        {
          description: 'Pijon class file',
          accept: { 'application/json': ['.pijon'] },
        },
      ],
      multiple: false,
    });

    const handle = handles[0];
    if (handle === undefined) return;

    const file = await handle.getFile();
    const json = await file.text();
    const pf = parseProject(json);
    const loaded = composeClassroom(pf);
    usePijonStore.getState().hydrate(loaded);
    usePijonStore.getState().setFileHandle(handle);
    usePijonStore.getState().setSaveStatus('saved');

    // Also persist to IndexedDB so crash recovery works for the newly opened file
    await writeToIDB(db);
  }

  /** Fallback open: <input type="file"> (Firefox / Safari). */
  async function openViaInput(): Promise<void> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pijon,application/json';

      input.onchange = () => {
        const file = input.files?.[0];
        if (file === undefined) {
          resolve();
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          try {
            const json = reader.result as string;
            const pf = parseProject(json);
            const loaded = composeClassroom(pf);
            usePijonStore.getState().hydrate(loaded);
            usePijonStore.getState().setSaveStatus('saved');
            // Persist to IndexedDB
            writeToIDB(db).then(resolve).catch(reject);
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        };
        reader.onerror = () => {
          reject(new Error('Failed to read file.'));
        };
        reader.readAsText(file);
      };

      input.oncancel = () => {
        resolve();
      };

      // Trigger the file picker
      input.click();
    });
  }

  // ---------------------------------------------------------------------------
  // PersistenceHandle implementation
  // ---------------------------------------------------------------------------

  const handle: PersistenceHandle = {
    async saveToFile() {
      if (hasFSA()) {
        await saveViaFSA();
      } else {
        saveViaDownload();
      }
    },

    async resaveToHandle() {
      const fileHandle = usePijonStore.getState().fileHandle;
      if (fileHandle === null || !hasFSA()) {
        // No handle or no FSA — fall back to saveToFile
        await handle.saveToFile();
        return;
      }

      try {
        const writable = await fileHandle.createWritable();
        await writable.write(currentJson());
        await writable.close();
        usePijonStore.getState().setSaveStatus('saved');
      } catch {
        // Handle may have become invalid — re-prompt
        await saveViaFSA();
      }
    },

    async openFromFile() {
      if (hasFSA()) {
        await openViaFSA();
      } else {
        await openViaInput();
      }
    },

    async eraseAll() {
      if (db) {
        // Delete the IndexedDB record for the current classroom
        const key = idbKey(usePijonStore.getState().classroom.id);
        await db.delete(STORE_NAME, key);

        // Also delete all other records in the store (belt-and-suspenders)
        const allKeys = await db.getAllKeys(STORE_NAME);
        for (const k of allKeys) {
          await db.delete(STORE_NAME, k);
        }
      }

      // Reset the store to empty state
      usePijonStore.getState().eraseAll();
    },

    destroy() {
      unsubscribe();
      debouncedWrite.cancel();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    },
  };

  return handle;
}
