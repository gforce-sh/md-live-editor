# Notes — Implementation Plan (v1)

A markdown note-taking editor package with an Obsidian-style inline Live Preview editor. Goal: load fast, respond fast, stay simple. Built test-first. **v1 target: running locally.** Deployment is deferred. Editor is served from `/dist` directory. Imported in other projects in their package.json with "file:<path-to-md-live-editor>/dist".

See [CONTEXT.md](./CONTEXT.md) for the domain glossary (Live Preview).

---

## 1. Locked decisions (recap)

| Area           | Decision                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend       | **SolidJS SPA** via Vite. Client-rendered (no SSR).                                                                                                                    |
| Editor         | **CodeMirror 6**, inline **Live Preview** (rendered doc; active line reveals raw markdown).                                                                            |
| Language       | **TypeScript** end-to-end, shared types between client/server.                                                                                                         |
| Markdown scope | headings, bold, **italics**, lists, code, links, tables, checkboxes.                                                                                                   |
| Autosave       | Debounced **2s** → `PATCH`. Status: `idle → saving… → saved`, plus **`couldn't save — retrying`** (keeps unsaved Body in memory, auto-retries). No manual save button. |
| Client storage | **None.** No IndexedDB. Fetch-on-load + in-memory session state + optimistic updates.                                                                                  |
| Sandbox        | Example component for user to demo and tinker with the editor themselves.                                                                                              |
| Testing        | **Vitest** (client logic) and **@solidjs/testing-library** (components). Strict red-green-refactor. **No Playwright/e2e.**                                             |

## 2. Out of scope (v1)

- **Images** in notes (no upload, no storage). The `![]()` syntax can be re-enabled later.
- **Offline support** / client-side persistence.
- **Deployment** (Lightsail, nginx, TLS, systemd, Litestream backups) — see §11.

## 3. Project structure

```
/
├── CONTEXT.md
├── PLAN.md
├── package.json
├── sandbox/
├── test/
└── src/
```

## 4. Local dev

- `npm run dev` runs sandbox component.

## 5. Editor / Live Preview

- A **thin Solid wrapper** mounts a CM6 `EditorView`. Solid owns the shell; CM6 owns the editing surface.
- Live Preview via `@codemirror/lang-markdown` + custom decorations (a `ViewPlugin` that renders non-active blocks and reveals raw syntax on the active line). **This is the highest-risk slice** — we spike it first to de-risk.
- **We do not test CM6 itself** (trust the library). All testable logic (debounce, title derivation, save state machine) is extracted out of the editor into pure units.

## 6. Testing strategy (TDD)

- **Client logic (TDD):** autosave **status state machine** with `@solidjs/testing-library` + jsdom. Debounce as plain units.
- **Editor:** not unit-tested (CM6 is the library's responsibility; jsdom can't render it). Wiring kept thin; verified manually.
- **Accepted gap:** no automated full-flow browser coverage in v1.

## 7. Implementation plan — vertical slices (tracer bullets, TDD)

Each slice is red-green-refactor and ends in something runnable.

- **Slice 0 — Walking skeleton.** Workspaces; Vite+Solid app; one passing test. _Done = `npm run dev` serves the app and the health check._
- **Slice 1 — Editor + autosave.** CM6 wrapper + Live Preview decorations (spike first); Body signal; debounce util; autosave `PATCH` + status state machine incl. `couldn't save — retrying`.
- **Slice 6 — Polish.** Rename affordance, flush-autosave-on-switch, full local run-through.

---
