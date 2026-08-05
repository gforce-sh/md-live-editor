import { describe, it, expect, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { createMarkdownEditor, type MarkdownEditorInstance } from "../src/core";

/**
 * A code block that reaches the end of the document used to crash the whole
 * Live Preview plugin: the line-walk stepped past the last line via
 * `lineAt(current.to + 1)`, which is out of range once the block's last line is
 * the document's last line. CodeMirror catches the throw, tears the plugin
 * down, and every decoration disappears — bullets, headings, tables, all of it.
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
  return EditorView.findFromDOM(host)!;
}

describe("code blocks ending at the document's last line", () => {
  it.each([
    ["unterminated fence", "```js\nconst a = 1;"],
    ["indented code block", "\tsome indented code"],
    ["tab-indented line that looks like a list", "\t- nested text"],
  ])("survives %s", (_name, doc) => {
    const view = mount(doc);

    // The plugin still holds decorations, i.e. it was not torn down.
    expect(view.contentDOM.querySelectorAll(".cm-line").length).toBeGreaterThan(0);
  });

  it("keeps decorating the rest of the document", () => {
    const view = mount("# Heading\n\n- item\n\n```js\nconst a = 1;");

    // A crash in the code-block walk would take these down with it.
    expect(view.contentDOM.querySelector(".cm-md-h1")).not.toBe(null);
    expect(view.contentDOM.querySelector(".md-bullet")).not.toBe(null);
  });
});
