# StudyGraph Desktop App

Shared Tauri + React desktop application for Windows and Linux.

## Stack

- Tauri 2
- React 18
- TypeScript
- Vite
- Rust `studygraph_core`
- SQLite through the Rust core

## Commands

```bash
npm install
npm test
npm run build
npm run release:check
npm run smoke:tauri
npm run tauri:dev
npm run tauri:build
```

`npm run release:check` runs the desktop unit tests, frontend production build, and `cargo test -p studygraph_core`.

## Local Tauri UI Smoke Test

`npm run smoke:tauri` runs the frontend unit tests, production build, and `cargo test -p studygraph_core`, then prints the manual UI checklist. Set `RUN_TAURI_DEV=1` to launch the interactive Tauri window as the final step.

On Ubuntu 24.04/Linux, Tauri needs the WebKit/GTK dev stack before the UI can launch:

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

Manual UI pass criteria: the app opens, sidebar renders, dashboard counts load, Notes/Doc/To Do/Graph/Import/Export/Settings tabs switch, a Markdown import/export can be exercised, and no browser console or Rust terminal errors appear.

## Current MVP Behavior

- Creates or opens a local SQLite workspace.
- Shows a Logseq-inspired sidebar and notes view.
- Creates, renames, and edits pages/blocks/properties.
- Manages Doc source pages and TODO learning tasks.
- Imports pasted Markdown, a single Markdown file, or a recursive Markdown folder.
- Scans `#card` and `sgd-*` blocks through the Rust core.
- Shows deck dashboard, due review, free practice, cloze answer mode, and Study Graph.
- Persists review events, review sessions, settings, docs, and SRS state.
- Exports Markdown folders and StudyGraph JSON backups; restores JSON backups.
- Provides storage/debug status and smoke-test instructions in Settings.
- Provides offline AI-style card previews; external API settings are metadata-only.

## Data Location

The app stores `studygraph.sqlite3` in the operating system's app data directory through Tauri's `app_data_dir`. The Settings / Debug screen reports the app data directory and database path when Tauri can provide them.

## Known Release Blockers

- No signed/notarized release artifacts yet.
- No auto-update channel.
- External AI calls are intentionally disabled.
- UI smoke still has a manual step.
- Mobile apps are not implemented.
