# Pijon — Human Testing & Validation

This checklist covers everything the automated suite **cannot** verify: real-browser behaviour,
PWA install/offline, visual rendering, and the end-to-end teacher workflow. The 1188-test Vitest
suite + `tsc` + `eslint` already guard the logic; this document is for the parts that need a human,
a real browser, and a pair of eyes.

> **How to use this:** run through it on a release candidate (the `dist/` build, not the dev server,
> for anything PWA/offline). Tick each box. Note the browser + OS you used. File anything that fails
> back into [TODO.md](TODO.md) under Bugs.

**Tester:** ________________  **Date:** ____________  **Build / commit:** ____________

**Environments to cover** (PWA behaviour differs per engine — do at least one Chromium + one of the others):

- [ ] Chrome / Edge (Chromium) — desktop
- [ ] Chromebook (the primary target device)
- [ ] Firefox — desktop (FSA fallback path)
- [ ] Safari — macOS and/or iOS (add-to-home path)

---

## 0. Build & serve the production bundle

The PWA, service worker, and offline behaviour only exist in the built output — **do not test these
on the Vite dev server.**

```sh
cd pijon-site
npm run build          # emits dist/ (should print the PWA precache manifest)
npx serve dist         # or any static server; open the printed localhost URL
```

- [ ] `npm run build` completes with no errors and prints a precache manifest (JS, HTML, icons, `manifest.webmanifest`).
- [ ] `dist/` contains only static files — **no** `.env`, secrets, or server config.
- [ ] The served app loads at `localhost` with no console errors.

---

## 1. Core teacher workflow (functional smoke test)

Walk the full loop from [PROJECT_OUTLINE.md](PROJECT_OUTLINE.md) § *The Teacher's Workflow*. This is
the heart of the app — if any step feels wrong, stop and note it.

### 1a. Build the classroom (Furniture editor)
- [ ] Drag each palette item onto the grid (single desk, table, teacher desk, whiteboard) — it places where dropped.
- [ ] Drag a placed piece to a new cell — **the furniture itself moves live** (not the browser's ghost drag-image).
- [ ] Dropping on an occupied cell is rejected with a clear visual flash; nothing is placed.
- [ ] Select a piece and press Delete / Backspace — it's removed.
- [ ] Resize the grid using the in-grid ghost-ring **+ / −** buttons on each edge (add/remove rows & columns).
- [ ] **Grid granularity:** increase granularity — the board stays the same physical size, squares get finer, and **furniture does not change visible size.**
- [ ] **At high granularity (G ≥ 8):** the ghost-ring resize buttons stay big enough to click (min-size clamp). Confirm you can still add/remove rows.

### 1b. Import the roster (Students editor)
- [ ] Add a student manually via the text box (Enter and the Add button both work; blank input is a no-op).
- [ ] The manual-add box sits **just above** Import CSV, and Import CSV is the **bottom-most** control in the roster panel.
- [ ] Import a **simple** CSV (names only) — students appear with correct names.
- [ ] Import a **full** CSV (names + preferences + fixtures) — students, preferences, and fixtures all import.
- [ ] Re-importing the same file works (no stuck file input).
- [ ] Export CSV downloads a file; re-importing it round-trips the roster + preferences.
- [ ] **Confirm in DevTools → Network: zero requests during import/export** (data never leaves the device).

### 1c. Seat the students
- [ ] The single action split-button: primary action shuffles; the dropdown lets you pick algorithm (Greedy / Random) and allocate-vs-shuffle.
- [ ] Allocate fills desks with a first arrangement.
- [ ] Drag a student between two desks — they swap (if target occupied) or move (if empty).
- [ ] **Drag a student straight from the roster onto a desk** — they get seated (swap if occupied).
- [ ] Right-click a seated desk → lock it. Locked students show a 🔒 badge and **don't move** on the next shuffle.
- [ ] Smart Shuffle re-seats unlocked students while locked ones stay put.
- [ ] **Invalid-seating banner:** add more students than seats (or leave students unplaced) → a clear error/banner appears (no silent failure).
- [ ] Undo / Redo step through shuffles; buttons disable correctly at the ends of history.

### 1d. Preferences (Students editor, right panel)
- [ ] Click a student in the roster → their preferences show in the right-hand panel.
- [ ] Turn on **assigner mode** (toggle at top of the preferences panel); click two students to link them. The **first click gives clear visual feedback** (strong highlight / amber ring).
- [ ] Self-target click is a no-op; ESC clears the first selection.
- [ ] Add / remove a preference from the list; adjust weight (Avoid / Prefer / Neutral label updates).
- [ ] **Mutual preferences:** linking A→B also creates B→A with the same weight; removing one side removes the other. Verify by selecting both students.
- [ ] **Show Links** toggle draws green (prefer) / red (avoid) dashed lines between seated students with arrowheads.

### 1e. Violations & neighbors
- [ ] **Show Violations is ON by default.** Its off-switch lives in the **Settings** popover (gear button), not the main toolbar.
- [ ] Seat two students who avoid each other as neighbors → both desks get a red violation tint.
- [ ] **Staleness check:** turn Show Violations OFF, edit a preference, turn it back ON → the display reflects the **updated** preferences (no stale cache).
- [ ] Right-click a desk → its neighbors highlight (purple source, dashed neighbors). Right-click again clears it.
- [ ] **Nearness** control lives in Settings; changing it updates allocation, violations, and neighbor preview consistently.

### 1f. Editor switching & shared grid
- [ ] Switch Furniture ↔ Students repeatedly — **the grid, furniture, and seating stay intact** (only the toolbar + side panels swap).
- [ ] Move a desk in the Furniture editor that has a student → switch to Students editor → the student is still on that desk in its new position.

### 1g. Right-click menu dismissal
- [ ] Open a desk's right-click/context menu, then **left-click anywhere on the grid** → the menu dismisses (not only on another right-click).

---

## 2. Autosave & data safety

- [ ] A **"Saved locally"** indicator is visible; it pulses while saving and settles to "Saved".
- [ ] Make a change, then **reload the page** → the classroom, roster, preferences, and locks are exactly as left.
- [ ] Close the tab and reopen → state persists (IndexedDB autosave).
- [ ] **Save to file:** save a `.pijon` project file (Chromium uses the file picker; Firefox/Safari fall back to a download). Confirm the file is created.
- [ ] **Open from file:** open the saved `.pijon` in a fresh session → state restores correctly.
- [ ] On Firefox/Safari, the save/open **fallback** (download + `<input type=file>`) works.
- [ ] **Erase all:** click "Erase all" → a confirm dialog appears; on confirm the class is wiped (empty grid, empty roster); on cancel nothing changes.
- [ ] After Erase all, reload → state stays empty (IndexedDB records were deleted).
- [ ] DevTools → Application → IndexedDB: a `project:<id>` record exists while working and is gone after Erase all.

---

## 3. PWA: install, service worker, offline

> Use the **built `dist/` served over a static server** (or the deployed URL). PWA features need a
> secure context (`localhost` counts) and the real service worker.

### 3a. Service worker
- [ ] DevTools → Application → Service Workers: the SW **installs and activates** in a fresh profile.
- [ ] The precache list (Application → Cache Storage) contains the JS bundle, HTML, icons, and `manifest.webmanifest` — **no external/remote URLs.**
- [ ] Rebuild and redeploy (or simulate an update): the update prompt / new SW activates; `skipWaiting` + `clientsClaim` mean two open tabs both pick up the new version.

### 3b. Offline
- [ ] Load the app, then set DevTools → Network → **Offline**, and reload → the app loads fully from cache with no errors.
- [ ] While offline, the core workflow (place furniture, add students, shuffle, save to IndexedDB) still works.
- [ ] **DevTools → Network shows zero outbound XHR/fetch** after a full load (filter by Fetch/XHR), online or offline.

### 3c. Install / manifest
- [ ] Chrome/Edge shows an **install prompt** (or address-bar install icon) after the SW activates.
- [ ] Installing adds Pijon to the shelf/desktop; it launches standalone (no browser chrome) and works offline.
- [ ] `manifest.webmanifest` validates: `name`, `short_name`, `description`, `start_url` `/`, `display: standalone`, `theme_color` (#4f46e5 indigo), `background_color`, and all three icons (192, 512, 512-maskable) present.
- [ ] The 192×192 and 512×512 PNG icons render (not corrupt).
- [ ] Maskable icon passes the [maskable.app](https://maskable.app) safe-zone check.
- [ ] **iOS Safari:** "Add to Home Screen" uses the `apple-touch-icon` and the app title; launching from the home screen works.
- [ ] Lighthouse (DevTools → Lighthouse → PWA + Installable) scores **≥ 90** on the production build.

### 3d. index.html meta (view source on the built page)
- [ ] `<meta name="theme-color">` present with the indigo value (#4f46e5).
- [ ] `<link rel="icon" type="image/svg+xml">` points to the favicon.
- [ ] `<link rel="manifest">` is present (injected at build time).
- [ ] `<meta name="description">` present; `apple-mobile-web-app-capable` + `apple-mobile-web-app-title` present.

---

## 4. Visual & theming (eyeball pass)

The automated tests check that colors/images come from the central files, but not that they *look*
right. Skim for these:

- [ ] Furniture renders from its image (per kind) when an asset is present, and falls back to a flat color when not.
- [ ] The classroom background image option works (plain white by default).
- [ ] The grid color picker opens from its asset-icon button and recolors the grid **live** as you drag in the picker; the color persists per classroom across reload.
- [ ] No layout breakage at narrow widths / on a Chromebook screen; panels scroll independently of the grid.
- [ ] Text on desks is legible and stays clipped within the furniture; tiny cells hide text rather than overflow.

---

## 5. Sign-off

- [ ] All sections above pass, or every failure is logged in [TODO.md](TODO.md) under Bugs.
- [ ] Tested on at least one Chromium browser **and** one non-Chromium (Firefox or Safari).
- [ ] Production build (`npm run build`) was used for §0 and §3.

**Result:** ☐ Pass  ☐ Pass with noted issues  ☐ Fail
**Notes:**

_______________________________________________________________________________

---

### What this document does *not* cover

Logic correctness (allocation, CSV parsing, persistence, store, canvas geometry, editor lifecycle)
is covered by the 1188-test Vitest suite — run `npx vitest run` for that. This file is strictly the
human/real-browser layer on top.
