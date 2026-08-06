import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { findMatches, renderedText, toDocPos } from "../src/search";

/**
 * `renderedText` strips markdown syntax so search sees what the reader sees.
 * It is pure over the syntax tree — no view, no cursor, no viewport — which is
 * what keeps the match set stable while navigating and complete below the fold.
 */

function state(doc: string) {
  return EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] });
}

const render = (doc: string) => renderedText(state(doc)).text;

const NO_OPTIONS = { caseSensitive: false, wholeWord: false, regexp: false };

const matches = (doc: string, query: string, options = {}) =>
  findMatches(renderedText(state(doc)), query, { ...NO_OPTIONS, ...options });

/** The document text each match covers. */
const matchTexts = (doc: string, query: string, options = {}) =>
  matches(doc, query, options).map((m) => doc.slice(m.from, m.to));

describe("stripping markdown syntax", () => {
  it.each([
    ["heading marks", "# Heading here", "Heading here"],
    ["bold", "Some **bold** text", "Some bold text"],
    ["italic", "Some *it* text", "Some it text"],
    ["inline code", "Some `code` text", "Some code text"],
    ["a bullet prefix", "- item one", "item one"],
    ["nested bullet indentation", "- a\n\t- b", "a\nb"],
    ["a horizontal rule", "text\n\n---", "text\n\n"],
  ])("removes %s", (_name, doc, expected) => {
    expect(render(doc)).toBe(expected);
  });

  it.each([
    ["ordered markers, which render as literal text", "1. one", "1. one"],
    ["blockquote marks, which the preview leaves alone", "> quoted", "> quoted"],
    ["link syntax, which the preview leaves alone", "[a](http://x/y)", "[a](http://x/y)"],
  ])("keeps %s", (_name, doc, expected) => {
    expect(render(doc)).toBe(expected);
  });

  it("hides the source indent of a hard-wrapped item, which the preview pads instead", () => {
    expect(render("- item one\n  continues here")).toBe("item one\ncontinues here");
  });

  it("keeps table cells and drops the pipes, so cell text stays searchable", () => {
    const rendered = render("| A | B |\n|---|---|\n| 1 | 2 |");

    expect(rendered).toContain("A");
    expect(rendered).toContain("2");
    expect(rendered).not.toContain("|");
    expect(rendered).not.toContain("---");
  });

  // A regex-based stripper gets each of these wrong; the syntax tree does not.
  describe("cases that defeat a regex stripper", () => {
    it("leaves ** alone inside a fenced code block, where it is literal text", () => {
      expect(render("```\n**not bold**\n```")).toBe("\n**not bold**\n");
    });

    it("leaves underscores in a URL alone", () => {
      expect(render("[x](http://a.com/a_b_c)")).toContain("a_b_c");
    });

    it("does not treat an escaped asterisk as emphasis", () => {
      expect(render("a \\*b\\* c")).toBe("a \\*b\\* c");
    });
  });
});

/**
 * CodeMirror parses lazily under a time budget, so `syntaxTree()` covers only
 * the first few kB of a long document. Search spans all of it, so the tree has
 * to be forced to the end — otherwise markdown syntax stays visible (and
 * searchable) past the parsed prefix while being stripped before it.
 */
describe("documents longer than the lazy parse budget", () => {
  const filler = Array.from(
    { length: 400 },
    (_, i) => `Filler paragraph ${i} with a few words in it.\n`,
  ).join("\n");
  const doc = `${filler}\n# TailHeading\n\n**tailbold**\n\n- tailitem\n`;

  it("is long enough to outrun the lazy parse", () => {
    expect(doc.length).toBeGreaterThan(10_000);
  });

  it.each([
    ["heading marks", "# TailHeading", "TailHeading"],
    ["bold markers", "**tailbold**", "tailbold"],
    ["bullet prefixes", "- tailitem", "tailitem"],
  ])("still strips %s in the tail", (_name, raw, visible) => {
    const rendered = render(doc);

    expect(rendered).not.toContain(raw);
    expect(rendered).toContain(visible);
  });

  it("does not match syntax in the tail", () => {
    expect(matches(doc, "**")).toEqual([]);
  });

  it("maps tail matches back to the right document position", () => {
    const found = matches(doc, "tailbold");

    expect(found).toHaveLength(1);
    expect(doc.slice(found[0]!.from, found[0]!.to)).toBe("tailbold");
  });
});

describe("mapping rendered offsets back to the document", () => {
  it.each([
    ["bold", "Some **bold** text"],
    ["a heading", "# Title\n\nbody"],
    ["a bullet list", "- one\n- two"],
    ["a table", "| A | B |\n|---|---|\n| 1 | 2 |"],
    ["mixed markup", "# T\n\n- **a** `b`\n  cont\n\n---\n"],
  ])("round-trips every offset in %s", (_name, doc) => {
    const rendered = renderedText(state(doc));

    // Every rendered character must map to the document character it came from.
    for (let i = 0; i < rendered.text.length; i++) {
      expect(doc[toDocPos(rendered, i)]).toBe(rendered.text[i]);
    }
  });

  it("maps an offset past the end to the end of the visible text", () => {
    const rendered = renderedText(state("**a**"));

    expect(toDocPos(rendered, 999)).toBe(3);
  });

  it("returns 0 for a document with nothing visible", () => {
    const rendered = renderedText(state("---"));

    expect(rendered.text).toBe("");
    expect(toDocPos(rendered, 0)).toBe(0);
  });
});

describe("finding matches", () => {
  it("finds text that only exists once the syntax is stripped", () => {
    expect(matchTexts("Some **bold** text", "bold")).toEqual(["bold"]);
  });

  it("does not match syntax the reader cannot see", () => {
    expect(matches("Some **bold** text", "**")).toEqual([]);
    expect(matches("# Heading", "#")).toEqual([]);
    expect(matches("- item", "- ")).toEqual([]);
  });

  it("finds every occurrence, in document order", () => {
    const found = matches("one two one two one", "one");

    expect(found).toHaveLength(3);
    expect(found.map((m) => m.from)).toEqual([0, 8, 16]);
  });

  it("covers the hidden markup a match spans, so the highlight is contiguous", () => {
    // Rendered "boldtext"; "dt" bridges the closing "**".
    expect(matchTexts("**bold**text", "dt")).toEqual(["d**t"]);
  });

  it("is case-insensitive by default and case-sensitive on request", () => {
    expect(matches("Todo todo TODO", "todo")).toHaveLength(3);
    expect(matches("Todo todo TODO", "todo", { caseSensitive: true })).toHaveLength(1);
  });

  it("honours whole-word matching", () => {
    expect(matches("cat category", "cat")).toHaveLength(2);
    expect(matches("cat category", "cat", { wholeWord: true })).toHaveLength(1);
  });

  it("honours regex matching", () => {
    expect(matchTexts("a1 b2 c3", "[a-z]\\d", { regexp: true })).toEqual(["a1", "b2", "c3"]);
  });

  it("treats a query literally unless regex is on", () => {
    // Without literal handling, "\n" would be read as a newline and match nothing.
    expect(matches("a\\nb", "\\n")).toHaveLength(1);
  });

  it("returns nothing for an empty or uncompilable query", () => {
    expect(matches("text", "")).toEqual([]);
    expect(matches("text", "[", { regexp: true })).toEqual([]);
  });

  it("skips zero-width regex matches, which have nothing to highlight", () => {
    expect(matches("abc", "x*", { regexp: true })).toEqual([]);
  });
});
