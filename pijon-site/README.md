# Pijon (web)

A local-first, no-install web app for building classroom layouts and seating students. Your data
never leaves your device.

> Status: Phase 11 complete (PWA + deploy). Full offline PWA — installable from URL, works without a connection after first load. Build, lint, and typecheck all pass.

## How development works here

Two documents, two audiences:

1. **[PROJECT_OUTLINE.md](PROJECT_OUTLINE.md)** — the **source of truth**, written for humans.
   Design goals, concepts, and features in plain language. The human developer edits *this*.
2. **[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)** — the **technical translation** for
   the coding agent: stack, class outlines, language decisions, and a phased task breakdown the agent
   dispatches to subagents.

The flow: **human edits the outline → outline is translated into the implementation plan → the
coding agent executes the plan, checking every change against the outline's Design Goals.** If the
two ever disagree, the outline wins and the plan is corrected.

## Stack (see the implementation plan for rationale)

TypeScript · Vite · React · Zustand · Canvas 2D · IndexedDB + File System Access API · PWA. Static
hosting, no backend, no runtime network calls.

---

## Build & deploy

```sh
npm run build   # emits a fully-static dist/
```

Deploy the `dist/` folder to any static host — no server, no runtime dependencies:

| Host | Command / steps |
|---|---|
| **Netlify** | Drag-and-drop `dist/` in the Netlify UI, or `netlify deploy --dir dist --prod` |
| **Cloudflare Pages** | Connect the repo; build command `npm run build`, output dir `dist` |
| **GitHub Pages** | Push `dist/` to the `gh-pages` branch, or use the [actions/deploy-pages](https://github.com/actions/deploy-pages) action |

**No backend, no server, no runtime network.** The service worker precaches the app shell on first
load; subsequent visits — and installs — work fully offline.

### GitHub Pages project sites (non-root base path)

If you host at `https://username.github.io/pijon/` (a project site, not an org/user site), set
`base` in `vite.config.ts`:

```ts
export default defineConfig({
  base: '/pijon/',   // match your repo name
  plugins: [ … ],
});
```

Leave `base` at the default `/` for root deployments (Netlify, Cloudflare Pages, custom domain).

### Installing as a PWA

Open the deployed URL in Chrome, Edge, or a Chromebook browser. The browser will show an "Install"
prompt (or use the address-bar install icon). Tap **Install** — Pijon is added to the shelf/desktop
and works offline from that point forward. No app store, nothing to sign, no admin rights needed.
