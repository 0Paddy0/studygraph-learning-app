import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppBackup,
  AppDebugInfo,
  AppSettings,
  BackupExportResult,
  DesktopSnapshot,
  DocBlockKind,
  DocPage,
  FolderExportResult,
  FolderImportResult,
  GeneratedCard,
  Rating,
  WorkspaceExport,
} from "./types";

export async function loadSnapshot(): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("load_snapshot");
}

export async function getAppDebugInfo(): Promise<AppDebugInfo> {
  return invoke<AppDebugInfo>("app_debug_info");
}

export async function loadAppSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("load_app_settings");
}

export async function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  return invoke<AppSettings>("save_app_settings", { settings });
}

export async function loadDocPages(): Promise<DocPage[]> {
  return invoke<DocPage[]>("load_doc_pages");
}

export async function createDocPage(title: string): Promise<DocPage[]> {
  return invoke<DocPage[]>("create_doc_page", { title });
}

export async function updateDocPageTitle(pageId: string, title: string): Promise<DocPage[]> {
  return invoke<DocPage[]>("update_doc_page_title", { pageId, title });
}

export async function deleteDocPage(pageId: string): Promise<DocPage[]> {
  return invoke<DocPage[]>("delete_doc_page", { pageId });
}

export async function addDocBlock(pageId: string, kind: DocBlockKind, content: string): Promise<DocPage[]> {
  return invoke<DocPage[]>("add_doc_block", { pageId, kind, content });
}

export async function updateDocBlock(
  blockId: string,
  kind: DocBlockKind,
  content: string,
  checked: boolean,
): Promise<DocPage[]> {
  return invoke<DocPage[]>("update_doc_block", {
    input: { blockId, kind, content, checked },
  });
}

export async function deleteDocBlock(blockId: string): Promise<DocPage[]> {
  return invoke<DocPage[]>("delete_doc_block", { blockId });
}

export async function moveDocBlock(blockId: string, direction: number): Promise<DocPage[]> {
  return invoke<DocPage[]>("move_doc_block", { blockId, direction });
}

export async function importMarkdownPage(pageName: string, markdown: string): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("import_markdown_page", {
    pageName,
    markdown,
  });
}

export async function pickMarkdownFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
  });
  return Array.isArray(selected) ? selected[0] ?? null : selected;
}

export async function importMarkdownFile(filePath: string): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("import_markdown_file", { filePath });
}

export async function pickMarkdownFolder(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: true,
  });
  return Array.isArray(selected) ? selected[0] ?? null : selected;
}

export async function importMarkdownFolder(folderPath: string): Promise<FolderImportResult> {
  return invoke<FolderImportResult>("import_markdown_folder", { folderPath });
}

export async function reviewCard(cardId: string, rating: Rating): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("review_card", {
    cardId,
    rating,
  });
}

export async function createPage(name: string): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("create_page", { name });
}

export async function renamePage(pageId: string, name: string): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("rename_page", { pageId, name });
}

export async function setPageProperty(pageId: string, key: string, value: string): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("set_page_property", { pageId, key, value });
}

export async function removePageProperty(pageId: string, key: string): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("remove_page_property", { pageId, key });
}

export async function addRootBlock(pageId: string, content: string): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("add_root_block", { pageId, content });
}

export async function addChildBlock(parentBlockId: string, content: string): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("add_child_block", { parentBlockId, content });
}

export async function addSiblingBlock(blockId: string, content: string): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("add_sibling_block", { blockId, content });
}

export async function indentBlock(blockId: string): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("indent_block", { blockId });
}

export async function outdentBlock(blockId: string): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("outdent_block", { blockId });
}

export async function updateBlockContent(blockId: string, content: string): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("update_block_content", { blockId, content });
}

export async function setBlockProperty(blockId: string, key: string, value: string): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("set_block_property", { blockId, key, value });
}

export async function removeBlockProperty(blockId: string, key: string): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("remove_block_property", { blockId, key });
}

export async function deleteBlock(blockId: string): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("delete_block", { blockId });
}

export async function insertGeneratedCards(pageId: string, cards: GeneratedCard[]): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("insert_generated_cards", { pageId, cards });
}

export async function insertDocCard(input: {
  pageId: string;
  docPageId: string;
  docBlockId: string;
  docPageTitle: string;
  question: string;
  answer: string;
  deck: string;
  topic: string;
}): Promise<DesktopSnapshot> {
  return invoke<DesktopSnapshot>("insert_doc_card", { input });
}

export async function exportWorkspaceMarkdown(): Promise<WorkspaceExport> {
  return invoke<WorkspaceExport>("export_workspace_markdown");
}

export async function pickExportFolder(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: true,
  });
  return Array.isArray(selected) ? selected[0] ?? null : selected;
}

export async function exportWorkspaceMarkdownToFolder(folderPath: string, overwrite: boolean): Promise<FolderExportResult> {
  return invoke<FolderExportResult>("export_workspace_markdown_to_folder", { folderPath, overwrite });
}

export async function exportAppBackup(): Promise<AppBackup> {
  return invoke<AppBackup>("export_app_backup");
}

export async function exportAppBackupToFolder(folderPath: string): Promise<BackupExportResult> {
  return invoke<BackupExportResult>("export_app_backup_to_folder", { folderPath });
}
