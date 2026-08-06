import { Annotation, Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { livePreview, tablePreview } from "./live-preview";
import { listKeymap } from "./list-indent";
import { createAutosave, type SaveStatus } from "./autosave";
import {
  createSearch,
  type SearchController,
  type SearchOptions,
  type SearchState,
} from "./search";

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "bold", textDecoration: "none" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.monospace, fontFamily: "ui-monospace, monospace" },
  { tag: tags.link, color: "var(--mle-link)" },
  // Markdown syntax marks (#, **, *, `, -, >, [], table |) are all tagged
  // processingInstruction; mute them so the revealed source reads as markup.
  { tag: tags.processingInstruction, color: "var(--mle-mark)" },
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
  /** Move focus into the editor so the caret is visible and typing works immediately. */
  focus(): void;
  /** Move the cursor to *pos* (0-based). */
  setCursor(pos: number): void;
  /**
   * Search over the rendered view (markdown syntax excluded). Commands live
   * here because "go to the next match" is an action, not state; the state
   * readout arrives via `onSearchState` or `search.subscribe`.
   */
  search: SearchController;
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
  /**
   * Called whenever search state changes — including changes the host did not
   * ask for, such as an edit altering the match count. The host renders the
   * counter itself.
   */
  onSearchState?: (state: SearchState) => void;
}

export interface MarkdownEditorInstance extends MarkdownEditorHandle {
  /** Tear down the editor: flush pending content (best effort), then dispose. */
  destroy(): void;
}

export type { SaveStatus, SearchController, SearchOptions, SearchState };

/** Colour scheme for the editor. "system" follows the OS via prefers-color-scheme. */
export type Theme = "light" | "dark" | "system";

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
  const search = createSearch();

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
        // List indentation must outrank defaultKeymap's Backspace binding; it
        // declines every key it doesn't handle, so deletion is otherwise normal.
        Prec.high(keymap.of([...listKeymap])),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ extensions: GFM }),
        syntaxHighlighting(markdownHighlight),
        livePreview,
        tablePreview,
        search.extension,
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

  const searchController = search.connect(view);
  const unsubscribeSearch = searchController.subscribe((s) => opts.onSearchState?.(s));

  return {
    getContent: () => view.state.doc.toString(),
    search: searchController,
    setContent: (content) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        effects: historyConf.reconfigure(history()), // wipe undo history
        annotations: programmatic.of(true), // do not autosave this change
      });
      autosave.reset(content);
    },
    flushSave: () => autosave.flushSave(),
    focus: () => view.focus(),
    setCursor: (pos: number) => {
      view.dispatch({
        selection: { anchor: pos },
      });
      view.focus();
    },
    destroy: () => {
      unsubscribe();
      unsubscribeSearch();
      void autosave.flushSave().catch(() => {}); // best-effort persist on unmount
      autosave.dispose();
      view.destroy();
    },
  };
}
