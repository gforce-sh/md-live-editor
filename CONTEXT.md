# Markdown Live Editor

A framework-agnostic markdown editor with inline Live Preview and Autosave, embedded by a Consumer. It produces and edits markdown and nothing else — it has no concept of the notes, documents, or files its Content ultimately belongs to.

## Language

### The editor

**Content**:
The markdown text held in the editor — what the user types and edits, and the only thing the editor knows about.
_Avoid_: doc, body, document, text

**Live Preview**:
The editing experience where the Content is displayed as rendered markdown in a single pane, except on the line or block the cursor is on, which reveals its raw markdown source. There is no separate "preview" view — editing and reading happen in the same place.
_Avoid_: Split preview, Side-by-side, WYSIWYG, Render pane

**Autosave**:
The behaviour of persisting Content as the user edits rather than on an explicit save action. The editor never stores Content itself — it hands it to the Consumer to save and reports back a save status.
_Avoid_: auto-save, manual save, persistence

### Structure & consumers

**Core**:
The framework-free heart of the package — the CodeMirror setup, Live Preview, and Autosave engine, exposed as a plain factory. Knows nothing about any UI framework.
_Avoid_: base, kernel, engine, vanilla build

**Adapter**:
A thin, framework-specific component (Solid, React) that mounts the Core in that framework's lifecycle and exposes it as an idiomatic component. Adapters absorb framework-specific concerns so the Core stays framework-free.
_Avoid_: wrapper, binding, integration

**Consumer**:
The host application that embeds the editor — through an Adapter or the Core directly — and owns where Content is ultimately stored.
_Avoid_: host app, client, importer, parent
