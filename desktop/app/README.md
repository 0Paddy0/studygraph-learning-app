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
npm run build
npm run tauri:dev
npm run tauri -- build --debug
```

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
