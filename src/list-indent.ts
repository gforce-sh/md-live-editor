import { EditorSelection } from "@codemirror/state";
import type { ChangeSpec, EditorState, Line } from "@codemirror/state";
import type { Command, KeyBinding } from "@codemirror/view";

/**
 * A list item's leading whitespace, its marker, and the whitespace after it.
 * Ordered markers (`1.`, `1)`) are matched too — they indent like bullets even
 * though only bullets get the circle in the Live Preview.
 */
const LIST_ITEM = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)/;

/** One indent level. A literal tab, so nesting stays compact in the source. */
const INDENT_UNIT = "\t";

export interface ListItemInfo {
  /** The raw leading whitespace of the line. */
  indent: string;
  /** Visual width of that whitespace, with tabs expanded to `tabSize` columns. */
  indentCols: number;
  /** The marker itself — "-", "*", "+", or "1." / "1)". */
  marker: string;
  /** Document position where the item's text begins (past the marker and its trailing space). */
  contentStart: number;
}

/** Expand whitespace to visual columns; a tab advances to the next tab stop. */
export function columnsOf(whitespace: string, tabSize: number): number {
  let col = 0;
  for (const ch of whitespace) {
    col = ch === "\t" ? col + tabSize - (col % tabSize) : col + 1;
  }
  return col;
}

function leadingWhitespace(text: string): string {
  return /^[ \t]*/.exec(text)![0];
}

function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

/** Parse a line as a list item, or null if it isn't one. */
export function parseListItem(line: Line, tabSize: number): ListItemInfo | null {
  const match = LIST_ITEM.exec(line.text);
  if (!match) return null;
  const [full, indent, marker] = match;
  return {
    indent: indent!,
    indentCols: columnsOf(indent!, tabSize),
    marker: marker!,
    contentStart: line.from + full.length,
  };
}

/**
 * The last line of the item starting at `line` — the item itself plus anything
 * nested under it (more deeply indented). Indenting carries this whole subtree
 * so a parent never re-parents its children onto a different item.
 *
 * Blank lines are skipped over rather than ending the subtree, so an item with
 * a blank line between it and its nested content stays intact; but a trailing
 * blank line is never counted as part of the subtree.
 */
export function subtreeEndLine(state: EditorState, line: Line, tabSize: number): number {
  const baseCols = columnsOf(leadingWhitespace(line.text), tabSize);
  let last = line.number;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const next = state.doc.line(n);
    if (isBlank(next.text)) continue;
    if (columnsOf(leadingWhitespace(next.text), tabSize) <= baseCols) break;
    last = n;
  }
  return last;
}

/**
 * True if `line` may be indented one level. An item can only nest under a
 * preceding *sibling*: the first item at a given level has no parent to nest
 * into. Indenting it anyway would push it a full tab (4 columns) past any list
 * content, which CommonMark reads as an **indented code block** — the bullet
 * stops rendering as a bullet. Refusing is what keeps that from happening;
 * `indentListItem` still swallows the keypress so focus stays put.
 */
export function canIndent(state: EditorState, line: Line, tabSize: number): boolean {
  const info = parseListItem(line, tabSize);
  if (!info) return false;

  for (let n = line.number - 1; n >= 1; n--) {
    const prev = state.doc.line(n);
    if (isBlank(prev.text)) continue;
    const cols = columnsOf(leadingWhitespace(prev.text), tabSize);
    // Shallower: we've reached our own parent without passing a sibling.
    if (cols < info.indentCols) return false;
    // Same level: a sibling — but only a list item can be nested under.
    if (cols === info.indentCols) return parseListItem(prev, tabSize) !== null;
    // Deeper: a descendant of some earlier sibling. Keep looking.
  }
  return false; // nothing above it at all
}

/**
 * The change that removes one indent level from `line`, or null if it has none.
 * Prefers a leading tab, and otherwise eats up to `tabSize` spaces so content
 * that was indented with spaces still outdents sensibly.
 */
export function outdentChange(line: Line, tabSize: number): ChangeSpec | null {
  const ws = leadingWhitespace(line.text);
  if (ws.length === 0) return null;
  if (ws[0] === "\t") return { from: line.from, to: line.from + 1 };
  let n = 0;
  while (n < ws.length && n < tabSize && ws[n] === " ") n++;
  return n > 0 ? { from: line.from, to: line.from + n } : null;
}

/** Collect the line numbers each selection range touches. */
function selectedLines(state: EditorState): number[] {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return [...lines].sort((a, b) => a - b);
}

/**
 * Build the changes to shift every selected list item (and its subtree) one
 * level. Returns an empty array when nothing is indentable, which lets the
 * command decline the key and fall through.
 */
export function indentChanges(state: EditorState, direction: "in" | "out"): ChangeSpec[] {
  const tabSize = state.tabSize;
  const changes: ChangeSpec[] = [];
  const done = new Set<number>();

  for (const n of selectedLines(state)) {
    if (done.has(n)) continue;
    const line = state.doc.line(n);
    if (direction === "in") {
      if (!canIndent(state, line, tabSize)) continue;
    } else {
      // Outdenting a top-level item is a no-op.
      if (!parseListItem(line, tabSize)) continue;
      if (leadingWhitespace(line.text).length === 0) continue;
    }

    const end = subtreeEndLine(state, line, tabSize);
    for (let m = n; m <= end; m++) {
      if (done.has(m)) continue;
      const target = state.doc.line(m);
      // Never add trailing whitespace to a blank line inside the subtree.
      if (isBlank(target.text)) continue;
      done.add(m);
      if (direction === "in") {
        changes.push({ from: target.from, insert: INDENT_UNIT });
      } else {
        const change = outdentChange(target, tabSize);
        if (change) changes.push(change);
      }
    }
  }
  return changes;
}

function applyIndent(
  view: Parameters<Command>[0],
  direction: "in" | "out",
): boolean {
  const changes = indentChanges(view.state, direction);
  if (changes.length === 0) return false;
  view.dispatch(
    view.state.update({
      changes,
      userEvent: direction === "in" ? "input.indent" : "delete.dedent",
      scrollIntoView: true,
    }),
  );
  return true;
}

/** True if any cursor sits on a list item — i.e. Tab is "ours" to swallow. */
function caretOnListItem(state: EditorState): boolean {
  return state.selection.ranges.some((range) => {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) {
      if (parseListItem(state.doc.line(n), state.tabSize)) return true;
    }
    return false;
  });
}

/**
 * Tab: indent the list item under the cursor one level, carrying its nested
 * items.
 *
 * The key is swallowed on *any* list item, including ones that can't be
 * indented (see `canIndent`). A refused indent that also returned false would
 * let the keypress reach the browser, which moves focus out of the editor —
 * the caret would vanish mid-edit. On a non-list line it still declines, so
 * Tab keeps its CM6 accessibility behaviour of tabbing out.
 */
export const indentListItem: Command = (view) =>
  applyIndent(view, "in") || caretOnListItem(view.state);

/**
 * Shift-Tab: outdent the list item under the cursor, carrying its nested items.
 * Swallowed on any list item, for the same reason as Tab.
 */
export const outdentListItem: Command = (view) =>
  applyIndent(view, "out") || caretOnListItem(view.state);

/**
 * Backspace: outdent instead of deleting, but only while the caret sits left of
 * the item's text (in the indent, on the marker, or in the space after it).
 * Anywhere else it declines so normal character deletion is untouched.
 */
export const outdentOnBackspace: Command = (view) => {
  const { state } = view;
  if (state.selection.ranges.length !== 1) return false;
  const range = state.selection.main;
  if (!range.empty) return false;

  const line = state.doc.lineAt(range.head);
  const info = parseListItem(line, state.tabSize);
  if (!info) return false;
  if (range.head > info.contentStart) return false; // caret is in the text
  if (info.indentCols === 0) return false; // nothing left to outdent

  return applyIndent(view, "out");
};

/** The marker the next item in a list gets — ordered markers count up. */
export function nextMarker(marker: string): string {
  const ordered = /^(\d+)([.)])$/.exec(marker);
  return ordered ? `${Number(ordered[1]) + 1}${ordered[2]}` : marker;
}

/**
 * Enter: continue the list, starting the next line with the same indent and a
 * fresh marker. On an *empty* item it ends the list instead — outdenting one
 * level if the item is nested, and otherwise clearing the marker — so Enter
 * always offers a way out rather than emitting bullets forever.
 */
export const continueList: Command = (view) => {
  const { state } = view;
  if (state.selection.ranges.length !== 1) return false;
  const range = state.selection.main;
  if (!range.empty) return false;

  const line = state.doc.lineAt(range.head);
  const info = parseListItem(line, state.tabSize);
  if (!info) return false;
  // Caret in the gutter (left of the text) — plain Enter, don't continue.
  if (range.head < info.contentStart) return false;

  const itemIsEmpty = line.text.slice(info.contentStart - line.from).trim().length === 0;
  if (itemIsEmpty) {
    const outdent = info.indentCols > 0 ? outdentChange(line, state.tabSize) : null;
    view.dispatch(
      state.update({
        // Nested: step out one level. Top level: drop the marker, ending the list.
        changes: outdent ?? { from: line.from, to: line.to, insert: "" },
        userEvent: "delete",
        scrollIntoView: true,
      }),
    );
    return true;
  }

  const insert = state.lineBreak + info.indent + nextMarker(info.marker) + " ";
  view.dispatch(
    state.update({
      changes: { from: range.head, insert },
      selection: EditorSelection.cursor(range.head + insert.length),
      userEvent: "input",
      scrollIntoView: true,
    }),
  );
  return true;
};

/** Key bindings for list editing. Must outrank the default keymap. */
export const listKeymap: readonly KeyBinding[] = [
  { key: "Tab", run: indentListItem },
  { key: "Shift-Tab", run: outdentListItem },
  { key: "Backspace", run: outdentOnBackspace },
  { key: "Enter", run: continueList },
];
