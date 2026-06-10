import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { livePreview, tablePreview } from "./live-preview";
import { createAutosave, type SaveStatus } from "./autosave";

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "bold", textDecoration: "none" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.monospace, fontFamily: "ui-monospace, monospace" },
  { tag: tags.link, color: "#2563eb" },
]);

// Marks doc changes the editor makes itself (setContent) so the update listener
// can tell them apart from user edits and not trigger autosave.
const programmatic = Annotation.define<boolean>();

export interface MarkdownEditorHandle {
  /** The current Content. */
  getContent(): string;
  /**
   * Replace the Content programmatically — used to load a different document
   * into the same long-lived editor. Does not trigger autosave and resets the
   * undo history (Cmd-Z must not bridge across documents).
   */
  setContent(content: string): void;
  /** Force a save now, skipping the debounce. Resolves when persisted, rejects on failure. */
  flushSave(): Promise<void>;
}

export interface MarkdownEditorOptions {
  /** Initial content; replace it afterwards via setContent. */
  initialContent: string;
  /** Called when the content should be persisted. Reject to trigger the retry flow. */
  onSave: (content: string) => Promise<void>;
  /** Debounce window before triggering a save (ms). Default: 2000. */
  debounceMs?: number;
  /** Delay before retrying after a failed save (ms). Default: 5000. */
  retryMs?: number;
  /** Called whenever the save status changes. The host renders the status itself. */
  onSaveStatus?: (status: SaveStatus) => void;
}

export interface MarkdownEditorInstance extends MarkdownEditorHandle {
  /** Tear down the editor: flush pending content (best effort), then dispose. */
  destroy(): void;
}

export type { SaveStatus };

/**
 * Framework-free markdown editor with inline Live Preview and debounced
 * autosave. Mounts a CodeMirror 6 view into `host` and returns an imperative
 * handle. Adapters (Solid, React) wrap this in their own lifecycle.
 */
export function createMarkdownEditor(
  host: HTMLElement,
  opts: MarkdownEditorOptions,
): MarkdownEditorInstance {
  const historyConf = new Compartment();

  const autosave = createAutosave((content) => opts.onSave(content), {
    debounceMs: opts.debounceMs ?? 2000,
    retryMs: opts.retryMs ?? 5000,
  });
  const unsubscribe = autosave.subscribe((s) => opts.onSaveStatus?.(s));

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: opts.initialContent,
      extensions: [
        historyConf.of(history()),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ extensions: GFM }),
        syntaxHighlighting(markdownHighlight),
        livePreview,
        tablePreview,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (
            u.docChanged &&
            !u.transactions.some((tr) => tr.annotation(programmatic))
          ) {
            autosave.schedule(u.state.doc.toString());
          }
        }),
      ],
    }),
  });
  autosave.reset(opts.initialContent); // initial content is the baseline

  return {
    getContent: () => view.state.doc.toString(),
    setContent: (content) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        effects: historyConf.reconfigure(history()), // wipe undo history
        annotations: programmatic.of(true), // do not autosave this change
      });
      autosave.reset(content);
    },
    flushSave: () => autosave.flushSave(),
    destroy: () => {
      unsubscribe();
      void autosave.flushSave().catch(() => {}); // best-effort persist on unmount
      autosave.dispose();
      view.destroy();
    },
  };
}
