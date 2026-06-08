import { createSignal, onCleanup, onMount } from "solid-js";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { livePreview, tablePreview } from "./live-preview";
import { createAutosave, type SaveStatus } from "./autosave";

const STATUS_LABELS: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save — retrying",
};

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "bold", textDecoration: "none" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.monospace, fontFamily: "ui-monospace, monospace" },
  { tag: tags.link, color: "#2563eb" },
]);

export interface MarkdownEditorProps {
  /** Initial document content. */
  doc: string;
  /** Called when the document should be persisted. Reject to trigger the retry flow. */
  onSave: (body: string) => Promise<void>;
  /** Debounce window before triggering a save (ms). Default: 2000. */
  debounceMs?: number;
  /** Delay before retrying after a failed save (ms). Default: 5000. */
  retryMs?: number;
  /** Optional callback fired whenever the save status changes. */
  onStatusChange?: (status: SaveStatus) => void;
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  let host: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  const [status, setStatus] = createSignal<SaveStatus>("idle");

  const autosave = createAutosave((body) => props.onSave(body), {
    debounceMs: props.debounceMs ?? 2000,
    retryMs: props.retryMs ?? 5000,
  });

  const unsubscribe = autosave.subscribe((s) => {
    setStatus(s);
    props.onStatusChange?.(s);
  });

  onMount(() => {
    view = new EditorView({
      parent: host!,
      state: EditorState.create({
        doc: props.doc,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ extensions: GFM }),
          syntaxHighlighting(markdownHighlight),
          livePreview,
          tablePreview,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) autosave.schedule(u.state.doc.toString());
          }),
        ],
      }),
    });
  });

  onCleanup(() => {
    unsubscribe();
    autosave.flush();
    autosave.dispose();
    view?.destroy();
  });

  return (
    <article class="md-live-editor">
      <span role="status" aria-live="polite" class="md-live-editor-status">
        {STATUS_LABELS[status()]}
      </span>
      <div class="md-live-editor-body" ref={host} />
    </article>
  );
}
