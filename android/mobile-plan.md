# Android Mobile Plan

## UI

- Bottom navigation:
  - Today
  - Pages
  - Decks
  - Study Graph
  - Settings

## MVP Screens

- Home
- Quick capture
- Page reader/editor
- Deck dashboard
- Review session
- Free practice
- Study Graph simplified
- Settings

## Rust Bridge

Use UniFFI or equivalent bridge after the Rust API stabilizes.

Bridge functions:

- create_workspace
- import_markdown
- list_pages
- get_page_tree
- scan_cards
- schedule_review
- build_study_graph
- export_markdown

## Android Concerns

- File import/export through Android document picker.
- Background review notifications later.
- Play Store signing later.
- Handle low-memory lifecycle cleanly.
