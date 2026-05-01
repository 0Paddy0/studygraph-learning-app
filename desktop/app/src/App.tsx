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
  pickExportFolder,
  pickMarkdownFile,
  pickMarkdownFolder,
  renamePage,
  removeBlockProperty,
  removePageProperty,
  reviewCard,
  saveAppSettings as saveStoredAppSettings,
  setPageProperty,
  setBlockProperty,
  updateDocBlock,
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
type MaybePromise<T = void> = T | Promise<T>;
type TodoStatus = "open" | "doing" | "done";

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
  path: string[];
  status: TodoStatus;
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
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("all");
  const [practiceDeckSlug, setPracticeDeckSlug] = useState<string>("");
  const [practiceNodeId, setPracticeNodeId] = useState<string>("");
  const [practiceScopeLabel, setPracticeScopeLabel] = useState("All cards");
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceShowAnswer, setPracticeShowAnswer] = useState(false);
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
      const next = await reviewCard(card.id, rating);
      setSnapshot(next);
      setShowAnswer(false);
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
      const next = await reviewCard(card.id, rating);
      setSnapshot(next);
      setPracticeShowAnswer(false);
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
      let next = await setBlockProperty(item.block.id, "sgd-todo", status);
      if (status === "done") {
        next = await setBlockProperty(item.block.id, "sgd-todo-done-at", new Date().toISOString());
      } else if (item.block.properties["sgd-todo-done-at"]) {
        next = await removeBlockProperty(item.block.id, "sgd-todo-done-at");
      }
      setSnapshot(next);
      setSelectedPageId(item.pageId);
      setFocusedBlockId(item.block.id);
      setTodoStatus(status === "done" ? "Task completed." : `Task moved to ${status}.`);
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

  function generateCardsPreview() {
    setError(null);
    const cards = mockGenerateCards(generatorInput);
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

  function openBlock(pageId: string, blockId: string) {
    setSelectedPageId(pageId);
    setFocusedBlockId(blockId);
    setScreen("notes");
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
  const todoItems = useMemo(() => buildTodoItems(pages), [pages]);
  const decks = useMemo(() => groupCardsByDeck(cards), [cards]);
  const allDueCards = useMemo(() => cards.filter(isDue), [cards]);
  const dueCards = useMemo(() => buildReviewQueue(cards, reviewNodeId), [cards, reviewNodeId]);
  const practiceQueue = useMemo(
    () => buildPracticeQueue(cards, practiceMode, practiceDeckSlug, practiceNodeId),
    [cards, practiceMode, practiceDeckSlug, practiceNodeId],
  );
  const currentCard = dueCards[selectedCardIndex];
  const currentPracticeCard = practiceQueue[practiceIndex];
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

        <nav className="nav">
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
          <button className={screen === "generate" ? "active" : ""} onClick={() => setScreen("generate")}>Generate Cards</button>
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
            onOpenBlock={openBlock}
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
            onShowAnswer={() => setShowAnswer(true)}
            onSkip={() => {
              setShowAnswer(false);
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
            }}
            onRecordRatingsChange={setPracticeRecordRatings}
            onShowAnswer={() => setPracticeShowAnswer(true)}
            onSkip={() => {
              setPracticeShowAnswer(false);
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
  onDeleteBlock: (blockId: string) => void;
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
  onDeletePage,
  onAddBlock,
  onAddSectionTemplate,
  onUpdateBlock,
  onDeleteBlock,
  onMoveBlock,
  onCreateCard,
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
  onDeletePage: (pageId: string) => void;
  onAddBlock: (pageId: string, kind: DocBlockKind) => void;
  onAddSectionTemplate: (pageId: string) => void;
  onUpdateBlock: (block: DocBlock) => void;
  onDeleteBlock: (blockId: string) => void;
  onMoveBlock: (blockId: string, direction: number) => void;
  onCreateCard: (docPage: DocPage, block: DocBlock) => void;
}) {
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

  return (
    <section className="doc">
      <aside className="doc-outline">
        <div className="doc-outline-heading">
          <strong>Docs</strong>
          <button onClick={onCreatePage}>+</button>
        </div>
        {pages.map((page) => (
          <button
            key={page.id}
            className={page.id === selectedPage.id ? "active" : ""}
            onClick={() => onSelectPage(page.id)}
          >
            {page.title}
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
      </aside>

      <article className="doc-page">
        <p className="doc-kicker">Documentation</p>
        <DocTitleEditor page={selectedPage} onRenamePage={onRenamePage} />
        <p className="doc-lead">
          Persistent Notion-style documentation stored in SQLite. Use it for longer explanations, project notes,
          manuals, and learning material that should live next to your cards.
        </p>
        <p className="doc-target">
          Card target: {selectedEditPageName ?? "select an Edit Desk page"}
        </p>
        <div className="doc-cover" />

        <div className="doc-toolbar">
          <button onClick={() => onAddBlock(selectedPage.id, "paragraph")}>Paragraph</button>
          <button onClick={() => onAddBlock(selectedPage.id, "heading")}>Heading</button>
          <button onClick={() => onAddBlock(selectedPage.id, "todo")}>Todo</button>
          <button onClick={() => onAddBlock(selectedPage.id, "quote")}>Quote</button>
          <button className="primary" onClick={() => onAddSectionTemplate(selectedPage.id)}>Section Template</button>
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
              />
            ))
          )}
        </div>
      </article>
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
}) {
  const [draft, setDraft] = useState(block.content);
  const [kind, setKind] = useState<DocBlockKind>(block.kind);
  const [checked, setChecked] = useState(block.checked);
  const links = useMemo(() => extractPageLinks(draft), [draft]);

  useEffect(() => {
    setDraft(block.content);
    setKind(block.kind);
    setChecked(block.checked);
  }, [block.id, block.content, block.kind, block.checked]);

  function save(next?: Partial<DocBlock>) {
    const merged = {
      ...block,
      kind,
      content: draft,
      checked,
      ...next,
    };
    if (merged.kind !== block.kind || merged.content !== block.content || merged.checked !== block.checked) {
      onUpdateBlock(merged);
    }
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
        <button disabled={isFirst} onClick={() => onMoveBlock(block.id, -1)}>Up</button>
        <button disabled={isLast} onClick={() => onMoveBlock(block.id, 1)}>Down</button>
        <button onClick={() => onCreateCard({ ...block, kind, content: draft, checked })}>Create Card</button>
        <button className="danger subtle" onClick={() => onDeleteBlock(block.id)}>Delete</button>
      </div>
      <textarea
        value={draft}
        rows={kind === "heading" ? 1 : 3}
        placeholder={placeholderForDocKind(kind)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => save()}
      />
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
  onOpenBlock: (pageId: string, blockId: string) => void;
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
          <h2>Quick Capture</h2>
          <p>Tasks are normal Edit Desk bullet blocks with `sgd-todo` metadata.</p>
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
        <span>{doingItems.length} doing</span>
        <span>{doneItems.length} done</span>
      </div>

      <div className="todo-board">
        <TodoColumn title="Open" items={openItems} onSetStatus={onSetStatus} onOpenBlock={onOpenBlock} />
        <TodoColumn title="Doing" items={doingItems} onSetStatus={onSetStatus} onOpenBlock={onOpenBlock} />
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
  onOpenBlock: (pageId: string, blockId: string) => void;
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
            <button className="todo-title" onClick={() => onOpenBlock(item.pageId, item.block.id)}>
              {stripTodoPrefix(stripPageLinks(item.block.content))}
            </button>
            <small>{item.pageName}{item.path.length > 1 ? ` / ${item.path.slice(0, -1).map(stripPageLinks).join(" / ")}` : ""}</small>
            <div className="todo-actions">
              <button disabled={item.status === "open"} onClick={() => onSetStatus(item, "open")}>Open</button>
              <button disabled={item.status === "doing"} onClick={() => onSetStatus(item, "doing")}>Doing</button>
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

function ReviewView({
  card,
  index,
  total,
  scopeLabel,
  showAnswer,
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
      <article className="review-card">
        <h2>{card.question}</h2>
        <CardStudyMeta card={card} />
        {card.linked_pages.length > 0 && <p>Linked: {card.linked_pages.join(", ")}</p>}
      </article>
      {showAnswer && (
        <article className="answer-card">
          <h3>Answer</h3>
          <pre>{card.answer_markdown || "(No answer child blocks)"}</pre>
        </article>
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

      <div className="practice-summary">
        <span>{total} cards in queue</span>
        <span>{selectedDeckLabel}</span>
        <span>{cards.length} cards indexed</span>
        {!recordRatings && <strong>Practice-only: SRS unchanged</strong>}
      </div>

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
            <article className="answer-card">
              <h3>Answer</h3>
              <pre>{card.answer_markdown || "(No answer child blocks)"}</pre>
            </article>
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
          <h2>Future API Provider</h2>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.apiProviderEnabled}
              onChange={(event) => onSettingsChange({ apiProviderEnabled: event.target.checked })}
            />
            Enable provider settings
          </label>
          <label>
            API base URL
            <input value={settings.apiBaseUrl} onChange={(event) => onSettingsChange({ apiBaseUrl: event.target.value })} />
          </label>
          <label>
            Model
            <input value={settings.apiModel} onChange={(event) => onSettingsChange({ apiModel: event.target.value })} />
          </label>
          <label>
            API key
            <input value="" disabled placeholder="Not stored in this MVP" />
          </label>
          <p className="settings-note">The current generator is offline. External requests are not implemented or sent automatically.</p>
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
}: {
  pages: WorkspaceExport["pages"];
  backup: AppBackup | null;
  fileStatus: string | null;
  onRefresh: () => void;
  onExportFolder: () => void;
  onRefreshBackup: () => void;
  onExportBackup: () => void;
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

function mockGenerateCards(input: CardGeneratorInput): GeneratedCard[] {
  const sentences = splitSourceSentences(input.source_text);
  if (sentences.length === 0) {
    return [];
  }

  const language = resolveGeneratorLanguage(input.language, input.source_text);
  const deck = singleLine(input.deck, "Generated");
  const topic = singleLine(input.topic, "General");
  const limit = clampNumber(input.number_of_cards, 1, 30);

  return sentences.slice(0, limit).map((sentence, index) => {
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
      };
    }

    return {
      question: `${promptPrefix} "${term}" ${contextPhrase}?`,
      answer: sentence,
      deck,
      topic,
      tags: ["generated", input.difficulty, "basic"],
      source_summary: shorten(sentence, 120),
    };
  });
}

function placeholderForDocKind(kind: DocBlockKind) {
  const placeholders: Record<DocBlockKind, string> = {
    heading: "Section heading",
    paragraph: "Write a paragraph...",
    todo: "Task or checklist item...",
    quote: "Quote or callout...",
  };
  return placeholders[kind];
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

function splitSourceSentences(value: string) {
  return value
    .replace(/\r/g, "")
    .split(/(?:[.!?]+|\n+)/)
    .map((part) => singleLine(part, ""))
    .filter((part) => part.length >= 12);
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
        "  sgd-source:: mock",
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
  return scopedCards.filter(isDue).sort(sortReviewCards);
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

function buildTodoItems(pages: Page[]): TodoItem[] {
  return pages.flatMap((page) =>
    flattenBlocks(page.blocks)
      .map((entry) => {
        const status = todoStatusForBlock(entry.block);
        if (!status) {
          return null;
        }
        return {
          id: entry.block.id,
          pageId: page.id,
          pageName: page.name,
          block: entry.block,
          path: entry.path,
          status,
        } satisfies TodoItem;
      })
      .filter((item): item is TodoItem => item !== null),
  );
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
    commandResult("generate", "Generate Cards", "Create local mock cards from source text"),
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
