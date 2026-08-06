# Search — Implementation Plan

Companion to `PLAN.md`. Covers the search feature only.

## 1. Locked decisions

| Decision | Choice | Why |
| --- | --- | --- |
| UI surface | **Headless.** The library ships no visible search UI. | Consumers own their chrome, as with `onSaveStatus`. The sandbox demonstrates one. |
| Scope | **Find only.** No replace. | |
| Match options | Case-insensitive by default, with toggles for case sensitivity, whole word, and regex. | |
| What is searched | **The rendered view** — markdown syntax excluded. | Searching `bold` must find `**bold**`. |
| Matches in hidden markup | **Do not exist.** | Follows from searching the rendered view. |
| Commands | Imperative, on `editor.search`. | "Go to the next match" is an action, not state; there is no honest prop shape for it. |
| State readout | `SearchState` snapshots, via `subscribe` and the `onSearchState` prop. | State changes without the host asking — a document edit changes the match count. |
| Key bindings | **None from the library.** | While searching, focus is in the host's input, outside CodeMirror, so a library keymap would not fire. Binding Down/Up in the document would break line navigation. |
| Table cells | **Searchable.** | Cell text is on screen; invisible-to-search-but-visible-on-screen is the complaint that motivated searching the rendered view. |

## 2. The core invariant

> **Rendered text is a subsequence of the document.**

Every character of the rendered string is a real document character, in document
order. Nothing is inserted — no bullet glyphs, no cell separators, no ellipses.

This is what makes mapping exact and total: any rendered offset maps to exactly
one document position, so every match can be highlighted and scrolled to. The
moment we insert text with no document backing, matches spanning it have no
well-defined document range, and the highlight becomes a guess.

The cost is cosmetic: a hidden table delimiter leaves the spaces that surrounded
it, so cells read as `1  2`. That is a fine thing to search and a bad thing to
display, and we are not displaying it.

## 3. What counts as hidden

Derived from `live-preview.ts`, because "the rendered view" means precisely what
that module hides. Node names verified against `@lezer/markdown` + GFM.

| Node | Hidden | Note |
| --- | --- | --- |
| `HeaderMark` | yes, plus the spaces after it | `# ` before a heading |
| `EmphasisMark` | yes | `**`, `*`, `_` |
| `CodeMark` | yes | both inline backticks and fence rows |
| `ListMark` (bullet `-` `*` `+`) | line start → text start | swallows the leading indent and the space after the marker, matching the prefix widget |
| `ListMark` (ordered `1.`) | no | rendered as-is today; see `PLAN.md` §10 |
| Bullet continuation lines | leading whitespace only | mirrors the `Decoration.replace` on the source indent |
| `HorizontalRule` | whole node | replaced by an `<hr>` widget |
| `TableDelimiter` | yes | pipes and the `|---|---|` row |
| `TableCell` | no | the visible content |
| `CodeText`, `CodeInfo` | no | fence body and language are on screen |
| `QuoteMark`, `LinkMark`, `URL` | no | `live-preview.ts` does not hide these, so neither do we |

**The tree must be forced to the end of the document.** `syntaxTree()` returns
only what has been parsed so far — CodeMirror parses lazily under a time budget
and in practice stops around 3 kB, whatever the document's length. Search spans
all of it, so the unparsed tail would keep its markdown syntax: `**` searchable
past the boundary but not before it. `search.ts` uses `ensureSyntaxTree` with a
500 ms budget, falling back to the partial tree if even that runs out. The parse
context keeps its work, so this is paid at most once per edit.

Two rules the implementation must obey:

1. **Derive from the syntax tree, never from the live decorations.** Decorations
   are cursor-dependent (`**bold**` reveals its asterisks when the caret enters)
   and viewport-dependent (built only for `view.visibleRanges`). Search built on
   them would drop every match below the fold, and the match set would shift as
   the user navigated into a match.
2. **Take the maximal hiding.** What is hidden when the caret is elsewhere, not
   what happens to be hidden right now.

## 4. Public API

### Added to `src/core.ts`, exported from `.` and `./core`

```ts
export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regexp?: boolean;
}

export interface SearchState {
  query: string;
  options: Required<SearchOptions>;
  matchCount: number;
  currentIndex: number; // 1-based; 0 when there is no current match
  valid: boolean;       // false only for a regex that does not compile
}

export interface SearchController {
  setQuery(query: string, options?: SearchOptions): void;
  next(): void;
  previous(): void;
  clear(): void;
  getState(): SearchState;
  subscribe(fn: (state: SearchState) => void): () => void;
}
```

`MarkdownEditorHandle` gains `search: SearchController`.
`MarkdownEditorOptions` gains `onSearchState?: (state: SearchState) => void`.

Queries are matched **literally** (`literal: true`) unless `regexp` is set, so a
typed `\n` matches a backslash and an n rather than a newline.

### Adapters

`react.ts` and `solid.tsx` both gain the `onSearchState` prop, ref-latched in
React exactly as `onSaveStatus` is, and re-export the three new types. The
controller itself stays on the handle, reached through the existing `ref`.

## 5. Internals — `src/search.ts`

```ts
interface RenderedSegment { renderedFrom: number; docFrom: number; length: number }
interface RenderedText { text: string; segments: RenderedSegment[] }

export function renderedText(state: EditorState): RenderedText;
export function toDocPos(rendered: RenderedText, offset: number): number;
export function findMatches(
  rendered: RenderedText, query: string, options: Required<SearchOptions>,
): { from: number; to: number }[];
export function createSearch(): {
  extension: Extension;
  connect(view: EditorView): SearchController;
};
```

`renderedText` walks the tree once collecting hidden ranges, merges them, and
takes the complement as segments. `findMatches` builds a synthetic
`Text.of(...)` from the rendered string and runs `SearchQuery.getCursor()` over
it — which accepts a `Text` directly and wraps it in a throwaway state, so
regex, whole-word, and case semantics all come from `@codemirror/search` rather
than being reimplemented. Matches map back through `toDocPos` by binary search.

A match spanning hidden markup (searching `bolditalic` across `**bold***italic*`)
yields a document range that *includes* the hidden characters. That is correct
for highlighting: those characters are not drawn.

State lives in a `StateField` recomputed on `docChanged` and on the query
effect, providing `Decoration.mark` highlights. `connect(view)` supplies the
view the commands need; the field's update also drives subscriber notification,
so edits re-emit state.

`live-preview.ts` exports `contentStartOf` and `continuationLines` for reuse, so
the two modules cannot disagree about where a list item's text begins.

## 6. Styling — `src/styles.css`

`--mle-search-match` and `--mle-search-match-current` in each of the three theme
blocks (light, `[data-theme='dark']`, and the `prefers-color-scheme` block),
applied by `.cm-md-search-match` and `.cm-md-search-match-current`. Dark mode
gets a muted amber rather than the same yellow.

## 7. Sandbox

A search box in the toolbar: input, `3 / 17` counter, prev/next, three option
toggles, Escape to close. `Cmd/Ctrl+F` opens it with `preventDefault()` —
worth doing because CodeMirror only renders the visible viewport, so the
browser's native find genuinely cannot see the rest of the document. Down/Up
cycle matches **from inside the input**, which is where focus is while
searching, and is why the library needs no keymap.

## 8. Tests

- `test/rendered-text.test.ts` — stripping and mapping: headings, emphasis,
  inline code, bullet prefixes and continuations, table cells, plus the cases a
  regex-based stripper gets wrong (`**` inside a fence, escaped `\*`,
  underscores in a URL). Round-trip assertions on offsets.
- `test/search-controller.test.ts` — counts, next/previous, wrap-around at both
  ends, each option, invalid regex → `valid: false`, `clear()`, and that editing
  the document re-emits state.
- `test/search-decorations.test.ts` — a mounted view carries
  `.cm-md-search-match` on every match and `-current` on exactly one.

## 9. Cost

Measured per keystroke while a query is active (strip + match, parse warm):

| Document | Size | Matches | Per keystroke |
| --- | --- | --- | --- |
| Small note | 1.5 kB | 20 | 0.7 ms |
| Long note | 24 kB | 300 | 3.0 ms |
| Book chapter | 246 kB | 3000 | 32 ms |

Two things trigger the recompute, and they are not equally controllable:

1. **Setting the query** — a Consumer can debounce its own `setQuery` calls
   freely, and should if it targets documents in the hundreds of kilobytes.
2. **Editing the document while a search is active** — this recompute lives in
   the `StateField` and is necessarily synchronous, because decorations must
   agree with the document within the same transaction. A Consumer cannot
   debounce it.

At note-sized documents neither matters. If (2) ever does, the fix is
library-side and follows the linter pattern: map the existing ranges through
`tr.changes` for immediate correctness and recompute out of band.

## 10. Known limitations

- A match inside a table or on a horizontal rule counts, and navigating to it
  moves the caret there — which reveals the raw source, so the highlight becomes
  visible on arrival. Until then it is inside a replaced widget and cannot be
  drawn.
- Ordered list markers are searchable as literal text (`1.`), because they are
  rendered as literal text.
- No replace.
