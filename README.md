# StudyGraph Learning App

Standalone, local-first StudyGraph app for notes, spaced repetition, and graph-based learning. The product is a clean native app rather than a Logseq fork, while keeping Logseq-compatible Markdown import/export where practical.

## Current Product Status

Desktop MVP is functional in `desktop/app`:

- Tauri 2 + React/Vite desktop shell
- Rust `studygraph_core` for parsing, SRS, graph building, SQLite storage, import/export, and backup data
- Logseq-like page/block editor with page and block properties
- Doc workspace for structured source notes and AI-style deck preparation
- TODO capture and learning queue
- Card detection from `#card` and `sgd-*` metadata
- Deck dashboard, due review, free practice, cloze-style answer mode, and review-session summaries
- Study Graph with deck/topic/card/page signals
- Single Markdown file import and recursive Markdown folder import
- Markdown folder export plus JSON backup export/restore
- Settings/debug screen with storage paths and smoke-test guidance
- Offline deterministic card-generation preview; external OpenAI/API settings are metadata-only in this build

Mobile folders (`iphone/`, `android/`) are planning stubs. They are not release targets yet.

## Repository Layout

```text
studygraph-learning-app/
  PLAN.md                  Product/architecture plan
  ROADMAP.md               Release-readiness roadmap
  shared/rust-core/        UI-independent Rust core crate
  desktop/app/             Tauri + React desktop app
  desktop/windows/         Windows packaging notes
  desktop/linux/           Linux packaging notes
  iphone/                  iOS plan
  android/                 Android plan
  scripts/                 Packaging helpers
```

## System Dependencies

Required toolchains:

- Rust stable + Cargo
- Node.js 22 and npm
- Linux desktop builds/smoke tests: WebKit/GTK Tauri development packages

Ubuntu 24.04 example:

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

## Install, Build, and Test

From the repo root:

```bash
cargo test -p studygraph_core
```

From `desktop/app`:

```bash
npm install
npm test
npm run build
npm run release:check
npm run smoke:tauri
npm run tauri:dev
npm run tauri:build
```

`npm run release:check` runs the desktop unit tests, production frontend build, and Rust core tests. `npm run smoke:tauri` also prints Linux dependency status and the manual UI checklist. Set `RUN_TAURI_DEV=1` to launch the interactive Tauri window at the end of the smoke run.

## Windows Build Helper

From the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows-exe.ps1
```

For a faster debug build:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows-exe.ps1 -Profile debug
```

Generated `release-artifacts/`, `target/`, `node_modules/`, and `dist/` outputs are ignored by Git.

## Markdown Import/Export

- Import a `.md`, `.markdown`, or `.txt` file from the Import tab.
- Import a folder recursively for Logseq-like `pages/` and `journals/` graphs. Common non-page folders such as `assets` are skipped.
- Export one Logseq-compatible Markdown file per page from the Export tab.
- Export/restore a StudyGraph JSON backup for local data transfer or release smoke testing.

## Known Blockers Before a Public Release

- No signed/notarized Windows or Linux release validation yet.
- No auto-update channel.
- External AI requests are intentionally disabled; provider settings are metadata only.
- No mobile runtime implementation yet.
- Manual UI smoke pass still required after CI/build checks.
- Full Logseq parity, cloud sync, and conflict-resolution UI are out of scope for this MVP.

## Release Checklist

Before tagging a desktop prerelease:

- [ ] `cargo test -p studygraph_core`
- [ ] `cd desktop/app && npm test`
- [ ] `cd desktop/app && npm run build`
- [ ] `cd desktop/app && npm run smoke:tauri`
- [ ] Manual smoke: app opens, sidebar renders, dashboard counts load, Notes/Doc/To Do/Graph/Import/Export/Settings tabs switch, no console/Rust errors
- [ ] Import single Markdown file and recursive folder
- [ ] Review at least one due card and confirm persistence after refresh
- [ ] Export Markdown folder and JSON backup; restore JSON backup in a disposable workspace/profile
- [ ] Build platform bundle (`npm run tauri:build` or Windows helper)
- [ ] Record known blockers in release notes
