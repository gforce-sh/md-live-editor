import { onCleanup, onMount } from "solid-js";
import {
  createMarkdownEditor,
  type MarkdownEditorHandle,
  type MarkdownEditorInstance,
  type SaveStatus,
} from "./core";

export type { MarkdownEditorHandle, SaveStatus };

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
  let editor: MarkdownEditorInstance | undefined;

  onMount(() => {
    editor = createMarkdownEditor(host!, {
      initialContent: props.initialContent,
      // Read through props at call time so the editor always calls the latest
      // onSave / onSaveStatus (Solid props are reactive getters).
      onSave: (content) => props.onSave(content),
      debounceMs: props.debounceMs,
      retryMs: props.retryMs,
      onSaveStatus: (s) => props.onSaveStatus?.(s),
    });
    props.ref?.(editor);
  });

  onCleanup(() => editor?.destroy());

  return (
    <article class="md-live-editor">
      <div class="md-live-editor-body" ref={host} />
    </article>
  );
}
