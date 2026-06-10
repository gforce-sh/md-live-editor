export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface Autosave {
  /** Queue the content to be saved after the debounce window. */
  schedule(content: string): void;
  /**
   * Save any pending content now, skipping the debounce. Resolves once the
   * editor is fully persisted (nothing pending, nothing in flight). Rejects if
   * a save fails — the retry timer keeps running in the background regardless.
   */
  flushSave(): Promise<void>;
  /**
   * Rebaseline to `content` without saving it: cancels any pending debounce or
   * retry and treats `content` as already-persisted. Used when the editor loads
   * a different document (setContent) so a discarded edit is never saved.
   */
  reset(content: string): void;
  status(): SaveStatus;
  subscribe(cb: (status: SaveStatus) => void): () => void;
  dispose(): void;
}

/**
 * Debounced autosave with a status state machine. Only ever runs one save at a
 * time; edits made while a save is in flight are coalesced and the latest is
 * saved next. On failure it keeps the latest (unsaved) content in memory and
 * retries.
 */
export function createAutosave(
  save: (content: string) => Promise<void>,
  opts: { debounceMs: number; retryMs: number },
): Autosave {
  let status: SaveStatus = "idle";
  let pending: string | null = null;
  let lastSaved: string | null = null;
  let saving = false;
  let disposed = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const subs = new Set<(status: SaveStatus) => void>();
  // Callers of flushSave waiting for the editor to reach quiescence.
  const waiters: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];

  const setStatus = (s: SaveStatus) => {
    status = s;
    for (const cb of subs) cb(s);
  };

  const isQuiesced = () => !saving && (pending === null || pending === lastSaved);

  const settleWaiters = (settle: (w: (typeof waiters)[number]) => void) => {
    const current = waiters.splice(0);
    for (const w of current) settle(w);
  };

  const run = () => {
    if (disposed || saving) return; // one save at a time
    if (pending === null || pending === lastSaved) {
      settleWaiters((w) => w.resolve()); // already quiesced
      return;
    }
    const content = pending;
    saving = true;
    setStatus("saving");
    save(content)
      .then(() => {
        if (disposed) return;
        saving = false;
        lastSaved = content;
        clearTimeout(retryTimer);
        if (pending !== lastSaved) {
          run(); // newer content arrived while saving
        } else {
          setStatus("saved");
          settleWaiters((w) => w.resolve());
        }
      })
      .catch((e: unknown) => {
        if (disposed) return;
        saving = false;
        setStatus("error");
        settleWaiters((w) => w.reject(e)); // flushSave callers abort
        clearTimeout(retryTimer);
        retryTimer = setTimeout(run, opts.retryMs); // keep retrying in the background
      });
  };

  return {
    schedule(content: string) {
      pending = content;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(run, opts.debounceMs);
    },
    flushSave() {
      clearTimeout(debounceTimer);
      if (isQuiesced()) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        waiters.push({ resolve, reject });
        run();
      });
    },
    reset(content: string) {
      clearTimeout(debounceTimer);
      clearTimeout(retryTimer);
      pending = content;
      lastSaved = content;
    },
    status: () => status,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    dispose() {
      disposed = true;
      clearTimeout(debounceTimer);
      clearTimeout(retryTimer);
      subs.clear();
      waiters.length = 0;
    },
  };
}
