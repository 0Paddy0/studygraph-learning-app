# Implementation Plan: Native StudyGraph App

## 1. Goal

Build a standalone Logseq-inspired learning and note application.

The app should keep the feel of Logseq and the current StudyGraph plugin:

- Left sidebar with navigation
- Block-based notes
- Markdown-like editing
- Page links using `[[Page]]`
- Tags using `#tag`
- Backlinks
- Cards detected from blocks
- Deck dashboard
- Due review
- Free practice
- Study Graph
- AI-assisted card generation later

The app must not be a Logseq fork at first. It should import/export Logseq-compatible Markdown where possible, but own its data model and runtime.

## 2. High-Level Architecture

```text
Rust Core
  Domain model
  Markdown/block parser
  Card scanner
  SRS scheduler
  Deck/topic stats
  Study graph builder
  SQLite storage
  Import/export
  Future sync merge engine

Desktop UI
  Tauri shell
  React/TypeScript UI
  Windows package
  Linux package

Mobile UI
  React Native/Expo or bare React Native
  iPhone target
  Android target
  Rust core through UniFFI/native bridge
```

## 3. Why Not Fork Logseq First

Forking Logseq would give a lot of existing behavior but also brings heavy constraints:

- Large Clojure/ClojureScript codebase
- Existing architectural decisions not optimized for StudyGraph-first learning
- Fork maintenance burden
- Licensing and attribution obligations
- Harder mobile/native direction

The safer first version is a clean app with Logseq-compatible import/export.

Forking Logseq can be reevaluated only if:

- exact feature parity with Logseq becomes mandatory,
- license review is completed,
- the maintenance cost is accepted.

## 4. Workspace Layout

```text
native-studygraph-app/
  PLAN.md
  README.md

  shared/
    rust-core/
      Cargo.toml
      src/
        lib.rs
        model.rs
        parser.rs
        scheduler.rs
        graph.rs
        storage.rs
        import_export.rs
        sync.rs

  desktop/
    windows/
      README.md
      packaging-plan.md

    linux/
      README.md
      packaging-plan.md

  iphone/
    README.md
    mobile-plan.md

  android/
    README.md
    mobile-plan.md
```

## 5. Rust Core Responsibilities

The Rust core should be UI-independent.

It owns:

- canonical data model
- parser and serializer
- SRS rules
- card index generation
- graph derivation
- persistent storage rules
- import/export
- sync conflict logic later

It must not own:

- visual layout
- React state management
- text editor UI
- platform-specific navigation
- platform-specific file pickers
- platform-specific sharing UI

## 6. Data Model

Initial entities:

```text
Workspace
Page
Block
BlockProperty
PageLink
Tag
StudyCard
SrsState
Deck
Topic
ReviewEvent
StudyGraphNode
StudyGraphEdge
Setting
SyncChange
```

Canonical IDs:

- Workspaces: UUID
- Pages: UUID plus normalized name
- Blocks: UUID
- Cards: block UUID
- Review events: UUID

The app should keep block UUIDs stable so import/export and sync can remain predictable.

## 7. SQLite Storage

Initial SQLite tables:

```sql
workspaces
pages
blocks
block_properties
page_links
tags
cards
srs_states
review_events
settings
sync_log
```

Important rule:

The card index is derived from blocks. SRS state and review history are persisted. The graph is derived.

## 8. Desktop App Plan

Desktop should use:

- Tauri
- Rust core directly
- React/TypeScript frontend
- Vite
- SQLite stored in app data directory

Windows target:

- `.msi` or `.exe` installer later
- auto-update later
- local workspace directory support

Linux target:

- AppImage first
- `.deb` later
- Flatpak later only if needed

Desktop MVP screens:

- Workspace picker
- Daily journal
- Page editor
- All pages
- Backlinks panel
- Card dashboard
- Review
- Free practice
- Study Graph
- Settings
- Import/export

## 9. Mobile App Plan

Mobile should use:

- React Native
- Rust core through UniFFI or another native bridge
- SQLite local storage
- shared screen concepts with desktop, but touch-first layout

iPhone target:

- iOS app with local-first database
- iCloud Drive export/import later
- App Store signing later

Android target:

- Android app with local SQLite database
- file import/export through Android document picker
- Play Store signing later

Mobile MVP screens:

- Home
- Today
- Page editor
- Quick capture
- Deck dashboard
- Review
- Free practice
- Study Graph simplified
- Settings

Mobile editor constraints:

- Start with a robust block list editor, not a perfect Logseq clone.
- Support block indentation.
- Support links and tags.
- Add advanced keyboard shortcuts later.

## 10. UI Direction

Visual style should stay close to:

- Logseq dark sidebar
- quiet information-dense layout
- StudyGraph plugin colors
- small-radius panels
- minimal decoration
- strong focus on writing and review

Avoid:

- marketing-style landing pages
- large hero sections
- decorative gradients
- heavy CSS frameworks

Desktop layout:

```text
Left sidebar | Main editor/review/graph | Right context panel
```

Mobile layout:

```text
Top app bar
Main screen
Bottom navigation
Modal review flow
```

## 11. StudyGraph Behavior

StudyGraph should be native to the app, not a plugin view.

Inputs:

- pages
- blocks
- properties
- links
- tags
- SRS state
- review history

Nodes:

- Deck
- Topic
- Card
- Page
- Concept
- Source

Edges:

- Deck -> Topic
- Topic -> Card
- Deck -> Card if no topic
- Card -> Linked Page
- Card -> Tag
- Card -> Source Page

Node metrics:

- total cards
- due cards
- new cards
- weak cards
- reviewed cards
- average ease
- lapse rate
- last reviewed

## 12. SRS Rules

Keep the current StudyGraph scheduler as the first version:

- Again: learning, due in minutes
- Hard: review, interval times hard multiplier
- Good: review, new card gets one day
- Easy: review, new card gets four days

Persist:

- due_at
- interval_days
- ease
- reps
- lapses
- last_reviewed_at
- last_rating
- hard_count

Also persist review events for analytics:

- card_id
- rating
- reviewed_at
- previous state snapshot
- next state snapshot

## 13. Import/Export

Import from:

- Logseq Markdown folder
- single Markdown file
- StudyGraph export JSON later

Export to:

- Logseq-compatible Markdown
- StudyGraph JSON
- CSV for cards/review history later

Import rules:

- Preserve block content.
- Preserve properties.
- Preserve `#card`.
- Preserve `sgd-*`.
- Generate UUIDs if missing.
- Keep source page names.

## 14. Sync Later

Do not build cloud sync first.

Prepare for it by:

- stable IDs
- append-only review events
- sync_log table
- updated_at timestamps
- deleted/tombstone markers
- deterministic conflict rules

Future sync candidates:

- file-based sync via user folder
- WebDAV
- iCloud/Google Drive/Dropbox bridge
- custom server

Conflict rule direction:

- Blocks: last-writer-wins for content, but preserve conflicting copy when unsure
- Review events: append-only, never merge destructively
- SRS state: recompute from review events when possible
- Settings: last-writer-wins

## 15. Implementation Phases

### Phase 0: Planning and Skeleton

- Create native app folder
- Define architecture
- Add Rust core crate
- Add platform folders
- Document platform packaging

### Phase 1: Rust Core MVP

- Model types
- Parser for Markdown blocks
- Property extraction
- Link/tag extraction
- Card scanner
- Scheduler
- Stats
- Study graph builder
- Unit tests

Acceptance:

- Rust tests pass.
- Given Markdown input, Rust returns pages, blocks, cards and graph nodes.

### Phase 2: Storage MVP

- SQLite schema
- workspace creation
- page CRUD
- block CRUD
- property CRUD
- card index rebuild
- review event persistence

Acceptance:

- Can create workspace.
- Can write/read pages and blocks.
- Can review a card and persist SRS.

### Phase 3: Desktop MVP

- Tauri shell
- React UI shell
- sidebar
- page editor
- dashboard
- review
- free practice
- study graph
- settings

Acceptance:

- Windows dev build runs.
- Linux dev build runs.
- Existing example decks import.
- Cards can be reviewed.

### Phase 4: Import/Export

- Import Logseq Markdown folder - implemented for recursive `.md`/`.markdown` folder import
- Import single Markdown file - implemented
- Export workspace as Markdown folder - implemented
- Export StudyGraph JSON

Acceptance:

- Current example decks can be imported and exported without losing card metadata.

### Phase 5: Mobile Prototype

- React Native project
- iPhone screen flow
- Android screen flow
- Rust bridge proof of concept
- local SQLite proof of concept

Acceptance:

- Mobile can open workspace.
- Mobile can show deck dashboard.
- Mobile can review cards.

### Phase 6: Mobile Product MVP

- Touch-first block editor
- quick capture
- offline storage
- import/export
- review notifications later

Acceptance:

- iPhone and Android builds install locally.
- Core behavior matches desktop for cards and SRS.

### Phase 7: Sync Preparation

- sync_log
- change records
- conflict tests
- import/export roundtrip tests

Acceptance:

- Two workspace snapshots can be merged in deterministic tests.

## 16. Testing Strategy

Rust core:

- parser tests
- scheduler tests
- graph tests
- storage tests
- import/export roundtrip tests
- sync merge tests later

Desktop:

- component tests
- Playwright for main flows
- Tauri command integration tests where practical

Mobile:

- unit tests for UI helpers
- Detox or equivalent later for end-to-end flows
- manual simulator/device smoke tests

## 17. First Development Tasks For Codex

1. Implement Rust model types.
2. Port scheduler from TypeScript to Rust.
3. Port normalization and parser from TypeScript to Rust.
4. Port graph builder from TypeScript to Rust.
5. Add Rust unit tests matching current TypeScript tests.
6. Add SQLite schema.
7. Scaffold Tauri desktop shell.
8. Reuse StudyGraph UI style in React desktop.
9. Scaffold React Native mobile app.
10. Add Rust mobile bridge after core API stabilizes.

## 18. Definition Of Done For First Real MVP

The app is considered an MVP when:

- It runs as a desktop app on Windows.
- It runs as a desktop app on Linux.
- It imports a Markdown deck.
- It shows pages and blocks.
- It detects `#card` blocks.
- It shows deck stats.
- It reviews cards with SRS.
- It shows Study Graph.
- It exports Markdown.
- It stores everything locally.

Mobile is considered a second MVP when:

- iPhone local build works.
- Android local build works.
- Deck dashboard works.
- Review works.
- Local database persists.
- Import/export exists in basic form.
