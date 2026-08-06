import { describe, it, expect, afterEach } from "vitest";
import { act, createElement, createRef, StrictMode, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MarkdownEditor, type MarkdownEditorHandle, type SearchState } from "../src/react";

/**
 * The React adapter's search wiring — the path the sandbox uses, and the one
 * the Core's own tests cannot reach: `onSearchState` is ref-latched so the
 * long-lived editor always calls the current closure, and the handle's `search`
 * delegates per call because StrictMode tears the editor down and rebuilds it
 * while the handle itself stays put.
 *
 * Plain createElement rather than JSX, as in src/react.ts — the package never
 * compiles both Solid and React JSX in one build (ADR-0001).
 */

let mounted: { root: Root; host: HTMLElement }[] = [];

afterEach(() => {
  for (const { root, host } of mounted) {
    act(() => root.unmount());
    host.remove();
  }
  mounted = [];
  document.body.innerHTML = "";
});

function render(ui: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() => root.render(ui));
  return { host, root };
}

const DOC = "one alpha two alpha three alpha";

const editor = (props: Record<string, unknown>) =>
  createElement(MarkdownEditor, {
    initialContent: DOC,
    onSave: async () => {},
    ...props,
  } as never);

describe("the React adapter's search wiring", () => {
  it("reaches the controller through the forwarded ref", () => {
    const ref = createRef<MarkdownEditorHandle>();
    render(editor({ ref }));

    act(() => ref.current!.search.setQuery("alpha"));

    expect(ref.current!.search.getState()).toMatchObject({
      query: "alpha",
      matchCount: 3,
      currentIndex: 1,
    });
  });

  it("pushes state to the onSearchState prop", () => {
    const seen: SearchState[] = [];
    const ref = createRef<MarkdownEditorHandle>();
    render(editor({ ref, onSearchState: (s: SearchState) => seen.push(s) }));

    act(() => ref.current!.search.setQuery("alpha"));

    expect(seen[seen.length - 1]).toMatchObject({ query: "alpha", matchCount: 3 });
  });

  it("calls the latest onSearchState after a re-render, not the one from mount", () => {
    const first: SearchState[] = [];
    const second: SearchState[] = [];
    const ref = createRef<MarkdownEditorHandle>();

    const { root } = render(editor({ ref, onSearchState: (s: SearchState) => first.push(s) }));
    act(() => root.render(editor({ ref, onSearchState: (s: SearchState) => second.push(s) })));
    act(() => ref.current!.search.setQuery("alpha"));

    expect(second).toHaveLength(1);
    expect(first).toHaveLength(0);
  });

  it("steps through matches and wraps, driven from the handle", () => {
    const ref = createRef<MarkdownEditorHandle>();
    render(editor({ ref }));
    act(() => ref.current!.search.setQuery("alpha"));

    act(() => ref.current!.search.next());
    expect(ref.current!.search.getState().currentIndex).toBe(2);

    act(() => ref.current!.search.previous());
    act(() => ref.current!.search.previous());
    expect(ref.current!.search.getState().currentIndex).toBe(3);
  });

  it("paints highlights into the rendered DOM", () => {
    const ref = createRef<MarkdownEditorHandle>();
    const { host } = render(editor({ ref }));

    act(() => ref.current!.search.setQuery("alpha"));

    expect(host.querySelectorAll(".cm-md-search-match")).toHaveLength(3);
    expect(host.querySelectorAll(".cm-md-search-match-current")).toHaveLength(1);
  });

  it("clears highlights through the handle", () => {
    const ref = createRef<MarkdownEditorHandle>();
    const { host } = render(editor({ ref }));
    act(() => ref.current!.search.setQuery("alpha"));

    act(() => ref.current!.search.clear());

    expect(host.querySelectorAll(".cm-md-search-match")).toHaveLength(0);
  });

  it("survives StrictMode's double mount, which rebuilds the editor underneath", () => {
    const ref = createRef<MarkdownEditorHandle>();
    const { host } = render(createElement(StrictMode, null, editor({ ref })));

    act(() => ref.current!.search.setQuery("alpha"));

    // Delegating per call is what keeps the handle pointed at the surviving editor.
    expect(ref.current!.search.getState().matchCount).toBe(3);
    expect(host.querySelectorAll(".cm-md-search-match")).toHaveLength(3);
  });

  it("searches the rendered view, so markup is found by its text and not its source", () => {
    const ref = createRef<MarkdownEditorHandle>();
    render(editor({ ref, initialContent: "Some **bold** text" }));

    act(() => ref.current!.search.setQuery("bold"));
    expect(ref.current!.search.getState().matchCount).toBe(1);

    act(() => ref.current!.search.setQuery("**"));
    expect(ref.current!.search.getState().matchCount).toBe(0);
  });
});
