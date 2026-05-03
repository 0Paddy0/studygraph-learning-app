use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

pub type CardId = Uuid;
pub type BlockId = Uuid;
pub type PageId = Uuid;
pub type WorkspaceId = Uuid;
pub type DocPageId = Uuid;
pub type DocBlockId = Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Workspace {
    pub id: WorkspaceId,
    pub name: String,
    pub pages: Vec<Page>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Page {
    pub id: PageId,
    pub name: String,
    pub properties: BTreeMap<String, String>,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Block {
    pub id: BlockId,
    pub content: String,
    pub properties: BTreeMap<String, String>,
    pub children: Vec<Block>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CardState {
    New,
    Learning,
    Review,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Rating {
    Again,
    Hard,
    Good,
    Easy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SrsState {
    pub state: CardState,
    pub due_at: Option<DateTime<Utc>>,
    pub interval_days: u32,
    pub ease: f32,
    pub reps: u32,
    pub lapses: u32,
    pub last_reviewed_at: Option<DateTime<Utc>>,
    pub last_rating: Option<Rating>,
    pub hard_count: u32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StudyCard {
    pub id: CardId,
    pub block_id: BlockId,
    pub question: String,
    pub answer_markdown: String,
    pub deck: String,
    pub deck_slug: String,
    pub topic: String,
    pub topic_slug: String,
    pub source_page: Option<String>,
    pub linked_pages: Vec<String>,
    pub tags: Vec<String>,
    pub raw_content: String,
    pub properties: BTreeMap<String, String>,
    pub srs: SrsState,
    pub incomplete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewEvent {
    pub id: Uuid,
    pub card_id: CardId,
    pub rating: Rating,
    pub reviewed_at: DateTime<Utc>,
    #[serde(default)]
    pub response_time_ms: Option<u32>,
    pub previous_srs: SrsState,
    pub next_srs: SrsState,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ReviewSessionKind {
    Review,
    Practice,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSession {
    pub id: Uuid,
    pub workspace_id: WorkspaceId,
    pub kind: ReviewSessionKind,
    pub scope_label: String,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub items: Vec<ReviewSessionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSessionItem {
    pub id: Uuid,
    pub session_id: Uuid,
    pub card_id: CardId,
    pub question: String,
    pub rating: Rating,
    #[serde(default)]
    pub response_time_ms: Option<u32>,
    #[serde(default)]
    pub cloze_result: Option<ClozeSessionResult>,
    pub answered_at: DateTime<Utc>,
    pub position: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClozeSessionResult {
    pub blanks: Vec<ClozeBlankResult>,
    pub suggested_rating: Rating,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClozeBlankResult {
    pub expected: String,
    pub input: String,
    pub correct: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppBackup {
    pub schema_version: u32,
    pub exported_at: DateTime<Utc>,
    pub workspace: Workspace,
    pub cards: Vec<StudyCard>,
    pub review_events: Vec<ReviewEvent>,
    #[serde(default)]
    pub review_sessions: Vec<ReviewSession>,
    pub settings: AppSettings,
    pub doc_pages: Vec<DocPage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocPage {
    pub id: DocPageId,
    pub workspace_id: WorkspaceId,
    pub title: String,
    pub icon: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub source: String,
    #[serde(default = "default_doc_language")]
    pub language: String,
    pub blocks: Vec<DocBlock>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn default_doc_language() -> String {
    "auto".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocBlock {
    pub id: DocBlockId,
    pub kind: DocBlockKind,
    pub content: String,
    pub checked: bool,
    pub position: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DocBlockKind {
    Heading,
    Paragraph,
    Todo,
    Quote,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub default_deck: String,
    pub default_topic: String,
    pub new_cards_per_day: u32,
    pub reviews_per_day: u32,
    pub api_provider_enabled: bool,
    pub api_base_url: String,
    pub api_model: String,
    pub open_ai_connection_mode: String,
    pub open_ai_account_email: String,
    pub open_ai_account_status: String,
    pub open_ai_api_key_configured: bool,
    pub open_ai_api_key_last_four: String,
    pub debug_mode: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            default_deck: "Generated".to_string(),
            default_topic: "General".to_string(),
            new_cards_per_day: 20,
            reviews_per_day: 120,
            api_provider_enabled: false,
            api_base_url: String::new(),
            api_model: String::new(),
            open_ai_connection_mode: "none".to_string(),
            open_ai_account_email: String::new(),
            open_ai_account_status: "not-connected".to_string(),
            open_ai_api_key_configured: false,
            open_ai_api_key_last_four: String::new(),
            debug_mode: false,
        }
    }
}

impl AppSettings {
    pub fn normalized(mut self) -> Self {
        self.default_deck = normalize_inline(&self.default_deck, "Generated");
        self.default_topic = normalize_inline(&self.default_topic, "General");
        self.new_cards_per_day = self.new_cards_per_day.min(500);
        self.reviews_per_day = self.reviews_per_day.min(2000);
        self.api_base_url = self.api_base_url.trim().to_string();
        self.api_model = self.api_model.trim().to_string();
        self.open_ai_connection_mode = match self.open_ai_connection_mode.trim() {
            "account" => "account".to_string(),
            "apiKey" | "api_key" | "api-key" => "apiKey".to_string(),
            _ => "none".to_string(),
        };
        self.open_ai_account_email = self.open_ai_account_email.trim().to_string();
        self.open_ai_account_status =
            normalize_inline(&self.open_ai_account_status, "not-connected");
        self.open_ai_api_key_last_four = self
            .open_ai_api_key_last_four
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .collect::<String>()
            .chars()
            .rev()
            .take(4)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        if self.open_ai_api_key_last_four.is_empty() {
            self.open_ai_api_key_configured = false;
        }
        self
    }
}

fn normalize_inline(value: &str, fallback: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized
    }
}
