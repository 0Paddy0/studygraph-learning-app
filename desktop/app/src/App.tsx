import { useEffect, useMemo, useRef, useState } from "react";
import {
  addChildBlock,
  addDocBlock,
  addRootBlock,
  addSiblingBlock,
  createDocPage,
  createPage,
  deleteBlock,
  deleteDocBlock,
  deleteDocPage,
  exportAppBackup,
  exportAppBackupToFolder,
  exportWorkspaceMarkdownToFolder,
  exportWorkspaceMarkdown,
  getAppDebugInfo,
  importMarkdownFile,
  importMarkdownFolder,
  importMarkdownPage,
  indentBlock,
  insertDocCard,
  insertGeneratedCards,
  loadDocPages,
  loadAppSettings as loadStoredAppSettings,
  loadReviewSessions,
  loadSnapshot,
  moveDocBlock,
  outdentBlock,
  pickBackupFile,
  pickExportFolder,
  pickMarkdownFile,
  pickMarkdownFolder,
  renamePage,
  restoreAppBackupFromFile,
  removeBlockProperty,
  removePageProperty,
  reviewCard,
  saveAppSettings as saveStoredAppSettings,
  saveReviewSession,
  setPageProperty,
  setBlockProperty,
  updateDocBlock,
  updateDocPageMetadata,
  updateDocPageTitle,
  updateBlockContent,
} from "./api";
import {
  aiQualitySummary,
  createConfiguredAiProvider,
  runLocalAiClozeGeneration,
} from "./aiPipeline";
import {
  applyGraphCardFilters,
  backlinksForPage,
  buildBlockLocations,
  buildPracticeQueue,
  buildReviewQueue,
  buildSearchResults,
  buildTodoItems,
  cardsForGraphNode,
  clampNumber,
  clampZoom,
  clozeAnswerMatches,
  clozeEvaluationToResult,
  countBlocks,
  countDocBlockKinds,
  dueLabel,
  evaluateClozeAnswers,
  escapeRegExp,
  extractPageLinks,
  filterGraphForView,
  filterPages,
  filterTodoItems,
  findLastChildId,
  flattenBlocks,
  findNextSiblingId,
  groupBacklinksBySource,
  groupCardsByDeck,
  graphNodeSignalClasses,
  isDue,
  isNewCard,
  isOverdue,
  isSystemGraphNode,
  isWeak,
  layoutGraph,
  normalizePageRef,
  normalizePageTitle,
  normalizeSlug,
  nodeRadius,
  pageNameFromFilePath,
  ratingLabel,
  shorten,
  singleLine,
  stripPageLinks,
  stripTodoPrefix,
  summarizeCards,
  summarizeTodoMetrics,
  titleForScreen,
  todoItemSubtitle,
  todoItemTitle,
  todoLearnButtonLabel,
  todoLearningTarget,
  todoTargetLabel,
} from "./studyLogic";
import type {
  AppBackup,
  AppDebugInfo,
  AiQualityIssue,
  AppSettings,
  BacklinkReference,
  Block,
  CardGeneratorInput,
  ClozeSessionResult,
  DesktopSnapshot,
  DocBlock,
  DocBlockKind,
  DocPage,
  GeneratedCard,
  Page,
  Rating,
  ReviewSession,
  ReviewSessionKind,
  StudyCard,
  StudyGraphEdge,
  StudyGraphNode,
  WorkspaceExport,
} from "./types";

type Screen = "notes" | "doc" | "todo" | "dashboard" | "review" | "practice" | "graph" | "generate" | "settings" | "import" | "export";
type PracticeMode = "all" | "deck" | "weak" | "new" | "graph";
type GraphStatusFilter = "all" | "due" | "overdue" | "weak" | "new";
type StudyMode = "classic" | "cloze";
type MaybePromise<T = void> = T | Promise<T>;
type TodoStatus = "open" | "doing" | "done";

interface DocDeckOptions {
  bidirectional: boolean;
  vocabulary: boolean;
  vocabularyDeck: string;
}

type SearchResultType = "page" | "block" | "card" | "command";

interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string;
  pageId?: string;
  blockId?: string;
  action?: "notes" | "doc" | "todo" | "dashboard" | "review" | "practice" | "graph" | "generate" | "settings" | "import" | "export" | "refresh";
  haystack: string;
}

type TodoTargetKind = "block" | "deck" | "topic";

interface TodoQueueMetrics {
  totalCards: number;
  dueCards: number;
  newCards: number;
  weakCards: number;
  overdueCards: number;
  estimatedMinutes: number;
}

interface TodoItem {
  id: string;
  pageId: string;
  pageName: string;
  block: Block;
  blockIds: string[];
  path: string[];
  status: TodoStatus;
  scope: "block" | "topic";
  targetKind: TodoTargetKind;
  deck?: string;
  topic?: string;
  cardCount?: number;
  learningNodeId?: string;
  learningLabel?: string;
  metrics: TodoQueueMetrics;
  hint?: string;
}

interface SessionAnswerStat {
  id: string;
  cardId: string;
  question: string;
  rating: Rating;
  responseTimeMs?: number;
  clozeResult?: ClozeSessionResult;
  answeredAt: string;
}

interface StoredSessionSummary {
  id: string;
  kind: "review" | "practice";
  completedAt: string;
  scopeLabel: string;
  answered: number;
  averageResponseTimeMs?: number;
  clozeBlankCount?: number;
  clozeCorrectCount?: number;
  counts: Record<Rating, number>;
}

const sampleImport = `# Ungarisch Mini
sgd-deck:: Ungarisch Deutsch

- Was bedeutet \`szia\`? #card
  sgd-topic:: Begruessung
  - Deutsch: hallo oder tschuess
  - Aussprache: ssia

- Wie sagt man danke auf Ungarisch? #card
  sgd-topic:: Hoeflichkeit
  - Ungarisch: köszönöm
  - Aussprache: koe-soe-noem
`;

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function statusError(context: string, error: unknown) {
  return `${context}: ${errorMessage(error)}`;
}

export function App() {
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [selectedCardIndex, setSelectedCardIndex] = useState(0);
  const [reviewNodeId, setReviewNodeId] = useState<string | null>(null);
  const [reviewScopeLabel, setReviewScopeLabel] = useState("All due cards");
  const [showAnswer, setShowAnswer] = useState(false);
  const [studyMode, setStudyMode] = useState<StudyMode>("classic");
  const [reviewStartedAt, setReviewStartedAt] = useState(() => Date.now());
  const [reviewResponseTimeMs, setReviewResponseTimeMs] = useState<number | undefined>();
  const [reviewSessionId, setReviewSessionId] = useState(() => randomUuid());
  const [reviewSessionStartedAt, setReviewSessionStartedAt] = useState(() => new Date().toISOString());
  const [reviewSessionStats, setReviewSessionStats] = useState<SessionAnswerStat[]>([]);
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("all");
  const [practiceDeckSlug, setPracticeDeckSlug] = useState<string>("");
  const [practiceNodeId, setPracticeNodeId] = useState<string>("");
  const [practiceScopeLabel, setPracticeScopeLabel] = useState("All cards");
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceShowAnswer, setPracticeShowAnswer] = useState(false);
  const [practiceStudyMode, setPracticeStudyMode] = useState<StudyMode>("classic");
  const [practiceStartedAt, setPracticeStartedAt] = useState(() => Date.now());
  const [practiceResponseTimeMs, setPracticeResponseTimeMs] = useState<number | undefined>();
  const [practiceSessionId, setPracticeSessionId] = useState(() => randomUuid());
  const [practiceSessionStartedAt, setPracticeSessionStartedAt] = useState(() => new Date().toISOString());
  const [practiceSessionStats, setPracticeSessionStats] = useState<SessionAnswerStat[]>([]);
  const [sessionSummaries, setSessionSummaries] = useState<StoredSessionSummary[]>([]);
  const [practiceRecordRatings, setPracticeRecordRatings] = useState(false);
  const [selectedNode, setSelectedNode] = useState<StudyGraphNode | null>(null);
  const [pageName, setPageName] = useState("Imported Page");
  const [pageFilter, setPageFilter] = useState("");
  const [todoDraft, setTodoDraft] = useState("");
  const [todoTargetPageId, setTodoTargetPageId] = useState<string>("");
  const [todoStatus, setTodoStatus] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState(sampleImport);
  const [exportedPages, setExportedPages] = useState<WorkspaceExport["pages"]>([]);
  const [backupPreview, setBackupPreview] = useState<AppBackup | null>(null);
  const [docPages, setDocPages] = useState<DocPage[]>([]);
  const [selectedDocPageId, setSelectedDocPageId] = useState<string | null>(null);
  const [docStatus, setDocStatus] = useState<string | null>(null);
  const [docDeckOptions, setDocDeckOptions] = useState<DocDeckOptions>({
    bidirectional: false,
    vocabulary: false,
    vocabularyDeck: "Vocabulary",
  });
  const [settings, setSettings] = useState<AppSettings>(() => loadFallbackAppSettings());
  const [generatorInput, setGeneratorInput] = useState<CardGeneratorInput>(() => {
    const initialSettings = loadFallbackAppSettings();
    return {
      deck: initialSettings.defaultDeck,
      topic: initialSettings.defaultTopic,
      source_text: "",
      language: "auto",
      number_of_cards: 6,
      difficulty: "medium",
      card_style: "basic",
      bidirectional_cards: false,
      vocabulary_mode: false,
      vocabulary_deck: "Vocabulary",
    };
  });
  const [generatedCards, setGeneratedCards] = useState<GeneratedCard[]>([]);
  const [generatorIssues, setGeneratorIssues] = useState<AiQualityIssue[]>([]);
  const [generatorStatus, setGeneratorStatus] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<AppDebugInfo | null>(null);
  const [debugStatus, setDebugStatus] = useState<string | null>(null);
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void refresh();
    void loadSettingsFromStorage();
    void loadDocsFromStorage();
    void loadReviewSessionSummariesFromStorage();
  }, []);

  function revealReviewAnswer() {
    setReviewResponseTimeMs(Date.now() - reviewStartedAt);
    setShowAnswer(true);
  }

  function revealPracticeAnswer() {
    setPracticeResponseTimeMs(Date.now() - practiceStartedAt);
    setPracticeShowAnswer(true);
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteQuery("");
        setPaletteIndex(0);
        setPaletteOpen(true);
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const next = await loadSnapshot();
      setSnapshot(next);
      setSelectedPageId((current) => current ?? next.workspace.pages[0]?.id ?? null);
      setFocusedBlockId(null);
      setLastRefreshAt(new Date().toISOString());
      void refreshDebugInfo();
    } catch (loadError) {
      setError(statusError("Storage load failed", loadError));
    } finally {
      setLoading(false);
    }
  }

  async function refreshDebugInfo() {
    setDebugStatus(null);
    try {
      const info = await getAppDebugInfo();
      setDebugInfo(info);
      setDebugStatus("Debug info refreshed.");
    } catch (debugError) {
      setDebugStatus(statusError("Storage debug info unavailable", debugError));
    }
  }

  async function loadSettingsFromStorage() {
    setSettingsStatus("Loading settings from SQLite...");
    try {
      const stored = await loadStoredAppSettings();
      setSettings(stored);
      saveFallbackAppSettings(stored);
      setGeneratorInput((current) => ({
        ...current,
        deck: stored.defaultDeck,
        topic: stored.defaultTopic,
      }));
      setSettingsStatus("Settings loaded from SQLite.");
    } catch (settingsError) {
      setSettingsStatus(
        statusError("Using local settings fallback; SQLite settings load failed", settingsError),
      );
    }
  }

  function updateSettings(patch: Partial<AppSettings>) {
    setSettings((current) => {
      const next = normalizeAppSettings({ ...current, ...patch });
      void persistSettings(next);
      return next;
    });
  }

  async function persistSettings(next: AppSettings) {
    setSettingsStatus("Saving settings to SQLite...");
    saveFallbackAppSettings(next);
    try {
      const saved = await saveStoredAppSettings(next);
      setSettings(saved);
      saveFallbackAppSettings(saved);
      setSettingsStatus("Settings saved to SQLite.");
    } catch (settingsError) {
      setSettingsStatus(
        statusError("Saved local fallback only; SQLite settings save failed", settingsError),
      );
    }
  }

  async function loadDocsFromStorage() {
    setDocStatus("Loading docs...");
    try {
      const pages = await loadDocPages();
      setDocPages(pages);
      setSelectedDocPageId((current) => current ?? pages[0]?.id ?? null);
      setDocStatus("Docs loaded.");
    } catch (docError) {
      setDocStatus(statusError("Doc storage load failed", docError));
    }
  }

  async function loadReviewSessionSummariesFromStorage() {
    try {
      const sessions = await loadReviewSessions();
      setSessionSummaries(sessions.map(reviewSessionToStoredSummary));
    } catch {
      setSessionSummaries([]);
    }
  }

  async function persistReviewSession(session: ReviewSession) {
    try {
      const sessions = await saveReviewSession(session);
      setSessionSummaries(sessions.map(reviewSessionToStoredSummary));
    } catch {
      setSessionSummaries((current) => upsertSessionSummary(current, reviewSessionToStoredSummary(session)));
    }
  }

  async function runDocMutation(action: () => Promise<DocPage[]>, selectPageId?: string) {
    setDocStatus("Saving docs...");
    try {
      const pages = await action();
      setDocPages(pages);
      setSelectedDocPageId((current) => selectPageId ?? current ?? pages[0]?.id ?? null);
      setDocStatus("Docs saved.");
    } catch (docError) {
      setDocStatus(docError instanceof Error ? docError.message : String(docError));
    }
  }

  async function createNewDocPage() {
    const title = window.prompt("Doc title", "Untitled Doc");
    if (!title) return;
    setDocStatus("Creating doc page...");
    try {
      const pages = await createDocPage(title);
      setDocPages(pages);
      const created = pages.find((page) => page.title === title.trim()) ?? pages.at(-1);
      setSelectedDocPageId(created?.id ?? pages[0]?.id ?? null);
      setDocStatus("Doc page created.");
    } catch (docError) {
      setDocStatus(docError instanceof Error ? docError.message : String(docError));
    }
  }

  async function addDocSectionTemplate(pageId: string) {
    setDocStatus("Adding doc section...");
    try {
      let pages = await addDocBlock(pageId, "heading", "New section");
      pages = await addDocBlock(pageId, "paragraph", "Write the explanation, context, and key ideas here.");
      pages = await addDocBlock(pageId, "todo", "Turn the important points into StudyGraph cards.");
      setDocPages(pages);
      setSelectedDocPageId(pageId);
      setDocStatus("Doc section template added.");
    } catch (docError) {
      setDocStatus(docError instanceof Error ? docError.message : String(docError));
    }
  }

  async function importPage() {
    setError(null);
    setFileStatus("Importing pasted Markdown into SQLite...");
    try {
      const next = await importMarkdownPage(pageName, markdown);
      setSnapshot(next);
      setSelectedPageId(next.workspace.pages.at(-1)?.id ?? next.workspace.pages[0]?.id ?? null);
      setFocusedBlockId(null);
      setFileStatus(`Imported pasted Markdown as ${pageName.trim() || "Imported Page"}.`);
      setScreen("dashboard");
    } catch (importError) {
      setError(statusError("Markdown text import failed", importError));
      setFileStatus(null);
    }
  }

  async function importFile() {
    setError(null);
    setFileStatus("Choose a Markdown file to import...");
    try {
      const filePath = await pickMarkdownFile();
      if (!filePath) {
        setFileStatus("Import cancelled; no file selected.");
        return;
      }
      setFileStatus(`Importing ${filePath}...`);
      const next = await importMarkdownFile(filePath);
      const importedPageName = pageNameFromFilePath(filePath);
      const importedPage = next.workspace.pages.find((page) => page.name === importedPageName);
      setSnapshot(next);
      setSelectedPageId(importedPage?.id ?? next.workspace.pages.at(-1)?.id ?? next.workspace.pages[0]?.id ?? null);
      setFocusedBlockId(null);
      setFileStatus(`Imported ${filePath}`);
      setScreen("notes");
    } catch (importError) {
      setError(statusError("Markdown file import failed", importError));
      setFileStatus(null);
    }
  }

  async function importFolder() {
    setError(null);
    setFileStatus("Choose a Markdown folder to import...");
    try {
      const folderPath = await pickMarkdownFolder();
      if (!folderPath) {
        setFileStatus("Import cancelled; no folder selected.");
        return;
      }
      const confirmed = window.confirm(
        "Import all Markdown files from this folder recursively? Pages with matching names will be replaced.",
      );
      if (!confirmed) {
        setFileStatus("Import cancelled before reading files.");
        return;
      }
      setFileStatus(`Importing Markdown folder ${folderPath}...`);
      const result = await importMarkdownFolder(folderPath);
      setSnapshot(result.snapshot);
      setSelectedPageId(result.snapshot.workspace.pages[0]?.id ?? null);
      setFocusedBlockId(null);
      setFileStatus(`Imported ${result.imported_files.length} Markdown files from ${result.folder_path}`);
      setScreen("dashboard");
    } catch (importError) {
      setError(statusError("Markdown folder import failed", importError));
      setFileStatus(null);
    }
  }

  async function rateCurrent(rating: Rating, clozeResult?: ClozeSessionResult) {
    const card = dueCards[selectedCardIndex];
    if (!card) {
      return;
    }
    setError(null);
    try {
      const next = await reviewCard(card.id, rating, reviewResponseTimeMs);
      setReviewSessionStats((current) => [...current, {
        id: randomUuid(),
        cardId: card.id,
        question: card.question,
        rating,
        responseTimeMs: reviewResponseTimeMs,
        clozeResult,
        answeredAt: new Date().toISOString(),
      }]);
      setSnapshot(next);
      setShowAnswer(false);
      setReviewResponseTimeMs(undefined);
      setSelectedCardIndex((current) => Math.min(current, Math.max(0, dueCards.length - 2)));
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError));
    }
  }

  async function ratePractice(rating: Rating, clozeResult?: ClozeSessionResult) {
    const card = practiceQueue[practiceIndex];
    if (!card) {
      return;
    }

    if (!practiceRecordRatings) {
      setPracticeShowAnswer(false);
      setPracticeResponseTimeMs(undefined);
      setPracticeIndex((current) => Math.min(current + 1, practiceQueue.length));
      return;
    }

    setError(null);
    try {
      const next = await reviewCard(card.id, rating, practiceResponseTimeMs);
      setPracticeSessionStats((current) => [...current, {
        id: randomUuid(),
        cardId: card.id,
        question: card.question,
        rating,
        responseTimeMs: practiceResponseTimeMs,
        clozeResult,
        answeredAt: new Date().toISOString(),
      }]);
      setSnapshot(next);
      setPracticeShowAnswer(false);
      setPracticeResponseTimeMs(undefined);
      setPracticeIndex((current) => Math.min(current, Math.max(0, practiceQueue.length - 2)));
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError));
    }
  }

  async function runMutation(action: () => Promise<DesktopSnapshot>, selectPageId?: string) {
    setError(null);
    try {
      const next = await action();
      setSnapshot(next);
      if (selectPageId) {
        setSelectedPageId(selectPageId);
      }
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    }
  }

  async function addRootBlockFromEditor(content: string) {
    if (!selectedPage) return;
    setError(null);
    try {
      const next = await addRootBlock(selectedPage.id, content);
      const page = next.workspace.pages.find((candidate) => candidate.id === selectedPage.id);
      setSnapshot(next);
      setSelectedPageId(selectedPage.id);
      setFocusedBlockId(page?.blocks.at(-1)?.id ?? null);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    }
  }

  async function addChildBlockFromEditor(blockId: string, content: string) {
    if (!selectedPage) return;
    setError(null);
    try {
      const next = await addChildBlock(blockId, content);
      const page = next.workspace.pages.find((candidate) => candidate.id === selectedPage.id);
      setSnapshot(next);
      setSelectedPageId(selectedPage.id);
      setFocusedBlockId(page ? findLastChildId(page.blocks, blockId) ?? blockId : blockId);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    }
  }

  async function addSiblingBlockFromEditor(blockId: string, content: string) {
    if (!selectedPage) return;
    setError(null);
    try {
      const next = await addSiblingBlock(blockId, content);
      const page = next.workspace.pages.find((candidate) => candidate.id === selectedPage.id);
      setSnapshot(next);
      setSelectedPageId(selectedPage.id);
      setFocusedBlockId(page ? findNextSiblingId(page.blocks, blockId) ?? blockId : blockId);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    }
  }

  async function createCardFromEditBlock(block: Block) {
    if (!selectedPage) return;
    const deck = window.prompt(
      "Deck",
      block.properties["sgd-deck"] ?? block.properties.deck ?? selectedPage.properties["sgd-deck"] ?? selectedPage.properties.deck ?? settings.defaultDeck,
    );
    if (deck === null) return;
    const topic = window.prompt(
      "Topic",
      block.properties["sgd-topic"] ?? block.properties.topic ?? selectedPage.properties["sgd-topic"] ?? selectedPage.properties.topic ?? settings.defaultTopic,
    );
    if (topic === null) return;

    const answer =
      block.children.some((child) => child.content.trim())
        ? null
        : window.prompt("Answer child block", "Answer or explanation");
    if (answer === null) return;

    setError(null);
    try {
      let next = await setBlockProperty(block.id, "sgd-card", "true");
      next = await setBlockProperty(block.id, "sgd-deck", deck);
      next = await setBlockProperty(block.id, "sgd-topic", topic);
      if (answer?.trim()) {
        next = await addChildBlock(block.id, answer);
      }
      setSnapshot(next);
      setSelectedPageId(selectedPage.id);
      setFocusedBlockId(block.id);
      setScreen("notes");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    }
  }

  async function createTodoFromQuickCapture(content: string, pageId: string) {
    const cleanContent = singleLine(content, "");
    if (!cleanContent) {
      setTodoStatus("Write a task first.");
      return;
    }

    setError(null);
    setTodoStatus("Adding task...");
    try {
      let targetPage = pages.find((page) => page.id === pageId) ?? selectedPage ?? pages[0];
      let latestSnapshot = snapshot;
      if (!targetPage) {
        latestSnapshot = await createPage("Inbox");
        targetPage = latestSnapshot.workspace.pages.find((page) => page.name === "Inbox") ?? latestSnapshot.workspace.pages[0];
      }
      if (!targetPage) {
        setTodoStatus("No page available for the task.");
        return;
      }

      latestSnapshot = await addRootBlock(targetPage.id, `TODO ${cleanContent}`);
      const updatedTargetPage = latestSnapshot.workspace.pages.find((page) => page.id === targetPage?.id);
      const newBlockId = updatedTargetPage?.blocks.at(-1)?.id;
      if (newBlockId) {
        latestSnapshot = await setBlockProperty(newBlockId, "sgd-todo", "open");
      }

      setSnapshot(latestSnapshot);
      setSelectedPageId(targetPage.id);
      setFocusedBlockId(newBlockId ?? null);
      setTodoDraft("");
      setTodoTargetPageId(targetPage.id);
      setTodoStatus("Task added.");
    } catch (mutationError) {
      setTodoStatus(mutationError instanceof Error ? mutationError.message : String(mutationError));
    }
  }

  async function updateTodoItemStatus(item: TodoItem, status: TodoStatus) {
    setError(null);
    setTodoStatus("Updating task...");
    try {
      let next = snapshot;
      const doneAt = new Date().toISOString();
      for (const blockId of item.blockIds) {
        next = await setBlockProperty(blockId, "sgd-todo", status);
        if (status === "done") {
          next = await setBlockProperty(blockId, "sgd-todo-done-at", doneAt);
        } else {
          next = await removeBlockProperty(blockId, "sgd-todo-done-at");
        }
      }
      if (!next) {
        setTodoStatus("No matching item blocks found.");
        return;
      }
      setSnapshot(next);
      setSelectedPageId(item.pageId);
      setFocusedBlockId(item.block.id);
      setTodoStatus(status === "done" ? "Item completed." : status === "doing" ? "Item moved to Next up." : "Item moved to Open.");
    } catch (mutationError) {
      setTodoStatus(mutationError instanceof Error ? mutationError.message : String(mutationError));
    }
  }

  async function createNewPage() {
    const name = window.prompt("Page name", "New Page");
    if (!name) return;
    setError(null);
    try {
      const next = await createPage(name);
      setSnapshot(next);
      const created = next.workspace.pages.find((page) => page.name === name.trim());
      setSelectedPageId(created?.id ?? next.workspace.pages.at(-1)?.id ?? null);
      setFocusedBlockId(null);
      setScreen("notes");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    }
  }

  async function openPageByName(rawName: string) {
    const name = normalizePageTitle(rawName);
    if (!name) return;

    const existingPage = pages.find((page) => normalizePageRef(page.name) === normalizePageRef(name));
    if (existingPage) {
      setSelectedPageId(existingPage.id);
      setFocusedBlockId(null);
      setScreen("notes");
      return;
    }

    const shouldCreate = window.confirm(`Page "${name}" does not exist yet. Create it?`);
    if (!shouldCreate) return;

    setError(null);
    try {
      const next = await createPage(name);
      setSnapshot(next);
      const created = next.workspace.pages.find((page) => normalizePageRef(page.name) === normalizePageRef(name));
      setSelectedPageId(created?.id ?? next.workspace.pages.at(-1)?.id ?? null);
      setFocusedBlockId(null);
      setScreen("notes");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    }
  }

  async function loadExport() {
    setError(null);
    setFileStatus("Preparing Markdown export and JSON backup preview...");
    try {
      const [result, backup] = await Promise.all([exportWorkspaceMarkdown(), exportAppBackup()]);
      setExportedPages(result.pages);
      setBackupPreview(backup);
      setFileStatus(`Prepared ${result.pages.length} Markdown pages and JSON backup preview.`);
      setScreen("export");
    } catch (exportError) {
      setError(statusError("Export preview failed", exportError));
      setFileStatus(null);
    }
  }

  async function exportToFolder() {
    setError(null);
    setFileStatus("Choose an export folder...");
    try {
      const folderPath = await pickExportFolder();
      if (!folderPath) {
        setFileStatus("Export cancelled; no folder selected.");
        return;
      }
      const overwrite = window.confirm(
        "Export all pages as Markdown into this folder? Existing .md files with matching page names can be overwritten.",
      );
      if (!overwrite) {
        setFileStatus("Export cancelled before writing files.");
        return;
      }
      setFileStatus(`Exporting Markdown files to ${folderPath}...`);
      const result = await exportWorkspaceMarkdownToFolder(folderPath, true);
      await loadExport();
      setFileStatus(`Exported ${result.files.length} Markdown files to ${result.folder_path}`);
    } catch (exportError) {
      setError(statusError("Markdown folder export failed", exportError));
      setFileStatus(null);
    }
  }

  async function loadBackupPreview() {
    setError(null);
    try {
      const result = await exportAppBackup();
      setBackupPreview(result);
      setScreen("export");
    } catch (exportError) {
      setError(statusError("JSON backup preview failed", exportError));
    }
  }

  async function exportBackupToFolder() {
    setError(null);
    setFileStatus("Choose a folder for studygraph-backup.json...");
    try {
      const folderPath = await pickExportFolder();
      if (!folderPath) {
        setFileStatus("Backup export cancelled; no folder selected.");
        return;
      }
      setFileStatus(`Writing JSON backup to ${folderPath}...`);
      const result = await exportAppBackupToFolder(folderPath);
      setBackupPreview(result.backup);
      setFileStatus(`Exported JSON backup to ${result.file_path}`);
      setScreen("export");
    } catch (exportError) {
      setError(statusError("JSON backup export failed", exportError));
      setFileStatus(null);
    }
  }

  async function restoreBackupFromFile() {
    setError(null);
    setFileStatus("Choose a StudyGraph JSON backup to restore...");
    try {
      const filePath = await pickBackupFile();
      if (!filePath) {
        setFileStatus("Restore cancelled; no backup file selected.");
        return;
      }
      const confirmed = window.confirm(
        "Restore this StudyGraph backup? This replaces the current workspace data with the backup contents.",
      );
      if (!confirmed) {
        setFileStatus("Restore cancelled before replacing workspace data.");
        return;
      }
      setFileStatus(`Restoring StudyGraph backup from ${filePath}...`);
      const result = await restoreAppBackupFromFile(filePath);
      setSnapshot(result.snapshot);
      setSelectedPageId(result.snapshot.workspace.pages[0]?.id ?? null);
      setFocusedBlockId(null);
      setBackupPreview(null);
      setFileStatus(`Restored backup from ${result.file_path}`);
      setScreen("export");
    } catch (restoreError) {
      setError(statusError("JSON backup restore failed", restoreError));
      setFileStatus(null);
    }
  }

  function generateCardsPreview() {
    setError(null);
    setGeneratorStatus("Running local AI preview pipeline...");
    if (!generatorInput.source_text.trim()) {
      setGeneratedCards([]);
      setGeneratorIssues([]);
      setGeneratorStatus("Add source text first. The current AI pipeline is local-only and makes no external API request.");
      return;
    }
    const provider = createConfiguredAiProvider(settings);
    const response = provider.generateCards({ input: generatorInput, existingCards: cards });
    setGeneratedCards(response.cards);
    setGeneratorIssues(response.issues);
    setGeneratorStatus(
      response.cards.length > 0
        ? `Generated ${response.cards.length} local preview cards (${aiQualitySummary(response.issues)}).`
        : response.diagnostics.candidateCards > 0
          ? `All generated candidates were duplicates or failed quality checks (${aiQualitySummary(response.issues)}).`
          : "Add source text with at least one meaningful sentence.",
    );
  }

  async function copyGeneratedMarkdown() {
    setGeneratorStatus(null);
    if (generatedCards.length === 0) {
      setGeneratorStatus("Generate a preview first.");
      return;
    }

    try {
      await navigator.clipboard.writeText(formatGeneratedCardsAsMarkdown(generatedCards));
      setGeneratorStatus("Copied generated Markdown to clipboard.");
    } catch {
      setGeneratorStatus("Clipboard is not available. Select the preview manually.");
    }
  }

  async function insertGeneratedPreview() {
    setError(null);
    setGeneratorStatus(null);
    if (!selectedPage) {
      setError("Select or create a page before inserting generated cards.");
      return;
    }
    if (generatedCards.length === 0) {
      setGeneratorStatus("Generate a preview first.");
      return;
    }

    try {
      const next = await insertGeneratedCards(selectedPage.id, generatedCards);
      setSnapshot(next);
      setSelectedPageId(selectedPage.id);
      setFocusedBlockId(null);
      setScreen("notes");
      setGeneratorStatus(`Inserted ${generatedCards.length} cards into ${selectedPage.name}.`);
    } catch (insertError) {
      setGeneratorStatus(statusError("Could not insert generated cards", insertError));
    }
  }

  async function createCardFromDocBlock(docPage: DocPage, block: DocBlock) {
    setError(null);
    setDocStatus(null);
    if (!selectedPage) {
      setDocStatus("Select or create an Edit Desk page before creating a card from Doc.");
      return;
    }

    const content = singleLine(stripPageLinks(block.content), "");
    if (!content) {
      setDocStatus("This Doc block is empty.");
      return;
    }

    try {
      const next = await insertDocCard({
        pageId: selectedPage.id,
        docPageId: docPage.id,
        docBlockId: block.id,
        docPageTitle: docPage.title,
        question: docQuestionFromBlock(block),
        answer: docAnswerFromBlock(docPage, block),
        deck: settings.defaultDeck,
        topic: settings.defaultTopic,
      });
      setSnapshot(next);
      setSelectedPageId(selectedPage.id);
      setFocusedBlockId(null);
      setDocStatus(`Created card in ${selectedPage.name}.`);
    } catch (insertError) {
      setDocStatus(insertError instanceof Error ? insertError.message : String(insertError));
    }
  }

  function sendDocToGenerator(docPage: DocPage, options: DocDeckOptions = docDeckOptions) {
    const sourceText = docPage.blocks
      .map((block) => stripPageLinks(block.content).trim())
      .filter(Boolean)
      .join("\n\n");

    sendDocTextToGenerator(docPage, sourceText, `Doc "${docPage.title}"`, options);
  }

  function sendDocTextToGenerator(docPage: DocPage, sourceText: string, sourceLabel: string, options: DocDeckOptions = docDeckOptions) {
    const cleanSourceText = sourceText.trim();
    if (!cleanSourceText) {
      setDocStatus("Add or select text before generating a deck.");
      return;
    }

    const nextInput: CardGeneratorInput = {
      ...generatorInput,
      deck: singleLine(docPage.title, settings.defaultDeck),
      topic: settings.defaultTopic,
      source_text: cleanSourceText,
      language: docPage.language === "auto" ? generatorInput.language : (docPage.language as CardGeneratorInput["language"]),
      number_of_cards: clampNumber(Math.max(generatorInput.number_of_cards, estimateCardCount(cleanSourceText)), 1, 30),
      card_style: "mixed",
      bidirectional_cards: options.bidirectional,
      vocabulary_mode: options.vocabulary,
      vocabulary_deck: singleLine(options.vocabularyDeck, "Vocabulary"),
    };

    setGeneratorInput(nextInput);
    const provider = createConfiguredAiProvider(settings);
    const response = provider.generateCards({ input: nextInput, existingCards: cards });
    setGeneratedCards(response.cards);
    setGeneratorIssues(response.issues);
    setGeneratorStatus(
      response.cards.length > 0
        ? `Prepared ${response.cards.length} local AI-style preview cards from ${sourceLabel} (${aiQualitySummary(response.issues)}). No external API call was made.`
        : response.diagnostics.candidateCards > 0
          ? `Doc parsing found candidates, but they were duplicates or failed quality checks (${aiQualitySummary(response.issues)}).`
          : "Selected Doc text is too short for local card generation.",
    );
    setDocStatus(`Sent ${sourceLabel} to Generate Cards with the selected AI parsing options.`);
    setScreen("generate");
  }

  function openBlock(pageId: string, blockId: string) {
    setSelectedPageId(pageId);
    setFocusedBlockId(blockId);
    setScreen("notes");
  }


  function learnTodoItem(item: TodoItem) {
    const learningTarget = todoLearningTarget(item, cards, settings);
    setError(null);
    setTodoStatus(null);

    if (learningTarget.kind === "review") {
      startDueReview(learningTarget.nodeId, learningTarget.label);
      return;
    }

    if (learningTarget.kind === "practice") {
      startPractice("graph", "", learningTarget.nodeId, learningTarget.label);
      return;
    }

    openTodoSource(item);
    setTodoStatus(learningTarget.message);
  }

  function openTodoSource(item: TodoItem) {
    const sourceBlockId = item.blockIds.find((blockId) => blockLocations.has(blockId)) ?? item.block.id;
    const location = blockLocations.get(sourceBlockId);
    if (location) {
      openBlock(location.pageId, sourceBlockId);
      return;
    }

    const sourcePage = pages.find((page) => page.id === item.pageId || page.name === item.pageName);
    if (sourcePage) {
      setSelectedPageId(sourcePage.id);
      setFocusedBlockId(null);
      setScreen("notes");
      return;
    }

    setError("Source block could not be found for this To Do item.");
  }

  function openCardSource(card: StudyCard) {
    const location = blockLocations.get(card.block_id);
    if (location) {
      openBlock(location.pageId, card.block_id);
      return;
    }

    const sourcePage = pages.find((page) => page.name === card.source_page);
    if (sourcePage) {
      setSelectedPageId(sourcePage.id);
      setFocusedBlockId(null);
      setScreen("notes");
      return;
    }

    setError("Source block could not be found for this card.");
  }

  function startDueReview(nodeId: string | null = null, label = "All due cards") {
    setReviewNodeId(nodeId);
    setReviewScopeLabel(label);
    setReviewSessionId(randomUuid());
    setReviewSessionStartedAt(new Date().toISOString());
    setSelectedCardIndex(0);
    setShowAnswer(false);
    setReviewSessionStats([]);
    setScreen("review");
  }

  function startPractice(mode: PracticeMode, deckSlug = "", nodeId = "", label = "All cards") {
    setPracticeMode(mode);
    setPracticeDeckSlug(deckSlug);
    setPracticeNodeId(nodeId);
    setPracticeScopeLabel(label);
    setPracticeSessionId(randomUuid());
    setPracticeSessionStartedAt(new Date().toISOString());
    setPracticeIndex(0);
    setPracticeShowAnswer(false);
    setPracticeSessionStats([]);
    setScreen("practice");
  }

  function startGraphReview(node: StudyGraphNode) {
    startDueReview(node.id, node.label);
  }

  function startGraphPractice(node: StudyGraphNode) {
    startPractice("graph", "", node.id, node.label);
  }

  function runSearchResult(result: SearchResult) {
    setPaletteOpen(false);
    setPaletteQuery("");
    setPaletteIndex(0);

    if (result.type === "page" && result.pageId) {
      setSelectedPageId(result.pageId);
      setFocusedBlockId(null);
      setScreen("notes");
      return;
    }

    if ((result.type === "block" || result.type === "card") && result.pageId && result.blockId) {
      openBlock(result.pageId, result.blockId);
      return;
    }

    switch (result.action) {
      case "notes":
        setScreen("notes");
        break;
      case "dashboard":
        setScreen("dashboard");
        break;
      case "doc":
        setScreen("doc");
        void loadDocsFromStorage();
        break;
      case "todo":
        setTodoTargetPageId((current) => current || selectedPage?.id || pages[0]?.id || "");
        setScreen("todo");
        break;
      case "review":
        startDueReview();
        break;
      case "practice":
        startPractice("all");
        break;
      case "graph":
        setScreen("graph");
        break;
      case "generate":
        setScreen("generate");
        break;
      case "settings":
        setScreen("settings");
        void refreshDebugInfo();
        void loadSettingsFromStorage();
        break;
      case "import":
        setScreen("import");
        break;
      case "export":
        void loadExport();
        break;
      case "refresh":
        void refresh();
        break;
    }
  }

  const pages = snapshot?.workspace.pages ?? [];
  const cards = snapshot?.cards ?? [];
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? pages[0];
  const blockLocations = useMemo(() => buildBlockLocations(pages), [pages]);
  const selectedPageBacklinks = useMemo(
    () => (selectedPage ? backlinksForPage(snapshot?.backlinks ?? [], selectedPage.name) : []),
    [snapshot?.backlinks, selectedPage],
  );
  const searchResults = useMemo(
    () => buildSearchResults(snapshot, paletteQuery),
    [snapshot, paletteQuery],
  );
  const filteredPages = useMemo(() => filterPages(pages, pageFilter), [pages, pageFilter]);
  const todoItems = useMemo(() => buildTodoItems(pages, cards), [pages, cards]);
  const decks = useMemo(() => groupCardsByDeck(cards), [cards]);
  const allDueCards = useMemo(() => cards.filter(isDue), [cards]);
  const dueCards = useMemo(() => buildReviewQueue(cards, reviewNodeId, settings), [cards, reviewNodeId, settings]);
  const practiceQueue = useMemo(
    () => buildPracticeQueue(cards, practiceMode, practiceDeckSlug, practiceNodeId),
    [cards, practiceMode, practiceDeckSlug, practiceNodeId],
  );
  const currentCard = dueCards[selectedCardIndex];
  const currentPracticeCard = practiceQueue[practiceIndex];

  useEffect(() => {
    setReviewStartedAt(Date.now());
    setReviewResponseTimeMs(undefined);
  }, [currentCard?.id]);

  useEffect(() => {
    setPracticeStartedAt(Date.now());
    setPracticeResponseTimeMs(undefined);
  }, [currentPracticeCard?.id]);

  useEffect(() => {
    if (!snapshot || reviewSessionStats.length === 0) return;
    const session = buildReviewSession(
      snapshot.workspace.id,
      reviewSessionId,
      "review",
      reviewScopeLabel,
      reviewSessionStartedAt,
      reviewSessionStats,
    );
    void persistReviewSession(session);
  }, [snapshot?.workspace.id, reviewSessionId, reviewSessionStartedAt, reviewSessionStats, reviewScopeLabel]);

  useEffect(() => {
    if (!snapshot || practiceSessionStats.length === 0) return;
    const session = buildReviewSession(
      snapshot.workspace.id,
      practiceSessionId,
      "practice",
      practiceScopeLabel,
      practiceSessionStartedAt,
      practiceSessionStats,
    );
    void persistReviewSession(session);
  }, [snapshot?.workspace.id, practiceSessionId, practiceSessionStartedAt, practiceSessionStats, practiceScopeLabel]);

  const selectedDocPage = docPages.find((page) => page.id === selectedDocPageId) ?? docPages[0];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">SG</span>
          <div>
            <strong>StudyGraph</strong>
            <small>{snapshot?.workspace.name ?? "Local"}</small>
          </div>
        </div>

        <button
          className={screen === "generate" ? "primary generate-shortcut active" : "primary generate-shortcut"}
          onClick={() => setScreen("generate")}
        >
          Generate Cards
        </button>

        <nav className="nav" aria-label="Main navigation">
          <button className={screen === "notes" ? "active" : ""} onClick={() => setScreen("notes")}>Edit Desk</button>
          <button className={screen === "doc" ? "active" : ""} onClick={() => {
            setScreen("doc");
            void loadDocsFromStorage();
          }}>
            Doc
          </button>
          <button className={screen === "todo" ? "active" : ""} onClick={() => {
            setTodoTargetPageId((current) => current || selectedPage?.id || pages[0]?.id || "");
            setScreen("todo");
          }}>
            To Do
          </button>
          <button className={screen === "dashboard" ? "active" : ""} onClick={() => setScreen("dashboard")}>Decks</button>
          <button className={screen === "review" ? "active" : ""} onClick={() => startDueReview()}>Review</button>
          <button className={screen === "practice" ? "active" : ""} onClick={() => startPractice("all")}>Free Practice</button>
          <button className={screen === "graph" ? "active" : ""} onClick={() => setScreen("graph")}>Study Graph</button>
          <button className={screen === "settings" ? "active" : ""} onClick={() => {
            setScreen("settings");
            void refreshDebugInfo();
            void loadSettingsFromStorage();
          }}>
            Settings / Debug
          </button>
          <button className={screen === "import" ? "active" : ""} onClick={() => setScreen("import")}>Import</button>
          <button className={screen === "export" ? "active" : ""} onClick={() => void loadExport()}>Export</button>
        </nav>

        <div className="page-list">
          <div className="page-list-heading">
            <h3>Pages</h3>
            <button onClick={() => void createNewPage()}>+</button>
          </div>
          <input
            className="page-filter"
            value={pageFilter}
            placeholder="Filter pages"
            onChange={(event) => setPageFilter(event.target.value)}
          />
          {filteredPages.length === 0 && <p className="empty-inline">No pages match.</p>}
          {filteredPages.map((page) => (
            <button
              key={page.id}
              className={selectedPage?.id === page.id ? "active page-button" : "page-button"}
              onClick={() => {
                setSelectedPageId(page.id);
                setFocusedBlockId(null);
                setScreen("notes");
              }}
            >
              <span>{page.name}</span>
              <small>{flattenBlocks(page.blocks).length}</small>
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{titleForScreen(screen)}</h1>
            <p>{cards.length} cards | {allDueCards.length} due | {pages.length} pages</p>
          </div>
          <div className="topbar-actions">
            <button onClick={() => {
              setPaletteQuery("");
              setPaletteIndex(0);
              setPaletteOpen(true);
            }}>
              Search Ctrl+K
            </button>
            <button onClick={() => void refresh()} disabled={loading}>{loading ? "Loading" : "Refresh"}</button>
          </div>
        </header>

        {error && <div className="error">{error}</div>}

        {screen === "notes" && selectedPage && (
          <NotesView
            page={selectedPage}
            pages={pages}
            focusedBlockId={focusedBlockId}
            onRenamePage={(name) => void runMutation(() => renamePage(selectedPage.id, name), selectedPage.id)}
            onSetPageProperty={(key, value) => void runMutation(() => setPageProperty(selectedPage.id, key, value), selectedPage.id)}
            onRemovePageProperty={(key) => void runMutation(() => removePageProperty(selectedPage.id, key), selectedPage.id)}
            onAddRootBlock={(content) => addRootBlockFromEditor(content)}
            onUpdateBlock={(blockId, content) => runMutation(() => updateBlockContent(blockId, content), selectedPage.id)}
            onAddChild={(blockId, content) => addChildBlockFromEditor(blockId, content)}
            onAddSibling={(blockId, content) => addSiblingBlockFromEditor(blockId, content)}
            onIndent={(blockId) => void runMutation(() => indentBlock(blockId), selectedPage.id)}
            onOutdent={(blockId) => void runMutation(() => outdentBlock(blockId), selectedPage.id)}
            onSetProperty={(blockId, key, value) => void runMutation(() => setBlockProperty(blockId, key, value), selectedPage.id)}
            onRemoveProperty={(blockId, key) => void runMutation(() => removeBlockProperty(blockId, key), selectedPage.id)}
            onDeleteBlock={(blockId) => void runMutation(() => deleteBlock(blockId), selectedPage.id)}
            onCreateCard={(block) => void createCardFromEditBlock(block)}
            backlinks={selectedPageBacklinks}
            onOpenPage={(pageId) => {
              setSelectedPageId(pageId);
              setFocusedBlockId(null);
              setScreen("notes");
            }}
            onOpenBlock={openBlock}
            onOpenPageByName={(name) => void openPageByName(name)}
          />
        )}
        {screen === "doc" && (
          <DocView
            pages={docPages}
            editPages={pages}
            selectedPage={selectedDocPage}
            selectedEditPageName={selectedPage?.name}
            status={docStatus}
            onSelectPage={setSelectedDocPageId}
            onCreatePage={() => void createNewDocPage()}
            onOpenPageByName={(name) => void openPageByName(name)}
            onRenamePage={(pageId, title) => void runDocMutation(() => updateDocPageTitle(pageId, title), pageId)}
            onUpdatePageMetadata={(pageId, tags, source, language) =>
              void runDocMutation(() => updateDocPageMetadata(pageId, tags, source, language), pageId)
            }
            onDeletePage={(pageId) => {
              if (window.confirm("Delete this doc page?")) {
                void runDocMutation(() => deleteDocPage(pageId));
              }
            }}
            onAddBlock={(pageId, kind) => void runDocMutation(() => addDocBlock(pageId, kind, ""), pageId)}
            onAddSectionTemplate={(pageId) => void addDocSectionTemplate(pageId)}
            onUpdateBlock={(block) =>
              void runDocMutation(
                () => updateDocBlock(block.id, block.kind, block.content, block.checked),
                selectedDocPage?.id,
              )
            }
            onDeleteBlock={(blockId) => void runDocMutation(() => deleteDocBlock(blockId), selectedDocPage?.id)}
            onMoveBlock={(blockId, direction) => void runDocMutation(() => moveDocBlock(blockId, direction), selectedDocPage?.id)}
            onCreateCard={(docPage, block) => void createCardFromDocBlock(docPage, block)}
            deckOptions={docDeckOptions}
            onDeckOptionsChange={(patch) => setDocDeckOptions((current) => ({ ...current, ...patch }))}
            onGenerateDeck={(docPage) => sendDocToGenerator(docPage)}
            onGenerateSelection={(docPage, text) => sendDocTextToGenerator(docPage, text, "the selected Doc text")}
          />
        )}
        {screen === "todo" && (
          <TodoView
            pages={pages}
            items={todoItems}
            draft={todoDraft}
            targetPageId={todoTargetPageId || selectedPage?.id || pages[0]?.id || ""}
            status={todoStatus}
            onDraftChange={setTodoDraft}
            onTargetPageChange={setTodoTargetPageId}
            onCreate={(content, pageId) => void createTodoFromQuickCapture(content, pageId)}
            onSetStatus={(item, status) => void updateTodoItemStatus(item, status)}
            onLearnItem={learnTodoItem}
            onEditBlock={openTodoSource}
          />
        )}
        {screen === "dashboard" && (
          <DashboardView
            decks={decks}
            onGenerateCards={() => setScreen("generate")}
            onReviewDeck={(deckSlug) => {
              const deck = decks.find((candidate) => candidate.deck_slug === deckSlug);
              startDueReview(`deck:${deckSlug}`, deck?.deck ?? "Deck");
            }}
            onPracticeDeck={(deckSlug, mode) => startPractice(mode, deckSlug)}
            onShowGraph={(deckSlug) => {
              const deck = decks.find((candidate) => candidate.deck_slug === deckSlug);
              setSelectedNode(deck ? {
                id: `deck:${deck.deck_slug}`,
                kind: "deck",
                label: deck.deck,
                total_cards: deck.total,
                due_cards: deck.due,
                weak_cards: deck.weak,
              } : null);
              setScreen("graph");
            }}
          />
        )}
        {screen === "review" && (
          <ReviewView
            card={currentCard}
            index={selectedCardIndex}
            total={dueCards.length}
            scopeLabel={reviewScopeLabel}
            showAnswer={showAnswer}
            studyMode={studyMode}
            onStudyModeChange={setStudyMode}
            responseTimeMs={reviewResponseTimeMs}
            sessionStats={reviewSessionStats}
            recentSummaries={sessionSummaries}
            allCardCount={cards.length}
            onStartPractice={() => startPractice("all")}
            onGenerateCards={() => setScreen("generate")}
            onOpenEditDesk={() => setScreen("notes")}
            onShowAnswer={revealReviewAnswer}
            onSkip={() => {
              setShowAnswer(false);
              setReviewResponseTimeMs(undefined);
              setSelectedCardIndex((current) => Math.min(current + 1, Math.max(0, dueCards.length - 1)));
            }}
            onRate={(rating, clozeResult) => void rateCurrent(rating, clozeResult)}
            onOpenCard={openCardSource}
          />
        )}
        {screen === "practice" && (
          <FreePracticeView
            card={currentPracticeCard}
            index={practiceIndex}
            total={practiceQueue.length}
            cards={cards}
            decks={decks}
            mode={practiceMode}
            deckSlug={practiceDeckSlug}
            graphNodeLabel={practiceMode === "graph" ? practiceScopeLabel : ""}
            showAnswer={practiceShowAnswer}
            studyMode={practiceStudyMode}
            onStudyModeChange={setPracticeStudyMode}
            responseTimeMs={practiceResponseTimeMs}
            sessionStats={practiceSessionStats}
            recentSummaries={sessionSummaries}
            allCardCount={cards.length}
            onGenerateCards={() => setScreen("generate")}
            onOpenEditDesk={() => setScreen("notes")}
            recordRatings={practiceRecordRatings}
            onModeChange={(mode) => {
              setPracticeMode(mode);
              setPracticeNodeId("");
              setPracticeScopeLabel("All cards");
              setPracticeIndex(0);
              setPracticeShowAnswer(false);
            }}
            onDeckChange={(deckSlug) => {
              setPracticeDeckSlug(deckSlug);
              setPracticeMode("deck");
              setPracticeNodeId("");
              setPracticeScopeLabel("Deck");
              setPracticeIndex(0);
              setPracticeShowAnswer(false);
              setPracticeResponseTimeMs(undefined);
            }}
            onRecordRatingsChange={setPracticeRecordRatings}
            onShowAnswer={revealPracticeAnswer}
            onSkip={() => {
              setPracticeShowAnswer(false);
              setPracticeResponseTimeMs(undefined);
              setPracticeIndex((current) => Math.min(current + 1, practiceQueue.length));
            }}
            onRate={(rating, clozeResult) => void ratePractice(rating, clozeResult)}
            onOpenCard={openCardSource}
          />
        )}
        {screen === "graph" && snapshot && (
          <GraphView
            snapshot={snapshot}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
            onStartDue={startGraphReview}
            onPractice={startGraphPractice}
            onGenerateCards={() => setScreen("generate")}
            onOpenCard={openCardSource}
            onOpenPageByName={(name) => void openPageByName(name)}
          />
        )}
        {screen === "generate" && (
          <GeneratorView
            input={generatorInput}
            cards={generatedCards}
            issues={generatorIssues}
            status={generatorStatus}
            selectedPageName={selectedPage?.name}
            onInputChange={(patch) => setGeneratorInput((current) => ({ ...current, ...patch }))}
            onGenerate={generateCardsPreview}
            onCopy={() => void copyGeneratedMarkdown()}
            onInsert={() => void insertGeneratedPreview()}
          />
        )}
        {screen === "settings" && (
          <SettingsView
            settings={settings}
            snapshot={snapshot}
            decks={decks}
            debugInfo={debugInfo}
            debugStatus={debugStatus}
            settingsStatus={settingsStatus}
            lastRefreshAt={lastRefreshAt}
            onSettingsChange={updateSettings}
            onReloadSettings={() => void loadSettingsFromStorage()}
            onRefreshDebug={() => void refreshDebugInfo()}
            onApplyGeneratorDefaults={() => {
              setGeneratorInput((current) => ({
                ...current,
                deck: settings.defaultDeck,
                topic: settings.defaultTopic,
              }));
              setGeneratorStatus("Generator defaults applied.");
              setScreen("generate");
            }}
          />
        )}
        {screen === "import" && (
          <ImportView
            pageName={pageName}
            markdown={markdown}
            onPageNameChange={setPageName}
            onMarkdownChange={setMarkdown}
            onImport={() => void importPage()}
            onImportFile={() => void importFile()}
            onImportFolder={() => void importFolder()}
            fileStatus={fileStatus}
          />
        )}
        {screen === "export" && (
          <ExportView
            pages={exportedPages}
            backup={backupPreview}
            fileStatus={fileStatus}
            onRefresh={() => void loadExport()}
            onExportFolder={() => void exportToFolder()}
            onRefreshBackup={() => void loadBackupPreview()}
            onExportBackup={() => void exportBackupToFolder()}
            onRestoreBackup={() => void restoreBackupFromFile()}
          />
        )}
      </main>
      <CommandPalette
        open={paletteOpen}
        query={paletteQuery}
        selectedIndex={paletteIndex}
        results={searchResults}
        onQueryChange={(query) => {
          setPaletteQuery(query);
          setPaletteIndex(0);
        }}
        onSelectedIndexChange={setPaletteIndex}
        onClose={() => setPaletteOpen(false)}
        onRun={runSearchResult}
      />
    </div>
  );
}

function NotesView({
  page,
  pages,
  focusedBlockId,
  onRenamePage,
  onSetPageProperty,
  onRemovePageProperty,
  onAddRootBlock,
  onUpdateBlock,
  onAddChild,
  onAddSibling,
  onIndent,
  onOutdent,
  onSetProperty,
  onRemoveProperty,
  onDeleteBlock,
  onCreateCard,
  backlinks,
  onOpenPage,
  onOpenBlock,
  onOpenPageByName,
}: {
  page: Page;
  pages: Page[];
  focusedBlockId: string | null;
  onRenamePage: (name: string) => void;
  onSetPageProperty: (key: string, value: string) => void;
  onRemovePageProperty: (key: string) => void;
  onAddRootBlock: (content: string) => MaybePromise;
  onUpdateBlock: (blockId: string, content: string) => MaybePromise;
  onAddChild: (blockId: string, content: string) => MaybePromise;
  onAddSibling: (blockId: string, content: string) => MaybePromise;
  onIndent: (blockId: string) => void;
  onOutdent: (blockId: string) => void;
  onSetProperty: (blockId: string, key: string, value: string) => void;
  onRemoveProperty: (blockId: string, key: string) => void;
  onDeleteBlock: (blockId: string) => MaybePromise;
  onCreateCard: (block: Block) => void;
  backlinks: BacklinkReference[];
  onOpenPage: (pageId: string) => void;
  onOpenBlock: (pageId: string, blockId: string) => void;
  onOpenPageByName: (name: string) => void;
}) {
  const [newBlock, setNewBlock] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const blockOrder = useMemo(() => flattenBlocks(page.blocks).map((entry) => entry.block.id), [page.blocks]);

  useEffect(() => {
    setSelectedBlockId(focusedBlockId);
  }, [page.id, focusedBlockId]);

  function moveSelection(blockId: string, direction: -1 | 1) {
    const index = blockOrder.indexOf(blockId);
    const nextId = blockOrder[index + direction];
    if (nextId) {
      setSelectedBlockId(nextId);
    }
  }

  function submitQuickBlock(kind: "bullet" | "todo" | "card") {
    const content = singleLine(newBlock, "");
    if (!content) return;
    const nextContent =
      kind === "todo"
        ? `TODO ${stripTodoPrefix(content)}`
        : kind === "card"
          ? `${content.replace(/\s+#card$/i, "")} #card`
          : content;
    void onAddRootBlock(nextContent);
    setNewBlock("");
  }

  return (
    <section className="notes">
      <div className="page-title-row">
        <PageTitleEditor pageName={page.name} onRenamePage={onRenamePage} />
      </div>
      <PagePropertiesEditor
        properties={page.properties}
        onSetProperty={onSetPageProperty}
        onRemoveProperty={onRemovePageProperty}
      />
      <div className="blocks">
        {page.blocks.map((block) => (
          <BlockView
            key={block.id}
            block={block}
            depth={0}
            pages={pages}
            selectedBlockId={selectedBlockId}
            onSelectBlock={setSelectedBlockId}
            onUpdateBlock={onUpdateBlock}
            onAddChild={onAddChild}
            onAddSibling={onAddSibling}
            onIndent={onIndent}
            onOutdent={onOutdent}
            onSetProperty={onSetProperty}
            onRemoveProperty={onRemoveProperty}
            onDeleteBlock={onDeleteBlock}
            onCreateCard={onCreateCard}
            onMoveSelection={moveSelection}
            onOpenPageByName={onOpenPageByName}
          />
        ))}
      </div>
      <div className="new-block-row">
        <input
          value={newBlock}
          placeholder="Quick bullet, todo, or card seed"
          onChange={(event) => setNewBlock(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && newBlock.trim()) {
              submitQuickBlock("bullet");
            }
          }}
        />
        <button
          onClick={() => {
            submitQuickBlock("bullet");
          }}
        >
          Bullet
        </button>
        <button onClick={() => submitQuickBlock("todo")}>To Do</button>
        <button onClick={() => submitQuickBlock("card")}>Card</button>
      </div>
      <LinkedReferences backlinks={backlinks} onOpenPage={onOpenPage} onOpenBlock={onOpenBlock} />
    </section>
  );
}

function DocView({
  pages,
  editPages,
  selectedPage,
  selectedEditPageName,
  status,
  onSelectPage,
  onCreatePage,
  onOpenPageByName,
  onRenamePage,
  onUpdatePageMetadata,
  onDeletePage,
  onAddBlock,
  onAddSectionTemplate,
  onUpdateBlock,
  onDeleteBlock,
  onMoveBlock,
  onCreateCard,
  deckOptions,
  onDeckOptionsChange,
  onGenerateDeck,
  onGenerateSelection,
}: {
  pages: DocPage[];
  editPages: Page[];
  selectedPage?: DocPage;
  selectedEditPageName?: string;
  status: string | null;
  onSelectPage: (pageId: string) => void;
  onCreatePage: () => void;
  onOpenPageByName: (name: string) => void;
  onRenamePage: (pageId: string, title: string) => void;
  onUpdatePageMetadata: (pageId: string, tags: string[], source: string, language: string) => void;
  onDeletePage: (pageId: string) => void;
  onAddBlock: (pageId: string, kind: DocBlockKind) => void;
  onAddSectionTemplate: (pageId: string) => void;
  onUpdateBlock: (block: DocBlock) => void;
  onDeleteBlock: (blockId: string) => MaybePromise;
  onMoveBlock: (blockId: string, direction: number) => void;
  onCreateCard: (docPage: DocPage, block: DocBlock) => void;
  deckOptions: DocDeckOptions;
  onDeckOptionsChange: (patch: Partial<DocDeckOptions>) => void;
  onGenerateDeck: (docPage: DocPage) => void;
  onGenerateSelection: (docPage: DocPage, text: string) => void;
}) {
  const [docFilter, setDocFilter] = useState("");
  const filteredDocPages = useMemo(() => filterDocPages(pages, docFilter), [pages, docFilter]);

  if (!selectedPage) {
    return (
      <section className="doc-empty">
        <p>No doc pages yet.</p>
        <button className="primary" onClick={onCreatePage}>Create Doc Page</button>
        {status && <p className="status">{status}</p>}
      </section>
    );
  }

  const headings = selectedPage.blocks.filter((block) => block.kind === "heading" && block.content.trim());
  const blockCounts = countDocBlockKinds(selectedPage.blocks);
  const stats = docPageStats(selectedPage);

  return (
    <section className="doc">
      <aside className="doc-outline">
        <div className="doc-outline-heading">
          <strong>Docs</strong>
          <button onClick={onCreatePage}>+</button>
        </div>
        <div className="doc-outline-search">
          <input
            value={docFilter}
            placeholder="Search docs, tags, source"
            onChange={(event) => setDocFilter(event.target.value)}
          />
        </div>
        {filteredDocPages.length === 0 && <p className="doc-outline-empty">No docs match.</p>}
        {filteredDocPages.map((page) => (
          <button
            key={page.id}
            className={page.id === selectedPage.id ? "active" : ""}
            onClick={() => onSelectPage(page.id)}
          >
            <span>{page.title}</span>
            {page.tags.length > 0 && <small>{page.tags.slice(0, 2).join(", ")}</small>}
          </button>
        ))}
        <div className="doc-outline-section">
          <strong>Page Outline</strong>
          {headings.length === 0 ? (
            <span>No headings yet.</span>
          ) : (
            headings.map((heading) => (
              <button
                key={heading.id}
                className="doc-heading-link"
                onClick={() => document.getElementById(`doc-block-${heading.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
              >
                {heading.content}
              </button>
            ))
          )}
        </div>
        <div className="doc-outline-section compact">
          <strong>Blocks</strong>
          <span>{blockCounts.heading} headings</span>
          <span>{blockCounts.paragraph} paragraphs</span>
          <span>{blockCounts.todo} todos</span>
          <span>{blockCounts.quote} quotes</span>
        </div>
        <div className="doc-outline-section doc-ai-options">
          <strong>AI deck from Doc</strong>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={deckOptions.bidirectional}
              onChange={(event) => onDeckOptionsChange({ bidirectional: event.target.checked })}
            />
            Bidirectional cards
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={deckOptions.vocabulary}
              onChange={(event) => onDeckOptionsChange({ vocabulary: event.target.checked })}
            />
            Vocabulary deck
          </label>
          <input
            value={deckOptions.vocabularyDeck}
            placeholder="Vocabulary deck name"
            onChange={(event) => onDeckOptionsChange({ vocabularyDeck: event.target.value })}
          />
          <button className="primary" onClick={() => onGenerateDeck(selectedPage)}>Parse Doc Text</button>
          <small>Offline parser: extracts preview cards in Generate Cards. No paid API call.</small>
        </div>
      </aside>

      <article className="doc-page">
        <p className="doc-kicker">Documentation</p>
        <DocTitleEditor page={selectedPage} onRenamePage={onRenamePage} />
        <p className="doc-lead">
          Markdown-backed document editor with local SQLite persistence, autosave on blur/debounce, and offline deck generation.
        </p>
        <DocMetadataEditor page={selectedPage} onUpdatePageMetadata={onUpdatePageMetadata} />
        <div className="doc-stats-row">
          <span>{stats.words} words</span>
          <span>{stats.characters} characters</span>
          <span>{selectedPage.blocks.length} blocks</span>
          <span>Updated {formatShortDateTime(selectedPage.updatedAt)}</span>
          <span>Card target: {selectedEditPageName ?? "select an Edit Desk page"}</span>
        </div>
        <div className="doc-cover" />

        <div className="doc-toolbar ribbon">
          <span className="ribbon-label">Insert</span>
          <button onClick={() => onAddBlock(selectedPage.id, "paragraph")}>Paragraph</button>
          <button onClick={() => onAddBlock(selectedPage.id, "heading")}>Heading</button>
          <button onClick={() => onAddBlock(selectedPage.id, "todo")}>Todo</button>
          <button onClick={() => onAddBlock(selectedPage.id, "quote")}>Quote</button>
          <button className="primary" onClick={() => onAddSectionTemplate(selectedPage.id)}>Section Template</button>
          <span className="ribbon-label">Cards</span>
          <button className="primary" onClick={() => onGenerateDeck(selectedPage)}>AI Deck from Doc</button>
          <button className="danger subtle" onClick={() => onDeletePage(selectedPage.id)}>Delete Page</button>
        </div>
        {status && <p className="status">{status}</p>}

        <div className="doc-blocks">
          {selectedPage.blocks.length === 0 ? (
            <p className="empty-inline">No blocks yet. Add a paragraph, heading, todo, or quote.</p>
          ) : (
            selectedPage.blocks.map((block, index) => (
              <DocBlockEditor
                key={block.id}
                block={block}
                isFirst={index === 0}
                isLast={index === selectedPage.blocks.length - 1}
                onUpdateBlock={onUpdateBlock}
                onDeleteBlock={onDeleteBlock}
                onMoveBlock={onMoveBlock}
                pages={editPages}
                onOpenPageByName={onOpenPageByName}
                onCreateCard={(block) => onCreateCard(selectedPage, block)}
                onGenerateSelection={(text) => onGenerateSelection(selectedPage, text)}
              />
            ))
          )}
        </div>
      </article>
    </section>
  );
}

function DocMetadataEditor({
  page,
  onUpdatePageMetadata,
}: {
  page: DocPage;
  onUpdatePageMetadata: (pageId: string, tags: string[], source: string, language: string) => void;
}) {
  const [tagsDraft, setTagsDraft] = useState(page.tags.join(", "));
  const [sourceDraft, setSourceDraft] = useState(page.source);
  const [languageDraft, setLanguageDraft] = useState(page.language || "auto");

  useEffect(() => {
    setTagsDraft(page.tags.join(", "));
    setSourceDraft(page.source);
    setLanguageDraft(page.language || "auto");
  }, [page.id, page.tags, page.source, page.language]);

  function save() {
    const tags = splitTags(tagsDraft);
    if (
      tags.join(",") !== page.tags.join(",") ||
      sourceDraft.trim() !== page.source ||
      languageDraft !== page.language
    ) {
      onUpdatePageMetadata(page.id, tags, sourceDraft, languageDraft);
    }
  }

  return (
    <section className="doc-metadata">
      <label>
        Tags
        <input
          value={tagsDraft}
          placeholder="exam, linguistics, source-notes"
          onChange={(event) => setTagsDraft(event.target.value)}
          onBlur={save}
        />
      </label>
      <label>
        Source
        <input
          value={sourceDraft}
          placeholder="Book, lecture, URL, or own notes"
          onChange={(event) => setSourceDraft(event.target.value)}
          onBlur={save}
        />
      </label>
      <label>
        Language
        <select
          value={languageDraft}
          onChange={(event) => {
            const value = event.target.value;
            setLanguageDraft(value);
            onUpdatePageMetadata(page.id, splitTags(tagsDraft), sourceDraft, value);
          }}
        >
          <option value="auto">Auto</option>
          <option value="en">English</option>
          <option value="de">German</option>
        </select>
      </label>
      <button onClick={save}>Save metadata</button>
    </section>
  );
}

function DocTitleEditor({
  page,
  onRenamePage,
}: {
  page: DocPage;
  onRenamePage: (pageId: string, title: string) => void;
}) {
  const [draft, setDraft] = useState(page.title);

  useEffect(() => {
    setDraft(page.title);
  }, [page.id, page.title]);

  function save() {
    if (draft.trim() !== page.title) {
      onRenamePage(page.id, draft);
    }
  }

  return (
    <input
      className="doc-title-input"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function DocBlockEditor({
  block,
  isFirst,
  isLast,
  onUpdateBlock,
  onDeleteBlock,
  onMoveBlock,
  pages,
  onOpenPageByName,
  onCreateCard,
  onGenerateSelection,
}: {
  block: DocBlock;
  isFirst: boolean;
  isLast: boolean;
  onUpdateBlock: (block: DocBlock) => void;
  onDeleteBlock: (blockId: string) => void;
  onMoveBlock: (blockId: string, direction: number) => void;
  pages: Page[];
  onOpenPageByName: (name: string) => void;
  onCreateCard: (block: DocBlock) => void;
  onGenerateSelection: (text: string) => void;
}) {
  const [draft, setDraft] = useState(block.content);
  const [kind, setKind] = useState<DocBlockKind>(block.kind);
  const [checked, setChecked] = useState(block.checked);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving">("saved");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const links = useMemo(() => extractPageLinks(draft), [draft]);
  const stats = useMemo(() => textStats(draft), [draft]);

  useEffect(() => {
    setDraft(block.content);
    setKind(block.kind);
    setChecked(block.checked);
    setSaveState("saved");
  }, [block.id, block.content, block.kind, block.checked]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  function save(next?: Partial<DocBlock>) {
    const merged = {
      ...block,
      kind,
      content: draft,
      checked,
      ...next,
    };
    if (merged.kind !== block.kind || merged.content !== block.content || merged.checked !== block.checked) {
      setSaveState("saving");
      onUpdateBlock(merged);
      window.setTimeout(() => setSaveState("saved"), 260);
    } else {
      setSaveState("saved");
    }
  }

  function scheduleSave(nextDraft: string) {
    setDraft(nextDraft);
    setSaveState("dirty");
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      const merged = { ...block, kind, content: nextDraft, checked };
      setSaveState("saving");
      onUpdateBlock(merged);
      window.setTimeout(() => setSaveState("saved"), 260);
    }, 900);
  }

  function applyFormat(action: DocFormatAction) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const next = formatDocText(draft, textarea.selectionStart, textarea.selectionEnd, action);
    scheduleSave(next.value);
    window.setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(next.selectionStart, next.selectionEnd);
    }, 0);
  }

  function selectedOrFullText() {
    const textarea = textareaRef.current;
    if (!textarea) return draft;
    const selected = draft.slice(textarea.selectionStart, textarea.selectionEnd).trim();
    return selected || draft.trim();
  }

  return (
    <article id={`doc-block-${block.id}`} className={`doc-edit-block ${kind}`}>
      <div className="doc-block-controls">
        <select
          value={kind}
          onChange={(event) => {
            const nextKind = event.target.value as DocBlockKind;
            setKind(nextKind);
            save({ kind: nextKind });
          }}
        >
          <option value="paragraph">Paragraph</option>
          <option value="heading">Heading</option>
          <option value="todo">Todo</option>
          <option value="quote">Quote</option>
        </select>
        {kind === "todo" && (
          <label className="doc-check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => {
                const nextChecked = event.target.checked;
                setChecked(nextChecked);
                save({ checked: nextChecked });
              }}
            />
            Done
          </label>
        )}
        <span className={`doc-save-state ${saveState}`}>{saveState === "dirty" ? "Unsaved" : saveState === "saving" ? "Saving..." : "Saved"}</span>
        <button disabled={isFirst} onClick={() => onMoveBlock(block.id, -1)}>Up</button>
        <button disabled={isLast} onClick={() => onMoveBlock(block.id, 1)}>Down</button>
        <button onClick={() => onCreateCard({ ...block, kind, content: draft, checked })}>Create Card</button>
        <button onClick={() => onGenerateSelection(selectedOrFullText())}>Cards from selection</button>
        <button className="danger subtle" onClick={() => onDeleteBlock(block.id)}>Delete</button>
      </div>
      <div className="doc-format-toolbar" aria-label="Document formatting toolbar">
        <button title="Bold Ctrl+B" onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("bold")}>B</button>
        <button title="Italic Ctrl+I" onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("italic")}><em>I</em></button>
        <button title="Underline Ctrl+U" onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("underline")}><u>U</u></button>
        <button onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("heading1")}>H1</button>
        <button onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("heading2")}>H2</button>
        <button onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("bullet")}>• List</button>
        <button onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("numbered")}>1. List</button>
        <button onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("quote")}>Quote</button>
        <button onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("code")}>Code</button>
        <button onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("alignLeft")}>Left</button>
        <button onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("alignCenter")}>Center</button>
        <button onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("alignRight")}>Right</button>
      </div>
      <textarea
        ref={textareaRef}
        className="doc-page-textarea"
        value={draft}
        rows={kind === "heading" ? 2 : 7}
        placeholder={placeholderForDocKind(kind)}
        onChange={(event) => scheduleSave(event.target.value)}
        onBlur={() => save()}
        onKeyDown={(event) => {
          if (!(event.ctrlKey || event.metaKey)) return;
          const key = event.key.toLowerCase();
          if (key === "b" || key === "i" || key === "u") {
            event.preventDefault();
            applyFormat(key === "b" ? "bold" : key === "i" ? "italic" : "underline");
          }
        }}
      />
      <div className="doc-block-footer">
        <span>{stats.words} words</span>
        <span>{stats.characters} chars</span>
        <span>Markdown shortcuts enabled</span>
      </div>
      <PageLinkChips links={links} pages={pages} onOpenPageByName={onOpenPageByName} />
    </article>
  );
}

function PageTitleEditor({
  pageName,
  onRenamePage,
}: {
  pageName: string;
  onRenamePage: (name: string) => void;
}) {
  const [draft, setDraft] = useState(pageName);

  useEffect(() => {
    setDraft(pageName);
  }, [pageName]);

  const save = () => {
    if (draft.trim() && draft.trim() !== pageName) {
      onRenamePage(draft);
    }
  };

  return (
    <input
      className="page-title-input"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function PagePropertiesEditor({
  properties,
  onSetProperty,
  onRemoveProperty,
}: {
  properties: Record<string, string>;
  onSetProperty: (key: string, value: string) => void;
  onRemoveProperty: (key: string) => void;
}) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const propertyEntries = Object.entries(properties);

  const addProperty = () => {
    if (!newKey.trim()) return;
    onSetProperty(newKey, newValue);
    setNewKey("");
    setNewValue("");
  };

  return (
    <section className="page-properties">
      <div className="page-properties-heading">
        <h2>Page Properties</h2>
        <button onClick={() => {
          const deck = window.prompt("Page deck", properties["sgd-deck"] ?? "Unassigned");
          if (deck !== null) onSetProperty("sgd-deck", deck);
        }}>
          Deck
        </button>
        <button onClick={() => {
          const topic = window.prompt("Page topic", properties["sgd-topic"] ?? "General");
          if (topic !== null) onSetProperty("sgd-topic", topic);
        }}>
          Topic
        </button>
      </div>
      {propertyEntries.length > 0 && (
        <div className="page-property-list">
          {propertyEntries.map(([key, value]) => (
            <PagePropertyRow
              key={key}
              propertyKey={key}
              propertyValue={value}
              onSetProperty={onSetProperty}
              onRemoveProperty={onRemoveProperty}
            />
          ))}
        </div>
      )}
      <div className="page-property-add">
        <input
          value={newKey}
          placeholder="property"
          onChange={(event) => setNewKey(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              addProperty();
            }
          }}
        />
        <input
          value={newValue}
          placeholder="value"
          onChange={(event) => setNewValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              addProperty();
            }
          }}
        />
        <button onClick={addProperty}>Add</button>
      </div>
    </section>
  );
}

function PagePropertyRow({
  propertyKey,
  propertyValue,
  onSetProperty,
  onRemoveProperty,
}: {
  propertyKey: string;
  propertyValue: string;
  onSetProperty: (key: string, value: string) => void;
  onRemoveProperty: (key: string) => void;
}) {
  const [draft, setDraft] = useState(propertyValue);

  useEffect(() => {
    setDraft(propertyValue);
  }, [propertyValue]);

  const save = () => {
    if (draft !== propertyValue) {
      onSetProperty(propertyKey, draft);
    }
  };

  return (
    <div className="page-property-row">
      <span>{propertyKey}::</span>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
      <button onClick={save}>Save</button>
      <button className="subtle danger" onClick={() => onRemoveProperty(propertyKey)}>
        Remove
      </button>
    </div>
  );
}

function BlockView({
  block,
  depth,
  pages,
  selectedBlockId,
  onSelectBlock,
  onUpdateBlock,
  onAddChild,
  onAddSibling,
  onIndent,
  onOutdent,
  onSetProperty,
  onRemoveProperty,
  onDeleteBlock,
  onCreateCard,
  onMoveSelection,
  onOpenPageByName,
}: {
  block: Block;
  depth: number;
  pages: Page[];
  selectedBlockId: string | null;
  onSelectBlock: (blockId: string) => void;
  onUpdateBlock: (blockId: string, content: string) => MaybePromise;
  onAddChild: (blockId: string, content: string) => MaybePromise;
  onAddSibling: (blockId: string, content: string) => MaybePromise;
  onIndent: (blockId: string) => void;
  onOutdent: (blockId: string) => void;
  onSetProperty: (blockId: string, key: string, value: string) => void;
  onRemoveProperty: (blockId: string, key: string) => void;
  onDeleteBlock: (blockId: string) => void;
  onCreateCard: (block: Block) => void;
  onMoveSelection: (blockId: string, direction: -1 | 1) => void;
  onOpenPageByName: (name: string) => void;
}) {
  const [draft, setDraft] = useState(block.content);
  const pageLinks = useMemo(() => extractPageLinks(block.content), [block.content]);
  const blockRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(block.content);
  }, [block.content]);

  useEffect(() => {
    if (selectedBlockId === block.id) {
      blockRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [block.id, selectedBlockId]);

  const save = async () => {
    if (draft.trim() !== block.content) {
      await onUpdateBlock(block.id, draft);
    }
  };

  async function saveThen(action: () => MaybePromise) {
    await save();
    await action();
  }

  return (
    <div ref={blockRef} className={selectedBlockId === block.id ? "block selected" : "block"} style={{ marginLeft: depth * 22 }}>
      <div className="block-line editable">
        <span className="bullet" />
        <input
          ref={inputRef}
          value={draft}
          onFocus={() => onSelectBlock(block.id)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === "Tab") {
              event.preventDefault();
              if (event.shiftKey) {
                onOutdent(block.id);
              } else {
                onIndent(block.id);
              }
            }
            if (event.key === "Backspace" && draft.trim() === "" && block.children.length === 0) {
              event.preventDefault();
              void onDeleteBlock(block.id);
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              void saveThen(() => onMoveSelection(block.id, -1));
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              void saveThen(() => onMoveSelection(block.id, 1));
            }
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void saveThen(() => onAddChild(block.id, ""));
            } else if (event.key === "Enter") {
              event.preventDefault();
              void saveThen(() => onAddSibling(block.id, ""));
            }
          }}
        />
        <button onClick={() => void save()}>Save</button>
      </div>
      <PageLinkChips links={pageLinks} pages={pages} onOpenPageByName={onOpenPageByName} />
      {Object.entries(block.properties).map(([key, value]) => (
        <div className="block-property" key={key}>
          <span>{key}:: {value}</span>
          <button onClick={() => onRemoveProperty(block.id, key)}>Remove</button>
        </div>
      ))}
      <div className="block-actions">
        <button onClick={() => {
          const content = window.prompt("Sibling block content", "New block");
          if (content) void onAddSibling(block.id, content);
        }}>
          Add sibling
        </button>
        <button onClick={() => {
          const content = window.prompt("Child block content", "Answer or detail");
          if (content) void onAddChild(block.id, content);
        }}>
          Add child
        </button>
        <button onClick={() => onIndent(block.id)}>Indent</button>
        <button onClick={() => onOutdent(block.id)}>Outdent</button>
        <button onClick={() => onCreateCard(block)}>
          Create Card
        </button>
        <button onClick={() => {
          const deck = window.prompt("Deck", block.properties["sgd-deck"] ?? "Unassigned");
          if (deck !== null) onSetProperty(block.id, "sgd-deck", deck);
        }}>
          Deck
        </button>
        <button onClick={() => {
          const topic = window.prompt("Topic", block.properties["sgd-topic"] ?? "General");
          if (topic !== null) onSetProperty(block.id, "sgd-topic", topic);
        }}>
          Topic
        </button>
        <button className="danger subtle" onClick={() => {
          if (window.confirm("Delete this block and all child blocks?")) {
            onDeleteBlock(block.id);
          }
        }}>
          Delete
        </button>
      </div>
      {block.children.map((child) => (
        <BlockView
          key={child.id}
          block={child}
          depth={depth + 1}
          pages={pages}
          selectedBlockId={selectedBlockId}
          onSelectBlock={onSelectBlock}
          onUpdateBlock={onUpdateBlock}
          onAddChild={onAddChild}
          onAddSibling={onAddSibling}
          onIndent={onIndent}
          onOutdent={onOutdent}
          onSetProperty={onSetProperty}
          onRemoveProperty={onRemoveProperty}
          onDeleteBlock={onDeleteBlock}
          onCreateCard={onCreateCard}
          onMoveSelection={onMoveSelection}
          onOpenPageByName={onOpenPageByName}
        />
      ))}
    </div>
  );
}

function EmptyState({
  title,
  message,
  actions = [],
}: {
  title: string;
  message: string;
  actions?: Array<{ label: string; onClick: () => void; primary?: boolean }>;
}) {
  return (
    <section className="empty">
      <div className="empty-card">
        <h2>{title}</h2>
        <p>{message}</p>
        {actions.length > 0 && (
          <div className="button-row">
            {actions.map((action) => (
              <button
                key={action.label}
                className={action.primary ? "primary" : undefined}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function DashboardView({
  decks,
  onGenerateCards,
  onReviewDeck,
  onPracticeDeck,
  onShowGraph,
}: {
  decks: Array<{ deck: string; deck_slug: string; total: number; due: number; weak: number; newCards: number }>;
  onGenerateCards: () => void;
  onReviewDeck: (deckSlug: string) => void;
  onPracticeDeck: (deckSlug: string, mode: PracticeMode) => void;
  onShowGraph: (deckSlug: string) => void;
}) {
  if (decks.length === 0) {
    return (
      <EmptyState
        title="No cards yet"
        message="Create cards from notes or generate a first local preview deck to unlock review, practice, and graph views."
        actions={[{ label: "Generate Cards", onClick: onGenerateCards, primary: true }]}
      />
    );
  }

  return (
    <section className="deck-grid">
      {decks.map((deck) => (
        <article className="deck-card" key={deck.deck_slug}>
          <h2>{deck.deck}</h2>
          <p>Due: {deck.due} | New: {deck.newCards} | Weak: {deck.weak} | Total: {deck.total}</p>
          <div className="button-row">
            <button onClick={() => onReviewDeck(deck.deck_slug)}>Learn Due</button>
            <button onClick={() => onPracticeDeck(deck.deck_slug, "deck")}>Practice All</button>
            <button onClick={() => onPracticeDeck(deck.deck_slug, "new")}>New Cards</button>
            <button onClick={() => onPracticeDeck(deck.deck_slug, "weak")}>Weak Cards</button>
            <button onClick={() => onShowGraph(deck.deck_slug)}>Graph</button>
          </div>
        </article>
      ))}
    </section>
  );
}

function PageLinkChips({
  links,
  pages,
  onOpenPageByName,
}: {
  links: string[];
  pages: Page[];
  onOpenPageByName: (name: string) => void;
}) {
  if (links.length === 0) {
    return null;
  }

  return (
    <div className="page-link-chips">
      {links.map((link) => {
        const exists = pages.some((page) => normalizePageRef(page.name) === normalizePageRef(link));
        return (
          <button
            key={link}
            className={exists ? "page-link-chip" : "page-link-chip missing"}
            onClick={() => onOpenPageByName(link)}
            title={exists ? `Open ${link}` : `Create ${link}`}
          >
            {link}
          </button>
        );
      })}
    </div>
  );
}

function LinkedReferences({
  backlinks,
  onOpenPage,
  onOpenBlock,
}: {
  backlinks: BacklinkReference[];
  onOpenPage: (pageId: string) => void;
  onOpenBlock: (pageId: string, blockId: string) => void;
}) {
  const grouped = useMemo(() => groupBacklinksBySource(backlinks), [backlinks]);

  return (
    <section className="linked-references">
      <div className="linked-references-heading">
        <h2>Linked References</h2>
        <span>{backlinks.length}</span>
      </div>
      {grouped.length === 0 ? (
        <p className="empty-inline">No linked references yet.</p>
      ) : (
        grouped.map((group) => (
          <article className="reference-group" key={group.source_page_id}>
            <button className="reference-page" onClick={() => onOpenPage(group.source_page_id)}>
              {group.source_page}
            </button>
            <div className="reference-list">
              {group.references.map((reference) => (
                <button
                  className="reference-block"
                  key={reference.block_id}
                  onClick={() => onOpenBlock(reference.source_page_id, reference.block_id)}
                >
                  <span>{stripPageLinks(reference.block_content)}</span>
                  {reference.block_path.length > 1 && (
                    <small>{reference.block_path.slice(0, -1).map(stripPageLinks).join(" / ")}</small>
                  )}
                </button>
              ))}
            </div>
          </article>
        ))
      )}
    </section>
  );
}

function TodoView({
  pages,
  items,
  draft,
  targetPageId,
  status,
  onDraftChange,
  onTargetPageChange,
  onCreate,
  onSetStatus,
  onLearnItem,
  onEditBlock,
}: {
  pages: Page[];
  items: TodoItem[];
  draft: string;
  targetPageId: string;
  status: string | null;
  onDraftChange: (value: string) => void;
  onTargetPageChange: (pageId: string) => void;
  onCreate: (content: string, pageId: string) => void;
  onSetStatus: (item: TodoItem, status: TodoStatus) => void;
  onLearnItem: (item: TodoItem) => void;
  onEditBlock: (item: TodoItem) => void;
}) {
  const [filter, setFilter] = useState("");
  const filteredItems = useMemo(() => filterTodoItems(items, filter), [items, filter]);
  const openItems = filteredItems.filter((item) => item.status === "open");
  const doingItems = filteredItems.filter((item) => item.status === "doing");
  const doneItems = filteredItems.filter((item) => item.status === "done");
  const queueSummary = summarizeTodoMetrics(filteredItems.filter((item) => item.status !== "done"));
  const effectiveTargetPageId = targetPageId || pages[0]?.id || "";

  return (
    <section className="todo">
      <div className="todo-capture">
        <div>
          <h2>Learning Queue</h2>
          <p>Open auto-lists new, due, weak, and overdue topics. Move items to Next up to steer today's learning.</p>
        </div>
        <div className="todo-input-row">
          <input
            value={draft}
            placeholder="TODO Review CPU cache coherency"
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onCreate(draft, effectiveTargetPageId);
              }
            }}
          />
          <select value={effectiveTargetPageId} onChange={(event) => onTargetPageChange(event.target.value)}>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>{page.name}</option>
            ))}
          </select>
          <button className="primary" onClick={() => onCreate(draft, effectiveTargetPageId)}>Add</button>
        </div>
        {status && <p className="status">{status}</p>}
      </div>

      <div className="todo-toolbar">
        <input value={filter} placeholder="Filter tasks" onChange={(event) => setFilter(event.target.value)} />
        <span>{openItems.length} open</span>
        <span>{doingItems.length} next up</span>
        <span>{doneItems.length} done</span>
        <span>{queueSummary.dueCards} due</span>
        <span>{queueSummary.newCards} new</span>
        <span>{queueSummary.weakCards} weak</span>
        <span>~{queueSummary.estimatedMinutes} min</span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No learning to-dos yet"
          message="Capture a TODO above or add sgd-todo:: open to a source block. Due, weak, overdue, and new-card topics will also appear here automatically."
          actions={[{ label: "Add TODO", onClick: () => onCreate(draft || "TODO Review today's weakest topic", effectiveTargetPageId), primary: true }]}
        />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          title="No to-dos match this filter"
          message="Clear or loosen the filter to see your open, next-up, and done learning tasks."
          actions={[{ label: "Clear filter", onClick: () => setFilter(""), primary: true }]}
        />
      ) : (
        <div className="todo-board">
          <TodoColumn title="Open / To learn" items={openItems} onSetStatus={onSetStatus} onLearnItem={onLearnItem} onEditBlock={onEditBlock} />
          <TodoColumn title="Next up" items={doingItems} onSetStatus={onSetStatus} onLearnItem={onLearnItem} onEditBlock={onEditBlock} />
          <TodoColumn title="Done" items={doneItems} onSetStatus={onSetStatus} onLearnItem={onLearnItem} onEditBlock={onEditBlock} />
        </div>
      )}
    </section>
  );
}

function TodoColumn({
  title,
  items,
  onSetStatus,
  onLearnItem,
  onEditBlock,
}: {
  title: string;
  items: TodoItem[];
  onSetStatus: (item: TodoItem, status: TodoStatus) => void;
  onLearnItem: (item: TodoItem) => void;
  onEditBlock: (item: TodoItem) => void;
}) {
  return (
    <section className="todo-column">
      <div className="todo-column-heading">
        <h2>{title}</h2>
        <span>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="empty-inline">No tasks.</p>
      ) : (
        items.map((item) => (
          <article className={`todo-item ${item.status}`} key={item.id}>
            <button className="todo-title" onClick={() => onLearnItem(item)}>
              {todoItemTitle(item)}
            </button>
            <div className="todo-badges">
              <span>{todoTargetLabel(item)}</span>
              {item.hint && <span className="warning">{item.hint}</span>}
            </div>
            <small>{todoItemSubtitle(item)}</small>
            <div className="todo-metrics" aria-label="Queue metadata">
              <span>{item.metrics.totalCards} cards</span>
              <span>{item.metrics.dueCards} due</span>
              <span>{item.metrics.newCards} new</span>
              <span>{item.metrics.weakCards} weak</span>
              <span>~{item.metrics.estimatedMinutes} min</span>
            </div>
            <div className="todo-actions">
              <button className="primary" onClick={() => onLearnItem(item)}>{todoLearnButtonLabel(item)}</button>
              <button onClick={() => onEditBlock(item)}>Edit Source</button>
              <button disabled={item.status === "open"} onClick={() => onSetStatus(item, "open")}>Open</button>
              <button disabled={item.status === "doing"} onClick={() => onSetStatus(item, "doing")}>Next up</button>
              <button className="success" disabled={item.status === "done"} onClick={() => onSetStatus(item, "done")}>{item.scope === "topic" ? "Done Topic" : "Done"}</button>
            </div>
          </article>
        ))
      )}
    </section>
  );
}

function CardStudyMeta({ card }: { card: StudyCard }) {
  const badges = [
    isNewCard(card) ? "New" : "Review",
    isDue(card) ? "Due" : dueLabel(card),
    isWeak(card) ? "Weak" : null,
    card.incomplete ? "Incomplete" : null,
  ].filter((badge): badge is string => Boolean(badge));

  return (
    <div className="card-study-meta">
      <div className="card-badges">
        {badges.map((badge) => (
          <span key={badge}>{badge}</span>
        ))}
      </div>
      <dl>
        <div>
          <dt>Deck</dt>
          <dd>{card.deck}</dd>
        </div>
        <div>
          <dt>Topic</dt>
          <dd>{card.topic}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{card.source_page ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Ease</dt>
          <dd>{card.srs.ease.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Interval</dt>
          <dd>{card.srs.interval_days}d</dd>
        </div>
        <div>
          <dt>Reps</dt>
          <dd>{card.srs.reps}</dd>
        </div>
        <div>
          <dt>Lapses</dt>
          <dd>{card.srs.lapses}</dd>
        </div>
      </dl>
    </div>
  );
}

function StudyModeToggle({ mode, onChange }: { mode: StudyMode; onChange: (mode: StudyMode) => void }) {
  return (
    <div className="study-mode-toggle">
      <span>Study mode</span>
      <button className={mode === "classic" ? "active" : ""} onClick={() => onChange("classic")}>Classic Q/A</button>
      <button className={mode === "cloze" ? "active" : ""} onClick={() => onChange("cloze")}>AI Cloze blanks</button>
    </div>
  );
}

function ClozeAnswer({
  card,
  onRate,
  onResultChange,
}: {
  card: StudyCard;
  onRate?: (rating: Rating, clozeResult: ClozeSessionResult) => void;
  onResultChange?: (clozeResult: ClozeSessionResult) => void;
}) {
  const clozeResponse = useMemo(() => runLocalAiClozeGeneration({ card }), [card.id, card.answer_markdown, card.srs.reps, card.srs.ease]);
  const cloze = clozeResponse.cloze;
  const [answers, setAnswers] = useState<string[]>(() => cloze.blanks.map(() => ""));
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    setAnswers(cloze.blanks.map(() => ""));
    requestAnimationFrame(() => inputRefs.current[0]?.focus());
  }, [cloze.text]);

  const evaluation = evaluateClozeAnswers(cloze.blanks, answers);
  const sessionResult = useMemo(
    () => clozeEvaluationToResult(cloze.blanks, answers, evaluation.suggestedRating),
    [answers, cloze.blanks, evaluation.suggestedRating],
  );

  useEffect(() => {
    onResultChange?.(sessionResult);
  }, [onResultChange, sessionResult]);

  function focusBlank(blankIndex: number) {
    if (blankIndex < 0) return;
    requestAnimationFrame(() => inputRefs.current[blankIndex]?.focus());
  }

  function nextBlankIndex(fromIndex: number, nextAnswers = answers) {
    for (let candidate = fromIndex + 1; candidate < cloze.blanks.length; candidate += 1) {
      if (!(nextAnswers[candidate] ?? "").trim()) return candidate;
    }
    return fromIndex + 1 < cloze.blanks.length ? fromIndex + 1 : -1;
  }

  function applySuggestedRating() {
    if (onRate && evaluation.filledCount === cloze.blanks.length) {
      onRate(evaluation.suggestedRating, sessionResult);
    }
  }

  function updateAnswer(blankIndex: number, value: string) {
    setAnswers((current) => {
      const next = current.map((answer, answerIndex) => answerIndex === blankIndex ? value : answer);
      if (clozeAnswerMatches(value, cloze.blanks[blankIndex] ?? "").correct) {
        const nextIndex = nextBlankIndex(blankIndex, next);
        if (nextIndex >= 0) focusBlank(nextIndex);
      }
      return next;
    });
  }

  return (
    <article className="answer-card cloze-card">
      <h3>AI Cloze Answer</h3>
      <p className="cloze-hint">Offline local pipeline: fill the blacked-out key words. Enter moves to the next blank, then applies the suggested rating when all blanks are checked.</p>
      {clozeResponse.issues.some((issue) => issue.level !== "info") && (
        <ul className="quality-list compact">
          {clozeResponse.issues.filter((issue) => issue.level !== "info").map((issue, index) => (
            <li key={`${issue.code}-${index}`} className={`quality-${issue.level}`}>{issue.message}</li>
          ))}
        </ul>
      )}
      <div className="cloze-text">
        {cloze.parts.map((part, index) => (
          part.kind === "text" ? (
            <span key={index}>{part.value}</span>
          ) : (
            <input
              key={index}
              ref={(node) => {
                inputRefs.current[part.blankIndex] = node;
              }}
              aria-label={`Hidden word ${part.blankIndex + 1}`}
              value={answers[part.blankIndex] ?? ""}
              placeholder="█"
              onChange={(event) => updateAnswer(part.blankIndex, event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const firstEmpty = answers.findIndex((answer) => !answer.trim());
                if (firstEmpty >= 0) {
                  const nextIndex = firstEmpty === part.blankIndex ? nextBlankIndex(part.blankIndex) : firstEmpty;
                  focusBlank(nextIndex >= 0 ? nextIndex : part.blankIndex);
                  return;
                }
                applySuggestedRating();
              }}
              className={evaluation.results[part.blankIndex]?.correct ? "correct" : evaluation.results[part.blankIndex]?.filled ? "incorrect" : ""}
            />
          )
        ))}
      </div>
      {cloze.blanks.length === 0 && <p className="empty-inline">No strong cloze blanks could be generated for this answer. Use Classic Q/A for this card.</p>}
      <div className="cloze-evaluation">
        <strong>{evaluation.correctCount}/{cloze.blanks.length} correct</strong>
        <span>Suggested rating: {ratingLabel(evaluation.suggestedRating)}</span>
        <small>{evaluation.message}</small>
        {onRate && evaluation.filledCount === cloze.blanks.length && (
          <button onClick={applySuggestedRating}>Apply suggested rating</button>
        )}
      </div>
      {evaluation.results.some((result) => result.filled && !result.correct) && (
        <div className="cloze-corrections">
          {evaluation.results.map((result, index) => (
            result.filled && !result.correct ? <span key={index}>#{index + 1}: {cloze.blanks[index]}</span> : null
          ))}
        </div>
      )}
      <details>
        <summary>Show original answer</summary>
        <pre>{card.answer_markdown || "(No answer child blocks)"}</pre>
      </details>
    </article>
  );
}

function RecentSessionSummaries({ summaries }: { summaries: StoredSessionSummary[] }) {
  const recent = summaries.slice(0, 3);
  if (recent.length === 0) return null;
  return (
    <aside className="study-session-summary recent-session-summary">
      {recent.map((summary) => (
        <span key={summary.id}>
          {summary.kind} · {summary.scopeLabel} · {summary.answered} cards
          {summary.averageResponseTimeMs !== undefined ? ` · Ø ${formatDurationMs(summary.averageResponseTimeMs)}` : ""}
          {summary.clozeBlankCount ? ` · Cloze ${summary.clozeCorrectCount ?? 0}/${summary.clozeBlankCount}` : ""}
        </span>
      ))}
    </aside>
  );
}

function SessionStatsPanel({
  stats,
  currentResponseTimeMs,
}: {
  stats: SessionAnswerStat[];
  currentResponseTimeMs?: number;
}) {
  const answered = stats.length;
  const timedStats = stats.filter((stat) => typeof stat.responseTimeMs === "number");
  const averageMs = timedStats.length > 0
    ? timedStats.reduce((sum, stat) => sum + (stat.responseTimeMs ?? 0), 0) / timedStats.length
    : undefined;
  const counts = stats.reduce<Record<Rating, number>>((acc, stat) => {
    acc[stat.rating] += 1;
    return acc;
  }, { again: 0, hard: 0, good: 0, easy: 0 });
  const slowest = [...timedStats]
    .sort((left, right) => (right.responseTimeMs ?? 0) - (left.responseTimeMs ?? 0))
    .slice(0, 3);
  const clozeStats = stats
    .map((stat) => stat.clozeResult)
    .filter((result): result is ClozeSessionResult => Boolean(result));
  const clozeBlankCount = clozeStats.reduce((sum, result) => sum + result.blanks.length, 0);
  const clozeCorrectCount = clozeStats.reduce(
    (sum, result) => sum + result.blanks.filter((blank) => blank.correct).length,
    0,
  );

  if (answered === 0 && currentResponseTimeMs === undefined) {
    return null;
  }

  return (
    <aside className="study-session-summary">
      <span>Answered: {answered}</span>
      {currentResponseTimeMs !== undefined && <span>Current answer time: {formatDurationMs(currentResponseTimeMs)}</span>}
      {averageMs !== undefined && <span>Ø answer time: {formatDurationMs(averageMs)}</span>}
      <span>Again {counts.again} · Hard {counts.hard} · Good {counts.good} · Easy {counts.easy}</span>
      {clozeBlankCount > 0 && <span>Cloze: {clozeCorrectCount}/{clozeBlankCount} blanks correct</span>}
      {slowest.length > 0 && (
        <span>Slowest: {slowest.map((stat) => `${shorten(stat.question, 28)} (${formatDurationMs(stat.responseTimeMs ?? 0)})`).join(" · ")}</span>
      )}
    </aside>
  );
}

function SessionCompletionState({
  title,
  message,
  stats,
  actions,
}: {
  title: string;
  message: string;
  stats: SessionAnswerStat[];
  actions: Array<{ label: string; onClick: () => void; primary?: boolean }>;
}) {
  return (
    <section className="empty session-complete">
      <div className="empty-card">
        <h2>{title}</h2>
        <p>{message}</p>
        {stats.length > 0 && <SessionStatsPanel stats={stats} />}
        <div className="button-row">
          {actions.map((action) => (
            <button key={action.label} className={action.primary ? "primary" : undefined} onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function isInteractiveKeyTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, button, a, [contenteditable='true']"));
}


function ReviewView({
  card,
  index,
  total,
  scopeLabel,
  showAnswer,
  studyMode,
  onStudyModeChange,
  responseTimeMs,
  sessionStats,
  recentSummaries,
  allCardCount,
  onStartPractice,
  onGenerateCards,
  onOpenEditDesk,
  onShowAnswer,
  onSkip,
  onRate,
  onOpenCard,
}: {
  card?: StudyCard;
  index: number;
  total: number;
  scopeLabel: string;
  showAnswer: boolean;
  studyMode: StudyMode;
  onStudyModeChange: (mode: StudyMode) => void;
  responseTimeMs?: number;
  sessionStats: SessionAnswerStat[];
  recentSummaries: StoredSessionSummary[];
  allCardCount: number;
  onStartPractice: () => void;
  onGenerateCards: () => void;
  onOpenEditDesk: () => void;
  onShowAnswer: () => void;
  onSkip: () => void;
  onRate: (rating: Rating, clozeResult?: ClozeSessionResult) => void;
  onOpenCard: (card: StudyCard) => void;
}) {
  const reviewRef = useRef<HTMLElement | null>(null);
  const [latestClozeResult, setLatestClozeResult] = useState<ClozeSessionResult | undefined>();
  const progress = total > 0 ? Math.min(100, Math.round(((index + 1) / total) * 100)) : 0;
  const ratingClozeResult = studyMode === "cloze" ? latestClozeResult : undefined;

  useEffect(() => {
    setLatestClozeResult(undefined);
  }, [card?.id, showAnswer, studyMode]);

  useEffect(() => {
    if (showAnswer && studyMode === "cloze") return;
    window.setTimeout(() => reviewRef.current?.focus(), 0);
  }, [card?.id, showAnswer, studyMode]);

  if (!card) {
    if (sessionStats.length > 0) {
      return (
        <SessionCompletionState
          title="Review session complete"
          message={`Nice. ${sessionStats.length} card${sessionStats.length === 1 ? "" : "s"} handled for ${scopeLabel}.`}
          stats={sessionStats}
          actions={[
            { label: "Free Practice", onClick: onStartPractice, primary: true },
            { label: "Generate More Cards", onClick: onGenerateCards },
          ]}
        />
      );
    }

    return (
      <EmptyState
        title={allCardCount === 0 ? "No cards yet" : "No due cards right now"}
        message={allCardCount === 0
          ? "Create or generate a first card to start a review session."
          : `Nothing is due in ${scopeLabel}. Keep momentum with Free Practice or add new cards.`}
        actions={allCardCount === 0
          ? [
              { label: "Generate Cards", onClick: onGenerateCards, primary: true },
              { label: "Edit Desk", onClick: onOpenEditDesk },
            ]
          : [{ label: "Free Practice", onClick: onStartPractice, primary: true }]}
      />
    );
  }

  return (
    <section
      className="review"
      ref={reviewRef}
      tabIndex={0}
      onKeyDown={(event) => {
        if (isInteractiveKeyTarget(event.target)) return;
        if (!showAnswer && (event.key === " " || event.key === "Enter")) {
          event.preventDefault();
          onShowAnswer();
          return;
        }
        if (event.key.toLowerCase() === "s") {
          event.preventDefault();
          onSkip();
          return;
        }
        if (event.key.toLowerCase() === "o") {
          event.preventDefault();
          onOpenCard(card);
          return;
        }
        if (showAnswer) {
          if (event.key === "Enter") {
            event.preventDefault();
            onRate(studyMode === "cloze" ? (latestClozeResult?.suggestedRating ?? "good") : "good", ratingClozeResult);
            return;
          }
          const ratingByKey: Record<string, Rating> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
          const rating = ratingByKey[event.key];
          if (rating) {
            event.preventDefault();
            onRate(rating, ratingClozeResult);
          }
        }
      }}
    >
      <div className="review-session-head">
        <div className="review-meta">Card {index + 1} of {total} | {scopeLabel}</div>
        <div className="session-progress" aria-label={`${progress}% complete`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>
      <p className="keyboard-hint">Enter/Space reveal · 1 Again · 2 Hard · 3 Good · 4 Easy · S skip · O source · Tab moves normally</p>
      <StudyModeToggle mode={studyMode} onChange={onStudyModeChange} />
      <SessionStatsPanel stats={sessionStats} currentResponseTimeMs={showAnswer ? responseTimeMs : undefined} />
      <RecentSessionSummaries summaries={recentSummaries} />
      <article className="review-card">
        <h2>{card.question}</h2>
        <CardStudyMeta card={card} />
        {card.linked_pages.length > 0 && <p>Linked: {card.linked_pages.join(", ")}</p>}
      </article>
      {showAnswer && (
        studyMode === "cloze" ? (
          <ClozeAnswer card={card} onRate={onRate} onResultChange={setLatestClozeResult} />
        ) : (
          <article className="answer-card">
            <h3>Answer</h3>
            <pre>{card.answer_markdown || "(No answer child blocks)"}</pre>
          </article>
        )
      )}
      <div className="button-row">
        {!showAnswer ? (
          <>
            <button className="primary" onClick={onShowAnswer}>Show Answer</button>
            <button onClick={onSkip}>Skip</button>
            <button onClick={() => onOpenCard(card)}>Open Source Block</button>
          </>
        ) : (
          <>
            <button className="danger" onClick={() => onRate("again", ratingClozeResult)}>Again</button>
            <button className="warning" onClick={() => onRate("hard", ratingClozeResult)}>Hard</button>
            <button className="primary" onClick={() => onRate("good", ratingClozeResult)}>Good</button>
            <button className="success" onClick={() => onRate("easy", ratingClozeResult)}>Easy</button>
            <button onClick={() => onOpenCard(card)}>Edit Card</button>
          </>
        )}
      </div>
    </section>
  );
}

function FreePracticeView({
  card,
  index,
  total,
  cards,
  decks,
  mode,
  deckSlug,
  graphNodeLabel,
  showAnswer,
  studyMode,
  onStudyModeChange,
  responseTimeMs,
  sessionStats,
  recentSummaries,
  allCardCount,
  onGenerateCards,
  onOpenEditDesk,
  recordRatings,
  onModeChange,
  onDeckChange,
  onRecordRatingsChange,
  onShowAnswer,
  onSkip,
  onRate,
  onOpenCard,
}: {
  card?: StudyCard;
  index: number;
  total: number;
  cards: StudyCard[];
  decks: Array<{ deck: string; deck_slug: string; total: number; due: number; weak: number; newCards: number }>;
  mode: PracticeMode;
  deckSlug: string;
  graphNodeLabel: string;
  showAnswer: boolean;
  studyMode: StudyMode;
  onStudyModeChange: (mode: StudyMode) => void;
  responseTimeMs?: number;
  sessionStats: SessionAnswerStat[];
  recentSummaries: StoredSessionSummary[];
  allCardCount: number;
  onGenerateCards: () => void;
  onOpenEditDesk: () => void;
  recordRatings: boolean;
  onModeChange: (mode: PracticeMode) => void;
  onDeckChange: (deckSlug: string) => void;
  onRecordRatingsChange: (value: boolean) => void;
  onShowAnswer: () => void;
  onSkip: () => void;
  onRate: (rating: Rating, clozeResult?: ClozeSessionResult) => void;
  onOpenCard: (card: StudyCard) => void;
}) {
  const practiceRef = useRef<HTMLElement | null>(null);
  const [latestClozeResult, setLatestClozeResult] = useState<ClozeSessionResult | undefined>();
  const ratingClozeResult = studyMode === "cloze" ? latestClozeResult : undefined;
  const selectedDeckLabel =
    mode === "graph"
      ? `Graph: ${graphNodeLabel || "selected node"}`
      : mode === "all"
        ? "All decks"
        : decks.find((deck) => deck.deck_slug === deckSlug)?.deck ?? "All decks";
  const progress = total > 0 ? Math.min(100, Math.round(((index + 1) / total) * 100)) : 0;

  useEffect(() => {
    setLatestClozeResult(undefined);
  }, [card?.id, showAnswer, studyMode]);

  useEffect(() => {
    if (showAnswer && studyMode === "cloze") return;
    window.setTimeout(() => practiceRef.current?.focus(), 0);
  }, [card?.id, showAnswer, studyMode, mode, deckSlug]);

  return (
    <section
      className="practice"
      ref={practiceRef}
      tabIndex={0}
      onKeyDown={(event) => {
        if (!card || isInteractiveKeyTarget(event.target)) return;
        if (!showAnswer && (event.key === " " || event.key === "Enter")) {
          event.preventDefault();
          onShowAnswer();
          return;
        }
        if (event.key.toLowerCase() === "s") {
          event.preventDefault();
          onSkip();
          return;
        }
        if (event.key.toLowerCase() === "o") {
          event.preventDefault();
          onOpenCard(card);
          return;
        }
        if (showAnswer) {
          if (event.key === "Enter") {
            event.preventDefault();
            onRate(studyMode === "cloze" ? (latestClozeResult?.suggestedRating ?? "good") : "good", ratingClozeResult);
            return;
          }
          const ratingByKey: Record<string, Rating> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
          const rating = ratingByKey[event.key];
          if (rating) {
            event.preventDefault();
            onRate(rating, ratingClozeResult);
          }
        }
      }}
    >
      <div className="practice-controls">
        <label>
          Mode
          <select value={mode} onChange={(event) => onModeChange(event.target.value as PracticeMode)}>
            <option value="all">All cards</option>
            <option value="deck">Deck</option>
            <option value="weak">Weak cards</option>
            <option value="new">New cards</option>
            <option value="graph" disabled={!graphNodeLabel}>Graph node</option>
          </select>
        </label>
        <label>
          Deck
          <select value={deckSlug} onChange={(event) => onDeckChange(event.target.value)}>
            <option value="">All decks</option>
            {decks.map((deck) => (
              <option key={deck.deck_slug} value={deck.deck_slug}>{deck.deck}</option>
            ))}
          </select>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={recordRatings}
            onChange={(event) => onRecordRatingsChange(event.target.checked)}
          />
          Record ratings in SRS
        </label>
      </div>

      <StudyModeToggle mode={studyMode} onChange={onStudyModeChange} />
      <p className="keyboard-hint">Enter/Space reveal · 1 Again · 2 Hard · 3 Good · 4 Easy · S skip · O source · Tab moves normally</p>

      <div className="practice-summary">
        <span>{total} cards in queue</span>
        <span>{selectedDeckLabel}</span>
        <span>{cards.length} cards indexed</span>
        {!recordRatings && <strong>Practice-only: SRS unchanged</strong>}
      </div>
      {recordRatings && <SessionStatsPanel stats={sessionStats} currentResponseTimeMs={showAnswer ? responseTimeMs : undefined} />}
      <RecentSessionSummaries summaries={recentSummaries} />

      {!card ? (
        sessionStats.length > 0 ? (
          <SessionCompletionState
            title="Practice session complete"
            message={`You reached the end of ${selectedDeckLabel}.`}
            stats={sessionStats}
            actions={[
              { label: "All Cards", onClick: () => onModeChange("all"), primary: true },
              { label: "Generate More Cards", onClick: onGenerateCards },
            ]}
          />
        ) : (
          <EmptyState
            title={allCardCount === 0 ? "No cards yet" : "No cards match this practice filter"}
            message={allCardCount === 0
              ? "Create or generate a first card before starting practice."
              : "Try All cards, choose another deck, or add cards for this filter."}
            actions={allCardCount === 0
              ? [
                  { label: "Generate Cards", onClick: onGenerateCards, primary: true },
                  { label: "Edit Desk", onClick: onOpenEditDesk },
                ]
              : [{ label: "All Cards", onClick: () => onModeChange("all"), primary: true }]}
          />
        )
      ) : (
        <>
          <div className="review-session-head">
            <div className="review-meta">Practice {index + 1} of {total} | {card.deck} / {card.topic}</div>
            <div className="session-progress" aria-label={`${progress}% complete`}>
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
          <article className="review-card">
            <h2>{card.question}</h2>
            <CardStudyMeta card={card} />
            {card.linked_pages.length > 0 && <p>Linked: {card.linked_pages.join(", ")}</p>}
          </article>
          {showAnswer && (
            studyMode === "cloze" ? (
              <ClozeAnswer card={card} onRate={onRate} onResultChange={setLatestClozeResult} />
            ) : (
              <article className="answer-card">
                <h3>Answer</h3>
                <pre>{card.answer_markdown || "(No answer child blocks)"}</pre>
              </article>
            )
          )}
          <div className="button-row">
            {!showAnswer ? (
              <>
                <button className="primary" onClick={onShowAnswer}>Show Answer</button>
                <button onClick={onSkip}>Skip</button>
                <button onClick={() => onOpenCard(card)}>Open Source Block</button>
              </>
            ) : (
              <>
                <button className="danger" onClick={() => onRate("again", ratingClozeResult)}>Again</button>
                <button className="warning" onClick={() => onRate("hard", ratingClozeResult)}>Hard</button>
                <button className="primary" onClick={() => onRate("good", ratingClozeResult)}>Good</button>
                <button className="success" onClick={() => onRate("easy", ratingClozeResult)}>Easy</button>
                <button onClick={() => onOpenCard(card)}>Edit Card</button>
                <button onClick={onSkip}>Skip</button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function GraphView({
  snapshot,
  selectedNode,
  onSelectNode,
  onStartDue,
  onPractice,
  onGenerateCards,
  onOpenCard,
  onOpenPageByName,
}: {
  snapshot: DesktopSnapshot;
  selectedNode: StudyGraphNode | null;
  onSelectNode: (node: StudyGraphNode) => void;
  onStartDue: (node: StudyGraphNode) => void;
  onPractice: (node: StudyGraphNode) => void;
  onGenerateCards: () => void;
  onOpenCard: (card: StudyCard) => void;
  onOpenPageByName: (name: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [statusFilter, setStatusFilter] = useState<GraphStatusFilter>("all");
  const [deckFilter, setDeckFilter] = useState("all");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const decks = useMemo(() => groupCardsByDeck(snapshot.cards), [snapshot.cards]);
  const graphData = useMemo(
    () => filterGraphForView(snapshot, statusFilter, deckFilter),
    [snapshot, statusFilter, deckFilter],
  );
  const layout = useMemo(() => layoutGraph(graphData.nodes, graphData.edges), [graphData]);
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const visibleNodeIds = new Set(graphData.nodes.map((node) => node.id));
  const selectedCards = selectedNode ? cardsForGraphNode(snapshot.cards, selectedNode.id) : [];
  const filteredSelectedCards = applyGraphCardFilters(selectedCards, statusFilter, deckFilter);
  const detailCards = filteredSelectedCards.length > 0 || statusFilter !== "all" || deckFilter !== "all" ? filteredSelectedCards : selectedCards;
  const selectedStats = summarizeCards(detailCards);
  const selectedDueCount = detailCards.filter(isDue).length;
  const selectedCard = selectedNode?.kind === "card" ? selectedCards[0] : undefined;
  const graphStats = summarizeCards(applyGraphCardFilters(snapshot.cards, statusFilter, deckFilter));
  const canOpenPage =
    selectedNode &&
    selectedNode.kind !== "card" &&
    !isSystemGraphNode(selectedNode) &&
    !selectedNode.label.startsWith("#");

  function fitToScreen() {
    const container = scrollRef.current;
    if (!container) return;
    const nextZoom = clampZoom(Math.min(container.clientWidth / layout.size.width, container.clientHeight / layout.size.height) * 0.96);
    setZoom(nextZoom);
    requestAnimationFrame(() => {
      container.scrollLeft = 0;
      container.scrollTop = 0;
    });
  }

  function resetView() {
    setZoom(1);
    requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container) return;
      container.scrollLeft = 0;
      container.scrollTop = 0;
    });
  }

  return (
    <section className="graph-layout">
      <div className="graph-panel">
        <div className="graph-toolbar">
          <div className="graph-filters">
            <label>
              Status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as GraphStatusFilter)}>
                <option value="all">All cards</option>
                <option value="due">Due now</option>
                <option value="overdue">Overdue review</option>
                <option value="weak">Weak</option>
                <option value="new">New</option>
              </select>
            </label>
            <label>
              Deck
              <select value={deckFilter} onChange={(event) => setDeckFilter(event.target.value)}>
                <option value="all">All decks</option>
                {decks.map((deck) => (
                  <option key={deck.deck_slug} value={deck.deck_slug}>{deck.deck}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="graph-controls">
            <button onClick={() => setZoom((current) => clampZoom(current - 0.15))}>−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((current) => clampZoom(current + 0.15))}>+</button>
            <button onClick={fitToScreen}>Fit</button>
            <button onClick={resetView}>Reset</button>
          </div>
        </div>
        <div className="graph-summary" aria-label="Visible graph summary">
          <span>{graphData.nodes.length} nodes</span>
          <span>{graphData.edges.length} edges</span>
          <strong>{graphStats.due} due</strong>
          <span>{graphStats.overdue} overdue</span>
          <span>{graphStats.weak} weak</span>
          <span>{graphStats.newCards} new</span>
        </div>
        <div
          ref={scrollRef}
          className="graph-scroll"
          onMouseDown={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest(".node")) return;
            const container = scrollRef.current;
            if (!container) return;
            dragRef.current = { x: event.clientX, y: event.clientY, left: container.scrollLeft, top: container.scrollTop };
            container.classList.add("is-panning");
          }}
          onMouseMove={(event) => {
            const drag = dragRef.current;
            const container = scrollRef.current;
            if (!drag || !container) return;
            container.scrollLeft = drag.left - (event.clientX - drag.x);
            container.scrollTop = drag.top - (event.clientY - drag.y);
          }}
          onMouseUp={() => {
            dragRef.current = null;
            scrollRef.current?.classList.remove("is-panning");
          }}
          onMouseLeave={() => {
            dragRef.current = null;
            scrollRef.current?.classList.remove("is-panning");
          }}
        >
          <svg
            className="graph"
            style={{ width: `${layout.size.width * zoom}px`, height: `${layout.size.height * zoom}px` }}
            viewBox={`0 0 ${layout.size.width} ${layout.size.height}`}
          >
            {graphData.edges.map((edge) => {
              const source = byId.get(edge.source);
              const target = byId.get(edge.target);
              if (!source || !target) return null;
              return <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={`edge ${edge.kind}`} />;
            })}
            {layout.nodes.map((node) => {
              const stats = summarizeCards(cardsForGraphNode(snapshot.cards, node.id));
              const isSelected = selectedNode?.id === node.id;
              return (
                <g
                  key={node.id}
                  className={`node ${node.kind} ${graphNodeSignalClasses(stats, isSelected)}`}
                  transform={`translate(${node.x} ${node.y})`}
                  onClick={() => onSelectNode(node)}
                >
                  <circle r={nodeRadius(node)} />
                  {(stats.overdue > 0 || stats.weak > 0) && <circle className="node-ring" r={nodeRadius(node) + 6} />}
                  <text y={nodeRadius(node) + 17}>{shorten(node.label, 28)}</text>
                </g>
              );
            })}
          </svg>
          {layout.nodes.length === 0 && (
            <div className="graph-empty">
              <div className="empty-card compact">
                <h2>{snapshot.cards.length === 0 ? "Graph is empty" : "No graph nodes match these filters"}</h2>
                <p>{snapshot.cards.length === 0
                  ? "Add or generate cards first; decks, topics, linked pages, and cards will appear here automatically."
                  : "Reset filters to see the full learning graph again."}</p>
                {snapshot.cards.length === 0 ? (
                  <button className="primary" onClick={onGenerateCards}>Generate Cards</button>
                ) : (
                  <button className="primary" onClick={() => {
                    setStatusFilter("all");
                    setDeckFilter("all");
                  }}>Reset filters</button>
                )}
              </div>
            </div>
          )}
        </div>
        <p className="graph-hint">Drag the background or use scrollbars to pan. Fit brings large decks/topics back into view.</p>
      </div>
      <aside className="details">
        {selectedNode ? (
          <>
            <div className="details-heading">
              <div>
                <h2>{selectedNode.label}</h2>
                <p>{selectedNode.kind}{visibleNodeIds.has(selectedNode.id) ? "" : " · hidden by current filters"}</p>
              </div>
              {isSystemGraphNode(selectedNode) && <span className="signal-badge">cluster</span>}
            </div>
            <dl className="details-stats">
              <dt>Total</dt><dd>{selectedStats.total}</dd>
              <dt>Due now</dt><dd>{selectedStats.due}</dd>
              <dt>Overdue</dt><dd>{selectedStats.overdue}</dd>
              <dt>Weak</dt><dd>{selectedStats.weak}</dd>
              <dt>New</dt><dd>{selectedStats.newCards}</dd>
              <dt>Upcoming</dt><dd>{selectedStats.upcoming}</dd>
              <dt>Avg ease</dt><dd>{selectedStats.total > 0 ? selectedStats.averageEase.toFixed(2) : "—"}</dd>
              <dt>Avg interval</dt><dd>{selectedStats.total > 0 ? `${selectedStats.averageIntervalDays.toFixed(1)}d` : "—"}</dd>
            </dl>
            <div className="button-row">
              <button onClick={() => onStartDue(selectedNode)} disabled={selectedDueCount === 0}>Learn Due</button>
              <button onClick={() => onPractice(selectedNode)} disabled={detailCards.length === 0}>Practice Visible</button>
              {selectedCard && <button onClick={() => onOpenCard(selectedCard)}>Open Source Block</button>}
              {canOpenPage && <button onClick={() => onOpenPageByName(selectedNode.label)}>Open Page</button>}
            </div>
            {selectedStats.topTopics.length > 0 && (
              <div className="details-card-list compact">
                <strong>Topic pressure</strong>
                {selectedStats.topTopics.slice(0, 6).map((topic) => (
                  <span key={`${topic.deck}:${topic.topic}`}>
                    {topic.topic} · {topic.count} cards · {topic.due} due · {topic.weak} weak
                  </span>
                ))}
              </div>
            )}
            {selectedCard && (
              <article className="details-card">
                <strong>{selectedCard.question}</strong>
                <p>{selectedCard.answer_markdown || "(No answer child blocks)"}</p>
              </article>
            )}
            {detailCards.length > 1 && (
              <div className="details-card-list">
                <strong>Related cards ({detailCards.length})</strong>
                {detailCards.slice(0, 12).map((card) => (
                  <button key={card.id} onClick={() => onOpenCard(card)} className={isWeak(card) || isOverdue(card) ? "attention" : undefined}>
                    {shorten(card.question, 52)}
                    <small>{card.deck} / {card.topic} · {dueLabel(card)}</small>
                  </button>
                ))}
                {detailCards.length > 12 && <span className="details-more">+{detailCards.length - 12} more cards hidden</span>}
              </div>
            )}
          </>
        ) : (
          <p>Select a graph node. Use filters to isolate due, weak, new, or deck-specific clusters.</p>
        )}
      </aside>
    </section>
  );
}

function GeneratorView({
  input,
  cards,
  issues,
  status,
  selectedPageName,
  onInputChange,
  onGenerate,
  onCopy,
  onInsert,
}: {
  input: CardGeneratorInput;
  cards: GeneratedCard[];
  issues: AiQualityIssue[];
  status: string | null;
  selectedPageName?: string;
  onInputChange: (patch: Partial<CardGeneratorInput>) => void;
  onGenerate: () => void;
  onCopy: () => void;
  onInsert: () => void;
}) {
  const markdownPreview = useMemo(() => formatGeneratedCardsAsMarkdown(cards), [cards]);
  const sourceTextReady = input.source_text.trim().length > 0;
  const externalAiStatus = "External API disabled";

  return (
    <section className="generate">
      <div className="generator-panel">
        <div className="generator-heading">
          <div>
            <h2>Offline AI Pipeline</h2>
            <p>Provider: local heuristic v1. Creates deterministic card and cloze previews locally; no text leaves this device.</p>
          </div>
          <span>{selectedPageName ? `Target page: ${selectedPageName}` : "No page selected"}</span>
        </div>

        <aside className="privacy-note">
          External OpenAI/API settings are metadata-only in this build. Future provider hookup belongs in <code>aiPipeline.ts</code> and must pass explicit privacy/quality checks before requests are enabled.
        </aside>

        <aside className="readiness-card" aria-label="AI pipeline status">
          <strong>AI readiness</strong>
          <ul>
            <li>Local heuristic provider: ready</li>
            <li>Source text: {sourceTextReady ? "ready for preview" : "missing"}</li>
            <li>{externalAiStatus}; no paid API call is made from this UI.</li>
          </ul>
        </aside>

        <div className="generator-grid">
          <label>
            Deck
            <input value={input.deck} onChange={(event) => onInputChange({ deck: event.target.value })} />
          </label>
          <label>
            Topic
            <input value={input.topic} onChange={(event) => onInputChange({ topic: event.target.value })} />
          </label>
          <label>
            Language
            <select
              value={input.language}
              onChange={(event) => onInputChange({ language: event.target.value as CardGeneratorInput["language"] })}
            >
              <option value="auto">Auto</option>
              <option value="de">German</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            Cards
            <input
              type="number"
              min={1}
              max={30}
              value={input.number_of_cards}
              onChange={(event) => onInputChange({ number_of_cards: clampNumber(event.target.valueAsNumber, 1, 30) })}
            />
          </label>
          <label>
            Difficulty
            <select
              value={input.difficulty}
              onChange={(event) => onInputChange({ difficulty: event.target.value as CardGeneratorInput["difficulty"] })}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <label>
            Style
            <select
              value={input.card_style}
              onChange={(event) => onInputChange({ card_style: event.target.value as CardGeneratorInput["card_style"] })}
            >
              <option value="basic">Basic</option>
              <option value="cloze">Cloze-like</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          <label className="toggle-row generator-toggle">
            <input
              type="checkbox"
              checked={input.bidirectional_cards}
              onChange={(event) => onInputChange({ bidirectional_cards: event.target.checked })}
            />
            Bidirectional cards
          </label>
          <label className="toggle-row generator-toggle">
            <input
              type="checkbox"
              checked={input.vocabulary_mode}
              onChange={(event) => onInputChange({ vocabulary_mode: event.target.checked })}
            />
            Vocabulary / language deck
          </label>
          <label>
            Vocabulary deck
            <input value={input.vocabulary_deck} onChange={(event) => onInputChange({ vocabulary_deck: event.target.value })} />
          </label>
        </div>

        <label>
          Source text
          <textarea
            value={input.source_text}
            onChange={(event) => onInputChange({ source_text: event.target.value })}
            rows={10}
            placeholder="Paste notes, an article excerpt, or your own explanation here."
          />
        </label>

        <div className="button-row">
          <button className="primary" onClick={onGenerate}>Generate Preview</button>
          <button onClick={onInsert} disabled={cards.length === 0}>Insert into Current Page</button>
          <button onClick={onCopy} disabled={cards.length === 0}>Copy as Markdown</button>
        </div>
        {status && <p className="status">{status}</p>}
        {issues.length > 0 && (
          <ul className="quality-list">
            {issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`} className={`quality-${issue.level}`}>
                <strong>{issue.level}</strong> · {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="generator-preview">
        {cards.length === 0 ? (
          <section className="empty">Generated cards will appear here for review before insertion.</section>
        ) : (
          <>
            <div className="generated-list">
              {cards.map((card, index) => (
                <article className="generated-card" key={`${card.question}-${index}`}>
                  <div className="generated-card-heading">
                    <strong>{index + 1}. {card.question}</strong>
                    <small>{card.deck} / {card.topic}</small>
                  </div>
                  <p>{card.answer}</p>
                  {card.tags.length > 0 && <small>Tags: {card.tags.join(", ")}</small>}
                </article>
              ))}
            </div>
            <label>
              Markdown preview
              <textarea
                value={markdownPreview}
                readOnly
                rows={Math.min(18, Math.max(8, markdownPreview.split("\n").length + 1))}
              />
            </label>
          </>
        )}
      </div>
    </section>
  );
}

function SettingsView({
  settings,
  snapshot,
  decks,
  debugInfo,
  debugStatus,
  settingsStatus,
  lastRefreshAt,
  onSettingsChange,
  onReloadSettings,
  onRefreshDebug,
  onApplyGeneratorDefaults,
}: {
  settings: AppSettings;
  snapshot: DesktopSnapshot | null;
  decks: Array<{ deck: string; deck_slug: string; total: number; due: number; weak: number; newCards: number }>;
  debugInfo: AppDebugInfo | null;
  debugStatus: string | null;
  settingsStatus: string | null;
  lastRefreshAt: string | null;
  onSettingsChange: (patch: Partial<AppSettings>) => void;
  onReloadSettings: () => void;
  onRefreshDebug: () => void;
  onApplyGeneratorDefaults: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const totalBlocks = useMemo(() => countBlocks(snapshot?.workspace.pages ?? []), [snapshot]);
  const topicCount = useMemo(
    () => new Set((snapshot?.cards ?? []).map((card) => `${card.deck_slug}:${card.topic_slug}`)).size,
    [snapshot],
  );
  const incompleteCards = snapshot?.cards.filter((card) => card.incomplete).length ?? 0;
  const storageStatus = debugInfo?.database_path
    ? `SQLite ready at ${debugInfo.database_path}`
    : snapshot
      ? "Workspace loaded; database path not reported yet."
      : "Workspace not loaded yet.";
  const debugReport = useMemo(
    () => buildDebugReport({
      settings,
      snapshot,
      decks,
      debugInfo,
      lastRefreshAt,
      totalBlocks,
      topicCount,
      incompleteCards,
    }),
    [settings, snapshot, decks, debugInfo, lastRefreshAt, totalBlocks, topicCount, incompleteCards],
  );

  async function copyReport() {
    setCopyStatus(null);
    try {
      await navigator.clipboard.writeText(debugReport);
      setCopyStatus("Debug report copied to clipboard.");
    } catch {
      setCopyStatus("Clipboard is not available. Select the report manually.");
    }
  }

  function selectOpenAiAccountMode() {
    const email = window.prompt("Optional account email label (no OAuth happens in this local build)", settings.openAiAccountEmail || "");
    if (email === null) return;
    onSettingsChange({
      apiProviderEnabled: true,
      openAiConnectionMode: "account",
      openAiAccountEmail: email.trim(),
      openAiAccountStatus: "oauth-not-configured",
    });
  }

  function saveApiKeyMetadata() {
    const trimmed = apiKeyDraft.trim();
    if (!trimmed) {
      onSettingsChange({
        openAiConnectionMode: "apiKey",
        openAiApiKeyConfigured: false,
        openAiApiKeyLastFour: "",
      });
      return;
    }

    onSettingsChange({
      apiProviderEnabled: true,
      openAiConnectionMode: "apiKey",
      openAiAccountStatus: "api-key-metadata-only",
      openAiApiKeyConfigured: true,
      openAiApiKeyLastFour: trimmed.slice(-4),
    });
    setApiKeyDraft("");
  }

  return (
    <section className="settings">
      <div className="settings-grid">
        <article className="settings-panel">
          <div className="settings-heading">
            <h2>Learning Defaults</h2>
            <button onClick={onReloadSettings}>Reload</button>
          </div>
          <label>
            Default deck
            <input value={settings.defaultDeck} onChange={(event) => onSettingsChange({ defaultDeck: event.target.value })} />
          </label>
          <label>
            Default topic
            <input value={settings.defaultTopic} onChange={(event) => onSettingsChange({ defaultTopic: event.target.value })} />
          </label>
          <div className="settings-two-col">
            <label>
              New cards/day
              <input
                type="number"
                min={0}
                max={500}
                value={settings.newCardsPerDay}
                onChange={(event) => onSettingsChange({ newCardsPerDay: clampNumber(event.target.valueAsNumber, 0, 500) })}
              />
            </label>
            <label>
              Reviews/day
              <input
                type="number"
                min={0}
                max={2000}
                value={settings.reviewsPerDay}
                onChange={(event) => onSettingsChange({ reviewsPerDay: clampNumber(event.target.valueAsNumber, 0, 2000) })}
              />
            </label>
          </div>
          <div className="button-row">
            <button onClick={onApplyGeneratorDefaults}>Apply Defaults to Generator</button>
          </div>
          {settingsStatus && <p className="status">{settingsStatus}</p>}
        </article>

        <article className="settings-panel">
          <h2>GPT / OpenAI Connection</h2>
          <p className="settings-note">Provider settings are explicit and local. The card generator stays offline until a secure API/OAuth implementation exists.</p>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.apiProviderEnabled}
              onChange={(event) => onSettingsChange({ apiProviderEnabled: event.target.checked })}
            />
            Enable AI provider settings
          </label>
          <label>
            Connection mode
            <select
              value={settings.openAiConnectionMode}
              onChange={(event) => onSettingsChange({ openAiConnectionMode: event.target.value as AppSettings["openAiConnectionMode"] })}
            >
              <option value="none">Not connected</option>
              <option value="account">GPT/OpenAI account (OAuth not available locally)</option>
              <option value="apiKey">API key fallback</option>
            </select>
          </label>
          <div className="button-row">
            <button className="primary" onClick={selectOpenAiAccountMode}>Select Account Mode</button>
            <button
              onClick={() => onSettingsChange({
                apiProviderEnabled: false,
                openAiConnectionMode: "none",
                openAiAccountStatus: "not-connected",
                openAiAccountEmail: "",
                openAiApiKeyConfigured: false,
                openAiApiKeyLastFour: "",
              })}
            >
              Disconnect
            </button>
          </div>
          <div className="debug-stats">
            <span>Account: {settings.openAiAccountStatus}</span>
            <span>Email: {settings.openAiAccountEmail || "not set"}</span>
            <span>API key: {settings.openAiApiKeyConfigured ? `configured (*${settings.openAiApiKeyLastFour})` : "not stored"}</span>
          </div>
          <label>
            API key fallback (not stored; only last four characters are remembered)
            <input
              type="password"
              value={apiKeyDraft}
              placeholder={settings.openAiApiKeyConfigured ? `Configured, ending ${settings.openAiApiKeyLastFour}` : "sk-..."}
              onChange={(event) => setApiKeyDraft(event.target.value)}
            />
          </label>
          <div className="button-row">
            <button onClick={saveApiKeyMetadata}>Remember API Key Metadata</button>
            <button onClick={() => {
              setApiKeyDraft("");
              onSettingsChange({ openAiApiKeyConfigured: false, openAiApiKeyLastFour: "" });
            }}>Clear API Key Metadata</button>
          </div>
          <label>
            API base URL
            <input value={settings.apiBaseUrl} onChange={(event) => onSettingsChange({ apiBaseUrl: event.target.value })} />
          </label>
          <label>
            Model
            <input value={settings.apiModel} onChange={(event) => onSettingsChange({ apiModel: event.target.value })} />
          </label>
          <p className="settings-note">No OAuth flow, API-key validation, external request, or paid API call is performed. Use a system keychain or environment-based backend before enabling real requests.</p>
        </article>
      </div>

      <article className="settings-panel">
        <div className="settings-heading">
          <h2>Storage & Smoke Test</h2>
          <button onClick={onRefreshDebug}>Refresh Storage Info</button>
        </div>
        <p className="settings-note">{storageStatus}</p>
        <dl className="debug-paths">
          <dt>Required checks</dt>
          <dd><code>cargo test -p studygraph_core</code>, <code>npm test</code>, <code>npm run build</code></dd>
          <dt>Linux UI deps</dt>
          <dd><code>libwebkit2gtk-4.1-dev</code>, <code>libjavascriptcoregtk-4.1-dev</code>, <code>libsoup-3.0-dev</code>, <code>libgtk-3-dev</code>, <code>libayatana-appindicator3-dev</code>, <code>librsvg2-dev</code></dd>
          <dt>Smoke command</dt>
          <dd><code>npm run smoke:tauri</code> or <code>RUN_TAURI_DEV=1 npm run smoke:tauri</code> for the interactive window.</dd>
        </dl>
        {debugStatus && <p className="status">{debugStatus}</p>}
      </article>

      <article className="settings-panel">
        <div className="settings-heading">
          <h2>Debug</h2>
          <div className="button-row">
            <button onClick={onRefreshDebug}>Refresh Debug Info</button>
            <button onClick={() => void copyReport()}>Copy Debug Report</button>
          </div>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={settings.debugMode}
            onChange={(event) => onSettingsChange({ debugMode: event.target.checked })}
          />
          Debug mode
        </label>
        <div className="debug-stats">
          <span>Workspace: {snapshot?.workspace.name ?? "not loaded"}</span>
          <span>Pages: {snapshot?.workspace.pages.length ?? 0}</span>
          <span>Blocks: {totalBlocks}</span>
          <span>Cards: {snapshot?.cards.length ?? 0}</span>
          <span>Incomplete: {incompleteCards}</span>
          <span>Decks: {decks.length}</span>
          <span>Topics: {topicCount}</span>
          <span>Graph nodes: {snapshot?.graph.nodes.length ?? 0}</span>
          <span>Graph edges: {snapshot?.graph.edges.length ?? 0}</span>
          <span>Last refresh: {lastRefreshAt ? new Date(lastRefreshAt).toLocaleString() : "never"}</span>
        </div>
        <dl className="debug-paths">
          <dt>Workspace ID</dt>
          <dd>{debugInfo?.workspace_id ?? snapshot?.workspace.id ?? "unknown"}</dd>
          <dt>App data dir</dt>
          <dd>{debugInfo?.app_data_dir ?? "unknown"}</dd>
          <dt>Database</dt>
          <dd>{debugInfo?.database_path ?? "unknown"}</dd>
        </dl>
        {debugStatus && <p className="status">{debugStatus}</p>}
        {copyStatus && <p className="status">{copyStatus}</p>}
        <label>
          Debug report
          <textarea value={debugReport} readOnly rows={16} />
        </label>
      </article>
    </section>
  );
}

function ImportView({
  pageName,
  markdown,
  onPageNameChange,
  onMarkdownChange,
  onImport,
  onImportFile,
  onImportFolder,
  fileStatus,
}: {
  pageName: string;
  markdown: string;
  onPageNameChange: (value: string) => void;
  onMarkdownChange: (value: string) => void;
  onImport: () => void;
  onImportFile: () => void;
  onImportFolder: () => void;
  fileStatus: string | null;
}) {
  return (
    <section className="import">
      <div className="import-actions">
        <button className="primary" onClick={onImportFile}>Import .md File</button>
        <button onClick={onImportFolder}>Import Markdown Folder</button>
        {fileStatus && <p className="status">{fileStatus}</p>}
      </div>
      <label>
        Page name
        <input value={pageName} onChange={(event) => onPageNameChange(event.target.value)} />
      </label>
      <label>
        Logseq-compatible Markdown
        <textarea value={markdown} onChange={(event) => onMarkdownChange(event.target.value)} rows={18} />
      </label>
      <button onClick={onImport}>Import Text as Page</button>
    </section>
  );
}

function ExportView({
  pages,
  backup,
  fileStatus,
  onRefresh,
  onExportFolder,
  onRefreshBackup,
  onExportBackup,
  onRestoreBackup,
}: {
  pages: WorkspaceExport["pages"];
  backup: AppBackup | null;
  fileStatus: string | null;
  onRefresh: () => void;
  onExportFolder: () => void;
  onRefreshBackup: () => void;
  onExportBackup: () => void;
  onRestoreBackup: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const allMarkdown = useMemo(
    () => pages.map((page) => `<!-- ${page.name}.md -->\n${page.markdown}`).join("\n\n"),
    [pages],
  );
  const backupJson = useMemo(() => (backup ? JSON.stringify(backup, null, 2) : ""), [backup]);

  async function copyText(value: string) {
    setCopyStatus(null);
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus("Copied to clipboard.");
    } catch {
      setCopyStatus("Clipboard is not available. Select the text manually.");
    }
  }

  return (
    <section className="export">
      <div className="export-actions">
        <button onClick={onRefresh}>Refresh Markdown</button>
        <button className="primary" onClick={onExportFolder}>Export Markdown Folder</button>
        <button className="primary" onClick={() => void copyText(allMarkdown)} disabled={!allMarkdown}>
          Copy All Markdown
        </button>
      </div>
      <div className="export-actions">
        <button onClick={onRefreshBackup}>Refresh JSON Backup</button>
        <button className="primary" onClick={onExportBackup}>Export JSON Backup</button>
        <button onClick={onRestoreBackup}>Restore JSON Backup</button>
        <button className="primary" onClick={() => void copyText(backupJson)} disabled={!backupJson}>
          Copy JSON Backup
        </button>
      </div>
      {copyStatus && <p className="status">{copyStatus}</p>}
      {fileStatus && <p className="status">{fileStatus}</p>}
      {backup ? (
        <article className="export-page">
          <div className="export-page-heading">
            <h2>studygraph-backup.json</h2>
            <span>{new Date(backup.exportedAt).toLocaleString()}</span>
          </div>
          <div className="backup-summary">
            <span>Workspace: {backup.workspace.name}</span>
            <span>Pages: {backup.workspace.pages.length}</span>
            <span>Cards: {backup.cards.length}</span>
            <span>Reviews: {backup.reviewEvents.length}</span>
            <span>Sessions: {backup.reviewSessions.length}</span>
            <span>Doc pages: {backup.docPages.length}</span>
            <span>Schema: {backup.schemaVersion}</span>
          </div>
          <textarea value={backupJson} readOnly rows={18} />
        </article>
      ) : (
        <p className="empty-inline">No JSON backup preview yet. Refresh the backup first.</p>
      )}
      {pages.length === 0 ? (
        <p className="empty-inline">No pages exported yet. Refresh the export first.</p>
      ) : (
        pages.map((page) => (
          <article className="export-page" key={page.name}>
            <div className="export-page-heading">
              <h2>{page.name}.md</h2>
              <button onClick={() => void copyText(page.markdown)}>Copy Page</button>
            </div>
            <textarea value={page.markdown} readOnly rows={Math.min(22, Math.max(8, page.markdown.split("\n").length + 1))} />
          </article>
        ))
      )}
    </section>
  );
}

function CommandPalette({
  open,
  query,
  selectedIndex,
  results,
  onQueryChange,
  onSelectedIndexChange,
  onClose,
  onRun,
}: {
  open: boolean;
  query: string;
  selectedIndex: number;
  results: SearchResult[];
  onQueryChange: (query: string) => void;
  onSelectedIndexChange: (index: number) => void;
  onClose: () => void;
  onRun: (result: SearchResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const safeIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));

  return (
    <div className="command-overlay" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <section className="command-palette" onMouseDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          placeholder="Search pages, blocks, cards, commands..."
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              onSelectedIndexChange(Math.min(safeIndex + 1, Math.max(0, results.length - 1)));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              onSelectedIndexChange(Math.max(0, safeIndex - 1));
            }
            if (event.key === "Enter" && results[safeIndex]) {
              event.preventDefault();
              onRun(results[safeIndex]);
            }
          }}
        />
        <div className="command-results">
          {results.length === 0 ? (
            <p className="empty-inline">No results.</p>
          ) : (
            results.map((result, index) => (
              <button
                key={result.id}
                className={index === safeIndex ? "command-result active" : "command-result"}
                onClick={() => onRun(result)}
                onMouseEnter={() => onSelectedIndexChange(index)}
              >
                <span className={`result-kind ${result.type}`}>{result.type}</span>
                <span>
                  <strong>{result.title}</strong>
                  <small>{result.subtitle}</small>
                </span>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

type DocFormatAction =
  | "bold"
  | "italic"
  | "underline"
  | "heading1"
  | "heading2"
  | "bullet"
  | "numbered"
  | "quote"
  | "code"
  | "alignLeft"
  | "alignCenter"
  | "alignRight";

function placeholderForDocKind(kind: DocBlockKind) {
  const placeholders: Record<DocBlockKind, string> = {
    heading: "Section heading",
    paragraph: "Start writing. Use Ctrl+B/I/U, toolbar formatting, lists, quotes, code, and [[page links]].",
    todo: "Task or checklist item...",
    quote: "Quote or callout...",
  };
  return placeholders[kind];
}

function formatDocText(value: string, selectionStart: number, selectionEnd: number, action: DocFormatAction) {
  const selected = value.slice(selectionStart, selectionEnd) || placeholderForFormat(action);
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);
  const linePrefix = (prefix: string) => selected.split("\n").map((line) => `${prefix}${line || " "}`).join("\n");
  const numbered = selected.split("\n").map((line, index) => `${index + 1}. ${line || " "}`).join("\n");

  const replacements: Record<DocFormatAction, string> = {
    bold: `**${selected}**`,
    italic: `*${selected}*`,
    underline: `<u>${selected}</u>`,
    heading1: linePrefix("# "),
    heading2: linePrefix("## "),
    bullet: linePrefix("- "),
    numbered,
    quote: linePrefix("> "),
    code: selected.includes("\n") ? `\`\`\`\n${selected}\n\`\`\`` : `\`${selected}\``,
    alignLeft: `<div align="left">\n${selected}\n</div>`,
    alignCenter: `<div align="center">\n${selected}\n</div>`,
    alignRight: `<div align="right">\n${selected}\n</div>`,
  };
  const replacement = replacements[action];
  return {
    value: `${before}${replacement}${after}`,
    selectionStart: before.length,
    selectionEnd: before.length + replacement.length,
  };
}

function placeholderForFormat(action: DocFormatAction) {
  if (action === "heading1" || action === "heading2") return "Heading";
  if (action === "bullet" || action === "numbered") return "List item";
  if (action === "quote") return "Quoted text";
  if (action === "code") return "code";
  return "text";
}

function textStats(text: string) {
  const clean = stripPageLinks(text).trim();
  return {
    words: clean ? clean.split(/\s+/).filter(Boolean).length : 0,
    characters: text.length,
  };
}

function docPageStats(page: DocPage) {
  return textStats(page.blocks.map((block) => block.content).join("\n\n"));
}

function estimateCardCount(sourceText: string) {
  const stats = textStats(sourceText);
  return clampNumber(Math.ceil(stats.words / 45), 3, 18);
}

function splitTags(value: string) {
  return value
    .split(/[#,]/)
    .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
    .filter(Boolean)
    .filter((tag, index, tags) => tags.indexOf(tag) === index);
}

function filterDocPages(pages: DocPage[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return pages;
  return pages.filter((page) => {
    const haystack = [
      page.title,
      page.tags.join(" "),
      page.source,
      page.language,
      page.blocks.map((block) => block.content).join(" "),
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

function upsertSessionSummary(current: StoredSessionSummary[], summary: StoredSessionSummary) {
  return [summary, ...current.filter((candidate) => candidate.id !== summary.id)].slice(0, 20);
}

function buildReviewSession(
  workspaceId: string,
  sessionId: string,
  kind: ReviewSessionKind,
  scopeLabel: string,
  startedAt: string,
  stats: SessionAnswerStat[],
): ReviewSession {
  const completedAt = stats.at(-1)?.answeredAt ?? new Date().toISOString();
  return {
    id: sessionId,
    workspaceId,
    kind,
    scopeLabel,
    startedAt,
    completedAt,
    items: stats.map((stat, position) => ({
      id: stat.id,
      sessionId,
      cardId: stat.cardId,
      question: stat.question,
      rating: stat.rating,
      responseTimeMs: stat.responseTimeMs,
      clozeResult: stat.clozeResult,
      answeredAt: stat.answeredAt,
      position,
    })),
  };
}

function reviewSessionToStoredSummary(session: ReviewSession): StoredSessionSummary {
  const timed = session.items.filter((item) => typeof item.responseTimeMs === "number");
  const clozeResults = session.items
    .map((item) => item.clozeResult)
    .filter((result): result is ClozeSessionResult => Boolean(result));
  const clozeBlankCount = clozeResults.reduce((sum, result) => sum + result.blanks.length, 0);
  const clozeCorrectCount = clozeResults.reduce(
    (sum, result) => sum + result.blanks.filter((blank) => blank.correct).length,
    0,
  );
  return {
    id: session.id,
    kind: session.kind,
    completedAt: session.completedAt ?? session.startedAt,
    scopeLabel: session.scopeLabel,
    answered: session.items.length,
    averageResponseTimeMs: timed.length > 0
      ? timed.reduce((sum, item) => sum + (item.responseTimeMs ?? 0), 0) / timed.length
      : undefined,
    clozeBlankCount: clozeBlankCount > 0 ? clozeBlankCount : undefined,
    clozeCorrectCount: clozeBlankCount > 0 ? clozeCorrectCount : undefined,
    counts: session.items.reduce<Record<Rating, number>>((acc, item) => {
      acc[item.rating] += 1;
      return acc;
    }, { again: 0, hard: 0, good: 0, easy: 0 }),
  };
}

function randomUuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const digit = char === "x" ? value : (value & 0x3) | 0x8;
    return digit.toString(16);
  });
}


function formatDurationMs(value: number) {
  if (!Number.isFinite(value)) return "0.0s";
  return `${(value / 1000).toFixed(1)}s`;
}

function formatShortDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function docQuestionFromBlock(block: DocBlock) {
  const content = singleLine(stripPageLinks(block.content), "Doc concept");
  if (block.kind === "heading") {
    return `What are the key ideas of ${content}?`;
  }
  if (block.kind === "todo") {
    return `What should be remembered about this task: ${content}?`;
  }
  if (block.kind === "quote") {
    return `What is the meaning of this note: ${shorten(content, 80)}?`;
  }
  return `What does this Doc note explain: ${shorten(content, 80)}?`;
}

function docAnswerFromBlock(page: DocPage, block: DocBlock) {
  const content = singleLine(stripPageLinks(block.content), "Review the source Doc block.");
  return `${content}\n\nSource Doc: ${page.title}`;
}

const defaultAppSettings: AppSettings = {
  defaultDeck: "Generated",
  defaultTopic: "General",
  newCardsPerDay: 20,
  reviewsPerDay: 120,
  apiProviderEnabled: false,
  apiBaseUrl: "",
  apiModel: "",
  openAiConnectionMode: "none",
  openAiAccountEmail: "",
  openAiAccountStatus: "not-connected",
  openAiApiKeyConfigured: false,
  openAiApiKeyLastFour: "",
  debugMode: false,
};

function normalizeAppSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    defaultDeck: singleLine(settings.defaultDeck, defaultAppSettings.defaultDeck),
    defaultTopic: singleLine(settings.defaultTopic, defaultAppSettings.defaultTopic),
    newCardsPerDay: clampNumber(settings.newCardsPerDay, 0, 500),
    reviewsPerDay: clampNumber(settings.reviewsPerDay, 0, 2000),
    apiBaseUrl: settings.apiBaseUrl.trim(),
    apiModel: settings.apiModel.trim(),
    openAiConnectionMode: ["account", "apiKey"].includes(settings.openAiConnectionMode) ? settings.openAiConnectionMode : "none",
    openAiAccountEmail: settings.openAiAccountEmail.trim(),
    openAiAccountStatus: singleLine(settings.openAiAccountStatus, defaultAppSettings.openAiAccountStatus),
    openAiApiKeyConfigured: Boolean(settings.openAiApiKeyConfigured),
    openAiApiKeyLastFour: settings.openAiApiKeyLastFour.replace(/[^a-zA-Z0-9]/g, "").slice(-4),
  };
}

function loadFallbackAppSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem("studygraph.settings");
    if (!raw) {
      return defaultAppSettings;
    }
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return normalizeAppSettings({
      ...defaultAppSettings,
      ...parsed,
      defaultDeck: parsed.defaultDeck ?? defaultAppSettings.defaultDeck,
      defaultTopic: parsed.defaultTopic ?? defaultAppSettings.defaultTopic,
      newCardsPerDay: parsed.newCardsPerDay ?? defaultAppSettings.newCardsPerDay,
      reviewsPerDay: parsed.reviewsPerDay ?? defaultAppSettings.reviewsPerDay,
      apiProviderEnabled: Boolean(parsed.apiProviderEnabled),
      openAiConnectionMode: parsed.openAiConnectionMode ?? defaultAppSettings.openAiConnectionMode,
      openAiAccountEmail: parsed.openAiAccountEmail ?? defaultAppSettings.openAiAccountEmail,
      openAiAccountStatus: parsed.openAiAccountStatus ?? defaultAppSettings.openAiAccountStatus,
      openAiApiKeyConfigured: Boolean(parsed.openAiApiKeyConfigured),
      openAiApiKeyLastFour: parsed.openAiApiKeyLastFour ?? defaultAppSettings.openAiApiKeyLastFour,
      debugMode: Boolean(parsed.debugMode),
    });
  } catch {
    return defaultAppSettings;
  }
}

function saveFallbackAppSettings(settings: AppSettings) {
  try {
    window.localStorage.setItem("studygraph.settings", JSON.stringify(normalizeAppSettings(settings)));
  } catch {
    // Local settings are only a fallback; the app remains usable without them.
  }
}

function formatGeneratedCardsAsMarkdown(cards: GeneratedCard[]) {
  return cards
    .map((card) => {
      const lines = [
        `- ${singleLine(card.question, "Generated question")} #card`,
        `  sgd-deck:: ${singleLine(card.deck, "Generated")}`,
        `  sgd-topic:: ${singleLine(card.topic, "General")}`,
        "  sgd-generated:: true",
        "  sgd-source:: local-generator",
      ];
      if (card.tags.length > 0) {
        lines.push(`  sgd-tags:: ${card.tags.map((tag) => singleLine(tag, "")).filter(Boolean).join(", ")}`);
      }
      lines.push(`  - ${singleLine(card.answer, "Generated answer is empty.")}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function buildDebugReport({
  settings,
  snapshot,
  decks,
  debugInfo,
  lastRefreshAt,
  totalBlocks,
  topicCount,
  incompleteCards,
}: {
  settings: AppSettings;
  snapshot: DesktopSnapshot | null;
  decks: Array<{ deck: string; deck_slug: string; total: number; due: number; weak: number; newCards: number }>;
  debugInfo: AppDebugInfo | null;
  lastRefreshAt: string | null;
  totalBlocks: number;
  topicCount: number;
  incompleteCards: number;
}) {
  const lines = [
    "StudyGraph Debug Report",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "Workspace",
    `Name: ${snapshot?.workspace.name ?? "not loaded"}`,
    `ID: ${debugInfo?.workspace_id ?? snapshot?.workspace.id ?? "unknown"}`,
    `Pages: ${snapshot?.workspace.pages.length ?? 0}`,
    `Blocks: ${totalBlocks}`,
    `Cards: ${snapshot?.cards.length ?? 0}`,
    `Incomplete cards: ${incompleteCards}`,
    `Decks: ${decks.length}`,
    `Topics: ${topicCount}`,
    `Graph nodes: ${snapshot?.graph.nodes.length ?? 0}`,
    `Graph edges: ${snapshot?.graph.edges.length ?? 0}`,
    `Last refresh: ${lastRefreshAt ?? "never"}`,
    "",
    "Storage",
    `App data dir: ${debugInfo?.app_data_dir ?? "unknown"}`,
    `Database: ${debugInfo?.database_path ?? "unknown"}`,
    "",
    "Settings",
    "Storage: SQLite settings table with local fallback",
    `Default deck: ${settings.defaultDeck}`,
    `Default topic: ${settings.defaultTopic}`,
    `New cards/day: ${settings.newCardsPerDay}`,
    `Reviews/day: ${settings.reviewsPerDay}`,
    `API provider enabled: ${settings.apiProviderEnabled}`,
    `OpenAI mode: ${settings.openAiConnectionMode}`,
    `OpenAI account status: ${settings.openAiAccountStatus}`,
    `OpenAI account email set: ${settings.openAiAccountEmail ? "yes" : "no"}`,
    `API key metadata configured: ${settings.openAiApiKeyConfigured ? `yes (*${settings.openAiApiKeyLastFour})` : "no"}`,
    `API base URL set: ${settings.apiBaseUrl.trim() ? "yes" : "no"}`,
    `API model: ${settings.apiModel || "not set"}`,
    `Debug mode: ${settings.debugMode}`,
    "",
    "Decks",
    ...decks.map((deck) => `${deck.deck}: total=${deck.total}, due=${deck.due}, new=${deck.newCards}, weak=${deck.weak}`),
  ];
  return lines.join("\n");
}
