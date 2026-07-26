import { describe, it, expect } from "vitest";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";
import {
  canIndent,
  columnsOf,
  continueList,
  indentChanges,
  nextMarker,
  outdentOnBackspace,
  parseListItem,
  subtreeEndLine,
} from "../src/list-indent";

/** Build a state whose caret sits at the first `|` in the doc (which is removed). */
function stateAt(doc: string): EditorState {
  const at = doc.indexOf("|");
  const text = at === -1 ? doc : doc.slice(0, at) + doc.slice(at + 1);
  return EditorState.create({
    doc: text,
    selection: at === -1 ? undefined : EditorSelection.cursor(at),
  });
}

/** Apply an indent/outdent to the caret's line and return the resulting doc. */
function shift(doc: string, direction: "in" | "out"): string {
  const state = stateAt(doc);
  const changes = indentChanges(state, direction);
  return state.update({ changes }).state.doc.toString();
}

describe("columnsOf", () => {
  it("expands a tab to the next tab stop", () => {
    expect(columnsOf("\t", 4)).toBe(4);
    expect(columnsOf("  \t", 4)).toBe(4);
    expect(columnsOf("\t\t", 4)).toBe(8);
    expect(columnsOf("   ", 4)).toBe(3);
  });
});

describe("parseListItem", () => {
  it("recognises every bullet marker", () => {
    for (const marker of ["-", "*", "+"]) {
      const state = EditorState.create({ doc: `${marker} item` });
      expect(parseListItem(state.doc.line(1), 4)?.marker).toBe(marker);
    }
  });

  it("recognises ordered markers", () => {
    const state = EditorState.create({ doc: "1. item" });
    expect(parseListItem(state.doc.line(1), 4)?.marker).toBe("1.");
  });

  it("reports where the item's text begins", () => {
    const state = EditorState.create({ doc: "  -   item" });
    expect(parseListItem(state.doc.line(1), 4)?.contentStart).toBe(6);
  });

  it("returns null for a plain paragraph", () => {
    const state = EditorState.create({ doc: "just text" });
    expect(parseListItem(state.doc.line(1), 4)).toBeNull();
  });

  it("returns null for a marker with no trailing space", () => {
    const state = EditorState.create({ doc: "-item" });
    expect(parseListItem(state.doc.line(1), 4)).toBeNull();
  });
});

describe("canIndent", () => {
  it("refuses the first item of a list — it has no sibling to nest under", () => {
    const state = EditorState.create({ doc: "- A\n- B" });
    expect(canIndent(state, state.doc.line(1), 4)).toBe(false);
  });

  it("allows an item that follows a sibling at the same level", () => {
    const state = EditorState.create({ doc: "- A\n- B" });
    expect(canIndent(state, state.doc.line(2), 4)).toBe(true);
  });

  it("refuses the first child of a parent", () => {
    const state = EditorState.create({ doc: "- A\n\t- A1\n\t- A2" });
    expect(canIndent(state, state.doc.line(2), 4)).toBe(false);
    expect(canIndent(state, state.doc.line(3), 4)).toBe(true);
  });

  it("looks past a preceding sibling's own children", () => {
    const state = EditorState.create({ doc: "- A\n\t- A1\n- B" });
    expect(canIndent(state, state.doc.line(3), 4)).toBe(true);
  });

  it("refuses to nest under a paragraph", () => {
    const state = EditorState.create({ doc: "some text\n- B" });
    expect(canIndent(state, state.doc.line(2), 4)).toBe(false);
  });
});

describe("nextMarker", () => {
  it("reuses a bullet marker as-is", () => {
    expect(nextMarker("-")).toBe("-");
    expect(nextMarker("*")).toBe("*");
  });

  it("counts an ordered marker up, keeping its delimiter", () => {
    expect(nextMarker("1.")).toBe("2.");
    expect(nextMarker("9)")).toBe("10)");
  });
});

describe("subtreeEndLine", () => {
  it("covers nested children", () => {
    const state = EditorState.create({ doc: "- A\n\t- A1\n\t\t- A1a\n- B" });
    expect(subtreeEndLine(state, state.doc.line(1), 4)).toBe(3);
  });

  it("spans a blank line between an item and its nested content", () => {
    const state = EditorState.create({ doc: "- A\n\n\t- A1\n- B" });
    expect(subtreeEndLine(state, state.doc.line(1), 4)).toBe(3);
  });

  it("excludes a trailing blank line", () => {
    const state = EditorState.create({ doc: "- A\n\t- A1\n\n" });
    expect(subtreeEndLine(state, state.doc.line(1), 4)).toBe(2);
  });

  it("is just the line itself when nothing is nested", () => {
    const state = EditorState.create({ doc: "- A\n- B" });
    expect(subtreeEndLine(state, state.doc.line(1), 4)).toBe(1);
  });
});

describe("indenting", () => {
  it("inserts a tab on the caret's item", () => {
    expect(shift("- A\n- |B", "in")).toBe("- A\n\t- B");
  });

  it("carries nested children with the parent", () => {
    expect(shift("- A\n- |B\n\t- B1\n\t\t- B1a", "in")).toBe(
      "- A\n\t- B\n\t\t- B1\n\t\t\t- B1a",
    );
  });

  it("leaves a following sibling alone", () => {
    expect(shift("- A\n- |B\n- C", "in")).toBe("- A\n\t- B\n- C");
  });

  it("refuses the first item of a list — it would become a code block", () => {
    expect(indentChanges(stateAt("- |A\n- B"), "in")).toEqual([]);
  });

  it("indents an ordered item", () => {
    expect(shift("1. A\n2. |B", "in")).toBe("1. A\n\t2. B");
  });

  it("does nothing on a plain paragraph, so Tab can fall through", () => {
    expect(indentChanges(stateAt("just |text"), "in")).toEqual([]);
  });

  it("never adds trailing whitespace to a blank line inside the subtree", () => {
    expect(shift("- A\n- |B\n\n\t- B1", "in")).toBe("- A\n\t- B\n\n\t\t- B1");
  });
});

describe("outdenting", () => {
  it("removes one tab from the caret's item", () => {
    expect(shift("- A\n\t- |B", "out")).toBe("- A\n- B");
  });

  it("carries nested children back with the parent", () => {
    expect(shift("- A\n\t- |B\n\t\t- B1", "out")).toBe("- A\n- B\n\t- B1");
  });

  it("eats space indentation too, up to one tab stop", () => {
    expect(shift("- A\n    - |B", "out")).toBe("- A\n- B");
    expect(shift("- A\n  - |B", "out")).toBe("- A\n- B");
  });

  it("does nothing to a top-level item", () => {
    expect(indentChanges(stateAt("- |A"), "out")).toEqual([]);
  });
});

/**
 * Run a Command against a doc. The commands only ever touch `state` and
 * `dispatch`, so a stub stands in for the EditorView — no layout, no jsdom.
 */
function run(doc: string, command: Command): { handled: boolean; doc: string } {
  let state = stateAt(doc);
  const view = {
    get state() {
      return state;
    },
    dispatch: (tr: Transaction) => {
      state = tr.state;
    },
  } as unknown as EditorView;
  const handled = command(view);
  return { handled, doc: state.doc.toString() };
}

describe("Enter continues the list", () => {
  it("starts the next line with the same marker and indent", () => {
    expect(run("- A|", continueList).doc).toBe("- A\n- ");
    expect(run("\t- A|", continueList).doc).toBe("\t- A\n\t- ");
  });

  it("counts ordered markers up", () => {
    expect(run("1. A|", continueList).doc).toBe("1. A\n2. ");
  });

  it("splits the line when the caret is mid-text", () => {
    expect(run("- AB|C", continueList).doc).toBe("- AB\n- C");
  });

  it("outdents an empty nested item instead of adding another bullet", () => {
    expect(run("- A\n\t- |", continueList).doc).toBe("- A\n- ");
  });

  it("ends the list on an empty top-level item", () => {
    expect(run("- A\n- |", continueList).doc).toBe("- A\n");
  });

  it("declines on a plain paragraph, leaving Enter alone", () => {
    expect(run("just text|", continueList).handled).toBe(false);
  });

  it("pushes the item down when the caret is at the start of its text", () => {
    expect(run("- |A", continueList).doc).toBe("- \n- A");
  });

  it("declines when the caret is left of the text, leaving Enter alone", () => {
    expect(run("\t|- A", continueList).handled).toBe(false);
    expect(run("|- A", continueList).handled).toBe(false);
  });
});

describe("Backspace outdents", () => {
  it("outdents when the caret is at the start of the text", () => {
    expect(run("- A\n\t- |B", outdentOnBackspace).doc).toBe("- A\n- B");
  });

  it("outdents when the caret is in the indent", () => {
    expect(run("- A\n|\t- B", outdentOnBackspace).doc).toBe("- A\n- B");
  });

  it("declines mid-text so normal deletion runs", () => {
    expect(run("- A\n\t- B|C", outdentOnBackspace).handled).toBe(false);
  });

  it("declines on a top-level item", () => {
    expect(run("- |A", outdentOnBackspace).handled).toBe(false);
  });
});

describe("round trip", () => {
  it("returns a subtree to its previous spacing", () => {
    const doc = "- A\n- B\n\t- B1";
    const indented = shift("- A\n- |B\n\t- B1", "in");
    const state = EditorState.create({
      doc: indented,
      selection: EditorSelection.cursor(indented.indexOf("- B") + 1),
    });
    const back = state.update({ changes: indentChanges(state, "out") }).state.doc.toString();
    expect(back).toBe(doc);
  });
});
