# Markdown Live Editor — Implementation Plan (v1)

A framework-agnostic markdown editor **package** with an Obsidian-style inline Live Preview and debounced Autosave. Goal: load fast, feel snappy, stay simple. Built test-first. Distributed as a built `dist/` and imported by host apps (Consumers) via a `file:` dependency.

See [CONTEXT.md](./CONTEXT.md) for the glossary (Content, Live Preview, Autosave, Core, Adapter, Consumer) and [docs/adr/](./docs/adr/) for the decisions behind the shape:

- [ADR-0001](./docs/adr/0001-framework-agnostic-core-with-adapters.md) — framework-agnostic Core with per-framework Adapters.
- [ADR-0002](./docs/adr/0002-long-lived-note-agnostic-editor.md) — long-lived, note-agnostic editor + consumer-owned save-before-switch handshake.

---

## 1. Locked decisions (recap)

| Area | Decision |
|---|---|
| Architecture | Framework-free **Core** + thin per-framework **Adapters**. Three subpath exports: `md-live-editor/core`, `/solid`, `/react`. (ADR-0001) |
| Editor surface | **CodeMirror 6**, inline **Live Preview** (rendered doc; active line/block reveals raw markdown). |
| Lifecycle | A **single long-lived instance**. The Consumer swaps documents via `setContent`, **not** a remount. (ADR-0002) |
| Boundary | The editor is **note-agnostic** — it edits Content and persists via `onSave(content)`. Tying Content to a note/document id is the Consumer's job. (ADR-0002) |
| Status | **Headless.** The editor emits status via `onSaveStatus`; the Consumer renders it. No status chrome inside the editor. |
| Autosave | Debounced **2s** → `onSave`. State machine `idle → saving → saved`, plus `error` (retry). Single in-flight save at a time. |
| `flushSave` | Returns a **Promise**: clears the debounce, saves pending Content now, resolves when fully quiesced, **rejects on failure** (retry timer keeps running). |
| `onSave` freshness | The Core captures a stable `onSave`; Adapters keep it pointed at the Consumer's **latest** callback. (ADR-0001) |
| Markdown scope | headings, bold, italics, lists, code, links, tables, checkboxes (GFM). |
| Language / deps | **TypeScript**. Core has **no framework dependency**; `solid-js` / `react` are **optional peer deps** declared by their Adapters. |
| Testing | **Vitest** + jsdom. Pure units (Autosave state machine, Live Preview widgets) are tested; CM6 itself is not. **No Playwright/e2e.** |
| Theming | **Deferred.** Appearance is owned by the editor for now; revisit via CSS custom properties when a second Consumer's palette clashes. |

## 2. Out of scope (v1)

- **Images** in notes (no upload/storage). `![]()` can be re-enabled later.
- **Offline / client-side persistence** — the editor never stores Content.
- **Adapters beyond Solid + React** — Vue/vanilla Consumers use the Core directly until a real consumer needs an adapter.
- **A full theming system** — see §1.

## 3. Public API (the contract)

**Props** (declarative, set at mount):

| Prop | Type | Default |
|---|---|---|
| `initialContent` | `string` | — |
| `onSave` | `(content: string) => Promise<void>` | — |
| `debounceMs` | `number` | `2000` |
| `retryMs` | `number` | `5000` |
| `onSaveStatus` | `(status: SaveStatus) => void` | — |

`SaveStatus = "idle" | "saving" | "saved" | "error"`. `initialContent` is read once at mount; all later updates go through `setContent`.

**Imperative handle** (via a `ref` prop):

| Method | Purpose |
|---|---|
| `getContent(): string` | Read the current Content without waiting for `onSave`. |
| `setContent(content): void` | Replace the Content **programmatically** — does **not** fire Autosave, and **resets undo history** (Cmd-Z must not bridge across documents). |
| `flushSave(): Promise<void>` | Force a save now (skip the debounce); resolve when quiesced, reject on failure. |

**Switching documents (Consumer-owned handshake, ADR-0002):**

```
try { await editor.flushSave(); }       // persist current doc
catch { /* stay put, surface error */ return; }   // abort the switch
advanceTarget(next);                      // re-point onSave at the new doc
editor.setContent(next.content);          // load it
```

## 4. Package structure & exports

```
src/
├── core/           createMarkdownEditor(host, opts) → handle   (framework-free)
├── solid/          <MarkdownEditor> Adapter over the Core
├── react/          <MarkdownEditor> Adapter over the Core
├── live-preview.ts CM6 decorations + TableWidget (framework-free)
├── autosave.ts     debounced save state machine (framework-free)
└── styles.css
```

`package.json` `exports`: `./core`, `./solid`, `./react`, `./styles.css`. Adapters declare their framework as an optional peer dependency; the Core declares none.

## 5. Distribution & dev workflow

- **Build:** `vite build` (lib, ES) emits `dist/`; `vite-plugin-dts` is scoped to `src` for `.d.ts`. `npm run build:watch` for iterative work.
- **Consume:** a host app depends on `"md-live-editor": "file:../../md-live-editor"` and imports a subpath (e.g. `md-live-editor/solid`). Consumers see changes only after a rebuild.
- **Sandbox:** `npm run dev` runs `sandbox/`, importing `src` directly (no build needed) — the demo/QA surface for the editor, including the headless status indicator.

## 6. Editor / Live Preview

- A thin Adapter mounts a CM6 `EditorView`; the Adapter owns the framework shell, CM6 owns the editing surface.
- Live Preview = `@codemirror/lang-markdown` + custom decorations (a `ViewPlugin` that renders non-active blocks and reveals raw syntax on the active line) + a `StateField` table widget.
- **We do not test CM6 itself.** All testable logic (debounce, Autosave state machine, widget rendering) lives in pure units outside the editor.

## 7. Autosave contract (detail)

- One save in flight at a time. While a save runs, new edits update `pending`; on completion, if `pending` differs from what was last saved, the latest `pending` is saved next.
- On failure: status `error`, retry after `retryMs`, and the latest unsaved Content is kept in memory.
- `flushSave()` clears the debounce, drives the queue to quiescence, and rejects if a save in the chain fails (retry continues in the background).
- Status is pushed to the Consumer via `onSaveStatus`; the editor renders none of it.

## 8. Testing strategy (TDD)

- **Autosave (strict TDD):** debounce, in-flight guard, retry, `flushSave` resolve/reject — as pure units against fake timers and a stub `onSave`.
- **Live Preview widgets:** `TableWidget` DOM output (already covered); extend to other decorations as they harden.
- **Adapters:** lightly — that they mount/unmount the Core and keep `onSave` fresh. CM6 rendering is not unit-tested (jsdom can't lay it out).
- **Accepted gap:** no automated full-flow browser coverage; the sandbox is the manual QA surface.

## 9. Implementation slices (tracer bullets, TDD)

**Done**
- **Slice 0 — Editor skeleton.** Solid CM6 component with Live Preview + GFM tables, debounce/retry Autosave (capture-once), sandbox, `TableWidget` tests.
- **Slice A — Headless status.** Removed the internal status chrome; editor emits `onSaveStatus`; the sandbox renders it.
- **Slice B — Terminology.** `doc → initialContent`, `onSave(body) → onSave(content)`, `onStatusChange → onSaveStatus`; CONTEXT.md + ADRs.

**Pending**
- **Slice C — Autosave hardening.** Add the in-flight guard; make `flushSave()` return a Promise (resolve on quiesce, reject on failure); keep the retry. Pure unit tests first.
- **Slice D — Imperative handle.** `getContent` / `setContent` / `flushSave` via a `ref` prop; `setContent` programmatic (no Autosave, reset undo history).
- **Slice E — Extract the Core.** Move CM6 + Autosave wiring into `createMarkdownEditor(host, opts) → handle`; framework-free; `./core` export.
- **Slice F — Solid Adapter.** Thin `<MarkdownEditor>` over the Core; keep `onSave` fresh; `./solid` export; optional peer dep.
- **Slice G — React Adapter.** Thin `<MarkdownEditor>` over the Core; `useRef`-fresh `onSave`; StrictMode-safe mount; `./react` export; optional peer dep.
- **Slice H — Re-wire quick-note** to `md-live-editor/solid` with `initialContent`, long-lived switching, and the save-before-switch handshake. (Separate repo; needs a package rebuild.)

## 10. Deferred

- Theming via CSS custom properties (accent, font, code background).
- A Vue (or vanilla-only) Adapter, if a Consumer needs one.
- Images / attachments.
