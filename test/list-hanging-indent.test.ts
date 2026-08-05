import { describe, it, expect, afterEach } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createMarkdownEditor, type MarkdownEditorInstance } from "../src/core";

/**
 * A wrapped bullet's continuation lines must line up with the item's text, not
 * with the bullet. jsdom can't lay text out, so these assert the mechanism that
 * produces that alignment: the line carries a --mle-hang matching the width of
 * the prefix widget that replaces the item's indent + marker + space.
 */

let open: MarkdownEditorInstance[] = [];

afterEach(() => {
  for (const editor of open) editor.destroy();
  open = [];
  document.body.innerHTML = "";
});

function mount(doc: string, caret?: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = createMarkdownEditor(host, { initialContent: doc, onSave: async () => {} });
  open.push(editor);

  const view = EditorView.findFromDOM(host)!;
  if (caret !== undefined) {
    view.contentDOM.focus();
    view.dispatch({ selection: EditorSelection.cursor(caret) });
  }
  return view;
}

const lines = (view: EditorView) =>
  Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".cm-line"));

describe("bullet hanging indent", () => {
  it("hangs a top-level item by one indent level", () => {
    const [line] = lines(mount("- some text"));

    expect(line!.classList.contains("cm-md-list-item")).toBe(true);
    expect(line!.style.getPropertyValue("--mle-hang")).toBe(
      "calc(1 * var(--mle-list-indent))",
    );
  });

  it("hangs a nested item further, so its own text column is the one used", () => {
    const [, nested] = lines(mount("- A\n\t- B"));

    expect(nested!.style.getPropertyValue("--mle-hang")).toBe(
      "calc(2 * var(--mle-list-indent))",
    );
  });

  // Depth comes from the parsed list structure, not from dividing the leading
  // whitespace by tabSize — that floored a two-space indent to depth 0 and
  // collapsed the level entirely, whatever the source style.
  it.each([
    ["tab", "- A\n\t- B"],
    ["two spaces", "- A\n  - B"],
    ["four spaces", "- A\n    - B"],
  ])("nests by one level on %s indentation", (_style, doc) => {
    const [, nested] = lines(mount(doc));

    expect(nested!.style.getPropertyValue("--mle-hang")).toBe(
      "calc(2 * var(--mle-list-indent))",
    );
  });

  it("keeps nesting past the first level on two-space indentation", () => {
    const [, , deep] = lines(mount("- A\n  - B\n    - C"));

    expect(deep!.style.getPropertyValue("--mle-hang")).toBe(
      "calc(3 * var(--mle-list-indent))",
    );
  });

  it("gives the widget the same width as the line's hang", () => {
    const [line] = lines(mount("- some text"));
    const bullet = line!.querySelector<HTMLElement>(".md-bullet")!;

    expect(bullet.style.width).toBe(line!.style.getPropertyValue("--mle-hang"));
  });

  it("pads the glyph past the indent levels, so nested bullets step across", () => {
    const [top, nested] = lines(mount("- A\n\t- B"));
    const glyph = (line: HTMLElement) => line.querySelector<HTMLElement>(".md-bullet")!;

    expect(glyph(top!).style.paddingLeft).toBe("calc(0 * var(--mle-list-indent))");
    expect(glyph(nested!).style.paddingLeft).toBe("calc(1 * var(--mle-list-indent))");
  });

  it("replaces the whole prefix, leaving the item's text as the only text", () => {
    const [, nested] = lines(mount("- A\n\t- nested text"));

    // The tab and the "- " are gone from the rendered text; the bullet stands in.
    expect(nested!.textContent).toBe("•nested text");
  });

  it("reveals the raw source when the caret is on the marker", () => {
    const [line] = lines(mount("- some text", 1));

    expect(line!.textContent).toBe("- some text");
    expect(line!.querySelector(".md-bullet")).toBe(null);
  });

  // The whole point of boxing the raw prefix: without it the hang is dropped
  // when the caret arrives and the wrapped text jumps left mid-edit.
  it("keeps the hang while the caret is on the marker, boxing the raw prefix", () => {
    // Caret on the nested item's marker ("- A\n" is 4 chars, then the tab).
    const [, line] = lines(mount("- A\n\t- some text", 5));
    const prefix = line!.querySelector<HTMLElement>(".md-list-prefix")!;

    expect(line!.classList.contains("cm-md-list-item")).toBe(true);
    expect(line!.style.getPropertyValue("--mle-hang")).toBe(
      "calc(2 * var(--mle-list-indent))",
    );
    // The box covers exactly the indent, the marker, and the space after it.
    expect(prefix.textContent).toBe("\t- ");
  });

  // An item's text can be hard-wrapped across source lines. Those are separate
  // .cm-line elements, so without their own indent they sit at the left margin
  // however well the soft-wrapped rows line up.
  describe("hard-wrapped continuation lines", () => {
    it("indents an indented continuation to the item's text column", () => {
      const [, cont] = lines(mount("- A\n  continues here"));

      expect(cont!.classList.contains("cm-md-list-continuation")).toBe(true);
      expect(cont!.style.getPropertyValue("--mle-hang")).toBe(
        "calc(1 * var(--mle-list-indent))",
      );
    });

    it("indents a lazy continuation, which carries no indent of its own", () => {
      const [, cont] = lines(mount("- A\ncontinues here"));

      expect(cont!.classList.contains("cm-md-list-continuation")).toBe(true);
    });

    it("hides the source indent, which the padding now provides", () => {
      const [, cont] = lines(mount("- A\n  continues here"));

      // Drawn as well as padded, the line would be indented twice.
      expect(cont!.textContent).toBe("continues here");
    });

    it("matches a nested item's depth, not its parent's", () => {
      const [, , cont] = lines(mount("- A\n  - B\n    continues here"));

      expect(cont!.style.getPropertyValue("--mle-hang")).toBe(
        "calc(2 * var(--mle-list-indent))",
      );
    });

    it("does not treat a nested item's own line as a continuation", () => {
      const [, nested] = lines(mount("- A\n  - B"));

      expect(nested!.classList.contains("cm-md-list-continuation")).toBe(false);
      expect(nested!.classList.contains("cm-md-list-item")).toBe(true);
    });
  });

  // Arrowing right from the line start must stop before the first letter with
  // the bullet already rendered. Counting the text start as part of the gutter
  // kept the raw source up at that position, so the caret only appeared to
  // reach the text once it was past the first letter.
  describe("the caret at the item's text start", () => {
    it("renders the bullet, so the caret sits before the first letter", () => {
      const [line] = lines(mount("- some text", 2));

      expect(line!.querySelector(".md-bullet")).not.toBe(null);
      expect(line!.textContent).toBe("•some text");
    });

    it("still reveals the raw source anywhere left of that", () => {
      for (const caret of [0, 1]) {
        const [line] = lines(mount("- some text", caret));
        expect(line!.textContent).toBe("- some text");
      }
    });

    it("reveals the raw source for a selection that ends at the text start", () => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const editor = createMarkdownEditor(host, {
        initialContent: "- some text",
        onSave: async () => {},
      });
      open.push(editor);
      const view = EditorView.findFromDOM(host)!;
      view.contentDOM.focus();
      // A selection covering the prefix overlaps the gutter, unlike a caret
      // resting at its far edge.
      view.dispatch({ selection: EditorSelection.range(0, 2) });

      expect(lines(view)[0]!.textContent).toBe("- some text");
    });
  });

  it("leaves ordered items alone", () => {
    const [line] = lines(mount("1. some text"));

    expect(line!.classList.contains("cm-md-list-item")).toBe(false);
    expect(line!.textContent).toBe("1. some text");
  });
});
