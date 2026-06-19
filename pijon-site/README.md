# Pijon (web)

A local-first, no-install web app for building classroom layouts and seating students. Your data
never leaves your device.

> Status: Phase 1 scaffold complete. Build/test/lint all pass. Domain and UI stubs are in place; feature phases begin next.

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
