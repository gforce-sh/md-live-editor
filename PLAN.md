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
| Lists | Bullet markers (`-`, `*`, `+`) render as a filled circle `•`; the source stays `-`. The raw marker is revealed while the caret is anywhere left of the item's text. Ordered markers render as-is. |
| List indentation | `Tab` / `Shift-Tab` indent / outdent the item under the caret **and its nested subtree**, one **tab character** per level. Both swallow the key on any list item, even when the indent is refused, so focus never escapes the editor. `Backspace` outdents when the caret is left of the item's text, and deletes normally everywhere else. |
| List continuation | `Enter` starts the next line with the same indent and a fresh marker (ordered markers count up). On an **empty** item it ends the list instead — outdenting if nested, clearing the marker if top-level. |
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
| `theme` | `"light" \| "dark" \| "system"` | `"light"` |
| `bg` | `{ light?: string; dark?: string }` | — |

`SaveStatus = "idle" | "saving" | "saved" | "error"`. `initialContent` is read once at mount; all later updates go through `setContent`.

`theme` is written to `data-theme` on the editor's `<article>`; `"system"` follows `prefers-color-scheme`. `bg` overrides just the background per scheme via the `--mle-light-bg` / `--mle-dark-bg` custom properties — the narrow escape hatch that exists while full theming stays deferred (§1).

**Imperative handle** (via a `ref` prop):

| Method | Purpose |
|---|---|
| `getContent(): string` | Read the current Content without waiting for `onSave`. |
| `setContent(content): void` | Replace the Content **programmatically** — does **not** fire Autosave, and **resets undo history** (Cmd-Z must not bridge across documents). |
| `flushSave(): Promise<void>` | Force a save now (skip the debounce); resolve when quiesced, reject on failure. |
| `focus(): void` | Move focus into the editor so the caret is visible and typing works immediately. |

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
├── core.ts         createMarkdownEditor(host, opts) → handle   (framework-free)
├── solid.tsx       <MarkdownEditor> Adapter over the Core
├── react.ts        <MarkdownEditor> Adapter over the Core
├── live-preview.ts CM6 decorations + Table/Hr/Bullet widgets (framework-free)
├── list-indent.ts  list indent/outdent commands + keymap (framework-free)
├── autosave.ts     debounced save state machine (framework-free)
├── fonts/          bundled Ysabeau Infant subset (OFL)
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
- **What counts as "active" differs by decoration.** Headings reveal their `#` marks when the caret is anywhere on the *line*; emphasis/code marks reveal when the caret touches the *span*; bullet markers reveal when the caret is anywhere in the *gutter* — the leading indent, the marker, or the space before the item's text. Nothing is active while the editor is unfocused, so a blurred editor renders fully.
- **Bullets** replace the marker with a `BulletWidget` (`•`) rather than hiding it, so the line keeps a visible marker at all times.
- **We do not test CM6 itself.** All testable logic (debounce, Autosave state machine, widget rendering) lives in pure units outside the editor.

## 6.5. List indentation (detail)

Lives in `src/list-indent.ts` — pure functions over `EditorState` plus four `Command`s, wired into the Core at `Prec.high` so they outrank both `defaultKeymap` (`Backspace`, `Enter`) and the keymap `@codemirror/lang-markdown` installs at `Prec.extend`.

- **Indent unit is a literal tab** (`\t`). CM6 renders it at `state.tabSize` (4) columns.
- **Subtree carries.** `Tab` moves the item *and* everything nested under it, so a parent never re-parents its children onto a different item. Blank lines inside a subtree are spanned but never get whitespace added to them.
- **Indent is clamped to representable nesting, but the key is still swallowed.** An item only indents if a preceding *sibling* exists at its level; the first item of a list has no parent to nest into, and indenting it by a full tab (4 columns) puts it past all list content, which CommonMark reads as an **indented code block** — the bullet stops rendering as a bullet. So `canIndent` refuses it.
  - **The refusal must not decline the key.** `Tab` returning `false` on a list line lets the keypress reach the browser, which moves focus out of the editor and the caret vanishes mid-edit. `indentListItem` therefore returns `true` on *any* list item, indenting where it can and doing nothing where it can't. These are two separate concerns — the clamp protects the markdown, swallowing the key protects the focus — and an earlier revision fixed the blur by dropping the clamp, which traded one visible bug for another.
  - Every indent unit ≥4 columns has this property, so it is inherent to the tab-character choice rather than something the implementation can avoid.
- **Outdent tolerates spaces.** It removes a leading tab if present, otherwise up to `tabSize` leading spaces, so content indented by other editors still outdents sensibly.
- **`Backspace` only outdents in the gutter** (caret at or left of the item's text, on an indented item). Everywhere else it declines and normal deletion runs.
- **`Enter` continues the list**, reusing the indent and marker (ordered markers count up). On an empty item it ends the list rather than emitting bullets forever: outdent one level if nested, otherwise clear the marker. With the caret strictly left of the item's text it declines, leaving `Enter` plain.
- **Every command declines keys it doesn't handle.** In particular `Tab` on a non-list line returns `false`, so the keypress falls through to the browser and moves focus out of the editor — preserving the CM6 keyboard-accessibility escape hatch. (`Escape` then `Tab` also still works.)

## 7. Autosave contract (detail)

- One save in flight at a time. While a save runs, new edits update `pending`; on completion, if `pending` differs from what was last saved, the latest `pending` is saved next.
- On failure: status `error`, retry after `retryMs`, and the latest unsaved Content is kept in memory.
- `flushSave()` clears the debounce, drives the queue to quiescence, and rejects if a save in the chain fails (retry continues in the background).
- Status is pushed to the Consumer via `onSaveStatus`; the editor renders none of it.

## 8. Testing strategy (TDD)

- **Autosave (strict TDD):** debounce, in-flight guard, retry, `flushSave` resolve/reject — as pure units against fake timers and a stub `onSave`.
- **Live Preview widgets:** `TableWidget` and `BulletWidget` DOM output; extend to other decorations as they harden.
- **List editing:** the indent/outdent/continue logic is pure over `EditorState`, so it is tested directly (nesting clamp, subtree carry, blank lines, space-indent tolerance, marker continuation, round trip) with no `EditorView` and no layout.
- **Keymap wiring (`test/keymap-wiring.test.ts`):** the one place we *do* mount a real `EditorView`, because key dispatch needs no layout and precedence bugs are invisible to the pure units — a command can be perfectly correct while the key never reaches it. Asserts that Tab/Shift-Tab/Enter/Backspace reach our bindings, and that Tab on a paragraph is left unhandled so focus can still escape.
- **Adapters:** lightly — that they mount/unmount the Core and keep `onSave` fresh. CM6 rendering is not unit-tested (jsdom can't lay it out).
- **Accepted gap:** no automated full-flow browser coverage; the sandbox is the manual QA surface.

## 9. Implementation slices (tracer bullets, TDD)

All slices below are **done**.

- **Slice 0 — Editor skeleton.** Solid CM6 component with Live Preview + GFM tables, debounce/retry Autosave, sandbox, `TableWidget` tests.
- **Slice A — Headless status.** Removed the internal status chrome; editor emits `onSaveStatus`; the sandbox renders it.
- **Slice B — Terminology.** `doc → initialContent`, `onSave(body) → onSave(content)`, `onStatusChange → onSaveStatus`; CONTEXT.md + ADRs.
- **Slice C — Autosave hardening.** In-flight guard (one save at a time); `flushSave()` returns a Promise that resolves on quiescence and rejects on failure (retry continues in the background); `reset()` rebaseline. Unit-tested.
- **Slice D — Imperative handle.** `getContent` / `setContent` / `flushSave` via a `ref` prop; `setContent` is programmatic — no Autosave, and resets the undo history via a history compartment.
- **Slice E — Extract the Core.** `createMarkdownEditor(host, opts) → handle` in `src/core.ts`, framework-free; adapters delegate to it.
- **Slice F — Solid adapter + subpath exports.** `src/solid.tsx` over the Core; `./core` + `./solid` exports; multi-entry build; `solid-js` optional peer.
- **Slice G — React adapter.** `src/react.ts` over the Core (`createElement`, no JSX); latest-ref `onSave`; StrictMode-safe; `./react` export; `react` optional peer.
- **Slice H — quick-note consumes `md-live-editor/solid`** with `initialContent`. It keeps remount-per-note (`<Show keyed>`), which the long-lived editor supports; adopting the in-place `setContent` switch handshake is deferred (§10).

- **Slice I — Bullets + list editing.** Bullet markers render as `•` (`BulletWidget`), revealed as raw `-` while the caret is in the gutter; `Tab` / `Shift-Tab` / `Backspace` indent and outdent list items with their subtrees using tab characters, and `Enter` continues the list. New `src/list-indent.ts`, unit-tested, plus a keymap-wiring test against a real `EditorView`. See §6.5.

> **Not runtime-verified:** the React adapter under StrictMode — build + types are green, but manual QA in a real React app remains.
>
> **Runtime-verified in the sandbox (slice I):** bullet rendering and gutter reveal, `Tab` nesting a non-first item, `Tab` on a first item leaving the doc untouched *and* keeping focus (`.cm-editor.cm-focused`), `Enter` continuing a nested list, `Backspace` outdenting from the gutter.

## 9.5. Bug fix — `posAtCoords` Y-offset after block widgets

- **Root cause:** `.md-table` had `margin: 8px 0;` (16px total), and `.md-hr` had `margin: 0.5em 0;` — margins injected into `.cm-content` between `.cm-line` elements that CodeMirror's `HeightOracle` does not account for when building the `HeightMap`. Lines after a table widget saw `posAtCoords` transition ~16px early.
- **Fix:** Changed both `.md-table` and `.md-hr` to `margin: 0` in `src/styles.css`. The table border and cell padding provide all necessary visual breathing room; margins are redundant and break CM6's cumulative height tracking.
- **Verified:** `posAtCoords` tested at top/mid/bottom of all 25 DOM lines — every line maps to its correct document line, including all lines after the table widget.

## 10. Deferred

- Theming via CSS custom properties beyond the `theme` / `bg` props (accent, font, code background).
- Rendering ordered list markers (`1.`) as anything other than their source; they indent like bullets but are not re-rendered.
- Per-depth bullet glyphs (`•` / `◦` / `▪`); every nesting level uses the same filled circle today.
- Renumbering an ordered list after an insert — `Enter` increments from the current marker only, it does not re-sequence the items below.
- A Vue (or vanilla-only) Adapter, if a Consumer needs one.
- quick-note adopting the long-lived `setContent` switch handshake (it currently remounts per note).
- Images / attachments.
