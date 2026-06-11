import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
  type SaveStatus,
  type Theme,
} from "../src/solid";
import "../src/styles.css";
import "./sandbox.css";

const INITIAL_DOC = `# md-live-editor sandbox

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
| ref            | (handle) => void                    | —       |
| theme          | light / dark / system               | "light" |

## Autosave

Edits are debounced (default 2 s) then passed to \`onSave\`. The editor itself
renders no status — the host app (this sandbox) reads \`onSaveStatus\` and shows
\`idle → saving… → saved\` in the toolbar, or \`couldn't save — retrying\` on failure.

Toggle **Simulate save failures** to test the retry flow.

## Imperative handle

Pass \`ref\` to receive a handle — try the toolbar buttons:

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

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save — retrying",
};

function Sandbox() {
  const [failSaves, setFailSaves] = createSignal(false);
  const [log, setLog] = createSignal<string[]>([]);
  const [status, setStatus] = createSignal<SaveStatus>("idle");
  const [theme, setTheme] = createSignal<Theme>("light");
  let editor: MarkdownEditorHandle | undefined;

  const pushLog = (msg: string) =>
    setLog((prev) => [`[${timestamp()}] ${msg}`, ...prev].slice(0, 6));

  const onSave = (content: string) =>
    new Promise<void>((resolve, reject) =>
      setTimeout(() => {
        if (failSaves()) {
          pushLog("save failed (simulated)");
          reject(new Error("simulated failure"));
        } else {
          pushLog(`saved ${content.length} chars`);
          resolve();
        }
      }, 600),
    );

  const loadSample = () => {
    editor?.setContent(SAMPLE_DOC);
    pushLog("setContent: loaded sample (no autosave, history reset)");
  };
  const logContent = () =>
    pushLog(`getContent: ${editor?.getContent().length ?? 0} chars`);
  const saveNow = () => {
    pushLog("flushSave: forcing save…");
    editor
      ?.flushSave()
      .then(() => pushLog("flushSave: resolved"))
      .catch(() => pushLog("flushSave: rejected"));
  };

  return (
    <div class="sandbox">
      <header class="sandbox-toolbar">
        <strong>md-live-editor sandbox</strong>
        <label class="sandbox-toggle">
          <input
            type="checkbox"
            checked={failSaves()}
            onChange={(e) => setFailSaves(e.currentTarget.checked)}
          />
          Simulate save failures
        </label>
        <label class="sandbox-toggle">
          Theme
          <select
            value={theme()}
            onChange={(e) => setTheme(e.currentTarget.value as Theme)}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </label>
        <div class="sandbox-actions">
          <button onClick={loadSample}>Load sample</button>
          <button onClick={logContent}>Log content</button>
          <button onClick={saveNow}>Save now</button>
        </div>
        <span class="sandbox-status" role="status" aria-live="polite">
          {STATUS_TEXT[status()]}
        </span>
      </header>
      <div class="sandbox-editor">
        <MarkdownEditor
          initialContent={INITIAL_DOC}
          onSave={onSave}
          onSaveStatus={setStatus}
          ref={(h) => (editor = h)}
          theme={theme()}
        />
      </div>
      <footer class="sandbox-log">
        {log().length === 0 ? (
          <span class="sandbox-log-empty">Save events will appear here…</span>
        ) : (
          log().map((entry) => <div>{entry}</div>)
        )}
      </footer>
    </div>
  );
}

render(() => <Sandbox />, document.getElementById("root")!);
