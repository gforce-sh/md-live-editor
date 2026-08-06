/** @jsxImportSource react */
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
  type SaveStatus,
  type SearchOptions,
  type SearchState,
  type Theme,
} from "../src/react";
import "../src/styles.css";
import "./sandbox.css";

const INITIAL_DOC = `# md-live-editor sandbox (React)

Edit here to try the Live Preview. The cursor line shows raw markdown;
all other lines render it.

## Inline formatting

**Bold**, *italic*, and \`inline code\` are rendered live.

## Tables

| Prop           | Type                                | Default |
|----------------|-------------------------------------|---------|
| initialContent | string                              | —       |
| onSave         | (content: string) => Promise<void>  | —       |
| debounceMs     | number                              | 2000    |
| retryMs        | number                              | 5000    |
| onSaveStatus   | (status: SaveStatus) => void        | —       |
| theme          | light / dark / system               | "light" |
| ref            | forwarded → handle                  | —       |

## Autosave

Edits are debounced (default 2 s) then passed to \`onSave\`. The editor itself
renders no status — this host reads \`onSaveStatus\` and shows \`idle → saving… →
saved\` in the toolbar, or \`couldn't save — retrying\` on failure.

Toggle **Simulate save failures** to test the retry flow.

## Search

Press ⌘F (or the toolbar button). Search runs over the **rendered** view, so
searching \`bold\` finds the **bold** above even though the source says
\`**bold**\` — and searching \`**\` finds nothing, because you cannot see it.
Table cells are searchable too: try \`retryMs\`.

↓ / ↑ (or Enter / Shift-Enter) step through matches and wrap around at both
ends. The three toggles are case sensitivity, whole word, and regex.

## Imperative handle

A \`ref\` (forwardRef) gives the handle — try the toolbar buttons:

- **Load sample** replaces this document via \`setContent\`: autosave does **not**
  fire, and the undo history is reset (Cmd-Z won't bring this doc back).
- **Log content** prints \`getContent()\` to the log.
- **Save now** calls \`flushSave()\` and logs whether it resolved or rejected.
`;

const SAMPLE_DOC = `# Loaded via setContent

This document replaced the previous one **programmatically**.

- Autosave was *not* triggered by the load
- Undo history was reset — try Cmd-Z, it won't restore the old document
`;

function timestamp() {
  return new Date().toLocaleTimeString();
}

/**
 * The search box. The library ships no UI, so this is both the demo and the
 * worked example: state arrives via onSearchState, commands go out through the
 * handle, and the keys are bound *here* — while you are searching, focus is in
 * this input, outside CodeMirror, where a library keymap could never fire.
 */
function SearchBox({
  state,
  editorRef,
  onClose,
}: {
  state: SearchState;
  editorRef: React.RefObject<MarkdownEditorHandle | null>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Required<SearchOptions>>({
    caseSensitive: false,
    wholeWord: false,
    regexp: false,
  });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const run = (nextQuery: string, nextOptions: Required<SearchOptions>) => {
    setQuery(nextQuery);
    setOptions(nextOptions);
    editorRef.current?.search.setQuery(nextQuery, nextOptions);
  };

  const toggle = (key: keyof SearchOptions) => () =>
    run(query, { ...options, [key]: !options[key] });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      editorRef.current?.search.next();
    } else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) {
      e.preventDefault();
      editorRef.current?.search.previous();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const counter = !state.valid
    ? "bad pattern"
    : state.query === ""
      ? ""
      : state.matchCount === 0
        ? "no matches"
        : `${state.currentIndex} / ${state.matchCount}`;

  return (
    <div className="sandbox-search">
      <input
        ref={inputRef}
        className="sandbox-search-input"
        placeholder="Search…"
        value={query}
        aria-invalid={!state.valid}
        onChange={(e) => run(e.target.value, options)}
        onKeyDown={onKeyDown}
      />
      <span className="sandbox-search-count">{counter}</span>
      <button onClick={() => editorRef.current?.search.previous()} title="Previous (↑)">
        ↑
      </button>
      <button onClick={() => editorRef.current?.search.next()} title="Next (↓)">
        ↓
      </button>
      {(
        [
          ["caseSensitive", "Aa", "Case sensitive"],
          ["wholeWord", "ab", "Whole word"],
          ["regexp", ".*", "Regex"],
        ] as const
      ).map(([key, label, title]) => (
        <button
          key={key}
          title={title}
          className={options[key] ? "sandbox-search-opt on" : "sandbox-search-opt"}
          onClick={toggle(key)}
        >
          {label}
        </button>
      ))}
      <button onClick={onClose} title="Close (Esc)">
        ✕
      </button>
    </div>
  );
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save — retrying",
};

function Sandbox() {
  const [failSaves, setFailSaves] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [theme, setTheme] = useState<Theme>("light");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState<SearchState>({
    query: "",
    options: { caseSensitive: false, wholeWord: false, regexp: false },
    matchCount: 0,
    currentIndex: 0,
    valid: true,
  });
  const editorRef = useRef<MarkdownEditorHandle>(null);

  // Cmd/Ctrl+F. Worth intercepting rather than leaving to the browser:
  // CodeMirror only renders the visible viewport, so native find genuinely
  // cannot see the rest of the document.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closeSearch = () => {
    setSearchOpen(false);
    editorRef.current?.search.clear();
    editorRef.current?.focus();
  };

  const pushLog = (msg: string) =>
    setLog((prev) => [`[${timestamp()}] ${msg}`, ...prev].slice(0, 6));

  // A fresh closure each render, reading the current failSaves — the adapter
  // keeps the editor pointed at this latest onSave.
  const onSave = (content: string) =>
    new Promise<void>((resolve, reject) =>
      setTimeout(() => {
        if (failSaves) {
          pushLog("save failed (simulated)");
          reject(new Error("simulated failure"));
        } else {
          pushLog(`saved ${content.length} chars`);
          resolve();
        }
      }, 600),
    );

  const loadSample = () => {
    editorRef.current?.setContent(SAMPLE_DOC);
    pushLog("setContent: loaded sample (no autosave, history reset)");
  };
  const logContent = () =>
    pushLog(`getContent: ${editorRef.current?.getContent().length ?? 0} chars`);
  const saveNow = () => {
    pushLog("flushSave: forcing save…");
    editorRef.current
      ?.flushSave()
      .then(() => pushLog("flushSave: resolved"))
      .catch(() => pushLog("flushSave: rejected"));
  };

  return (
    <div className="sandbox">
      <header className="sandbox-toolbar">
        <strong>md-live-editor sandbox (React)</strong>
        <label className="sandbox-toggle">
          <input
            type="checkbox"
            checked={failSaves}
            onChange={(e) => setFailSaves(e.target.checked)}
          />
          Simulate save failures
        </label>
        <label className="sandbox-toggle">
          Theme
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </label>
        <div className="sandbox-actions">
          <button onClick={loadSample}>Load sample</button>
          <button onClick={logContent}>Log content</button>
          <button onClick={saveNow}>Save now</button>
          <button onClick={() => setSearchOpen(true)}>Search (⌘F)</button>
        </div>
        <span className="sandbox-status" role="status" aria-live="polite">
          {STATUS_TEXT[status]}
        </span>
      </header>
      {searchOpen && (
        <SearchBox state={search} editorRef={editorRef} onClose={closeSearch} />
      )}
      <div className="sandbox-editor">
        <MarkdownEditor
          ref={editorRef}
          initialContent={INITIAL_DOC}
          onSave={onSave}
          onSaveStatus={setStatus}
          onSearchState={setSearch}
          theme={theme}
        />
      </div>
      <footer className="sandbox-log">
        {log.length === 0 ? (
          <span className="sandbox-log-empty">Save events will appear here…</span>
        ) : (
          log.map((entry, i) => <div key={i}>{entry}</div>)
        )}
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sandbox />
  </StrictMode>,
);
