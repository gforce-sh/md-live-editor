import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateField } from "@codemirror/state";
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
          if (!markerIsActive(view, node.to)) {
            decos.push(
              Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to),
            );
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
            current = doc.lineAt(current.to + 1);
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
 */
function markerIsActive(view: EditorView, markEnd: number): boolean {
  if (!view.hasFocus) return false;
  const doc = view.state.doc;
  const line = doc.lineAt(markEnd);
  let contentStart = markEnd;
  while (contentStart < line.to && /[ \t]/.test(doc.sliceString(contentStart, contentStart + 1))) {
    contentStart++;
  }
  return selectionTouches(view.state, line.from, contentStart);
}

/** Renders a bullet list marker as a filled circle. */
export class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "md-bullet";
    span.textContent = "•";
    return span;
  }
  eq(): boolean {
    return true;
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
