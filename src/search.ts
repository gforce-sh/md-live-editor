import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { SearchQuery } from "@codemirror/search";
import {
  EditorSelection,
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
  Text,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { contentStartOf, continuationLines } from "./live-preview";

/** How a query is matched. All default to false — plain, case-insensitive substring. */
export interface SearchOptions {
  /** Distinguish "TODO" from "todo". */
  caseSensitive?: boolean;
  /** Match only at word boundaries: "cat" will not match "category". */
  wholeWord?: boolean;
  /** Treat the query as a regular expression. */
  regexp?: boolean;
}

/**
 * Immutable snapshot of search state, handed to subscribers. Deliberately plain
 * data: subscribers hold on to these (React keeps one in state across renders),
 * and a method on a snapshot would either act on stale state or secretly reach
 * into live state, with no way to tell which by looking. Commands live on
 * SearchController instead.
 */
export interface SearchState {
  /** The active query; "" when search is cleared. */
  query: string;
  options: Required<SearchOptions>;
  /** Total matches in the rendered text. 0 when the query is empty or invalid. */
  matchCount: number;
  /** 1-based position of the current match; 0 when there is none. */
  currentIndex: number;
  /** False only when `regexp` is set and the pattern does not compile. */
  valid: boolean;
}

/** Drives search. One stable instance per editor, reached at `editor.search`. */
export interface SearchController {
  /** Set or replace the query; "" clears. Selects the first match at or after the cursor. */
  setQuery(query: string, options?: SearchOptions): void;
  /** Move to the next match, wrapping to the first after the last. */
  next(): void;
  /** Move to the previous match, wrapping to the last before the first. */
  previous(): void;
  /** Drop the query and all highlights. */
  clear(): void;
  /** Read the current snapshot. */
  getState(): SearchState;
  /** Observe changes, including those caused by document edits. Returns an unsubscribe. */
  subscribe(fn: (state: SearchState) => void): () => void;
}

const NO_OPTIONS: Required<SearchOptions> = {
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
};

interface DocRange {
  from: number;
  to: number;
}

/** One run of visible document text within the rendered string. */
interface RenderedSegment {
  renderedFrom: number;
  docFrom: number;
  length: number;
}

/**
 * The document as the user sees it, plus the map back to document positions.
 *
 * Invariant: `text` is a *subsequence* of the document — every character in it
 * is a real document character, in order, and nothing is inserted. That makes
 * the mapping exact and total, so every match has a document range to highlight
 * and scroll to. Inserting text with no document backing (a bullet glyph, a
 * cell separator) would leave matches that span it with no honest position.
 */
export interface RenderedText {
  text: string;
  /** Ordered, non-overlapping. */
  segments: RenderedSegment[];
}

/** Sort and merge, so the complement can be taken in one pass. */
function mergeRanges(ranges: DocRange[]): DocRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: DocRange[] = [sorted[0]!];
  for (const r of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (r.from <= last.to) last.to = Math.max(last.to, r.to);
    else merged.push({ ...r });
  }
  return merged;
}

/**
 * How long to spend forcing the parse to reach the end of the document.
 * Generous because it is paid at most once per edit: the parse context keeps
 * its work, so repeat calls on an unchanged document are free.
 */
const PARSE_BUDGET_MS = 500;

/**
 * A syntax tree covering the whole document.
 *
 * `syntaxTree()` returns only what has been parsed so far — CodeMirror parses
 * lazily under a time budget, and in practice stops around 3 kB. Search spans
 * the whole document, so the unparsed tail would keep its markdown syntax:
 * `**` and `# ` would be searchable there but not here, which is exactly the
 * inconsistency this feature exists to remove.
 *
 * If even the forced parse runs out of budget, fall back to the partial tree.
 * The tail then behaves as raw source until the next call picks the work up
 * where it left off.
 */
function fullTree(state: EditorState): Tree {
  return ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state);
}

/**
 * The document ranges the Live Preview hides, and so the ones search must skip.
 *
 * Read from the syntax tree, never from the live decorations: those reveal
 * themselves under the caret and are only built for the visible viewport, so
 * search built on them would lose every match below the fold and shift its
 * match set as the user navigated into one. The tree gives the *maximal*
 * hiding — what is hidden when the caret is elsewhere — which is stable.
 */
function hiddenRanges(state: EditorState): DocRange[] {
  const doc = state.doc;
  const tree = fullTree(state);
  const hidden: DocRange[] = [];

  tree.iterate({
    enter: (node) => {
      const name = node.name;
      if (node.to === node.from) return;

      // "# " — the mark plus the space that separates it from the heading text.
      if (name === "HeaderMark") {
        let to = node.to;
        const lineTo = doc.lineAt(node.from).to;
        while (to < lineTo && doc.sliceString(to, to + 1) === " ") to++;
        hidden.push({ from: node.from, to });
        return;
      }
      // Inline "**"/"*"/"`" and the ``` rows of a fenced block.
      if (name === "EmphasisMark" || name === "CodeMark") {
        hidden.push({ from: node.from, to: node.to });
        return;
      }
      // Table pipes and the |---|---| row. Cell text stays: it is on screen.
      if (name === "TableDelimiter") {
        hidden.push({ from: node.from, to: node.to });
        return;
      }
      // Replaced wholesale by an <hr> widget — no text at all.
      if (name === "HorizontalRule") {
        hidden.push({ from: node.from, to: node.to });
        return;
      }
      if (name === "ListMark") {
        // Ordered markers ("1.") are rendered as literal text, so they stay
        // searchable as literal text.
        if (!/^[-*+]$/.test(doc.sliceString(node.from, node.to))) return;
        const line = doc.lineAt(node.from);
        // The bullet widget stands in for the whole prefix: leading indent,
        // marker, and the space after it.
        hidden.push({ from: line.from, to: contentStartOf(doc, node.to) });
        for (const cont of continuationLines(tree, doc, node.node)) {
          if (cont.textStart > cont.from) {
            hidden.push({ from: cont.from, to: cont.textStart });
          }
        }
        return;
      }
    },
  });

  return mergeRanges(hidden);
}

/** Strip markdown syntax, keeping a map back to the document. Pure — no view. */
export function renderedText(state: EditorState): RenderedText {
  const doc = state.doc;
  const segments: RenderedSegment[] = [];
  let text = "";

  const take = (from: number, to: number) => {
    if (to <= from) return;
    segments.push({ renderedFrom: text.length, docFrom: from, length: to - from });
    text += doc.sliceString(from, to);
  };

  let pos = 0;
  for (const range of hiddenRanges(state)) {
    take(pos, range.from);
    pos = Math.max(pos, range.to);
  }
  take(pos, doc.length);

  return { text, segments };
}

/** Rendered offset → document position, by binary search over the segments. */
export function toDocPos(rendered: RenderedText, offset: number): number {
  const segments = rendered.segments;
  if (segments.length === 0) return 0;

  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid]!.renderedFrom <= offset) lo = mid;
    else hi = mid - 1;
  }
  const segment = segments[lo]!;
  // Clamp: an offset past the last segment maps to the end of the visible text.
  const within = Math.min(Math.max(offset - segment.renderedFrom, 0), segment.length);
  return segment.docFrom + within;
}

/**
 * Every match, as document ranges, in document order.
 *
 * Matching itself is delegated to `SearchQuery` over a synthetic `Text` built
 * from the rendered string — `getCursor` accepts a `Text` and wraps it in a
 * throwaway state, so regex, whole-word, and case semantics all come from
 * @codemirror/search rather than being reimplemented here.
 */
export function findMatches(
  rendered: RenderedText,
  query: string,
  options: Required<SearchOptions>,
): DocRange[] {
  const spec = new SearchQuery({
    search: query,
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord,
    regexp: options.regexp,
    // What the user typed is what we match: a typed "\n" is a backslash and an
    // n, not a newline. Regex mode has its own escaping and ignores this.
    literal: !options.regexp,
  });
  if (!spec.valid) return [];

  const matches: DocRange[] = [];
  const cursor = spec.getCursor(Text.of(rendered.text.split("\n")));
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    const { from, to } = step.value;
    // A zero-width regex match (/a*/) has no range to highlight or land on.
    if (to <= from) continue;
    // Map the end through the last matched character, not through `to` itself:
    // a match ending flush against hidden markup would otherwise stretch the
    // highlight across it, into the next visible run.
    matches.push({ from: toDocPos(rendered, from), to: toDocPos(rendered, to - 1) + 1 });
  }
  return matches;
}

/** True when a regex query would not compile — the only way to be invalid. */
function queryIsValid(query: string, options: Required<SearchOptions>): boolean {
  if (query === "") return true;
  return new SearchQuery({ search: query, regexp: options.regexp }).valid;
}

interface SearchFieldValue {
  query: string;
  options: Required<SearchOptions>;
  matches: DocRange[];
  /** 0-based; -1 when there is no current match. */
  current: number;
  valid: boolean;
  decorations: DecorationSet;
}

const EMPTY_FIELD: SearchFieldValue = {
  query: "",
  options: NO_OPTIONS,
  matches: [],
  current: -1,
  valid: true,
  decorations: Decoration.none,
};

function decorate(matches: DocRange[], current: number): DecorationSet {
  const ranges: Range<Decoration>[] = matches.map((m, i) =>
    Decoration.mark({
      class:
        i === current
          ? "cm-md-search-match cm-md-search-match-current"
          : "cm-md-search-match",
    }).range(m.from, m.to),
  );
  return Decoration.set(ranges, true);
}

function snapshot(value: SearchFieldValue): SearchState {
  return {
    query: value.query,
    options: value.options,
    matchCount: value.matches.length,
    currentIndex: value.current + 1,
    valid: value.valid,
  };
}

function sameState(a: SearchState, b: SearchState): boolean {
  return (
    a.query === b.query &&
    a.matchCount === b.matchCount &&
    a.currentIndex === b.currentIndex &&
    a.valid === b.valid &&
    a.options.caseSensitive === b.options.caseSensitive &&
    a.options.wholeWord === b.options.wholeWord &&
    a.options.regexp === b.options.regexp
  );
}

/**
 * Search over the rendered view, as a CodeMirror extension plus the imperative
 * controller that drives it.
 *
 * Call once per editor: the extension carries per-editor state, so it cannot be
 * shared between views. `connect` supplies the view the commands need, which
 * does not exist until after the state is built.
 */
export function createSearch(): {
  extension: Extension;
  connect(view: EditorView): SearchController;
} {
  const setQueryEffect = StateEffect.define<{
    query: string;
    options: Required<SearchOptions>;
  }>();
  const setCurrentEffect = StateEffect.define<number>();

  /** First match at or after `pos`, else the first match of all (wrapping). */
  const indexAtOrAfter = (matches: DocRange[], pos: number): number => {
    if (matches.length === 0) return -1;
    const found = matches.findIndex((m) => m.from >= pos);
    return found < 0 ? 0 : found;
  };

  const field = StateField.define<SearchFieldValue>({
    create() {
      return EMPTY_FIELD;
    },
    update(value, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setQueryEffect)) {
          const { query, options } = effect.value;
          const valid = queryIsValid(query, options);
          const matches =
            query === "" || !valid
              ? []
              : findMatches(renderedText(tr.state), query, options);
          const current = indexAtOrAfter(matches, tr.state.selection.main.head);
          return { query, options, matches, current, valid, decorations: decorate(matches, current) };
        }
        if (effect.is(setCurrentEffect)) {
          const current = effect.value;
          return { ...value, current, decorations: decorate(value.matches, current) };
        }
      }

      if (tr.docChanged && value.query !== "") {
        const matches = value.valid
          ? findMatches(renderedText(tr.state), value.query, value.options)
          : [];
        // Hold the user's place across the edit by document position rather
        // than by index: inserting text above shifts every index below it.
        const anchor = value.matches[value.current];
        const current = indexAtOrAfter(
          matches,
          anchor ? tr.changes.mapPos(anchor.from) : tr.state.selection.main.head,
        );
        return { ...value, matches, current, decorations: decorate(matches, current) };
      }
      if (tr.docChanged) {
        return { ...value, matches: [], current: -1, decorations: Decoration.none };
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
  });

  let view: EditorView | null = null;
  const subscribers = new Set<(state: SearchState) => void>();
  let last: SearchState = snapshot(EMPTY_FIELD);

  const notify = (state: SearchState) => {
    if (sameState(state, last)) return;
    last = state;
    for (const fn of subscribers) fn(state);
  };

  const listener = EditorView.updateListener.of((update) => {
    notify(snapshot(update.state.field(field)));
  });

  /** Put the caret on the current match and scroll it into view. */
  const reveal = () => {
    if (!view) return;
    const value = view.state.field(field);
    const match = value.matches[value.current];
    if (!match) return;
    view.dispatch({
      selection: EditorSelection.cursor(match.from),
      effects: EditorView.scrollIntoView(match.from, { y: "center" }),
    });
  };

  /** Step the current match by `delta`, wrapping at both ends. */
  const step = (delta: number) => {
    if (!view) return;
    const value = view.state.field(field);
    const count = value.matches.length;
    if (count === 0) return;
    const from = value.current < 0 ? (delta > 0 ? -1 : 0) : value.current;
    const next = (((from + delta) % count) + count) % count;
    view.dispatch({ effects: setCurrentEffect.of(next) });
    reveal();
  };

  const controller: SearchController = {
    setQuery(query, options) {
      if (!view) return;
      view.dispatch({
        effects: setQueryEffect.of({ query, options: { ...NO_OPTIONS, ...options } }),
      });
      reveal();
    },
    next: () => step(1),
    previous: () => step(-1),
    clear() {
      view?.dispatch({ effects: setQueryEffect.of({ query: "", options: NO_OPTIONS }) });
    },
    getState: () => (view ? snapshot(view.state.field(field)) : snapshot(EMPTY_FIELD)),
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };

  return {
    extension: [field, listener],
    connect(v) {
      view = v;
      return controller;
    },
  };
}
