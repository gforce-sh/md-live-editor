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
  type SearchController,
  type SearchOptions,
  type SearchState,
  type Theme,
} from "./core";

export type {
  MarkdownEditorHandle,
  SaveStatus,
  SearchController,
  SearchOptions,
  SearchState,
  Theme,
};

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
  /** Called whenever search state changes. The host renders the counter itself. */
  onSearchState?: (state: SearchState) => void;
  /** Colour scheme. "light" (default), "dark", or "system" (follows the OS). */
  theme?: Theme;
  /** Override the editor background colour for each scheme. Omit to use defaults. */
  bg?: { light?: string; dark?: string };
}

/** What the handle reports before the editor has mounted. */
const IDLE_SEARCH: SearchState = {
  query: "",
  options: { caseSensitive: false, wholeWord: false, regexp: false },
  matchCount: 0,
  currentIndex: 0,
  valid: true,
};

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
    const onSearchStateRef = useRef(props.onSearchState);
    useEffect(() => {
      onSaveRef.current = props.onSave;
      onSaveStatusRef.current = props.onSaveStatus;
      onSearchStateRef.current = props.onSearchState;
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
        onSearchState: (s) => onSearchStateRef.current?.(s),
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
        focus: () => editorRef.current?.focus(),
        setCursor: (pos: number) => editorRef.current?.setCursor(pos),
        // Delegated per call rather than captured: under StrictMode the editor
        // is torn down and rebuilt, so the controller identity changes while
        // this handle does not.
        search: {
          setQuery: (q, o) => editorRef.current?.search.setQuery(q, o),
          next: () => editorRef.current?.search.next(),
          previous: () => editorRef.current?.search.previous(),
          clear: () => editorRef.current?.search.clear(),
          getState: () => editorRef.current?.search.getState() ?? IDLE_SEARCH,
          subscribe: (fn) => editorRef.current?.search.subscribe(fn) ?? (() => {}),
        },
      }),
      [],
    );

    const bgStyle: Record<string, string> = {};
    if (props.bg?.light) bgStyle["--mle-light-bg"] = props.bg.light;
    if (props.bg?.dark) bgStyle["--mle-dark-bg"] = props.bg.dark;

    return createElement(
      "article",
      { className: "md-live-editor", "data-theme": props.theme ?? "light", style: bgStyle },
      createElement("div", { className: "md-live-editor-body", ref: hostRef }),
    );
  },
);
