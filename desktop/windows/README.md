# Windows Desktop Target

Target: standalone StudyGraph desktop app for Windows.

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

- Tauri Windows installer
- code signing later
- auto-update later

## Current Build Commands

From the desktop app folder:

```powershell
cd "C:\intern\new path\plugin\logseq\native-studygraph-app\desktop\app"
npm install
npm run tauri -- build --debug
```

The current debug build creates:

```text
C:\intern\new path\plugin\logseq\native-studygraph-app\target\debug\studygraph_desktop.exe
C:\intern\new path\plugin\logseq\native-studygraph-app\target\debug\bundle\msi\StudyGraph_0.1.0_x64_en-US.msi
C:\intern\new path\plugin\logseq\native-studygraph-app\target\debug\bundle\nsis\StudyGraph_0.1.0_x64-setup.exe
```

Run without installing:

```powershell
cd "C:\intern\new path\plugin\logseq\native-studygraph-app"
.\target\debug\studygraph_desktop.exe
```
