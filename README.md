# Native StudyGraph App

This folder is the planning and starter workspace for a future standalone StudyGraph application.

The existing Logseq plugin remains in the project root. This native app is intentionally separated so it can grow into its own product without coupling to Logseq plugin APIs.

## Target Structure

```text
native-studygraph-app/
  PLAN.md
  shared/
    rust-core/
  desktop/
    windows/
    linux/
  iphone/
  android/
```

## Product Direction

Goal: build a Logseq-inspired local-first note and learning app with StudyGraph deeply integrated.

Core split:

- Rust: parser, scheduler, SRS, graph builder, storage, import/export, future sync
- TypeScript/React: desktop UI, mobile UI, editor interaction, graph visualization

## Current Status

The desktop MVP is now a working Tauri app for Windows development builds.

Implemented:

- Rust core for parser, SRS scheduler, graph builder, SQLite storage, and Markdown import/export
- React/Tauri desktop shell
- Logseq-like notes sidebar and block editor
- Page and block properties
- Card detection from `#card` and `sgd-*` metadata
- Deck dashboard
- Due review with SRS persistence
- Study Graph view
- Single Markdown file import through a native file picker
- Recursive Markdown folder import through a native folder picker
- Workspace export as Logseq-compatible Markdown files through a native folder picker

The existing Logseq plugin remains in the project root. The native app is intentionally separate.

## Desktop Commands

From `native-studygraph-app/desktop/app`:

```powershell
npm install
npm run tauri:dev
npm run build
npm run tauri -- build --debug
```

## Windows Build Helper

From `native-studygraph-app`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows-exe.ps1
```

This creates a release Tauri build and copies the generated `.exe`/installer artifacts to:

```text
native-studygraph-app/release-artifacts/windows/release/
```

For a faster debug build:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows-exe.ps1 -Profile debug
```

The `release-artifacts/`, `target/`, `node_modules/`, and `dist/` folders are intentionally ignored by Git.

The latest Windows debug artifacts are written under:

```text
native-studygraph-app/target/debug/
native-studygraph-app/target/debug/bundle/
```

## Markdown Import/Export

Use the `Import` tab to choose a `.md`, `.markdown`, or `.txt` file. The app imports it as one page and scans cards from `#card` blocks.

Use `Import Markdown Folder` to import a folder recursively. This is intended for Logseq-like graphs with `pages/` and `journals/` folders. The importer reads `.md` and `.markdown` files, skips common non-page folders such as `assets`, and replaces existing pages with matching page names.

Use the `Export` tab to choose an output folder. The app writes one Logseq-compatible `.md` file per page. Existing files with matching page names can be overwritten after confirmation.
