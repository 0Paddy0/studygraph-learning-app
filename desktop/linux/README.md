# Linux Desktop Target

Target: standalone StudyGraph desktop app for Linux.

Planned stack:

- Tauri shell
- React/TypeScript UI
- Rust core linked directly
- SQLite local database

First local goal:

1. Launch app window.
2. Create/open local workspace.
3. Import Markdown deck.
4. Show Logseq-like note layout.
5. Review cards with Rust SRS.
6. Show Study Graph.

Packaging later:

- AppImage first
- `.deb` second
- Flatpak only if needed

## Current Build Direction

The shared Tauri app lives in:

```text
native-studygraph-app/desktop/app
```

On Linux, the intended commands will be:

```bash
cd native-studygraph-app/desktop/app
npm install
npm run tauri -- build
```

Linux packaging has not been verified from this Windows machine yet. The same Tauri app should be used for Linux builds once Linux WebKit/Tauri system dependencies are installed.
