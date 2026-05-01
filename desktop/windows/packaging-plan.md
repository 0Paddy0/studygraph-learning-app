# Windows Packaging Plan

## Phase 1

- Development build only.
- Run through Tauri dev command.

## Phase 2

- Produce unsigned `.msi` or `.exe` installer.
- Store app data in Windows app data directory.
- Allow user-selected workspace export/import folders.

## Phase 3

- Code signing.
- Auto-update.
- Crash/error diagnostics with explicit user opt-in.

## Notes

The app must remain local-first. No telemetry or external content upload by default.
