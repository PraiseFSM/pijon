# Pijon Asset Reference

> **Single source of truth** for all image assets in Pijon.
>
> Location decision: assets live in `public/assets/` so Vite serves them at a
> stable URL path (`/assets/<filename>`) without any build-step transformation.
> A designer or integrator can drop a correctly-named replacement file into this
> folder and it shows up immediately — no code change, no rebuild required.
>
> Color decision: non-image colors are NOT here. They live in
> `src/theme/colors.ts` (TypeScript module so they can be imported and
> type-checked). That file is the single source of truth for every hex/rgba
> color used in the UI. See that file for color tokens.

---

## Asset table

| Purpose / where used | Expected size | Aspect ratio | Format | Filename |
|---|---|---|---|---|
| Default furniture fallback image (shown in canvas when no kind-specific image exists; also in palette items — §14.3) | 128 × 128 px | 1:1 | PNG | `furniture-default.png` |
| Classroom background (drawn behind grid lines in render.ts — §14.4; plain white by default) | 64 × 64 px (tiles/stretches) | any | PNG | `classroom-background.png` |
| App favicon (tab icon + PWA shortcut; referenced from `index.html`) | 32 × 32 (SVG is resolution-independent) | 1:1 | SVG | `favicon.svg` |
| Grid-color-button icon (the button that opens the grid color picker — §14.5; solid purple placeholder) | 32 × 32 px | 1:1 | PNG | `grid-color-button.png` |

---

## Notes

- **PWA manifest icons** (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) live in
  `public/` (root), NOT in `public/assets/`. This is intentional: the Vite PWA plugin
  references them at `/icon-*.png` in the generated manifest, and moving them would require
  updating `vite.config.ts`. They are kept as-is (Phase 11 originals); only the browser
  favicon is routed through this `assets/` folder.

- **Furniture kind images** (§14.3 — `single-desk.png`, `table.png`, `teacher-desk.png`,
  `whiteboard.png`) will be added here when implemented. Use `furniture-default.png` as the
  fallback until then.

- To replace any asset: drop a correctly-named file here. PNG is preferred for raster assets
  so they can be swapped with photos later. SVG is acceptable for icons.

- All assets are referenced in code exclusively through the **asset path helper**
  (`src/assets/paths.ts`) which maps logical names to URL strings. Never hard-code
  `/assets/<filename>` strings in component code — use the helper instead.
