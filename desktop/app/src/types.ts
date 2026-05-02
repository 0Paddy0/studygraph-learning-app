export type Rating = "again" | "hard" | "good" | "easy";
export type GeneratorLanguage = "auto" | "de" | "en";
export type GeneratorDifficulty = "easy" | "medium" | "hard";
export type GeneratorStyle = "basic" | "cloze" | "mixed";

export interface CardGeneratorInput {
  deck: string;
  topic: string;
  source_text: string;
  language: GeneratorLanguage;
  number_of_cards: number;
  difficulty: GeneratorDifficulty;
  card_style: GeneratorStyle;
  bidirectional_cards: boolean;
  vocabulary_mode: boolean;
  vocabulary_deck: string;
}

export interface GeneratedCard {
  question: string;
  answer: string;
  deck: string;
  topic: string;
  tags: string[];
  source_summary?: string;
}

export interface AppSettings {
  defaultDeck: string;
  defaultTopic: string;
  newCardsPerDay: number;
  reviewsPerDay: number;
  apiProviderEnabled: boolean;
  apiBaseUrl: string;
  apiModel: string;
  openAiConnectionMode: "none" | "account" | "apiKey";
  openAiAccountEmail: string;
  openAiAccountStatus: string;
  openAiApiKeyConfigured: boolean;
  openAiApiKeyLastFour: string;
  debugMode: boolean;
}

export type DocBlockKind = "heading" | "paragraph" | "todo" | "quote";

export interface DocBlock {
  id: string;
  kind: DocBlockKind;
  content: string;
  checked: boolean;
  position: number;
}

export interface DocPage {
  id: string;
  workspaceId: string;
  title: string;
  icon: string;
  blocks: DocBlock[];
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  pages: Page[];
}

export interface Page {
  id: string;
  name: string;
  properties: Record<string, string>;
  blocks: Block[];
}

export interface Block {
  id: string;
  content: string;
  properties: Record<string, string>;
  children: Block[];
}

export interface SrsState {
  state: "new" | "learning" | "review";
  due_at?: string | null;
  interval_days: number;
  ease: number;
  reps: number;
  lapses: number;
  last_reviewed_at?: string | null;
  last_rating?: Rating | null;
  hard_count: number;
  created_at: string;
}

export interface StudyCard {
  id: string;
  block_id: string;
  question: string;
  answer_markdown: string;
  deck: string;
  deck_slug: string;
  topic: string;
  topic_slug: string;
  source_page?: string | null;
  linked_pages: string[];
  tags: string[];
  raw_content: string;
  properties: Record<string, string>;
  srs: SrsState;
  incomplete: boolean;
}

export interface ReviewEvent {
  id: string;
  card_id: string;
  rating: Rating;
  reviewed_at: string;
  previous_srs: SrsState;
  next_srs: SrsState;
}

export interface AppBackup {
  schemaVersion: number;
  exportedAt: string;
  workspace: Workspace;
  cards: StudyCard[];
  reviewEvents: ReviewEvent[];
  settings: AppSettings;
  docPages: DocPage[];
}

export interface StudyGraphNode {
  id: string;
  kind: "deck" | "topic" | "card" | "concept" | "source";
  label: string;
  total_cards: number;
  due_cards: number;
  weak_cards: number;
}

export interface StudyGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "contains" | "references" | "source" | "related";
}

export interface StudyGraphData {
  nodes: StudyGraphNode[];
  edges: StudyGraphEdge[];
}

export interface BacklinkReference {
  target_page: string;
  source_page_id: string;
  source_page: string;
  block_id: string;
  block_content: string;
  block_path: string[];
}

export interface DesktopSnapshot {
  workspace: Workspace;
  cards: StudyCard[];
  graph: StudyGraphData;
  backlinks: BacklinkReference[];
}

export interface AppDebugInfo {
  app_data_dir: string;
  database_path: string;
  workspace_id?: string | null;
}

export interface ExportedPage {
  name: string;
  markdown: string;
}

export interface WorkspaceExport {
  pages: ExportedPage[];
}

export interface FolderExportResult {
  folder_path: string;
  files: string[];
}

export interface BackupExportResult {
  file_path: string;
  backup: AppBackup;
}

export interface BackupRestoreResult {
  file_path: string;
  snapshot: DesktopSnapshot;
}

export interface FolderImportResult {
  folder_path: string;
  imported_files: string[];
  snapshot: DesktopSnapshot;
}
