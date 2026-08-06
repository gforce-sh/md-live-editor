import { describe, it, expect, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { createMarkdownEditor, type MarkdownEditorInstance } from "../src/core";

/**
 * Matches are painted with mark decorations. jsdom does no layout, so these
 * assert the decorations reach the DOM and carry the right classes — the colour
 * itself is CSS, verified in the browser.
 */

let open: MarkdownEditorInstance[] = [];

afterEach(() => {
  for (const editor of open) editor.destroy();
  open = [];
  document.body.innerHTML = "";
});

function mount(doc: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = createMarkdownEditor(host, { initialContent: doc, onSave: async () => {} });
  open.push(editor);
  return { editor, view: EditorView.findFromDOM(host)! };
}

const highlights = (view: EditorView) =>
  Array.from(view.contentDOM.querySelectorAll(".cm-md-search-match"));
const current = (view: EditorView) =>
  Array.from(view.contentDOM.querySelectorAll(".cm-md-search-match-current"));

describe("search highlights", () => {
  it("marks every match", () => {
    const { editor, view } = mount("one alpha two alpha three alpha");

    editor.search.setQuery("alpha");

    expect(highlights(view)).toHaveLength(3);
  });

  it("marks exactly one of them as current", () => {
    const { editor, view } = mount("one alpha two alpha three alpha");

    editor.search.setQuery("alpha");

    expect(current(view)).toHaveLength(1);
    expect(current(view)[0]!.textContent).toBe("alpha");
  });

  it("moves the current mark as the user steps through", () => {
    const { editor, view } = mount("alpha beta alpha");

    editor.search.setQuery("alpha");
    editor.search.next();

    expect(current(view)).toHaveLength(1);
    // Still one of the three, and still only one.
    expect(highlights(view)).toHaveLength(2);
  });

  it("highlights text whose markup is hidden", () => {
    const { editor, view } = mount("Some **bold** text");

    editor.search.setQuery("bold");

    expect(highlights(view)).toHaveLength(1);
    expect(highlights(view)[0]!.textContent).toBe("bold");
  });

  it("removes every highlight when the search is cleared", () => {
    const { editor, view } = mount("alpha alpha");
    editor.search.setQuery("alpha");

    editor.search.clear();

    expect(highlights(view)).toHaveLength(0);
  });

  it("paints nothing for a query with no matches", () => {
    const { editor, view } = mount("alpha");

    editor.search.setQuery("nothing");

    expect(highlights(view)).toHaveLength(0);
  });

  // A table's whole source is replaced by a block widget. A mark decoration
  // landing inside that range must not upset CodeMirror's decoration set — the
  // match is simply not drawn until the caret arrives and the source reappears.
  it("does not break on a match inside a table", () => {
    const { editor, view } = mount("| A | needle |\n|---|---|\n| 1 | 2 |");

    editor.search.setQuery("needle");

    expect(editor.search.getState().matchCount).toBe(1);
    expect(view.contentDOM.querySelectorAll(".cm-line").length).toBeGreaterThan(0);
  });

  it("does not break on a match spanning a hard-wrapped item's hidden indent", () => {
    const { editor, view } = mount("- item\n  more");

    editor.search.setQuery("m\nm");

    expect(editor.search.getState().matchCount).toBe(1);
    expect(highlights(view).length).toBeGreaterThan(0);
  });

  it("survives a document that ends in a code block, which once killed the plugins", () => {
    const { editor, view } = mount("alpha\n\n```js\nconst a = 1;");

    editor.search.setQuery("alpha");

    expect(highlights(view)).toHaveLength(1);
  });
});
