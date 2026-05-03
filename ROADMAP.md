# StudyGraph Roadmap

## Release Readiness Snapshot

Status: desktop MVP / prerelease hardening.

The current app is useful for local desktop testing: notes, cards, SRS review, Study Graph, import/export, JSON backup, settings/debug, and offline card-generation previews are wired through the Rust core and Tauri UI.

## 0.1 Desktop Prerelease

Goal: ship a signed or clearly marked prerelease desktop build for manual testers.

Must-have gates:

- Rust core tests pass: `cargo test -p studygraph_core`
- Desktop tests pass: `npm test`
- Desktop production build passes: `npm run build`
- Tauri smoke script passes dependency checks and manual checklist: `npm run smoke:tauri`
- Markdown import/export and JSON backup/restore pass on a disposable test workspace
- Release notes document privacy posture and known limitations

Feature scope:

- Local SQLite workspace
- Page/block editor
- Doc source-note workspace
- TODO learning queue
- Card generation preview (offline only)
- Deck dashboard
- Review and free practice
- Study Graph
- Settings/debug/storage paths
- Markdown import/export
- JSON backup export/restore

Known blockers:

- External OpenAI/API calls are not implemented.
- No update channel.
- No signed/notarized installers validated in this repo yet.
- No automated end-to-end UI runner; manual smoke is still required.
- Mobile apps remain planning only.

## 0.2 Desktop Hardening

- Add automated UI smoke/e2e coverage for core flows.
- Add release artifact checksums and clearer release-note template.
- Improve empty/error/retry states for all Tauri command failures.
- Add disposable workspace/profile support for safer backup-restore testing.
- Expand import/export roundtrip tests with larger Logseq-like graphs.
- Decide packaging targets: Windows `.msi`/`.exe`, Linux AppImage/`.deb`.

## 0.3 AI Provider Decision

- Keep offline generation as default.
- Design secure provider boundary before any external request is enabled.
- Store secrets only in OS keychain or a backend-controlled environment, not plain SQLite/localStorage.
- Add explicit privacy confirmation, request preview, timeout/error/retry UI, and provider tests.

## Later

- Mobile runtime prototype with shared Rust core bridge.
- Sync preparation and conflict handling.
- Analytics over review events and graph health.
- More complete Logseq compatibility where product value justifies it.
