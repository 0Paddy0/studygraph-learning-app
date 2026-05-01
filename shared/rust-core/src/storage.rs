use crate::model::{
    AppBackup, AppSettings, Block, CardState, DocBlock, DocBlockKind, DocPage, Page, Rating,
    ReviewEvent, SrsState, StudyCard, Workspace,
};
use crate::parser::scan_cards_from_pages;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::collections::BTreeMap;
use std::path::Path;
use uuid::Uuid;

pub struct StoragePlan;

impl StoragePlan {
    pub const INITIAL_SQLITE_TABLES: &'static [&'static str] = &[
        "workspaces",
        "pages",
        "blocks",
        "block_properties",
        "page_links",
        "tags",
        "cards",
        "srs_states",
        "review_events",
        "settings",
        "doc_pages",
        "doc_blocks",
        "sync_log",
    ];
}

#[derive(Debug)]
pub enum StorageError {
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    Uuid(uuid::Error),
    Chrono(chrono::ParseError),
}

impl From<rusqlite::Error> for StorageError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<serde_json::Error> for StorageError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<uuid::Error> for StorageError {
    fn from(error: uuid::Error) -> Self {
        Self::Uuid(error)
    }
}

impl From<chrono::ParseError> for StorageError {
    fn from(error: chrono::ParseError) -> Self {
        Self::Chrono(error)
    }
}

pub type StorageResult<T> = Result<T, StorageError>;

pub struct StudyGraphStorage {
    conn: Connection,
}

impl StudyGraphStorage {
    pub fn open(path: impl AsRef<Path>) -> StorageResult<Self> {
        let conn = Connection::open(path)?;
        let storage = Self { conn };
        storage.init_schema()?;
        Ok(storage)
    }

    pub fn in_memory() -> StorageResult<Self> {
        let conn = Connection::open_in_memory()?;
        let storage = Self { conn };
        storage.init_schema()?;
        Ok(storage)
    }

    pub fn init_schema(&self) -> StorageResult<()> {
        self.conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pages (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                name TEXT NOT NULL,
                properties_json TEXT NOT NULL,
                position INTEGER NOT NULL,
                FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS blocks (
                id TEXT PRIMARY KEY,
                page_id TEXT NOT NULL,
                parent_id TEXT,
                content TEXT NOT NULL,
                properties_json TEXT NOT NULL,
                position INTEGER NOT NULL,
                FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE,
                FOREIGN KEY(parent_id) REFERENCES blocks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS block_properties (
                block_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY(block_id, key),
                FOREIGN KEY(block_id) REFERENCES blocks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS page_links (
                source_block_id TEXT NOT NULL,
                target_page TEXT NOT NULL,
                FOREIGN KEY(source_block_id) REFERENCES blocks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS tags (
                block_id TEXT NOT NULL,
                tag TEXT NOT NULL,
                FOREIGN KEY(block_id) REFERENCES blocks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS cards (
                id TEXT PRIMARY KEY,
                block_id TEXT NOT NULL,
                workspace_id TEXT NOT NULL,
                question TEXT NOT NULL,
                answer_markdown TEXT NOT NULL,
                deck TEXT NOT NULL,
                deck_slug TEXT NOT NULL,
                topic TEXT NOT NULL,
                topic_slug TEXT NOT NULL,
                source_page TEXT,
                linked_pages_json TEXT NOT NULL,
                tags_json TEXT NOT NULL,
                raw_content TEXT NOT NULL,
                properties_json TEXT NOT NULL,
                incomplete INTEGER NOT NULL,
                FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS srs_states (
                card_id TEXT PRIMARY KEY,
                state TEXT NOT NULL,
                due_at TEXT,
                interval_days INTEGER NOT NULL,
                ease REAL NOT NULL,
                reps INTEGER NOT NULL,
                lapses INTEGER NOT NULL,
                last_reviewed_at TEXT,
                last_rating TEXT,
                hard_count INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS review_events (
                id TEXT PRIMARY KEY,
                card_id TEXT NOT NULL,
                rating TEXT NOT NULL,
                reviewed_at TEXT NOT NULL,
                previous_srs_json TEXT NOT NULL,
                next_srs_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                workspace_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value_json TEXT NOT NULL,
                PRIMARY KEY(workspace_id, key),
                FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS doc_pages (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                title TEXT NOT NULL,
                icon TEXT NOT NULL,
                position INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS doc_blocks (
                id TEXT PRIMARY KEY,
                doc_page_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                content TEXT NOT NULL,
                checked INTEGER NOT NULL,
                position INTEGER NOT NULL,
                FOREIGN KEY(doc_page_id) REFERENCES doc_pages(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS sync_log (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                operation TEXT NOT NULL,
                changed_at TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            );
            ",
        )?;
        Ok(())
    }

    pub fn save_workspace(&mut self, workspace: &Workspace) -> StorageResult<()> {
        let now = Utc::now().to_rfc3339();
        let tx = self.conn.transaction()?;

        tx.execute(
            "
            INSERT INTO workspaces (id, name, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?3)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                updated_at = excluded.updated_at
            ",
            params![workspace.id.to_string(), workspace.name, now],
        )?;

        tx.execute(
            "DELETE FROM pages WHERE workspace_id = ?1",
            params![workspace.id.to_string()],
        )?;
        tx.execute(
            "DELETE FROM cards WHERE workspace_id = ?1",
            params![workspace.id.to_string()],
        )?;

        for (position, page) in workspace.pages.iter().enumerate() {
            insert_page(&tx, workspace.id, page, position)?;
        }

        let (cards, _) = scan_cards_from_pages(&workspace.pages);
        for card in cards {
            insert_card_index(&tx, workspace.id, &card)?;
            if load_srs_state_tx(&tx, card.id)?.is_none() {
                upsert_srs_state_tx(&tx, card.id, &card.srs)?;
            }
        }

        tx.commit()?;
        Ok(())
    }

    pub fn load_workspace(&self, workspace_id: Uuid) -> StorageResult<Option<Workspace>> {
        let workspace_row = self
            .conn
            .query_row(
                "SELECT name FROM workspaces WHERE id = ?1",
                params![workspace_id.to_string()],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        let Some(name) = workspace_row else {
            return Ok(None);
        };

        let pages = self.load_pages(workspace_id)?;

        Ok(Some(Workspace {
            id: workspace_id,
            name,
            pages,
        }))
    }

    pub fn list_workspaces(&self) -> StorageResult<Vec<(Uuid, String)>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, name
            FROM workspaces
            ORDER BY updated_at DESC, name ASC
            ",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut workspaces = Vec::new();
        for row in rows {
            let (id, name) = row?;
            workspaces.push((Uuid::parse_str(&id)?, name));
        }

        Ok(workspaces)
    }

    pub fn load_pages(&self, workspace_id: Uuid) -> StorageResult<Vec<Page>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, name, properties_json
            FROM pages
            WHERE workspace_id = ?1
            ORDER BY position ASC
            ",
        )?;
        let rows = stmt.query_map(params![workspace_id.to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;

        let mut pages = Vec::new();
        for row in rows {
            let (id, name, properties_json) = row?;
            let page_id = Uuid::parse_str(&id)?;
            let properties = serde_json::from_str::<BTreeMap<String, String>>(&properties_json)?;
            let blocks = self.load_blocks_for_page(page_id)?;
            pages.push(Page {
                id: page_id,
                name,
                properties,
                blocks,
            });
        }

        Ok(pages)
    }

    pub fn load_cards(&self, workspace_id: Uuid) -> StorageResult<Vec<StudyCard>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, block_id, question, answer_markdown, deck, deck_slug, topic,
                   topic_slug, source_page, linked_pages_json, tags_json, raw_content,
                   properties_json, incomplete
            FROM cards
            WHERE workspace_id = ?1
            ORDER BY deck, topic, question
            ",
        )?;
        let rows = stmt.query_map(params![workspace_id.to_string()], |row| {
            Ok(StoredCardRow {
                id: row.get(0)?,
                block_id: row.get(1)?,
                question: row.get(2)?,
                answer_markdown: row.get(3)?,
                deck: row.get(4)?,
                deck_slug: row.get(5)?,
                topic: row.get(6)?,
                topic_slug: row.get(7)?,
                source_page: row.get(8)?,
                linked_pages_json: row.get(9)?,
                tags_json: row.get(10)?,
                raw_content: row.get(11)?,
                properties_json: row.get(12)?,
                incomplete: row.get::<_, i64>(13)? != 0,
            })
        })?;

        let mut cards = Vec::new();
        for row in rows {
            let row = row?;
            let card_id = Uuid::parse_str(&row.id)?;
            let srs = self
                .load_srs_state(card_id)?
                .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)?;
            cards.push(StudyCard {
                id: card_id,
                block_id: Uuid::parse_str(&row.block_id)?,
                question: row.question,
                answer_markdown: row.answer_markdown,
                deck: row.deck,
                deck_slug: row.deck_slug,
                topic: row.topic,
                topic_slug: row.topic_slug,
                source_page: row.source_page,
                linked_pages: serde_json::from_str(&row.linked_pages_json)?,
                tags: serde_json::from_str(&row.tags_json)?,
                raw_content: row.raw_content,
                properties: serde_json::from_str(&row.properties_json)?,
                srs,
                incomplete: row.incomplete,
            });
        }

        Ok(cards)
    }

    pub fn load_srs_state(&self, card_id: Uuid) -> StorageResult<Option<SrsState>> {
        load_srs_state_conn(&self.conn, card_id)
    }

    pub fn upsert_srs_state(&self, card_id: Uuid, srs: &SrsState) -> StorageResult<()> {
        upsert_srs_state_conn(&self.conn, card_id, srs)
    }

    pub fn append_review_event(&self, event: &ReviewEvent) -> StorageResult<()> {
        self.conn.execute(
            "
            INSERT INTO review_events
                (id, card_id, rating, reviewed_at, previous_srs_json, next_srs_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ",
            params![
                event.id.to_string(),
                event.card_id.to_string(),
                rating_to_str(event.rating),
                event.reviewed_at.to_rfc3339(),
                serde_json::to_string(&event.previous_srs)?,
                serde_json::to_string(&event.next_srs)?,
            ],
        )?;
        self.upsert_srs_state(event.card_id, &event.next_srs)?;
        Ok(())
    }

    pub fn load_review_events(&self, card_id: Uuid) -> StorageResult<Vec<ReviewEvent>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, rating, reviewed_at, previous_srs_json, next_srs_json
            FROM review_events
            WHERE card_id = ?1
            ORDER BY reviewed_at ASC
            ",
        )?;
        let rows = stmt.query_map(params![card_id.to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?;

        let mut events = Vec::new();
        for row in rows {
            let (id, rating, reviewed_at, previous_srs_json, next_srs_json) = row?;
            events.push(ReviewEvent {
                id: Uuid::parse_str(&id)?,
                card_id,
                rating: rating_from_str(&rating),
                reviewed_at: parse_datetime(&reviewed_at)?,
                previous_srs: serde_json::from_str(&previous_srs_json)?,
                next_srs: serde_json::from_str(&next_srs_json)?,
            });
        }
        Ok(events)
    }

    pub fn load_app_settings(&self, workspace_id: Uuid) -> StorageResult<AppSettings> {
        let value_json = self
            .conn
            .query_row(
                "
                SELECT value_json
                FROM settings
                WHERE workspace_id = ?1 AND key = 'app-settings'
                ",
                params![workspace_id.to_string()],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        let Some(value_json) = value_json else {
            return Ok(AppSettings::default());
        };

        Ok(serde_json::from_str::<AppSettings>(&value_json)?.normalized())
    }

    pub fn save_app_settings(
        &self,
        workspace_id: Uuid,
        settings: &AppSettings,
    ) -> StorageResult<AppSettings> {
        let normalized = settings.clone().normalized();
        self.conn.execute(
            "
            INSERT INTO settings (workspace_id, key, value_json)
            VALUES (?1, 'app-settings', ?2)
            ON CONFLICT(workspace_id, key) DO UPDATE SET
                value_json = excluded.value_json
            ",
            params![
                workspace_id.to_string(),
                serde_json::to_string(&normalized)?,
            ],
        )?;
        Ok(normalized)
    }

    pub fn export_app_backup(&self, workspace_id: Uuid) -> StorageResult<AppBackup> {
        let workspace = self
            .load_workspace(workspace_id)?
            .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)?;
        let cards = self.load_cards(workspace_id)?;
        let mut review_events = Vec::new();
        for card in &cards {
            review_events.extend(self.load_review_events(card.id)?);
        }

        Ok(AppBackup {
            schema_version: 1,
            exported_at: Utc::now(),
            workspace,
            cards,
            review_events,
            settings: self.load_app_settings(workspace_id)?,
            doc_pages: self.load_doc_pages(workspace_id)?,
        })
    }

    pub fn load_doc_pages(&self, workspace_id: Uuid) -> StorageResult<Vec<DocPage>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, title, icon, created_at, updated_at
            FROM doc_pages
            WHERE workspace_id = ?1
            ORDER BY position ASC, updated_at DESC
            ",
        )?;
        let rows = stmt.query_map(params![workspace_id.to_string()], |row| {
            Ok(StoredDocPageRow {
                id: row.get(0)?,
                title: row.get(1)?,
                icon: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;

        let mut pages = Vec::new();
        for row in rows {
            let row = row?;
            let page_id = Uuid::parse_str(&row.id)?;
            pages.push(DocPage {
                id: page_id,
                workspace_id,
                title: row.title,
                icon: row.icon,
                blocks: self.load_doc_blocks(page_id)?,
                created_at: parse_datetime(&row.created_at)?,
                updated_at: parse_datetime(&row.updated_at)?,
            });
        }

        Ok(pages)
    }

    pub fn ensure_default_doc_page(&mut self, workspace_id: Uuid) -> StorageResult<Vec<DocPage>> {
        let pages = self.load_doc_pages(workspace_id)?;
        if !pages.is_empty() {
            return Ok(pages);
        }

        let now = Utc::now();
        let page = DocPage {
            id: Uuid::new_v4(),
            workspace_id,
            title: "StudyGraph Docs".to_string(),
            icon: "doc".to_string(),
            blocks: vec![
                DocBlock {
                    id: Uuid::new_v4(),
                    kind: DocBlockKind::Heading,
                    content: "Welcome to Doc".to_string(),
                    checked: false,
                    position: 0,
                },
                DocBlock {
                    id: Uuid::new_v4(),
                    kind: DocBlockKind::Paragraph,
                    content: "Use this area for longer documentation, guides, and project notes."
                        .to_string(),
                    checked: false,
                    position: 1,
                },
                DocBlock {
                    id: Uuid::new_v4(),
                    kind: DocBlockKind::Todo,
                    content: "Create your first persistent document page.".to_string(),
                    checked: false,
                    position: 2,
                },
            ],
            created_at: now,
            updated_at: now,
        };
        self.save_doc_page(&page, 0)?;
        self.load_doc_pages(workspace_id)
    }

    pub fn create_doc_page(&mut self, workspace_id: Uuid, title: &str) -> StorageResult<DocPage> {
        let position = self.next_doc_page_position(workspace_id)?;
        let now = Utc::now();
        let page = DocPage {
            id: Uuid::new_v4(),
            workspace_id,
            title: normalize_text(title, "Untitled Doc"),
            icon: "doc".to_string(),
            blocks: vec![DocBlock {
                id: Uuid::new_v4(),
                kind: DocBlockKind::Paragraph,
                content: String::new(),
                checked: false,
                position: 0,
            }],
            created_at: now,
            updated_at: now,
        };
        self.save_doc_page(&page, position)?;
        Ok(page)
    }

    pub fn update_doc_page_title(&self, page_id: Uuid, title: &str) -> StorageResult<()> {
        self.conn.execute(
            "
            UPDATE doc_pages
            SET title = ?1, updated_at = ?2
            WHERE id = ?3
            ",
            params![
                normalize_text(title, "Untitled Doc"),
                Utc::now().to_rfc3339(),
                page_id.to_string(),
            ],
        )?;
        Ok(())
    }

    pub fn delete_doc_page(&mut self, workspace_id: Uuid, page_id: Uuid) -> StorageResult<()> {
        self.conn.execute(
            "DELETE FROM doc_pages WHERE id = ?1 AND workspace_id = ?2",
            params![page_id.to_string(), workspace_id.to_string()],
        )?;
        if self.load_doc_pages(workspace_id)?.is_empty() {
            self.create_doc_page(workspace_id, "StudyGraph Docs")?;
        }
        Ok(())
    }

    pub fn add_doc_block(
        &self,
        page_id: Uuid,
        kind: DocBlockKind,
        content: &str,
    ) -> StorageResult<DocBlock> {
        let position = self.next_doc_block_position(page_id)?;
        let block = DocBlock {
            id: Uuid::new_v4(),
            kind,
            content: content.to_string(),
            checked: false,
            position: position as u32,
        };
        insert_doc_block_conn(&self.conn, page_id, &block)?;
        self.touch_doc_page(page_id)?;
        Ok(block)
    }

    pub fn update_doc_block(
        &self,
        block_id: Uuid,
        kind: DocBlockKind,
        content: &str,
        checked: bool,
    ) -> StorageResult<()> {
        self.conn.execute(
            "
            UPDATE doc_blocks
            SET kind = ?1, content = ?2, checked = ?3
            WHERE id = ?4
            ",
            params![
                doc_block_kind_to_str(kind),
                content,
                i64::from(checked),
                block_id.to_string(),
            ],
        )?;
        if let Some(page_id) = self.doc_page_id_for_block(block_id)? {
            self.touch_doc_page(page_id)?;
        }
        Ok(())
    }

    pub fn delete_doc_block(&self, block_id: Uuid) -> StorageResult<()> {
        let page_id = self.doc_page_id_for_block(block_id)?;
        self.conn.execute(
            "DELETE FROM doc_blocks WHERE id = ?1",
            params![block_id.to_string()],
        )?;
        if let Some(page_id) = page_id {
            self.resequence_doc_blocks(page_id)?;
            self.touch_doc_page(page_id)?;
        }
        Ok(())
    }

    pub fn move_doc_block(&self, block_id: Uuid, direction: i32) -> StorageResult<()> {
        let Some(page_id) = self.doc_page_id_for_block(block_id)? else {
            return Ok(());
        };
        let mut blocks = self.load_doc_blocks(page_id)?;
        let Some(index) = blocks.iter().position(|block| block.id == block_id) else {
            return Ok(());
        };
        let next_index = if direction < 0 {
            index.saturating_sub(1)
        } else {
            (index + 1).min(blocks.len().saturating_sub(1))
        };
        if index == next_index {
            return Ok(());
        }
        blocks.swap(index, next_index);
        for (position, block) in blocks.iter().enumerate() {
            self.conn.execute(
                "UPDATE doc_blocks SET position = ?1 WHERE id = ?2",
                params![position as i64, block.id.to_string()],
            )?;
        }
        self.touch_doc_page(page_id)?;
        Ok(())
    }

    fn load_blocks_for_page(&self, page_id: Uuid) -> StorageResult<Vec<Block>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, parent_id, content, properties_json
            FROM blocks
            WHERE page_id = ?1
            ORDER BY parent_id IS NOT NULL, position ASC
            ",
        )?;
        let rows = stmt.query_map(params![page_id.to_string()], |row| {
            Ok(StoredBlockRow {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                content: row.get(2)?,
                properties_json: row.get(3)?,
            })
        })?;

        let mut flat = Vec::new();
        for row in rows {
            flat.push(row?);
        }

        build_block_tree(&flat, None)
    }

    fn save_doc_page(&self, page: &DocPage, position: i64) -> StorageResult<()> {
        self.conn.execute(
            "
            INSERT INTO doc_pages
                (id, workspace_id, title, icon, position, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                icon = excluded.icon,
                updated_at = excluded.updated_at
            ",
            params![
                page.id.to_string(),
                page.workspace_id.to_string(),
                normalize_text(&page.title, "Untitled Doc"),
                normalize_text(&page.icon, "doc"),
                position,
                page.created_at.to_rfc3339(),
                page.updated_at.to_rfc3339(),
            ],
        )?;
        self.conn.execute(
            "DELETE FROM doc_blocks WHERE doc_page_id = ?1",
            params![page.id.to_string()],
        )?;
        for (position, block) in page.blocks.iter().enumerate() {
            let mut block = block.clone();
            block.position = position as u32;
            insert_doc_block_conn(&self.conn, page.id, &block)?;
        }
        Ok(())
    }

    fn load_doc_blocks(&self, page_id: Uuid) -> StorageResult<Vec<DocBlock>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, kind, content, checked, position
            FROM doc_blocks
            WHERE doc_page_id = ?1
            ORDER BY position ASC
            ",
        )?;
        let rows = stmt.query_map(params![page_id.to_string()], |row| {
            Ok(StoredDocBlockRow {
                id: row.get(0)?,
                kind: row.get(1)?,
                content: row.get(2)?,
                checked: row.get::<_, i64>(3)? != 0,
                position: row.get::<_, i64>(4)?,
            })
        })?;

        let mut blocks = Vec::new();
        for row in rows {
            let row = row?;
            blocks.push(DocBlock {
                id: Uuid::parse_str(&row.id)?,
                kind: doc_block_kind_from_str(&row.kind),
                content: row.content,
                checked: row.checked,
                position: row.position.max(0) as u32,
            });
        }
        Ok(blocks)
    }

    fn next_doc_page_position(&self, workspace_id: Uuid) -> StorageResult<i64> {
        let position = self.conn.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM doc_pages WHERE workspace_id = ?1",
            params![workspace_id.to_string()],
            |row| row.get::<_, i64>(0),
        )?;
        Ok(position)
    }

    fn next_doc_block_position(&self, page_id: Uuid) -> StorageResult<i64> {
        let position = self.conn.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM doc_blocks WHERE doc_page_id = ?1",
            params![page_id.to_string()],
            |row| row.get::<_, i64>(0),
        )?;
        Ok(position)
    }

    fn doc_page_id_for_block(&self, block_id: Uuid) -> StorageResult<Option<Uuid>> {
        let page_id = self
            .conn
            .query_row(
                "SELECT doc_page_id FROM doc_blocks WHERE id = ?1",
                params![block_id.to_string()],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        page_id
            .map(|id| Uuid::parse_str(&id))
            .transpose()
            .map_err(Into::into)
    }

    fn resequence_doc_blocks(&self, page_id: Uuid) -> StorageResult<()> {
        let blocks = self.load_doc_blocks(page_id)?;
        for (position, block) in blocks.iter().enumerate() {
            self.conn.execute(
                "UPDATE doc_blocks SET position = ?1 WHERE id = ?2",
                params![position as i64, block.id.to_string()],
            )?;
        }
        Ok(())
    }

    fn touch_doc_page(&self, page_id: Uuid) -> StorageResult<()> {
        self.conn.execute(
            "UPDATE doc_pages SET updated_at = ?1 WHERE id = ?2",
            params![Utc::now().to_rfc3339(), page_id.to_string()],
        )?;
        Ok(())
    }
}

fn insert_page(
    tx: &Transaction<'_>,
    workspace_id: Uuid,
    page: &Page,
    position: usize,
) -> StorageResult<()> {
    tx.execute(
        "
        INSERT INTO pages (id, workspace_id, name, properties_json, position)
        VALUES (?1, ?2, ?3, ?4, ?5)
        ",
        params![
            page.id.to_string(),
            workspace_id.to_string(),
            page.name,
            serde_json::to_string(&page.properties)?,
            position as i64,
        ],
    )?;

    for (block_position, block) in page.blocks.iter().enumerate() {
        insert_block(tx, page.id, None, block, block_position)?;
    }

    Ok(())
}

fn insert_block(
    tx: &Transaction<'_>,
    page_id: Uuid,
    parent_id: Option<Uuid>,
    block: &Block,
    position: usize,
) -> StorageResult<()> {
    tx.execute(
        "
        INSERT INTO blocks (id, page_id, parent_id, content, properties_json, position)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ",
        params![
            block.id.to_string(),
            page_id.to_string(),
            parent_id.map(|id| id.to_string()),
            block.content,
            serde_json::to_string(&block.properties)?,
            position as i64,
        ],
    )?;

    for (key, value) in &block.properties {
        tx.execute(
            "
            INSERT INTO block_properties (block_id, key, value)
            VALUES (?1, ?2, ?3)
            ",
            params![block.id.to_string(), key, value],
        )?;
    }

    for (child_position, child) in block.children.iter().enumerate() {
        insert_block(tx, page_id, Some(block.id), child, child_position)?;
    }

    Ok(())
}

fn insert_card_index(
    tx: &Transaction<'_>,
    workspace_id: Uuid,
    card: &StudyCard,
) -> StorageResult<()> {
    tx.execute(
        "
        INSERT INTO cards
            (id, block_id, workspace_id, question, answer_markdown, deck, deck_slug,
             topic, topic_slug, source_page, linked_pages_json, tags_json, raw_content,
             properties_json, incomplete)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
        ",
        params![
            card.id.to_string(),
            card.block_id.to_string(),
            workspace_id.to_string(),
            card.question,
            card.answer_markdown,
            card.deck,
            card.deck_slug,
            card.topic,
            card.topic_slug,
            card.source_page,
            serde_json::to_string(&card.linked_pages)?,
            serde_json::to_string(&card.tags)?,
            card.raw_content,
            serde_json::to_string(&card.properties)?,
            i64::from(card.incomplete),
        ],
    )?;
    Ok(())
}

fn upsert_srs_state_conn(conn: &Connection, card_id: Uuid, srs: &SrsState) -> StorageResult<()> {
    conn.execute(
        "
        INSERT INTO srs_states
            (card_id, state, due_at, interval_days, ease, reps, lapses,
             last_reviewed_at, last_rating, hard_count, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(card_id) DO UPDATE SET
            state = excluded.state,
            due_at = excluded.due_at,
            interval_days = excluded.interval_days,
            ease = excluded.ease,
            reps = excluded.reps,
            lapses = excluded.lapses,
            last_reviewed_at = excluded.last_reviewed_at,
            last_rating = excluded.last_rating,
            hard_count = excluded.hard_count,
            created_at = excluded.created_at
        ",
        params![
            card_id.to_string(),
            card_state_to_str(srs.state),
            srs.due_at.map(|value| value.to_rfc3339()),
            srs.interval_days as i64,
            srs.ease as f64,
            srs.reps as i64,
            srs.lapses as i64,
            srs.last_reviewed_at.map(|value| value.to_rfc3339()),
            srs.last_rating.map(rating_to_str),
            srs.hard_count as i64,
            srs.created_at.to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn upsert_srs_state_tx(tx: &Transaction<'_>, card_id: Uuid, srs: &SrsState) -> StorageResult<()> {
    tx.execute(
        "
        INSERT INTO srs_states
            (card_id, state, due_at, interval_days, ease, reps, lapses,
             last_reviewed_at, last_rating, hard_count, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(card_id) DO UPDATE SET
            state = excluded.state,
            due_at = excluded.due_at,
            interval_days = excluded.interval_days,
            ease = excluded.ease,
            reps = excluded.reps,
            lapses = excluded.lapses,
            last_reviewed_at = excluded.last_reviewed_at,
            last_rating = excluded.last_rating,
            hard_count = excluded.hard_count,
            created_at = excluded.created_at
        ",
        params![
            card_id.to_string(),
            card_state_to_str(srs.state),
            srs.due_at.map(|value| value.to_rfc3339()),
            srs.interval_days as i64,
            srs.ease as f64,
            srs.reps as i64,
            srs.lapses as i64,
            srs.last_reviewed_at.map(|value| value.to_rfc3339()),
            srs.last_rating.map(rating_to_str),
            srs.hard_count as i64,
            srs.created_at.to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn load_srs_state_conn(conn: &Connection, card_id: Uuid) -> StorageResult<Option<SrsState>> {
    let row = conn
        .query_row(
            "
            SELECT state, due_at, interval_days, ease, reps, lapses,
                   last_reviewed_at, last_rating, hard_count, created_at
            FROM srs_states
            WHERE card_id = ?1
            ",
            params![card_id.to_string()],
            |row| {
                Ok(StoredSrsRow {
                    state: row.get(0)?,
                    due_at: row.get(1)?,
                    interval_days: row.get::<_, i64>(2)?,
                    ease: row.get::<_, f64>(3)?,
                    reps: row.get::<_, i64>(4)?,
                    lapses: row.get::<_, i64>(5)?,
                    last_reviewed_at: row.get(6)?,
                    last_rating: row.get(7)?,
                    hard_count: row.get::<_, i64>(8)?,
                    created_at: row.get(9)?,
                })
            },
        )
        .optional()?;

    row.map(srs_from_row).transpose()
}

fn load_srs_state_tx(tx: &Transaction<'_>, card_id: Uuid) -> StorageResult<Option<SrsState>> {
    let row = tx
        .query_row(
            "
            SELECT state, due_at, interval_days, ease, reps, lapses,
                   last_reviewed_at, last_rating, hard_count, created_at
            FROM srs_states
            WHERE card_id = ?1
            ",
            params![card_id.to_string()],
            |row| {
                Ok(StoredSrsRow {
                    state: row.get(0)?,
                    due_at: row.get(1)?,
                    interval_days: row.get::<_, i64>(2)?,
                    ease: row.get::<_, f64>(3)?,
                    reps: row.get::<_, i64>(4)?,
                    lapses: row.get::<_, i64>(5)?,
                    last_reviewed_at: row.get(6)?,
                    last_rating: row.get(7)?,
                    hard_count: row.get::<_, i64>(8)?,
                    created_at: row.get(9)?,
                })
            },
        )
        .optional()?;

    row.map(srs_from_row).transpose()
}

fn srs_from_row(row: StoredSrsRow) -> StorageResult<SrsState> {
    Ok(SrsState {
        state: card_state_from_str(&row.state),
        due_at: row.due_at.as_deref().map(parse_datetime).transpose()?,
        interval_days: row.interval_days as u32,
        ease: row.ease as f32,
        reps: row.reps as u32,
        lapses: row.lapses as u32,
        last_reviewed_at: row
            .last_reviewed_at
            .as_deref()
            .map(parse_datetime)
            .transpose()?,
        last_rating: row.last_rating.as_deref().map(rating_from_str),
        hard_count: row.hard_count as u32,
        created_at: parse_datetime(&row.created_at)?,
    })
}

fn build_block_tree(flat: &[StoredBlockRow], parent_id: Option<&str>) -> StorageResult<Vec<Block>> {
    let mut blocks = Vec::new();
    for row in flat
        .iter()
        .filter(|row| row.parent_id.as_deref() == parent_id)
    {
        blocks.push(Block {
            id: Uuid::parse_str(&row.id)?,
            content: row.content.clone(),
            properties: serde_json::from_str(&row.properties_json)?,
            children: build_block_tree(flat, Some(row.id.as_str()))?,
        });
    }
    Ok(blocks)
}

fn insert_doc_block_conn(conn: &Connection, page_id: Uuid, block: &DocBlock) -> StorageResult<()> {
    conn.execute(
        "
        INSERT INTO doc_blocks (id, doc_page_id, kind, content, checked, position)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ",
        params![
            block.id.to_string(),
            page_id.to_string(),
            doc_block_kind_to_str(block.kind),
            block.content,
            i64::from(block.checked),
            block.position as i64,
        ],
    )?;
    Ok(())
}

fn doc_block_kind_to_str(kind: DocBlockKind) -> &'static str {
    match kind {
        DocBlockKind::Heading => "heading",
        DocBlockKind::Paragraph => "paragraph",
        DocBlockKind::Todo => "todo",
        DocBlockKind::Quote => "quote",
    }
}

fn doc_block_kind_from_str(value: &str) -> DocBlockKind {
    match value {
        "heading" => DocBlockKind::Heading,
        "todo" => DocBlockKind::Todo,
        "quote" => DocBlockKind::Quote,
        _ => DocBlockKind::Paragraph,
    }
}

fn normalize_text(value: &str, fallback: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized
    }
}

fn parse_datetime(value: &str) -> Result<DateTime<Utc>, chrono::ParseError> {
    DateTime::parse_from_rfc3339(value).map(|datetime| datetime.with_timezone(&Utc))
}

fn card_state_to_str(state: CardState) -> &'static str {
    match state {
        CardState::New => "new",
        CardState::Learning => "learning",
        CardState::Review => "review",
    }
}

fn card_state_from_str(value: &str) -> CardState {
    match value {
        "learning" => CardState::Learning,
        "review" => CardState::Review,
        _ => CardState::New,
    }
}

fn rating_to_str(rating: Rating) -> &'static str {
    match rating {
        Rating::Again => "again",
        Rating::Hard => "hard",
        Rating::Good => "good",
        Rating::Easy => "easy",
    }
}

fn rating_from_str(value: &str) -> Rating {
    match value {
        "again" => Rating::Again,
        "hard" => Rating::Hard,
        "easy" => Rating::Easy,
        _ => Rating::Good,
    }
}

struct StoredCardRow {
    id: String,
    block_id: String,
    question: String,
    answer_markdown: String,
    deck: String,
    deck_slug: String,
    topic: String,
    topic_slug: String,
    source_page: Option<String>,
    linked_pages_json: String,
    tags_json: String,
    raw_content: String,
    properties_json: String,
    incomplete: bool,
}

struct StoredBlockRow {
    id: String,
    parent_id: Option<String>,
    content: String,
    properties_json: String,
}

struct StoredDocPageRow {
    id: String,
    title: String,
    icon: String,
    created_at: String,
    updated_at: String,
}

struct StoredDocBlockRow {
    id: String,
    kind: String,
    content: String,
    checked: bool,
    position: i64,
}

struct StoredSrsRow {
    state: String,
    due_at: Option<String>,
    interval_days: i64,
    ease: f64,
    reps: i64,
    lapses: i64,
    last_reviewed_at: Option<String>,
    last_rating: Option<String>,
    hard_count: i64,
    created_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import_export::import_single_markdown_page;
    use crate::scheduler::{schedule_review, SchedulerSettings};
    use chrono::TimeZone;
    use pretty_assertions::assert_eq;

    #[test]
    fn saves_and_loads_workspace_with_page_tree() {
        let page = import_single_markdown_page(
            "Programming",
            "# Programming\nsgd-deck:: Programming\n- What is Rust? #card\n  sgd-topic:: Rust\n  - A language.",
        );
        let workspace = Workspace {
            id: Uuid::new_v4(),
            name: "Test Workspace".to_string(),
            pages: vec![page],
        };
        let mut storage = StudyGraphStorage::in_memory().unwrap();

        storage.save_workspace(&workspace).unwrap();
        let loaded = storage.load_workspace(workspace.id).unwrap().unwrap();

        assert_eq!(loaded.name, "Test Workspace");
        assert_eq!(loaded.pages.len(), 1);
        assert_eq!(loaded.pages[0].name, "Programming");
        assert_eq!(loaded.pages[0].blocks[0].children[0].content, "A language.");
    }

    #[test]
    fn reindexes_cards_when_saving_workspace() {
        let page = import_single_markdown_page(
            "Programming",
            "- What is a union type? #card\n  sgd-deck:: Programming\n  sgd-topic:: TypeScript\n  - A type with alternatives.",
        );
        let workspace = Workspace {
            id: Uuid::new_v4(),
            name: "Cards".to_string(),
            pages: vec![page],
        };
        let mut storage = StudyGraphStorage::in_memory().unwrap();

        storage.save_workspace(&workspace).unwrap();
        let cards = storage.load_cards(workspace.id).unwrap();

        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].deck, "Programming");
        assert_eq!(cards[0].topic, "TypeScript");
        assert_eq!(cards[0].srs.reps, 0);
    }

    #[test]
    fn appends_review_event_and_updates_srs() {
        let page = import_single_markdown_page(
            "Programming",
            "- What is Rust? #card\n  sgd-deck:: Programming\n  sgd-topic:: Rust\n  - A language.",
        );
        let workspace = Workspace {
            id: Uuid::new_v4(),
            name: "Reviews".to_string(),
            pages: vec![page],
        };
        let mut storage = StudyGraphStorage::in_memory().unwrap();
        storage.save_workspace(&workspace).unwrap();
        let card = storage.load_cards(workspace.id).unwrap().remove(0);
        let now = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();
        let next = schedule_review(&card.srs, Rating::Good, now, SchedulerSettings::default());
        let event = ReviewEvent {
            id: Uuid::new_v4(),
            card_id: card.id,
            rating: Rating::Good,
            reviewed_at: now,
            previous_srs: card.srs,
            next_srs: next.clone(),
        };

        storage.append_review_event(&event).unwrap();
        let loaded_srs = storage.load_srs_state(card.id).unwrap().unwrap();
        let events = storage.load_review_events(card.id).unwrap();

        assert_eq!(loaded_srs.reps, 1);
        assert_eq!(loaded_srs.due_at, next.due_at);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].rating, Rating::Good);
    }

    #[test]
    fn review_events_survive_card_reindex() {
        let page = import_single_markdown_page(
            "Programming",
            "- What is Rust? #card\n  sgd-deck:: Programming\n  sgd-topic:: Rust\n  - A language.",
        );
        let workspace = Workspace {
            id: Uuid::new_v4(),
            name: "Reindex".to_string(),
            pages: vec![page],
        };
        let mut storage = StudyGraphStorage::in_memory().unwrap();
        storage.save_workspace(&workspace).unwrap();
        let card = storage.load_cards(workspace.id).unwrap().remove(0);
        let now = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();
        let next = schedule_review(&card.srs, Rating::Good, now, SchedulerSettings::default());
        let event = ReviewEvent {
            id: Uuid::new_v4(),
            card_id: card.id,
            rating: Rating::Good,
            reviewed_at: now,
            previous_srs: card.srs,
            next_srs: next,
        };

        storage.append_review_event(&event).unwrap();
        storage.save_workspace(&workspace).unwrap();

        let cards = storage.load_cards(workspace.id).unwrap();
        let events = storage.load_review_events(cards[0].id).unwrap();

        assert_eq!(events.len(), 1);
        assert_eq!(cards[0].srs.reps, 1);
    }

    #[test]
    fn saves_and_loads_app_settings() {
        let workspace = Workspace {
            id: Uuid::new_v4(),
            name: "Settings".to_string(),
            pages: Vec::new(),
        };
        let mut storage = StudyGraphStorage::in_memory().unwrap();
        storage.save_workspace(&workspace).unwrap();
        let settings = AppSettings {
            default_deck: "  Trading Basics  ".to_string(),
            default_topic: " Risk Management ".to_string(),
            new_cards_per_day: 900,
            reviews_per_day: 5000,
            api_provider_enabled: true,
            api_base_url: " https://example.test/api ".to_string(),
            api_model: " study-model ".to_string(),
            debug_mode: true,
        };

        let saved = storage.save_app_settings(workspace.id, &settings).unwrap();
        let loaded = storage.load_app_settings(workspace.id).unwrap();

        assert_eq!(saved.default_deck, "Trading Basics");
        assert_eq!(loaded.default_topic, "Risk Management");
        assert_eq!(loaded.new_cards_per_day, 500);
        assert_eq!(loaded.reviews_per_day, 2000);
        assert_eq!(loaded.api_base_url, "https://example.test/api");
        assert!(loaded.api_provider_enabled);
        assert!(loaded.debug_mode);
    }

    #[test]
    fn exports_complete_app_backup() {
        let page = import_single_markdown_page(
            "CPU",
            "- What does the ALU do? #card\n  sgd-deck:: CPU\n  sgd-topic:: Execution Units\n  - It performs arithmetic and logical operations.",
        );
        let workspace = Workspace {
            id: Uuid::new_v4(),
            name: "Backup".to_string(),
            pages: vec![page],
        };
        let mut storage = StudyGraphStorage::in_memory().unwrap();
        storage.save_workspace(&workspace).unwrap();
        storage
            .save_app_settings(
                workspace.id,
                &AppSettings {
                    default_deck: "CPU".to_string(),
                    default_topic: "Execution Units".to_string(),
                    ..AppSettings::default()
                },
            )
            .unwrap();
        storage.create_doc_page(workspace.id, "CPU Docs").unwrap();

        let card = storage.load_cards(workspace.id).unwrap().remove(0);
        let now = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();
        let next = schedule_review(&card.srs, Rating::Easy, now, SchedulerSettings::default());
        storage
            .append_review_event(&ReviewEvent {
                id: Uuid::new_v4(),
                card_id: card.id,
                rating: Rating::Easy,
                reviewed_at: now,
                previous_srs: card.srs,
                next_srs: next,
            })
            .unwrap();

        let backup = storage.export_app_backup(workspace.id).unwrap();

        assert_eq!(backup.schema_version, 1);
        assert_eq!(backup.workspace.name, "Backup");
        assert_eq!(backup.cards.len(), 1);
        assert_eq!(backup.review_events.len(), 1);
        assert_eq!(backup.settings.default_deck, "CPU");
        assert_eq!(backup.doc_pages.len(), 1);
        assert_eq!(backup.doc_pages[0].title, "CPU Docs");
    }

    #[test]
    fn persists_doc_pages_and_blocks() {
        let workspace = Workspace {
            id: Uuid::new_v4(),
            name: "Docs".to_string(),
            pages: Vec::new(),
        };
        let mut storage = StudyGraphStorage::in_memory().unwrap();
        storage.save_workspace(&workspace).unwrap();

        let page = storage
            .create_doc_page(workspace.id, "  CPU Notes  ")
            .unwrap();
        storage
            .update_doc_page_title(page.id, "CPU Architecture")
            .unwrap();
        storage.delete_doc_block(page.blocks[0].id).unwrap();
        let heading = storage
            .add_doc_block(page.id, DocBlockKind::Heading, "Pipeline")
            .unwrap();
        let todo = storage
            .add_doc_block(page.id, DocBlockKind::Todo, "Review cache coherency")
            .unwrap();
        storage
            .update_doc_block(todo.id, DocBlockKind::Todo, "Review MESI", true)
            .unwrap();
        storage.move_doc_block(todo.id, -1).unwrap();
        storage.delete_doc_block(heading.id).unwrap();

        let pages = storage.load_doc_pages(workspace.id).unwrap();

        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].title, "CPU Architecture");
        assert_eq!(pages[0].blocks.len(), 1);
        assert_eq!(pages[0].blocks[0].content, "Review MESI");
        assert!(pages[0].blocks[0].checked);
    }
}
