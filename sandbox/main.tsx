import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { MarkdownEditor } from "../src/index";
import "../src/styles.css";
import "./sandbox.css";

const INITIAL_DOC = `# md-live-editor sandbox

Edit here to try the Live Preview. The cursor line shows raw markdown;
all other lines render it.

## Inline formatting

**Bold**, *italic*, and \`inline code\` are rendered live.

## Tables

| Prop          | Type                            | Default |
|---------------|---------------------------------|---------|
| doc           | string                          | —       |
| onSave        | (body: string) => Promise<void> | —       |
| debounceMs    | number                          | 2000    |
| retryMs       | number                          | 5000    |
| onStatusChange| (status: SaveStatus) => void    | —       |

## Autosave

Edits are debounced (default 2 s) then passed to \`onSave\`. The status
indicator above the editor tracks \`idle → saving… → saved\`, or switches
to \`couldn't save — retrying\` on failure.

Toggle **Simulate save failures** in the toolbar above to test the retry
flow.
`;

function timestamp() {
  return new Date().toLocaleTimeString();
}

function Sandbox() {
  const [failSaves, setFailSaves] = createSignal(false);
  const [log, setLog] = createSignal<string[]>([]);

  const onSave = (body: string) =>
    new Promise<void>((resolve, reject) =>
      setTimeout(() => {
        if (failSaves()) {
          setLog((prev) =>
            [`[${timestamp()}] save failed (simulated)`, ...prev].slice(0, 6),
          );
          reject(new Error("simulated failure"));
        } else {
          setLog((prev) =>
            [`[${timestamp()}] saved ${body.length} chars`, ...prev].slice(0, 6),
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
      </header>
      <div class="sandbox-editor">
        <MarkdownEditor doc={INITIAL_DOC} onSave={onSave} />
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
