import { describe, it, expect, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { createMarkdownEditor, type MarkdownEditorInstance, type SearchState } from "../src/core";

/**
 * The controller over a real mounted editor. jsdom cannot lay text out, but it
 * runs CodeMirror's state and dispatch faithfully, which is all search needs.
 */

let open: MarkdownEditorInstance[] = [];

afterEach(() => {
  for (const editor of open) editor.destroy();
  open = [];
  document.body.innerHTML = "";
});

function mount(doc: string, onSearchState?: (s: SearchState) => void) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = createMarkdownEditor(host, {
    initialContent: doc,
    onSave: async () => {},
    onSearchState,
  });
  open.push(editor);
  return editor;
}

/** Last emitted snapshot; the project targets below ES2022, so no Array.at. */
const last = (states: SearchState[]) => states[states.length - 1];

const THREE = "one alpha two alpha three alpha";

describe("search state", () => {
  it("reports no query before anything is searched", () => {
    expect(mount(THREE).search.getState()).toMatchObject({
      query: "",
      matchCount: 0,
      currentIndex: 0,
      valid: true,
    });
  });

  it("counts matches over the rendered text, not the source", () => {
    const editor = mount("Some **bold** text");
    editor.search.setQuery("bold");

    expect(editor.search.getState()).toMatchObject({ query: "bold", matchCount: 1 });
  });

  it("finds nothing for syntax the reader cannot see", () => {
    const editor = mount("Some **bold** text");
    editor.search.setQuery("**");

    expect(editor.search.getState().matchCount).toBe(0);
  });

  it("selects the first match and reports it as 1", () => {
    const editor = mount(THREE);
    editor.search.setQuery("alpha");

    expect(editor.search.getState()).toMatchObject({ matchCount: 3, currentIndex: 1 });
  });

  it("reports the options in force", () => {
    const editor = mount(THREE);
    editor.search.setQuery("ALPHA", { caseSensitive: true, wholeWord: true });

    expect(editor.search.getState().options).toEqual({
      caseSensitive: true,
      wholeWord: true,
      regexp: false,
    });
  });

  it.each([
    ["case sensitivity", "Todo todo", "todo", { caseSensitive: true }, 1],
    ["whole word", "cat category", "cat", { wholeWord: true }, 1],
    ["regex", "a1 b2", "[a-z]\\d", { regexp: true }, 2],
  ])("applies %s", (_name, doc, query, options, expected) => {
    const editor = mount(doc);
    editor.search.setQuery(query, options);

    expect(editor.search.getState().matchCount).toBe(expected);
  });

  it("marks an uncompilable regex invalid rather than throwing", () => {
    const editor = mount(THREE);
    editor.search.setQuery("[", { regexp: true });

    expect(editor.search.getState()).toMatchObject({ valid: false, matchCount: 0 });
  });

  it("stays valid for a plain query that looks like broken regex", () => {
    const editor = mount("a [ b");
    editor.search.setQuery("[");

    expect(editor.search.getState()).toMatchObject({ valid: true, matchCount: 1 });
  });
});

describe("stepping through matches", () => {
  it("advances one match at a time", () => {
    const editor = mount(THREE);
    editor.search.setQuery("alpha");

    editor.search.next();
    expect(editor.search.getState().currentIndex).toBe(2);
    editor.search.next();
    expect(editor.search.getState().currentIndex).toBe(3);
  });

  it("wraps from the last match to the first", () => {
    const editor = mount(THREE);
    editor.search.setQuery("alpha");
    editor.search.next();
    editor.search.next();

    editor.search.next();

    expect(editor.search.getState().currentIndex).toBe(1);
  });

  it("wraps backwards from the first match to the last", () => {
    const editor = mount(THREE);
    editor.search.setQuery("alpha");

    editor.search.previous();

    expect(editor.search.getState().currentIndex).toBe(3);
  });

  it("moves the caret to the current match, so arriving there is editable", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createMarkdownEditor(host, {
      initialContent: THREE,
      onSave: async () => {},
    });
    open.push(editor);
    const view = EditorView.findFromDOM(host)!;

    editor.search.setQuery("alpha");
    expect(view.state.selection.main.head).toBe(THREE.indexOf("alpha"));

    editor.search.next();
    expect(view.state.selection.main.head).toBe(THREE.indexOf("alpha", 5));
  });

  it("lands on the match's rendered start even when markup precedes it", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createMarkdownEditor(host, {
      initialContent: "text **alpha** more",
      onSave: async () => {},
    });
    open.push(editor);
    const view = EditorView.findFromDOM(host)!;

    editor.search.setQuery("alpha");

    // Position 7 is the "a", not the "**" at 5.
    expect(view.state.selection.main.head).toBe(7);
  });

  it("does nothing when there are no matches", () => {
    const editor = mount(THREE);
    editor.search.setQuery("nothing here");

    editor.search.next();
    editor.search.previous();

    expect(editor.search.getState().currentIndex).toBe(0);
  });
});

describe("clearing", () => {
  it("drops the query and the matches", () => {
    const editor = mount(THREE);
    editor.search.setQuery("alpha");

    editor.search.clear();

    expect(editor.search.getState()).toMatchObject({
      query: "",
      matchCount: 0,
      currentIndex: 0,
    });
  });
});

describe("subscribers", () => {
  it("are notified when a query is set", () => {
    const seen: SearchState[] = [];
    const editor = mount(THREE);
    editor.search.subscribe((s) => seen.push(s));

    editor.search.setQuery("alpha");

    expect(last(seen)).toMatchObject({ query: "alpha", matchCount: 3 });
  });

  // The reason state is pushed rather than returned: an edit changes the match
  // count without the host calling anything, so a returned value goes stale.
  it("are notified when an edit changes the match count", () => {
    const seen: SearchState[] = [];
    const editor = mount(THREE);
    editor.search.setQuery("alpha");
    editor.search.subscribe((s) => seen.push(s));

    editor.setContent("alpha alpha");

    expect(last(seen)?.matchCount).toBe(2);
  });

  it("receive the prop callback passed at construction", () => {
    const seen: SearchState[] = [];
    const editor = mount(THREE, (s) => seen.push(s));

    editor.search.setQuery("alpha");

    expect(last(seen)?.matchCount).toBe(3);
  });

  it("are not notified when nothing changed", () => {
    const seen: SearchState[] = [];
    const editor = mount(THREE);
    editor.search.setQuery("alpha");
    editor.search.subscribe((s) => seen.push(s));

    editor.search.setQuery("alpha");

    expect(seen).toHaveLength(0);
  });

  it("stop receiving updates once unsubscribed", () => {
    const seen: SearchState[] = [];
    const editor = mount(THREE);
    const off = editor.search.subscribe((s) => seen.push(s));

    off();
    editor.search.setQuery("alpha");

    expect(seen).toHaveLength(0);
  });
});
