# Long-lived, note-agnostic editor with a consumer-owned save-before-switch handshake

The editor is a **single long-lived instance** that knows nothing about notes (or whatever the host app's documents are). It edits one markdown document at a time and calls `onSave(content)` to persist it; switching documents is `setContent(newContent)`, **not** a remount. This preserves undo history, scroll position, and focus across a switch, and avoids remount flicker. Tying content to a note/document id is entirely the consumer's responsibility — the editor only produces and edits markdown.

Because one editor outlives many documents, a naive switch can corrupt data: a debounced or retrying save of document A can land on document B's `onSave`. Consumers therefore switch via an **ordered handshake**:

```
try { await editor.flushSave(); }      // persist A; rejects on failure
catch { /* stay on A, surface error */ return; }   // abort the switch
advanceTarget(B);                       // consumer re-points its save target
editor.setContent(B.content);           // load B
```

- `flushSave()` clears the debounce timer, guards against overlapping in-flight saves (one save at a time), resolves only when fully persisted, and **rejects on failure** (the retry timer keeps running so a consumer that stays on A eventually persists it).
- `setContent()` applies as a **programmatic** change: it does **not** trigger autosave and it **resets the undo history** (Cmd-Z must not bridge across documents).
- The editor calls the consumer's *latest* `onSave`; adapters keep that pointer fresh (see ADR-0001), so consumers write a naive `onSave` and the editor stays note-agnostic.

## Considered Options

- **Remount-per-note** (e.g. Solid `<Show keyed>`, React `key`) — simpler and corruption-proof by construction, but loses undo/scroll/focus and flickers on every switch. Rejected in favour of the long-lived editor.
