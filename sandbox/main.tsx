import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { MarkdownEditor, type SaveStatus } from "../src/index";
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

## Autosave

Edits are debounced (default 2 s) then passed to \`onSave\`. The editor itself
renders no status — the host app (this sandbox) reads \`onSaveStatus\` and shows
\`idle → saving… → saved\` in the toolbar, or \`couldn't save — retrying\` on failure.

Toggle **Simulate save failures** in the toolbar above to test the retry
flow.
`;

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save — retrying",
};

function timestamp() {
  return new Date().toLocaleTimeString();
}

function Sandbox() {
  const [failSaves, setFailSaves] = createSignal(false);
  const [log, setLog] = createSignal<string[]>([]);
  const [status, setStatus] = createSignal<SaveStatus>("idle");

  const onSave = (content: string) =>
    new Promise<void>((resolve, reject) =>
      setTimeout(() => {
        if (failSaves()) {
          setLog((prev) =>
            [`[${timestamp()}] save failed (simulated)`, ...prev].slice(0, 6),
          );
          reject(new Error("simulated failure"));
        } else {
          setLog((prev) =>
            [`[${timestamp()}] saved ${content.length} chars`, ...prev].slice(0, 6),
          );
          resolve();
        }
      }, 600),
    );

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
        <span class="sandbox-status" role="status" aria-live="polite">
          {STATUS_TEXT[status()]}
        </span>
      </header>
      <div class="sandbox-editor">
        <MarkdownEditor
          initialContent={INITIAL_DOC}
          onSave={onSave}
          onSaveStatus={setStatus}
        />
      </div>
      <footer class="sandbox-log">
        {log().length === 0
          ? <span class="sandbox-log-empty">Save events will appear here…</span>
          : log().map((entry) => <div>{entry}</div>)
        }
      </footer>
    </div>
  );
}

render(() => <Sandbox />, document.getElementById("root")!);
