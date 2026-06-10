# Framework-agnostic core with per-framework adapters

CodeMirror 6 owns the entire editing surface — its own DOM, state, and update cycle — so a UI framework contributes nothing to the editor's hot path (keystrokes never round-trip through Solid signals or a React vdom). The package must also be consumable from mixed consumers (quick-note is Solid; future apps are React).

We therefore ship a dependency-free vanilla **core** (`md-live-editor/core`, `createMarkdownEditor(host, opts)` returning an imperative handle) plus thin per-framework **adapter** components (`md-live-editor/solid`, `md-live-editor/react`) that wrap the core in each framework's lifecycle and declare that framework as an *optional peer dependency*. quick-note consumes `md-live-editor/solid`; React apps consume `md-live-editor/react`; vanilla consumers use the core directly.

## Considered Options

- **Stay Solid-only** — rejected: forces every consumer onto Solid, contradicting the mixed-consumer goal.
- **Ship only the core; each consumer writes its own wrapper** — rejected: the wrapper is small but carries framework-specific footguns (React StrictMode double-mount, ref forwarding, cleanup ordering) worth writing once and sharing rather than having each consumer rediscover.
