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
  setPageProperty,
  setBlockProperty,
  updateDocBlock,
  updateDocPageMetadata,
  updateDocPageTitle,
  updateBlockContent,
} from "./api";
import type {
  AppBackup,
  AppDebugInfo,
  AppSettings,
  BacklinkReference,
  Block,
  CardGeneratorInput,
  DesktopSnapshot,
  DocBlock,
  DocBlockKind,
  DocPage,
  GeneratedCard,
  Page,
  Rating,
  StudyCard,
  StudyGraphNode,
  WorkspaceExport,
} from "./types";

type Screen = "notes" | "doc" | "todo" | "dashboard" | "review" | "practice" | "graph" | "generate" | "settings" | "import" | "export";
type PracticeMode = "all" | "deck" | "weak" | "new" | "graph";
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

interface TodoItem {
  id: string;
  pageId: string;
  pageName: string;
  block: Block;
  blockIds: string[];
  path: string[];
  status: TodoStatus;
  scope: "block" | "topic";
  deck?: string;
  topic?: string;
  cardCount?: number;
}

interface SessionAnswerStat {
  cardId: string;
  question: string;
  rating: Rating;
  responseTimeMs?: number;
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
  const [practiceSessionStats, setPracticeSessionStats] = useState<SessionAnswerStat[]>([]);
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
      setError(loadError instanceof Error ? loadError.message : String(loadError));
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
      setDebugStatus(debugError instanceof Error ? debugError.message : String(debugError));
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
        `Using local settings fallback: ${settingsError instanceof Error ? settingsError.message : String(settingsError)}`,
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
        `Saved local fallback only: ${settingsError instanceof Error ? settingsError.message : String(settingsError)}`,
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
      setDocStatus(docError instanceof Error ? docError.message : String(docError));
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
    setFileStatus(null);
    try {
      const next = await importMarkdownPage(pageName, markdown);
      setSnapshot(next);
      setSelectedPageId(next.workspace.pages.at(-1)?.id ?? next.workspace.pages[0]?.id ?? null);
      setFocusedBlockId(null);
      setScreen("dashboard");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    }
  }

  async function importFile() {
    setError(null);
    setFileStatus(null);
    try {
      const filePath = await pickMarkdownFile();
      if (!filePath) return;
      const next = await importMarkdownFile(filePath);
      const importedPageName = pageNameFromFilePath(filePath);
      const importedPage = next.workspace.pages.find((page) => page.name === importedPageName);
      setSnapshot(next);
      setSelectedPageId(importedPage?.id ?? next.workspace.pages.at(-1)?.id ?? next.workspace.pages[0]?.id ?? null);
      setFocusedBlockId(null);
      setFileStatus(`Imported ${filePath}`);
      setScreen("notes");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    }
  }

  async function importFolder() {
    setError(null);
    setFileStatus(null);
    try {
      const folderPath = await pickMarkdownFolder();
      if (!folderPath) return;
      const confirmed = window.confirm(
        "Import all Markdown files from this folder recursively? Pages with matching names will be replaced.",
      );
      if (!confirmed) return;
      const result = await importMarkdownFolder(folderPath);
      setSnapshot(result.snapshot);
      setSelectedPageId(result.snapshot.workspace.pages[0]?.id ?? null);
      setFocusedBlockId(null);
      setFileStatus(`Imported ${result.imported_files.length} Markdown files from ${result.folder_path}`);
      setScreen("dashboard");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    }
  }

  async function rateCurrent(rating: Rating) {
    const card = dueCards[selectedCardIndex];
    if (!card) {
      return;
    }
    setError(null);
    try {
      const next = await reviewCard(card.id, rating, reviewResponseTimeMs);
      setReviewSessionStats((current) => [...current, {
        cardId: card.id,
        question: card.question,
        rating,
        responseTimeMs: reviewResponseTimeMs,
      }]);
      setSnapshot(next);
      setShowAnswer(false);
      setReviewResponseTimeMs(undefined);
      setSelectedCardIndex((current) => Math.min(current, Math.max(0, dueCards.length - 2)));
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError));
    }
  }

  async function ratePractice(rating: Rating) {
    const card = practiceQueue[practiceIndex];
    if (!card) {
      return;
    }

    if (!practiceRecordRatings) {
      setPracticeShowAnswer(false);
      setPracticeIndex((current) => Math.min(current + 1, Math.max(0, practiceQueue.length - 1)));
      return;
    }

    setError(null);
    try {
      const next = await reviewCard(card.id, rating, practiceResponseTimeMs);
      setPracticeSessionStats((current) => [...current, {
        cardId: card.id,
        question: card.question,
        rating,
        responseTimeMs: practiceResponseTimeMs,
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
      for (const blockId of item.blockIds) {
        next = await setBlockProperty(blockId, "sgd-todo", status);
        if (status === "done") {
          next = await setBlockProperty(blockId, "sgd-todo-done-at", new Date().toISOString());
        } else if (item.blockIds.length === 1 && item.block.properties["sgd-todo-done-at"]) {
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
    try {
      const [result, backup] = await Promise.all([exportWorkspaceMarkdown(), exportAppBackup()]);
      setExportedPages(result.pages);
      setBackupPreview(backup);
      setScreen("export");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    }
  }

  async function exportToFolder() {
    setError(null);
    setFileStatus(null);
    try {
      const folderPath = await pickExportFolder();
      if (!folderPath) return;
      const overwrite = window.confirm(
        "Export all pages as Markdown into this folder? Existing .md files with matching page names can be overwritten.",
      );
      if (!overwrite) return;
      const result = await exportWorkspaceMarkdownToFolder(folderPath, true);
      setFileStatus(`Exported ${result.files.length} Markdown files to ${result.folder_path}`);
      await loadExport();
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    }
  }

  async function loadBackupPreview() {
    setError(null);
    try {
      const result = await exportAppBackup();
      setBackupPreview(result);
      setScreen("export");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    }
  }

  async function exportBackupToFolder() {
    setError(null);
    setFileStatus(null);
    try {
      const folderPath = await pickExportFolder();
      if (!folderPath) return;
      const result = await exportAppBackupToFolder(folderPath);
      setBackupPreview(result.backup);
      setFileStatus(`Exported JSON backup to ${result.file_path}`);
      setScreen("export");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    }
  }

  async function restoreBackupFromFile() {
    setError(null);
    setFileStatus(null);
    try {
      const filePath = await pickBackupFile();
      if (!filePath) return;
      const confirmed = window.confirm(
        "Restore this StudyGraph backup? This replaces the current workspace data with the backup contents.",
      );
      if (!confirmed) return;
      const result = await restoreAppBackupFromFile(filePath);
      setSnapshot(result.snapshot);
      setSelectedPageId(result.snapshot.workspace.pages[0]?.id ?? null);
      setFocusedBlockId(null);
      setBackupPreview(null);
      setFileStatus(`Restored backup from ${result.file_path}`);
      setScreen("export");
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : String(restoreError));
    }
  }

  function generateCardsPreview() {
    setError(null);
    const cards = generateLocalCards(generatorInput);
    setGeneratedCards(cards);
    setGeneratorStatus(
      cards.length > 0
        ? `Generated ${cards.length} local preview cards.`
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
      setError(insertError instanceof Error ? insertError.message : String(insertError));
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
    const cards = generateLocalCards(nextInput);
    setGeneratedCards(cards);
    setGeneratorStatus(
      cards.length > 0
        ? `Prepared ${cards.length} local AI-style preview cards from ${sourceLabel}. No external API call was made.`
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


  function openTodoItem(item: TodoItem) {
    if (item.scope === "topic") {
      startPractice("graph", "", item.id, `${item.deck ?? "Deck"} / ${item.topic ?? "Topic"}`);
      return;
    }
    openBlock(item.pageId, item.block.id);
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
    setSelectedCardIndex(0);
    setShowAnswer(false);
    setScreen("review");
  }

  function startPractice(mode: PracticeMode, deckSlug = "", nodeId = "", label = "All cards") {
    setPracticeMode(mode);
    setPracticeDeckSlug(deckSlug);
    setPracticeNodeId(nodeId);
    setPracticeScopeLabel(label);
    setPracticeIndex(0);
    setPracticeShowAnswer(false);
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
  const dueCards = useMemo(() => buildReviewQueue(cards, reviewNodeId), [cards, reviewNodeId]);
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
            onOpenBlock={openTodoItem}
          />
        )}
        {screen === "dashboard" && (
          <DashboardView
            decks={decks}
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
            onShowAnswer={revealReviewAnswer}
            onSkip={() => {
              setShowAnswer(false);
              setReviewResponseTimeMs(undefined);
              setSelectedCardIndex((current) => Math.min(current + 1, Math.max(0, dueCards.length - 1)));
            }}
            onRate={(rating) => void rateCurrent(rating)}
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
              setPracticeIndex((current) => Math.min(current + 1, Math.max(0, practiceQueue.length - 1)));
            }}
            onRate={(rating) => void ratePractice(rating)}
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
            onOpenCard={openCardSource}
            onOpenPageByName={(name) => void openPageByName(name)}
          />
        )}
        {screen === "generate" && (
          <GeneratorView
            input={generatorInput}
            cards={generatedCards}
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

function DashboardView({
  decks,
  onReviewDeck,
  onPracticeDeck,
  onShowGraph,
}: {
  decks: Array<{ deck: string; deck_slug: string; total: number; due: number; weak: number; newCards: number }>;
  onReviewDeck: (deckSlug: string) => void;
  onPracticeDeck: (deckSlug: string, mode: PracticeMode) => void;
  onShowGraph: (deckSlug: string) => void;
}) {
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
  onOpenBlock,
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
  onOpenBlock: (item: TodoItem) => void;
}) {
  const [filter, setFilter] = useState("");
  const filteredItems = useMemo(() => filterTodoItems(items, filter), [items, filter]);
  const openItems = filteredItems.filter((item) => item.status === "open");
  const doingItems = filteredItems.filter((item) => item.status === "doing");
  const doneItems = filteredItems.filter((item) => item.status === "done");
  const effectiveTargetPageId = targetPageId || pages[0]?.id || "";

  return (
    <section className="todo">
      <div className="todo-capture">
        <div>
          <h2>Learning Queue</h2>
          <p>Open auto-lists unlearned card topics. Move items to Next up to control what appears in learning.</p>
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
      </div>

      <div className="todo-board">
        <TodoColumn title="Open / To learn" items={openItems} onSetStatus={onSetStatus} onOpenBlock={onOpenBlock} />
        <TodoColumn title="Next up" items={doingItems} onSetStatus={onSetStatus} onOpenBlock={onOpenBlock} />
        <TodoColumn title="Done" items={doneItems} onSetStatus={onSetStatus} onOpenBlock={onOpenBlock} />
      </div>
    </section>
  );
}

function TodoColumn({
  title,
  items,
  onSetStatus,
  onOpenBlock,
}: {
  title: string;
  items: TodoItem[];
  onSetStatus: (item: TodoItem, status: TodoStatus) => void;
  onOpenBlock: (item: TodoItem) => void;
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
            <button className="todo-title" onClick={() => onOpenBlock(item)}>
              {todoItemTitle(item)}
            </button>
            <small>{todoItemSubtitle(item)}</small>
            <div className="todo-actions">
              <button disabled={item.status === "open"} onClick={() => onSetStatus(item, "open")}>Open</button>
              <button disabled={item.status === "doing"} onClick={() => onSetStatus(item, "doing")}>Next up</button>
              <button className="success" disabled={item.status === "done"} onClick={() => onSetStatus(item, "done")}>Done</button>
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

function ClozeAnswer({ card }: { card: StudyCard }) {
  const cloze = useMemo(() => buildClozePrompt(card), [card.id, card.answer_markdown, card.srs.reps, card.srs.ease]);
  const [answers, setAnswers] = useState<string[]>(() => cloze.blanks.map(() => ""));

  useEffect(() => {
    setAnswers(cloze.blanks.map(() => ""));
  }, [cloze.text]);

  return (
    <article className="answer-card cloze-card">
      <h3>AI Cloze Answer</h3>
      <p className="cloze-hint">Fill the blacked-out key words. More words are hidden as the card gets stronger.</p>
      <div className="cloze-text">
        {cloze.parts.map((part, index) => (
          part.kind === "text" ? (
            <span key={index}>{part.value}</span>
          ) : (
            <input
              key={index}
              aria-label={`Hidden word ${part.blankIndex + 1}`}
              value={answers[part.blankIndex] ?? ""}
              placeholder="█"
              onChange={(event) => setAnswers((current) => current.map((value, answerIndex) => answerIndex === part.blankIndex ? event.target.value : value))}
              className={normalizeAnswer(answers[part.blankIndex] ?? "") === normalizeAnswer(cloze.blanks[part.blankIndex]) ? "correct" : ""}
            />
          )
        ))}
      </div>
      <details>
        <summary>Show original answer</summary>
        <pre>{card.answer_markdown || "(No answer child blocks)"}</pre>
      </details>
    </article>
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

  if (answered === 0 && currentResponseTimeMs === undefined) {
    return null;
  }

  return (
    <aside className="study-session-summary">
      <span>Answered: {answered}</span>
      {currentResponseTimeMs !== undefined && <span>Current answer time: {formatDurationMs(currentResponseTimeMs)}</span>}
      {averageMs !== undefined && <span>Ø answer time: {formatDurationMs(averageMs)}</span>}
      <span>Again {counts.again} · Hard {counts.hard} · Good {counts.good} · Easy {counts.easy}</span>
      {slowest.length > 0 && (
        <span>Slowest: {slowest.map((stat) => `${shorten(stat.question, 28)} (${formatDurationMs(stat.responseTimeMs ?? 0)})`).join(" · ")}</span>
      )}
    </aside>
  );
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
  onShowAnswer: () => void;
  onSkip: () => void;
  onRate: (rating: Rating) => void;
  onOpenCard: (card: StudyCard) => void;
}) {
  const reviewRef = useRef<HTMLElement | null>(null);
  const progress = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;

  useEffect(() => {
    window.setTimeout(() => reviewRef.current?.focus(), 0);
  }, [card?.id, showAnswer]);

  if (!card) {
    return (
      <section className="empty">
        <h2>No due cards right now.</h2>
        <p>Use Free Practice or add new #card blocks in Edit Desk.</p>
      </section>
    );
  }

  return (
    <section
      className="review"
      ref={reviewRef}
      tabIndex={0}
      onKeyDown={(event) => {
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
          const ratingByKey: Record<string, Rating> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
          const rating = ratingByKey[event.key];
          if (rating) {
            event.preventDefault();
            onRate(rating);
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
      <StudyModeToggle mode={studyMode} onChange={onStudyModeChange} />
      <SessionStatsPanel stats={sessionStats} currentResponseTimeMs={showAnswer ? responseTimeMs : undefined} />
      <article className="review-card">
        <h2>{card.question}</h2>
        <CardStudyMeta card={card} />
        {card.linked_pages.length > 0 && <p>Linked: {card.linked_pages.join(", ")}</p>}
      </article>
      {showAnswer && (
        studyMode === "cloze" ? (
          <ClozeAnswer card={card} />
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
            <button className="danger" onClick={() => onRate("again")}>Again</button>
            <button className="warning" onClick={() => onRate("hard")}>Hard</button>
            <button className="primary" onClick={() => onRate("good")}>Good</button>
            <button className="success" onClick={() => onRate("easy")}>Easy</button>
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
  recordRatings: boolean;
  onModeChange: (mode: PracticeMode) => void;
  onDeckChange: (deckSlug: string) => void;
  onRecordRatingsChange: (value: boolean) => void;
  onShowAnswer: () => void;
  onSkip: () => void;
  onRate: (rating: Rating) => void;
  onOpenCard: (card: StudyCard) => void;
}) {
  const practiceRef = useRef<HTMLElement | null>(null);
  const selectedDeckLabel =
    mode === "graph"
      ? `Graph: ${graphNodeLabel || "selected node"}`
      : mode === "all"
        ? "All decks"
        : decks.find((deck) => deck.deck_slug === deckSlug)?.deck ?? "All decks";
  const progress = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;

  useEffect(() => {
    window.setTimeout(() => practiceRef.current?.focus(), 0);
  }, [card?.id, showAnswer, mode, deckSlug]);

  return (
    <section
      className="practice"
      ref={practiceRef}
      tabIndex={0}
      onKeyDown={(event) => {
        if (!card) return;
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
          const ratingByKey: Record<string, Rating> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
          const rating = ratingByKey[event.key];
          if (rating) {
            event.preventDefault();
            onRate(rating);
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

      <div className="practice-summary">
        <span>{total} cards in queue</span>
        <span>{selectedDeckLabel}</span>
        <span>{cards.length} cards indexed</span>
        {!recordRatings && <strong>Practice-only: SRS unchanged</strong>}
      </div>
      {recordRatings && <SessionStatsPanel stats={sessionStats} currentResponseTimeMs={showAnswer ? responseTimeMs : undefined} />}

      {!card ? (
        <section className="empty">No cards match this practice filter.</section>
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
              <ClozeAnswer card={card} />
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
                <button className="danger" onClick={() => onRate("again")}>Again</button>
                <button className="warning" onClick={() => onRate("hard")}>Hard</button>
                <button className="primary" onClick={() => onRate("good")}>Good</button>
                <button className="success" onClick={() => onRate("easy")}>Easy</button>
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
  onOpenCard,
  onOpenPageByName,
}: {
  snapshot: DesktopSnapshot;
  selectedNode: StudyGraphNode | null;
  onSelectNode: (node: StudyGraphNode) => void;
  onStartDue: (node: StudyGraphNode) => void;
  onPractice: (node: StudyGraphNode) => void;
  onOpenCard: (card: StudyCard) => void;
  onOpenPageByName: (name: string) => void;
}) {
  const layout = layoutGraph(snapshot.graph.nodes);
  const byId = new Map(layout.map((node) => [node.id, node]));
  const selectedCards = selectedNode ? cardsForGraphNode(snapshot.cards, selectedNode.id) : [];
  const selectedDueCount = selectedCards.filter(isDue).length;
  const selectedCard = selectedNode?.kind === "card" ? selectedCards[0] : undefined;
  const canOpenPage =
    selectedNode &&
    selectedNode.kind !== "card" &&
    selectedNode.label !== "Weak Cards" &&
    !selectedNode.label.startsWith("#");

  return (
    <section className="graph-layout">
      <div className="graph-scroll">
        <svg className="graph" viewBox="0 0 980 620">
        {snapshot.graph.edges.map((edge) => {
          const source = byId.get(edge.source);
          const target = byId.get(edge.target);
          if (!source || !target) return null;
          return <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={`edge ${edge.kind}`} />;
        })}
        {layout.map((node) => (
          <g key={node.id} className={`node ${node.kind}`} transform={`translate(${node.x} ${node.y})`} onClick={() => onSelectNode(node)}>
            <circle r={node.kind === "deck" ? 22 : node.kind === "topic" ? 17 : 12} />
            <text y={32}>{shorten(node.label, 28)}</text>
          </g>
        ))}
        </svg>
      </div>
      <aside className="details">
        {selectedNode ? (
          <>
            <h2>{selectedNode.label}</h2>
            <p>{selectedNode.kind}</p>
            <dl>
              <dt>Total</dt><dd>{selectedNode.total_cards}</dd>
              <dt>Due</dt><dd>{selectedNode.due_cards}</dd>
              <dt>Weak</dt><dd>{selectedNode.weak_cards}</dd>
            </dl>
            <div className="button-row">
              <button onClick={() => onStartDue(selectedNode)} disabled={selectedDueCount === 0}>Learn Due</button>
              <button onClick={() => onPractice(selectedNode)} disabled={selectedCards.length === 0}>Practice All</button>
              {selectedCard && <button onClick={() => onOpenCard(selectedCard)}>Open Source Block</button>}
              {canOpenPage && <button onClick={() => onOpenPageByName(selectedNode.label)}>Open Page</button>}
            </div>
            {selectedCard && (
              <article className="details-card">
                <strong>{selectedCard.question}</strong>
                <p>{selectedCard.answer_markdown || "(No answer child blocks)"}</p>
              </article>
            )}
            {selectedCards.length > 1 && (
              <div className="details-card-list">
                <strong>Related cards</strong>
                {selectedCards.slice(0, 6).map((card) => (
                  <button key={card.id} onClick={() => onOpenCard(card)}>
                    {shorten(card.question, 48)}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <p>Select a graph node.</p>
        )}
      </aside>
    </section>
  );
}

function GeneratorView({
  input,
  cards,
  status,
  selectedPageName,
  onInputChange,
  onGenerate,
  onCopy,
  onInsert,
}: {
  input: CardGeneratorInput;
  cards: GeneratedCard[];
  status: string | null;
  selectedPageName?: string;
  onInputChange: (patch: Partial<CardGeneratorInput>) => void;
  onGenerate: () => void;
  onCopy: () => void;
  onInsert: () => void;
}) {
  const markdownPreview = useMemo(() => formatGeneratedCardsAsMarkdown(cards), [cards]);

  return (
    <section className="generate">
      <div className="generator-panel">
        <div className="generator-heading">
          <div>
            <h2>Offline Card Generator</h2>
            <p>Creates deterministic preview cards locally. No text leaves this device.</p>
          </div>
          <span>{selectedPageName ? `Target page: ${selectedPageName}` : "No page selected"}</span>
        </div>

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

function generateLocalCards(input: CardGeneratorInput): GeneratedCard[] {
  const sentences = splitSourceSentences(input.source_text);
  const definitionFacts = extractDefinitionFacts(input.source_text);
  if (sentences.length === 0 && definitionFacts.length === 0) {
    return [];
  }

  const language = resolveGeneratorLanguage(input.language, input.source_text);
  const deck = singleLine(input.deck, "Generated");
  const topic = singleLine(input.topic, "General");
  const vocabularyDeck = singleLine(input.vocabulary_deck, `${deck} Vocabulary`);
  const limit = clampNumber(input.number_of_cards, 1, 30);
  const directCards = definitionFacts.slice(0, limit).map((fact) => ({
    question: fact.question || (language === "de" ? `Was bedeutet "${fact.term}" im Kontext ${topic}?` : `What does "${fact.term}" mean in the context of ${topic}?`),
    answer: fact.answer,
    deck,
    topic,
    tags: ["generated", input.difficulty, "definition"],
    source_summary: shorten(fact.answer, 120),
  } satisfies GeneratedCard));
  const directSources = new Set(definitionFacts.map((fact) => fact.source));
  const remainingSentences = sentences.filter((sentence) => !directSources.has(sentence));
  const remainingLimit = Math.max(0, limit - directCards.length);

  const sentenceCards = remainingSentences.slice(0, remainingLimit).map((sentence, index) => {
    const term = pickKeyTerm(sentence, topic);
    const style = input.card_style === "mixed" ? (index % 3 === 1 ? "cloze" : "basic") : input.card_style;
    const promptPrefix =
      input.difficulty === "hard"
        ? language === "de" ? "Erklaere technisch praezise" : "Explain precisely"
        : input.difficulty === "easy"
          ? language === "de" ? "Was bedeutet" : "What does"
          : language === "de" ? "Wie erklaerst du" : "How would you explain";
    const contextPhrase = language === "de" ? `im Kontext ${topic}` : `in the context of ${topic}`;

    if (style === "cloze") {
      return {
        question: language === "de"
          ? `Ergaenze den zentralen Begriff: ${maskTerm(sentence, term)}`
          : `Fill in the key term: ${maskTerm(sentence, term)}`,
        answer: `${term}: ${sentence}`,
        deck,
        topic,
        tags: ["generated", input.difficulty, "cloze"],
        source_summary: shorten(sentence, 120),
      } satisfies GeneratedCard;
    }

    return {
      question: `${promptPrefix} "${term}" ${contextPhrase}?`,
      answer: sentence,
      deck,
      topic,
      tags: ["generated", input.difficulty, "basic"],
      source_summary: shorten(sentence, 120),
    } satisfies GeneratedCard;
  });
  const baseCards = [...directCards, ...sentenceCards];

  const bidirectionalCards = input.bidirectional_cards
    ? baseCards.map((card) => ({
        question: language === "de" ? `Welche Frage passt zu: ${shorten(card.answer, 90)}?` : `Which prompt matches: ${shorten(card.answer, 90)}?`,
        answer: card.question,
        deck: card.deck,
        topic: card.topic,
        tags: [...card.tags.filter((tag) => !["basic", "cloze", "definition"].includes(tag)), "bidirectional"],
        source_summary: card.source_summary,
      } satisfies GeneratedCard))
    : [];

  const vocabularyCards = input.vocabulary_mode
    ? extractVocabularyTerms([...definitionFacts.map((fact) => `${fact.term}: ${fact.answer}`), ...sentences], topic).slice(0, Math.min(limit, 12)).map(({ term, sentence }) => ({
        question: language === "de" ? `Was bedeutet "${term}" in diesem Text?` : `What does "${term}" mean in this text?`,
        answer: language === "de" ? `Kontext: ${sentence}` : `Context: ${sentence}`,
        deck: vocabularyDeck,
        topic: language === "de" ? "Vokabeln" : "Vocabulary",
        tags: ["generated", "vocabulary", "language-learning"],
        source_summary: shorten(sentence, 120),
      } satisfies GeneratedCard))
    : [];

  return [...baseCards, ...bidirectionalCards, ...vocabularyCards];
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

function buildClozePrompt(card: StudyCard) {
  const text = card.answer_markdown || "(No answer child blocks)";
  const words = Array.from(text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}-]{3,}/gu));
  const unique = new Set<string>();
  const candidates = words
    .map((match) => ({ value: match[0], index: match.index ?? 0 }))
    .filter((word) => {
      const normalized = normalizeAnswer(word.value);
      if (unique.has(normalized) || commonClozeWords.has(normalized)) return false;
      unique.add(normalized);
      return true;
    })
    .sort((left, right) => right.value.length - left.value.length);
  const strength = Math.max(card.srs.reps, Math.round(card.srs.ease));
  const blankCount = Math.min(Math.max(1, Math.floor(strength / 2)), 6, candidates.length);
  const selected = candidates.slice(0, blankCount).sort((left, right) => left.index - right.index);
  const parts: Array<{ kind: "text"; value: string } | { kind: "blank"; blankIndex: number }> = [];
  const blanks: string[] = [];
  let cursor = 0;
  for (const blank of selected) {
    parts.push({ kind: "text", value: text.slice(cursor, blank.index) });
    parts.push({ kind: "blank", blankIndex: blanks.length });
    blanks.push(blank.value);
    cursor = blank.index + blank.value.length;
  }
  parts.push({ kind: "text", value: text.slice(cursor) });
  return { text, parts, blanks };
}

function normalizeAnswer(value: string) {
  return value.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

const commonClozeWords = new Set(["this", "that", "with", "from", "have", "will", "eine", "einer", "einen", "einem", "oder", "aber", "auch", "dass", "nicht", "werden", "kann", "sind", "the", "and", "for", "into"]);

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

interface DefinitionFact {
  term: string;
  answer: string;
  source: string;
  question?: string;
}

function splitSourceSentences(value: string) {
  const seen = new Set<string>();
  const chunks: string[] = [];
  for (const rawLine of value.replace(/\r/g, "").split(/\n+/)) {
    const cleanLine = cleanSourceLine(rawLine);
    if (!cleanLine) continue;
    const parts = cleanLine.length > 220
      ? cleanLine.split(/(?<=[.!?])\s+/)
      : [cleanLine];
    for (const part of parts) {
      const cleanPart = singleLine(part.replace(/[.!?]+$/, ""), "");
      const key = cleanPart.toLocaleLowerCase();
      if (cleanPart.length >= 8 && !seen.has(key)) {
        seen.add(key);
        chunks.push(cleanPart);
      }
    }
  }
  return chunks;
}

function extractDefinitionFacts(value: string): DefinitionFact[] {
  const lines = value.replace(/\r/g, "").split(/\n+/).map(cleanSourceLine).filter(Boolean);
  const facts: DefinitionFact[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] ?? "";
    const qaMatch = line.match(/^(?:q|frage|question)\s*[:?]\s*(.+)$/i);
    const answerMatch = next.match(/^(?:a|antwort|answer)\s*[:\-]\s*(.+)$/i);
    if (qaMatch && answerMatch) {
      addDefinitionFact(facts, seen, {
        term: pickKeyTerm(qaMatch[1], ""),
        question: singleLine(qaMatch[1], "Generated question"),
        answer: singleLine(answerMatch[1], "Generated answer"),
        source: line,
      });
      index += 1;
      continue;
    }

    const arrowMatch = line.match(/^(.{2,80}?)\s*(?:=>|->|—|–)\s*(.{8,})$/);
    if (arrowMatch) {
      addDefinitionFact(facts, seen, {
        term: cleanTerm(arrowMatch[1]),
        answer: singleLine(arrowMatch[2], "Generated answer"),
        source: line,
      });
      continue;
    }

    const colonMatch = line.match(/^([^:]{2,70}):\s*(.{8,})$/);
    if (colonMatch && !/^(sgd-|deck|topic|card)\b/i.test(colonMatch[1])) {
      addDefinitionFact(facts, seen, {
        term: cleanTerm(colonMatch[1]),
        answer: singleLine(colonMatch[2], "Generated answer"),
        source: line,
      });
    }
  }

  return facts;
}

function cleanSourceLine(value: string) {
  const trimmed = value
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^TODO\s+/i, "");
  if (!trimmed || /^(sgd-|deck|topic|card)[\w-]*::/i.test(trimmed)) return "";
  return singleLine(stripPageLinks(trimmed), "");
}

function cleanTerm(value: string) {
  return singleLine(value.replace(/^[`*_]+|[`*_]+$/g, ""), "concept").replace(/[.:;,-]+$/, "");
}

function addDefinitionFact(facts: DefinitionFact[], seen: Set<string>, fact: DefinitionFact) {
  const term = cleanTerm(fact.term);
  const answer = singleLine(fact.answer, "");
  const key = `${term.toLocaleLowerCase()}::${answer.toLocaleLowerCase()}`;
  if (!term || !answer || seen.has(key)) return;
  seen.add(key);
  facts.push({ ...fact, term, answer });
}

function resolveGeneratorLanguage(language: CardGeneratorInput["language"], sourceText: string): "de" | "en" {
  if (language === "de" || language === "en") {
    return language;
  }
  const lower = ` ${sourceText.toLocaleLowerCase()} `;
  return /[äöüß]/i.test(sourceText) || /\b(der|die|das|und|ist|eine|einen|mit|fuer|für|nicht)\b/.test(lower)
    ? "de"
    : "en";
}

function extractVocabularyTerms(sentences: string[], topic: string) {
  const seen = new Set<string>();
  const terms: Array<{ term: string; sentence: string }> = [];

  for (const sentence of sentences) {
    for (const rawWord of sentence.replace(/[`*_()[\]{}"':;,.!?]/g, " ").split(/\s+/)) {
      const term = rawWord.trim();
      const normalized = term.toLocaleLowerCase();
      if (term.length < 4 || seen.has(normalized) || normalizeVocabularyStopWords(topic).has(normalized)) {
        continue;
      }
      seen.add(normalized);
      terms.push({ term, sentence });
    }
  }

  return terms.sort((left, right) => right.term.length - left.term.length);
}

function normalizeVocabularyStopWords(topic: string) {
  return new Set([
    "about",
    "after",
    "also",
    "and",
    "are",
    "because",
    "das",
    "der",
    "die",
    "eine",
    "einen",
    "for",
    "from",
    "ist",
    "mit",
    "nicht",
    "oder",
    "that",
    "the",
    "this",
    "und",
    "von",
    "was",
    "were",
    "with",
    ...topic.split(/[\s/,-]+/).map((word) => word.toLocaleLowerCase()).filter((word) => word.length > 0),
  ]);
}

function pickKeyTerm(sentence: string, topic: string) {
  const stopWords = new Set([
    "about",
    "after",
    "also",
    "and",
    "are",
    "because",
    "das",
    "der",
    "die",
    "eine",
    "einen",
    "for",
    "from",
    "ist",
    "mit",
    "nicht",
    "oder",
    "that",
    "the",
    "this",
    "und",
    "von",
    "was",
    "were",
    "with",
  ]);
  const topicWords = topic.split(/[\s/,-]+/).filter((word) => word.length > 3);
  const words = sentence
    .replace(/[`*_()[\]{}"':;,.!?]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const candidates = words.filter((word) => {
    const normalized = word.toLocaleLowerCase();
    return word.length >= 4 && !stopWords.has(normalized);
  });

  const topicCandidate = candidates.find((word) =>
    topicWords.some((topicWord) => word.toLocaleLowerCase().includes(topicWord.toLocaleLowerCase())),
  );
  return topicCandidate ?? candidates.sort((left, right) => right.length - left.length)[0] ?? words[0] ?? "concept";
}

function maskTerm(sentence: string, term: string) {
  if (!term) {
    return sentence;
  }
  return sentence.replace(new RegExp(escapeRegExp(term), "i"), "____");
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

function countBlocks(pages: Page[]) {
  return pages.reduce((total, page) => total + flattenBlocks(page.blocks).length, 0);
}

function singleLine(value: string, fallback: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function groupCardsByDeck(cards: StudyCard[]) {
  const groups = new Map<string, StudyCard[]>();
  for (const card of cards) {
    groups.set(card.deck_slug, [...(groups.get(card.deck_slug) ?? []), card]);
  }
  return Array.from(groups.values()).map((deckCards) => ({
    deck: deckCards[0].deck,
    deck_slug: deckCards[0].deck_slug,
    total: deckCards.length,
    due: deckCards.filter(isDue).length,
    weak: deckCards.filter(isWeak).length,
    newCards: deckCards.filter(isNewCard).length,
  }));
}

function buildReviewQueue(cards: StudyCard[], nodeId: string | null) {
  const scopedCards = nodeId ? cardsForGraphNode(cards, nodeId) : cards;
  const nextUpCards = scopedCards.filter((card) => todoStatusForCard(card) === "doing");
  if (nextUpCards.length > 0) {
    return nextUpCards.sort(sortReviewCards);
  }

  return scopedCards
    .filter((card) => todoStatusForCard(card) !== "done")
    .filter(isDue)
    .sort(sortReviewCards);
}

function buildPracticeQueue(cards: StudyCard[], mode: PracticeMode, deckSlug: string, nodeId: string) {
  let queue = [...cards];

  if (mode === "graph" && nodeId) {
    queue = cardsForGraphNode(cards, nodeId);
  } else if (mode === "deck" && deckSlug) {
    queue = queue.filter((card) => card.deck_slug === deckSlug);
  } else if (mode === "weak") {
    queue = queue.filter(isWeak);
    if (deckSlug) {
      queue = queue.filter((card) => card.deck_slug === deckSlug);
    }
  } else if (mode === "new") {
    queue = queue.filter(isNewCard);
    if (deckSlug) {
      queue = queue.filter((card) => card.deck_slug === deckSlug);
    }
  }

  return queue.sort((left, right) => {
    const deckCompare = left.deck.localeCompare(right.deck);
    if (deckCompare !== 0) return deckCompare;
    const topicCompare = left.topic.localeCompare(right.topic);
    if (topicCompare !== 0) return topicCompare;
    return left.question.localeCompare(right.question);
  });
}

function cardsForGraphNode(cards: StudyCard[], nodeId: string) {
  if (nodeId.startsWith("deck:")) {
    const deckSlug = nodeId.slice("deck:".length);
    return cards.filter((card) => card.deck_slug === deckSlug);
  }

  if (nodeId.startsWith("topic:")) {
    const [, deckSlug, topicSlug] = nodeId.split(":");
    return cards.filter((card) => card.deck_slug === deckSlug && card.topic_slug === topicSlug);
  }

  if (nodeId.startsWith("card:")) {
    const cardId = nodeId.slice("card:".length);
    return cards.filter((card) => card.id === cardId);
  }

  if (nodeId === "concept:weak-cards") {
    return cards.filter(isWeak);
  }

  if (nodeId.startsWith("concept:")) {
    const conceptSlug = nodeId.slice("concept:".length);
    return cards.filter((card) =>
      card.linked_pages.some((page) => normalizeSlug(page) === conceptSlug) ||
      card.tags.some((tag) => normalizeSlug(`#${tag}`) === conceptSlug),
    );
  }

  if (nodeId.startsWith("source:")) {
    const sourceSlug = nodeId.slice("source:".length);
    return cards.filter((card) => card.source_page ? normalizeSlug(card.source_page) === sourceSlug : false);
  }

  return [];
}

function sortReviewCards(left: StudyCard, right: StudyCard) {
  const leftDue = left.srs.due_at ? new Date(left.srs.due_at).getTime() : 0;
  const rightDue = right.srs.due_at ? new Date(right.srs.due_at).getTime() : 0;
  if (leftDue !== rightDue) return leftDue - rightDue;
  const weakCompare = Number(isWeak(right)) - Number(isWeak(left));
  if (weakCompare !== 0) return weakCompare;
  const newCompare = Number(isNewCard(right)) - Number(isNewCard(left));
  if (newCompare !== 0) return newCompare;
  return left.question.localeCompare(right.question);
}

function buildBlockLocations(pages: Page[]) {
  const locations = new Map<string, { pageId: string; pageName: string; path: string[] }>();
  for (const page of pages) {
    for (const block of flattenBlocks(page.blocks)) {
      locations.set(block.block.id, {
        pageId: page.id,
        pageName: page.name,
        path: block.path,
      });
    }
  }
  return locations;
}

function buildTodoItems(pages: Page[], cards: StudyCard[]): TodoItem[] {
  const blockEntries = new Map<string, { page: Page; block: Block; path: string[] }>();
  for (const page of pages) {
    for (const entry of flattenBlocks(page.blocks)) {
      blockEntries.set(entry.block.id, { page, block: entry.block, path: entry.path });
    }
  }

  const cardBlockIds = new Set(cards.map((card) => card.block_id));
  const items: TodoItem[] = [];

  for (const entry of blockEntries.values()) {
    if (cardBlockIds.has(entry.block.id)) {
      continue;
    }
    const status = todoStatusForBlock(entry.block);
    if (!status) {
      continue;
    }
    items.push({
      id: entry.block.id,
      pageId: entry.page.id,
      pageName: entry.page.name,
      block: entry.block,
      blockIds: [entry.block.id],
      path: entry.path,
      status,
      scope: "block",
    });
  }

  const topicGroups = new Map<string, Array<{ card: StudyCard; entry: { page: Page; block: Block; path: string[] } }>>();
  for (const card of cards) {
    const entry = blockEntries.get(card.block_id);
    if (!entry) {
      continue;
    }
    const key = `${card.deck_slug}:${card.topic_slug}`;
    topicGroups.set(key, [...(topicGroups.get(key) ?? []), { card, entry }]);
  }

  for (const [key, group] of topicGroups) {
    const statuses = group.map(({ card }) => todoStatusForCard(card)).filter((status): status is TodoStatus => Boolean(status));
    const hasUnlearnedCards = group.some(({ card }) => isUnlearnedCard(card));
    if (!hasUnlearnedCards && statuses.length === 0) {
      continue;
    }

    const status = statuses.includes("doing")
      ? "doing"
      : statuses.length > 0 && statuses.every((value) => value === "done")
        ? "done"
        : "open";
    const first = group[0];
    items.push({
      id: `topic:${key}`,
      pageId: first.entry.page.id,
      pageName: first.entry.page.name,
      block: first.entry.block,
      blockIds: group.map(({ card }) => card.block_id),
      path: [first.card.deck, first.card.topic],
      status,
      scope: "topic",
      deck: first.card.deck,
      topic: first.card.topic,
      cardCount: group.length,
    });
  }

  return items.sort((left, right) => {
    const statusCompare = todoStatusOrder(left.status) - todoStatusOrder(right.status);
    if (statusCompare !== 0) return statusCompare;
    const titleCompare = todoItemTitle(left).localeCompare(todoItemTitle(right));
    if (titleCompare !== 0) return titleCompare;
    return left.pageName.localeCompare(right.pageName);
  });
}

function countDocBlockKinds(blocks: DocBlock[]) {
  return blocks.reduce(
    (counts, block) => ({
      ...counts,
      [block.kind]: counts[block.kind] + 1,
    }),
    { heading: 0, paragraph: 0, todo: 0, quote: 0 } satisfies Record<DocBlockKind, number>,
  );
}

function todoStatusForBlock(block: Block): TodoStatus | null {
  const property = normalizeTodoToken(block.properties["sgd-todo"] ?? block.properties.todo ?? "");
  if (property) {
    return property;
  }

  const content = normalizeSearchText(block.content);
  if (/^(\- )?\[x\]\s+/.test(content) || content.startsWith("done ") || content.includes("#done")) {
    return "done";
  }
  if (content.startsWith("doing ") || content.includes("#doing")) {
    return "doing";
  }
  if (/^(\- )?\[ \]\s+/.test(content) || content.startsWith("todo ") || content.includes("#todo")) {
    return "open";
  }
  return null;
}

function normalizeTodoToken(value: string): TodoStatus | null {
  const normalized = value.trim().toLocaleLowerCase();
  if (["open", "todo", "to-do", "false", "unchecked"].includes(normalized)) return "open";
  if (["doing", "progress", "in-progress", "active"].includes(normalized)) return "doing";
  if (["done", "true", "checked", "complete", "completed"].includes(normalized)) return "done";
  return null;
}

function todoStatusForCard(card: StudyCard): TodoStatus | null {
  return normalizeTodoToken(card.properties["sgd-todo"] ?? card.properties.todo ?? "");
}

function isUnlearnedCard(card: StudyCard) {
  return card.srs.reps === 0 || card.srs.state === "new";
}

function todoStatusOrder(status: TodoStatus) {
  if (status === "open") return 0;
  if (status === "doing") return 1;
  return 2;
}

function filterTodoItems(items: TodoItem[], query: string) {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return items;
  }
  return items.filter((item) =>
    normalizeSearchText(`${item.block.content} ${item.pageName} ${item.path.join(" ")}`).includes(normalized),
  );
}

function stripTodoPrefix(value: string) {
  return value
    .replace(/^(\- )?\[[ xX]\]\s+/, "")
    .replace(/^(todo|doing|done)\s+/i, "")
    .trim() || "Untitled task";
}

function todoItemTitle(item: TodoItem) {
  if (item.scope === "topic") {
    return `${item.deck ?? "Deck"} / ${item.topic ?? "Topic"}`;
  }
  return stripTodoPrefix(stripPageLinks(item.block.content));
}

function todoItemSubtitle(item: TodoItem) {
  if (item.scope === "topic") {
    const count = item.cardCount === 1 ? "1 card" : `${item.cardCount ?? item.blockIds.length} cards`;
    return `${count} | first source: ${item.pageName}`;
  }
  return `${item.pageName}${item.path.length > 1 ? ` / ${item.path.slice(0, -1).map(stripPageLinks).join(" / ")}` : ""}`;
}

function filterPages(pages: Page[], query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return pages;
  }
  return pages.filter((page) => {
    const blocks = flattenBlocks(page.blocks)
      .map((entry) => entry.block.content)
      .join(" ");
    return normalizeSearchText(`${page.name} ${blocks}`).includes(normalizedQuery);
  });
}

function findLastChildId(blocks: Block[], parentBlockId: string): string | null {
  for (const block of blocks) {
    if (block.id === parentBlockId) {
      return block.children.at(-1)?.id ?? null;
    }
    const nested = findLastChildId(block.children, parentBlockId);
    if (nested) return nested;
  }
  return null;
}

function findNextSiblingId(blocks: Block[], blockId: string): string | null {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index >= 0) {
    return blocks[index + 1]?.id ?? null;
  }

  for (const block of blocks) {
    const nested = findNextSiblingId(block.children, blockId);
    if (nested) return nested;
  }
  return null;
}

function buildSearchResults(snapshot: DesktopSnapshot | null, query: string): SearchResult[] {
  const commands: SearchResult[] = [
    commandResult("notes", "Open Edit Desk", "Open the Logseq-style outliner"),
    commandResult("doc", "Open Documentation", "Open the Notion-style documentation desk"),
    commandResult("todo", "Open To Do", "Capture and review task blocks"),
    commandResult("dashboard", "Open Deck Dashboard", "Show deck counts and due cards"),
    commandResult("review", "Start Due Review", "Open review flow for due cards"),
    commandResult("practice", "Start Free Practice", "Practice cards without changing SRS by default"),
    commandResult("graph", "Open Study Graph", "Show graph-based learning view"),
    commandResult("generate", "Generate Cards", "Create local parser cards from source text"),
    commandResult("settings", "Open Settings and Debug", "Show SQLite settings, storage paths, and debug report"),
    commandResult("import", "Import Markdown", "Import Markdown text, file, or folder"),
    commandResult("export", "Export Markdown", "Preview or export Markdown files"),
    commandResult("refresh", "Refresh Workspace", "Reload local snapshot"),
  ];

  if (!snapshot) {
    return filterSearchResults(commands, query).slice(0, 30);
  }

  const results: SearchResult[] = [...commands];
  const blockLocations = new Map<string, { pageId: string; pageName: string; path: string[] }>();

  for (const page of snapshot.workspace.pages) {
    results.push({
      id: `page:${page.id}`,
      type: "page",
      title: page.name,
      subtitle: "Page",
      pageId: page.id,
      haystack: page.name,
    });

    for (const block of flattenBlocks(page.blocks)) {
      blockLocations.set(block.block.id, {
        pageId: page.id,
        pageName: page.name,
        path: block.path,
      });
      results.push({
        id: `block:${block.block.id}`,
        type: "block",
        title: stripPageLinks(block.block.content),
        subtitle: `${page.name}${block.path.length > 1 ? ` / ${block.path.slice(0, -1).map(stripPageLinks).join(" / ")}` : ""}`,
        pageId: page.id,
        blockId: block.block.id,
        haystack: `${page.name} ${block.path.join(" ")} ${Object.values(block.block.properties).join(" ")}`,
      });
    }
  }

  for (const card of snapshot.cards) {
    const location = blockLocations.get(card.block_id);
    results.push({
      id: `card:${card.id}`,
      type: "card",
      title: card.question,
      subtitle: `${card.deck} / ${card.topic}${location ? ` / ${location.pageName}` : ""}`,
      pageId: location?.pageId,
      blockId: card.block_id,
      haystack: `${card.question} ${card.answer_markdown} ${card.deck} ${card.topic} ${card.linked_pages.join(" ")} ${card.tags.join(" ")}`,
    });
  }

  return filterSearchResults(results, query).slice(0, 50);
}

function commandResult(action: NonNullable<SearchResult["action"]>, title: string, subtitle: string): SearchResult {
  return {
    id: `command:${action}`,
    type: "command",
    title,
    subtitle,
    action,
    haystack: `${title} ${subtitle}`,
  };
}

function filterSearchResults(results: SearchResult[], query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  const scored = results
    .map((result) => ({ result, score: scoreSearchResult(result, tokens, normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || resultTypeOrder(left.result.type) - resultTypeOrder(right.result.type));

  return scored.map((entry) => entry.result);
}

function scoreSearchResult(result: SearchResult, tokens: string[], normalizedQuery: string) {
  if (tokens.length === 0) {
    return result.type === "command" ? 80 : 30 - resultTypeOrder(result.type);
  }

  const title = normalizeSearchText(result.title);
  const haystack = normalizeSearchText(result.haystack);
  if (!tokens.every((token) => haystack.includes(token))) {
    return 0;
  }

  let score = 10;
  if (title === normalizedQuery) score += 100;
  if (title.startsWith(normalizedQuery)) score += 70;
  if (title.includes(normalizedQuery)) score += 35;
  if (result.type === "page") score += 12;
  if (result.type === "command") score += 8;
  if (result.type === "card") score += 6;
  return score;
}

function resultTypeOrder(type: SearchResultType) {
  const order: Record<SearchResultType, number> = {
    command: 0,
    page: 1,
    card: 2,
    block: 3,
  };
  return order[type];
}

function normalizeSearchText(value: string) {
  return stripPageLinks(value).toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeSlug(value: string) {
  let out = "";
  let lastWasDash = false;
  let lastWasSlash = false;

  for (const character of value.trim().toLocaleLowerCase()) {
    if (/^[\p{L}\p{N}]$/u.test(character)) {
      out += character;
      lastWasDash = false;
      lastWasSlash = false;
    } else if (character === "/") {
      while (out.endsWith("-")) {
        out = out.slice(0, -1);
      }
      if (out && !lastWasSlash) {
        out += "/";
      }
      lastWasDash = false;
      lastWasSlash = true;
    } else if (!lastWasDash && !lastWasSlash && out) {
      out += "-";
      lastWasDash = true;
    }
  }

  return out.replace(/^[-/]+|[-/]+$/g, "");
}

function flattenBlocks(blocks: Block[], ancestors: string[] = []): Array<{ block: Block; path: string[] }> {
  return blocks.flatMap((block) => {
    const path = [...ancestors, block.content];
    return [{ block, path }, ...flattenBlocks(block.children, path)];
  });
}

function isDue(card: StudyCard) {
  return !card.srs.due_at || new Date(card.srs.due_at).getTime() <= Date.now();
}

function dueLabel(card: StudyCard) {
  if (!card.srs.due_at) {
    return "Due now";
  }

  const diffMs = new Date(card.srs.due_at).getTime() - Date.now();
  if (diffMs <= 0) {
    return "Due now";
  }

  const minutes = Math.ceil(diffMs / 60000);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.ceil(minutes / 60);
  if (hours < 48) {
    return `${hours}h`;
  }

  return `${Math.ceil(hours / 24)}d`;
}

function isNewCard(card: StudyCard) {
  return card.srs.reps === 0 || !card.srs.due_at;
}

function isWeak(card: StudyCard) {
  return card.srs.lapses >= 2 || card.srs.ease <= 1.6 || card.srs.last_rating === "again" || card.srs.hard_count >= 2;
}

function layoutGraph(nodes: StudyGraphNode[]) {
  const lanes: Record<StudyGraphNode["kind"], number> = {
    deck: 90,
    topic: 280,
    card: 500,
    concept: 720,
    source: 890,
  };
  const counters: Record<StudyGraphNode["kind"], number> = {
    deck: 0,
    topic: 0,
    card: 0,
    concept: 0,
    source: 0,
  };
  return nodes.map((node) => {
    const index = counters[node.kind]++;
    return { ...node, x: lanes[node.kind], y: 70 + index * 76 };
  });
}

function titleForScreen(screen: Screen) {
  const titles: Record<Screen, string> = {
    notes: "Edit Desk",
    doc: "Documentation",
    todo: "To Do",
    dashboard: "Deck Dashboard",
    review: "Review",
    practice: "Free Practice",
    graph: "Study Graph",
    generate: "Generate Cards",
    settings: "Settings / Debug",
    import: "Import Markdown",
    export: "Export Markdown",
  };
  return titles[screen];
}

function shorten(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function pageNameFromFilePath(filePath: string) {
  const fileName = filePath.split(/[\\/]/).pop() ?? "Imported Page";
  return fileName.replace(/\.(md|markdown|txt)$/i, "") || "Imported Page";
}

function extractPageLinks(value: string) {
  const links = new Set<string>();
  const pattern = /\[\[([^\]]+)]]/g;
  let match = pattern.exec(value);
  while (match) {
    const link = normalizePageTitle(match[1]);
    if (link) {
      links.add(link);
    }
    match = pattern.exec(value);
  }
  return Array.from(links);
}

function normalizePageTitle(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function backlinksForPage(backlinks: BacklinkReference[], pageName: string) {
  const wanted = normalizePageRef(pageName);
  return backlinks.filter((backlink) => normalizePageRef(backlink.target_page) === wanted);
}

function normalizePageRef(value: string) {
  return normalizePageTitle(value).toLocaleLowerCase();
}

function groupBacklinksBySource(backlinks: BacklinkReference[]) {
  const groups = new Map<string, { source_page_id: string; source_page: string; references: BacklinkReference[] }>();
  for (const backlink of backlinks) {
    const current = groups.get(backlink.source_page_id) ?? {
      source_page_id: backlink.source_page_id,
      source_page: backlink.source_page,
      references: [],
    };
    current.references.push(backlink);
    groups.set(backlink.source_page_id, current);
  }
  return Array.from(groups.values()).sort((left, right) => left.source_page.localeCompare(right.source_page));
}

function stripPageLinks(value: string) {
  return value.replace(/\[\[([^\]]+)]]/g, "$1");
}
