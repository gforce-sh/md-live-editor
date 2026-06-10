import { onCleanup, onMount } from "solid-js";
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

export interface MarkdownEditorProps {
  /** Initial content. Read once on mount; replace it afterwards via the handle's setContent. */
  initialContent: string;
  /** Called when the content should be persisted. Reject to trigger the retry flow. */
  onSave: (content: string) => Promise<void>;
  /** Debounce window before triggering a save (ms). Default: 2000. */
  debounceMs?: number;
  /** Delay before retrying after a failed save (ms). Default: 5000. */
  retryMs?: number;
  /** Called whenever the save status changes. The host renders the status itself. */
  onSaveStatus?: (status: SaveStatus) => void;
  /** Receives the imperative handle once the editor has mounted. */
  ref?: (handle: MarkdownEditorHandle) => void;
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  let host: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  const historyConf = new Compartment();

  const autosave = createAutosave((content) => props.onSave(content), {
    debounceMs: props.debounceMs ?? 2000,
    retryMs: props.retryMs ?? 5000,
  });

  const unsubscribe = autosave.subscribe((s) => props.onSaveStatus?.(s));

  const handle: MarkdownEditorHandle = {
    getContent: () => view?.state.doc.toString() ?? "",
    setContent: (content) => {
      if (!view) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        effects: historyConf.reconfigure(history()), // wipe undo history
        annotations: programmatic.of(true), // do not autosave this change
      });
      autosave.reset(content);
    },
    flushSave: () => autosave.flushSave(),
  };

  onMount(() => {
    view = new EditorView({
      parent: host!,
      state: EditorState.create({
        doc: props.initialContent,
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
    autosave.reset(props.initialContent); // initial content is the baseline
    props.ref?.(handle);
  });

  onCleanup(() => {
    unsubscribe();
    void autosave.flushSave().catch(() => {}); // best-effort persist on unmount
    autosave.dispose();
    view?.destroy();
  });

  return (
    <article class="md-live-editor">
      <div class="md-live-editor-body" ref={host} />
    </article>
  );
}
