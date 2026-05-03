# StudyGraph Desktop App

This is the shared Tauri + React desktop application for Windows and Linux.

## Stack

- Tauri 2
- React
- TypeScript
- Vite
- Rust `studygraph_core`
- SQLite through the Rust core

## Commands

```bash
npm install
npm test
npm run build
npm run smoke:tauri
npm run tauri:dev
npm run tauri -- build --debug
```

## Local Tauri UI Smoke Test

`npm run smoke:tauri` runs the frontend unit tests, production build, and `cargo test -p studygraph_core`, then prints the manual UI checklist. Set `RUN_TAURI_DEV=1` to launch the interactive Tauri window as the final step.

On Ubuntu 24.04/Linux, Tauri needs the WebKit/GTK dev stack before the UI can launch:

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

Manual UI pass criteria: the app opens, sidebar renders, dashboard counts load, notes/todo/graph tabs switch, and no browser console or Rust terminal errors appear.

## Current MVP Behavior

- Creates or opens a local SQLite workspace.
- Shows a Logseq-inspired sidebar and notes view.
- Creates and renames pages.
- Adds root blocks and child blocks.
- Edits block content.
- Sets card/deck/topic block properties from the UI.
- Deletes blocks after confirmation.
- Imports Logseq-compatible Markdown pages.
- Scans `#card` blocks through the Rust core.
- Shows deck dashboard.
- Reviews due cards through Rust SRS.
- Persists review events and SRS state.
- Shows a functional Study Graph.

## Data Location

The app stores `studygraph.sqlite3` in the operating system's app data directory through Tauri's `app_data_dir`.

## Notes

This app is not yet a full Logseq replacement. It is the first desktop shell connected to the shared Rust core.
