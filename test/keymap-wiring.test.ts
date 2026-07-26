import { describe, it, expect, afterEach } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createMarkdownEditor, type MarkdownEditorInstance } from "../src/core";

/**
 * These tests exercise the *wiring* — that our list keymap actually outranks
 * the default and markdown keymaps for Tab / Enter / Backspace. CM6 rendering
 * is still not tested (jsdom can't lay it out), but key dispatch needs no
 * layout, and a precedence bug here is invisible to the pure unit tests.
 */

let open: MarkdownEditorInstance[] = [];

afterEach(() => {
  for (const editor of open) editor.destroy();
  open = [];
  document.body.innerHTML = "";
});

/** Mount the real editor, place the caret at `caret`, and return a key presser. */
function mount(doc: string, caret: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = createMarkdownEditor(host, { initialContent: doc, onSave: async () => {} });
  open.push(editor);

  const view = EditorView.findFromDOM(host)!;
  view.dispatch({ selection: EditorSelection.cursor(caret) });

  return {
    /** Returns whether the editor handled the key (i.e. called preventDefault). */
    press(key: string, shift = false): boolean {
      const event = new KeyboardEvent("keydown", {
        key,
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      });
      view.contentDOM.dispatchEvent(event);
      return event.defaultPrevented;
    },
    content: () => editor.getContent(),
  };
}

describe("Tab", () => {
  it("indents the list item under the caret", () => {
    const ed = mount("- A\n- B", 6); // caret in "B"
    expect(ed.press("Tab")).toBe(true);
    expect(ed.content()).toBe("- A\n\t- B");
  });

  // The first item of a list can't be nested in valid markdown (it would become
  // an indented code block), so the indent is refused — but the key must still
  // be swallowed, or the browser moves focus and the caret vanishes mid-edit.
  it("swallows Tab on the first item of a list without indenting it", () => {
    const ed = mount("- A\n- B", 2);
    expect(ed.press("Tab")).toBe(true);
    expect(ed.content()).toBe("- A\n- B");
  });

  it("swallows Shift-Tab on a top-level item without changing it", () => {
    const ed = mount("- A\n- B", 6);
    expect(ed.press("Tab", true)).toBe(true);
    expect(ed.content()).toBe("- A\n- B");
  });

  it("is left to the browser on a plain paragraph, so focus can escape", () => {
    const ed = mount("just text", 4);
    expect(ed.press("Tab")).toBe(false);
    expect(ed.content()).toBe("just text");
  });

  it("outdents with Shift-Tab", () => {
    const ed = mount("- A\n\t- B", 7);
    expect(ed.press("Tab", true)).toBe(true);
    expect(ed.content()).toBe("- A\n- B");
  });
});

describe("Enter", () => {
  it("continues the list with a fresh marker", () => {
    const ed = mount("- A", 3);
    expect(ed.press("Enter")).toBe(true);
    expect(ed.content()).toBe("- A\n- ");
  });

  it("keeps the indent of a nested item", () => {
    const ed = mount("- A\n\t- B", 8);
    expect(ed.press("Enter")).toBe(true);
    expect(ed.content()).toBe("- A\n\t- B\n\t- ");
  });

  it("ends the list on an empty item", () => {
    const ed = mount("- A\n- ", 6);
    expect(ed.press("Enter")).toBe(true);
    expect(ed.content()).toBe("- A\n");
  });
});

describe("Backspace", () => {
  it("outdents from the start of the item's text", () => {
    const ed = mount("- A\n\t- B", 7);
    expect(ed.press("Backspace")).toBe(true);
    expect(ed.content()).toBe("- A\n- B");
  });

  it("leaves normal deletion alone mid-text", () => {
    const ed = mount("- A\n\t- BC", 9); // caret after "C"
    ed.press("Backspace");
    expect(ed.content()).toBe("- A\n\t- B");
  });
});
