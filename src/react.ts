import {
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  createMarkdownEditor,
  type MarkdownEditorHandle,
  type MarkdownEditorInstance,
  type SaveStatus,
  type Theme,
} from "./core";

export type { MarkdownEditorHandle, SaveStatus, Theme };

export interface MarkdownEditorProps {
  /** Initial content. Read once on mount; replace it afterwards via the ref's setContent. */
  initialContent: string;
  /** Called when the content should be persisted. Reject to trigger the retry flow. */
  onSave: (content: string) => Promise<void>;
  /** Debounce window before triggering a save (ms). Default: 2000. */
  debounceMs?: number;
  /** Delay before retrying after a failed save (ms). Default: 5000. */
  retryMs?: number;
  /** Called whenever the save status changes. The host renders the status itself. */
  onSaveStatus?: (status: SaveStatus) => void;
  /** Colour scheme. "light" (default), "dark", or "system" (follows the OS). */
  theme?: Theme;
}

// JSX is deliberately avoided (plain createElement) so the package never has to
// compile both Solid and React JSX in one build — see ADR-0001.
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(props, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<MarkdownEditorInstance | undefined>(undefined);

    // React hands us new prop identities every render; keep the latest callbacks
    // in refs so the long-lived editor always calls the current ones.
    const onSaveRef = useRef(props.onSave);
    const onSaveStatusRef = useRef(props.onSaveStatus);
    useEffect(() => {
      onSaveRef.current = props.onSave;
      onSaveStatusRef.current = props.onSaveStatus;
    });

    // Mount once. initialContent is read here by design; use setContent (via the
    // ref) to load a different document afterwards. The cleanup/recreate pair is
    // also what makes this safe under React StrictMode's double-mount.
    useEffect(() => {
      const editor = createMarkdownEditor(hostRef.current!, {
        initialContent: props.initialContent,
        onSave: (content) => onSaveRef.current(content),
        debounceMs: props.debounceMs,
        retryMs: props.retryMs,
        onSaveStatus: (s) => onSaveStatusRef.current?.(s),
      });
      editorRef.current = editor;
      return () => {
        editor.destroy();
        editorRef.current = undefined;
      };
    }, []);

    useImperativeHandle(
      ref,
      (): MarkdownEditorHandle => ({
        getContent: () => editorRef.current?.getContent() ?? "",
        setContent: (content) => editorRef.current?.setContent(content),
        flushSave: () => editorRef.current?.flushSave() ?? Promise.resolve(),
      }),
      [],
    );

    return createElement(
      "article",
      { className: "md-live-editor", "data-theme": props.theme ?? "light" },
      createElement("div", { className: "md-live-editor-body", ref: hostRef }),
    );
  },
);
