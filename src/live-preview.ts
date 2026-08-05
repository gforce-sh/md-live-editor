import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode, Tree } from "@lezer/common";
import { type EditorState, type Range, StateField, type Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

/**
 * Width of one nesting level, and so of the bullet's own column. Kept as a CSS
 * custom property (see styles.css) so the hanging indent and the prefix widget
 * are always derived from the same number.
 */
const LIST_INDENT = "var(--mle-list-indent)";

/** The CSS width a list item's prefix occupies at `depth` levels of nesting. */
function hangWidth(depth: number): string {
  return `calc(${depth + 1} * ${LIST_INDENT})`;
}

/**
 * Nesting depth of a list item, counted from the enclosing List nodes.
 *
 * Deliberately not derived from the leading whitespace: markdown nests on one
 * space or on eight, and dividing columns by tabSize silently floors a
 * two-space indent (the most common style) to depth zero, collapsing the level.
 * The parser has already resolved what nests inside what — ask it.
 */
function listDepth(marker: SyntaxNode): number {
  let depth = -1;
  for (let n: SyntaxNode | null = marker; n; n = n.parent) {
    if (/List$/.test(n.name)) depth++;
  }
  return Math.max(depth, 0);
}

/**
 * Start positions of the source lines an item's text is hard-wrapped onto —
 * the lines after the marker's own that still belong to this item and carry no
 * marker of their own. Lines owned by a nested item are excluded: that item
 * decorates them itself, at its own depth.
 */
function continuationLines(
  tree: Tree,
  doc: Text,
  marker: SyntaxNode,
): { from: number; textStart: number }[] {
  const item = marker.parent;
  if (!item || item.name !== "ListItem") return [];

  const starts: { from: number; textStart: number }[] = [];
  for (let n = doc.lineAt(marker.from).number + 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.from > item.to) break;
    // Resolve at the line's first non-space character: resolving at the line
    // start would land outside the item for an indented continuation.
    const textStart = line.from + /^[ \t]*/.exec(line.text)![0].length;
    let owner: SyntaxNode | null = tree.resolveInner(textStart, 1);
    while (owner && owner.name !== "ListItem") owner = owner.parent;
    if (!owner || owner.from !== item.from) break;
    starts.push({ from: line.from, textStart });
  }
  return starts;
}

/** Position where an item's text begins, given the position just after its marker. */
function contentStartOf(doc: Text, markEnd: number): number {
  const line = doc.lineAt(markEnd);
  let pos = markEnd;
  while (pos < line.to && /[ \t]/.test(doc.sliceString(pos, pos + 1))) pos++;
  return pos;
}

function buildInlineDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;

        if (/^ATXHeading[1-6]$/.test(name)) {
          const level = name.slice(-1);
          const line = view.state.doc.lineAt(node.from);
          decos.push(
            Decoration.line({
              class: `cm-md-heading cm-md-h${level}`,
            }).range(line.from),
          );
          return;
        }
        // Bullet list markers render as a filled circle; the source stays "-".
        // Ordered markers ("1.") are left alone — they already read as a list.
        if (name === "ListMark") {
          const doc = view.state.doc;
          if (!/^[-*+]$/.test(doc.sliceString(node.from, node.to))) return;
          // The item's prefix — leading indent, marker, and the space after it —
          // is boxed at a width we control, and the line hangs by that same
          // width. The first line's text origin and the wrapped lines' left edge
          // are then derived from one number and cannot disagree, whatever font
          // or tab-size is in play (the editor font is proportional, so a ch/em
          // estimate would drift).
          const line = doc.lineAt(node.from);
          const depth = listDepth(node.node);
          const prefixEnd = contentStartOf(doc, node.to);
          decos.push(
            Decoration.line({
              class: "cm-md-list-item",
              attributes: { style: `--mle-hang: ${hangWidth(depth)}` },
            }).range(line.from),
            markerIsActive(view, node.to)
              ? // Editing the prefix: the raw "- " must stay real, editable text,
                // so box it with a mark rather than swapping in the widget. Same
                // width, so the hang stays true and the text doesn't shift.
                Decoration.mark({ class: "md-list-prefix" }).range(line.from, prefixEnd)
              : Decoration.replace({ widget: new BulletWidget(depth) }).range(
                  line.from,
                  prefixEnd,
                ),
          );
          // An item's text can also be hard-wrapped across several source
          // lines. Those continuation lines are separate .cm-line elements with
          // no prefix of their own, so they need the same indent applied as
          // plain padding — without it they sit at the left margin and the item
          // looks ragged even though its soft-wrapped rows line up.
          for (const cont of continuationLines(tree, doc, node.node)) {
            decos.push(
              Decoration.line({
                class: "cm-md-list-continuation",
                attributes: { style: `--mle-hang: ${hangWidth(depth)}` },
              }).range(cont.from),
            );
            // Such a line is usually also indented in the source to line up
            // under its item. That indent is now the padding's job — drawing it
            // as well would indent the line twice. Hidden even while the caret
            // is on the line: it is structure rather than content, and
            // revealing it would shift the text mid-edit.
            if (cont.textStart > cont.from) {
              decos.push(Decoration.replace({}).range(cont.from, cont.textStart));
            }
          }
          return;
        }
        if (name === "StrongEmphasis") {
          decos.push(Decoration.mark({ class: "cm-md-strong" }).range(node.from, node.to));
          return;
        }
        if (name === "Emphasis") {
          decos.push(Decoration.mark({ class: "cm-md-emphasis" }).range(node.from, node.to));
          return;
        }
        if (name === "InlineCode") {
          decos.push(Decoration.mark({ class: "cm-md-code" }).range(node.from, node.to));
          return;
        }

        // Fenced code blocks: add a class to every line inside CodeText.
        // CodeText is the node that wraps the actual code content (not the
        // fence markers or language info).  We keep line-level decoration
        // because the content is multi-line code that shouldn't be replaced.
        if (name === "CodeText") {
          const doc = view.state.doc;
          const line = doc.lineAt(node.from);
          let current = line;
          while (current.from < node.to) {
            decos.push(Decoration.line({ class: "cm-md-fenced-code" }).range(current.from));
            // Stop at the last line: an unterminated code block runs to the end
            // of the document, and lineAt(to + 1) would then be out of range.
            if (current.number === doc.lines) break;
            current = doc.line(current.number + 1);
          }
          return;
        }

        if (name === "HeaderMark" && node.to > node.from && !lineIsActive(view, node.from)) {
          let to = node.to;
          const doc = view.state.doc;
          const lineTo = doc.lineAt(node.from).to;
          while (to < lineTo && doc.sliceString(to, to + 1) === " ") to++;
          // Use mark (not replace) so the characters stay in the DOM at zero size,
          // keeping the line height identical whether or not the cursor is on the heading.
          decos.push(Decoration.mark({ class: "cm-md-header-mark-hidden" }).range(node.from, to));
        }
        const isInlineMarker = name === "EmphasisMark" || name === "CodeMark";
        if (isInlineMarker && node.to > node.from && node.node.parent) {
          // Check against the parent span (e.g. `StrongEmphasis [5-13]` for
          // `**bold**`) so clicking anywhere on the formatted content reveals
          // both opening and closing markers, not just the one nearest the cursor.
          const parent = node.node.parent;
          if (!spanIsActive(view, parent.from, parent.to)) {
            decos.push(Decoration.replace({}).range(node.from, node.to));
          }
        }
      },
    });
  }

  return Decoration.set(decos, true);
}

/**
 * True if the cursor is directly on the given span (the "active" span).
 * Returns false when the editor has no focus — nothing is active then.
 */
function spanIsActive(view: EditorView, from: number, to: number): boolean {
  if (!view.hasFocus) return false;
  return selectionTouches(view.state, from, to);
}

/**
 * True if the cursor is on the given span's line (the "active" line).
 * Returns false when the editor has no focus — nothing is active then.
 */
function lineIsActive(view: EditorView, pos: number): boolean {
  if (!view.hasFocus) return false;
  const line = view.state.doc.lineAt(pos);
  return selectionTouches(view.state, line.from, line.to);
}

/**
 * True if the cursor is anywhere left of a list item's text — in the leading
 * indent, on the marker itself, or in the space between marker and text. That
 * whole gutter reveals the raw "-"; putting the caret in the item's text shows
 * the circle again. `markEnd` is the position just after the marker.
 *
 * The text start itself belongs to the text, not the gutter: a caret there sits
 * before the item's first letter, which is a text position the user arrowed to.
 * Counting it as the gutter left the raw source showing at that position, so
 * the first Right that finally rendered the bullet had already stepped past the
 * first letter — the caret appeared to skip it.
 */
function markerIsActive(view: EditorView, markEnd: number): boolean {
  if (!view.hasFocus) return false;
  const doc = view.state.doc;
  const line = doc.lineAt(markEnd);
  const contentStart = contentStartOf(doc, markEnd);
  // Half-open [line.from, contentStart): a range merely ending at contentStart
  // still overlaps the gutter, but a caret sitting exactly there does not.
  return view.state.selection.ranges.some((r) => r.from < contentStart && r.to >= line.from);
}

/**
 * Renders a bullet list item's whole prefix — its indentation and marker — as a
 * filled circle in a fixed-width box. The box width matches the line's hanging
 * indent, so wrapped text lines up under the first line's text.
 */
export class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super();
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "md-bullet";
    span.textContent = "•";
    // The box spans the item's whole prefix; the leading `depth` levels are the
    // indentation, so pad past them and the glyph lands in its own column —
    // otherwise every bullet, however deeply nested, sits at the line's start.
    span.style.width = hangWidth(this.depth);
    span.style.paddingLeft = `calc(${this.depth} * ${LIST_INDENT})`;
    return span;
  }
  eq(other: BulletWidget): boolean {
    return other.depth === this.depth;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** CodeMirror extension providing the inline Live Preview decorations. */
export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildInlineDecorations(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        u.focusChanged
      ) {
        this.decorations = buildInlineDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

class HrWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement("hr");
    hr.className = "md-hr";
    return hr;
  }
  eq(): boolean {
    return true;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** Split a markdown table row into trimmed cell strings. */
function tableCells(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|")) l = l.slice(0, -1);
  return l.split("|").map((c) => c.trim());
}

/** Renders a GFM table's markdown source as an HTML <table>. */
export class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.source === this.source;
  }

  toDOM(): HTMLElement {
    const lines = this.source.split("\n").filter((l) => l.trim().length > 0);
    const table = document.createElement("table");
    table.className = "md-table";

    const [headerLine, , ...bodyLines] = lines;
    if (headerLine !== undefined) {
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      for (const cell of tableCells(headerLine)) {
        const th = document.createElement("th");
        th.textContent = cell;
        tr.appendChild(th);
      }
      thead.appendChild(tr);
      table.appendChild(thead);
    }

    const tbody = document.createElement("tbody");
    for (const line of bodyLines) {
      const tr = document.createElement("tr");
      for (const cell of tableCells(line)) {
        const td = document.createElement("td");
        td.textContent = cell;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    return table;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildBlockDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "HorizontalRule") {
        if (!selectionTouches(state, node.from, node.to)) {
          decos.push(
            Decoration.replace({
              widget: new HrWidget(),
              block: true,
            }).range(node.from, node.to),
          );
        }
        return false;
      }
      if (node.name === "Table") {
        if (!selectionTouches(state, node.from, node.to)) {
          const source = state.doc.sliceString(node.from, node.to);
          decos.push(
            Decoration.replace({
              widget: new TableWidget(source),
              block: true,
            }).range(node.from, node.to),
          );
        }
        return false;
      }
    },
  });
  return Decoration.set(decos, true);
}

/** CodeMirror extension that renders GFM tables and horizontal rules as block widgets. */
export const tablePreview = StateField.define<DecorationSet>({
  create(state) {
    return buildBlockDecorations(state);
  },
  update(deco, tr) {
    if (tr.docChanged || tr.selection) return buildBlockDecorations(tr.state);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
