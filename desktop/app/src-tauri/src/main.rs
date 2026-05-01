#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use studygraph_core::{
    build_backlinks, build_study_graph, export_page_to_logseq_markdown,
    import_single_markdown_page, schedule_review, AppBackup, AppSettings, BacklinkReference, Block,
    DocBlockKind, DocPage, Page, Rating, ReviewEvent, SchedulerSettings, StudyCard, StudyGraphData,
    StudyGraphStorage, Workspace,
};
use tauri::Manager;
use uuid::Uuid;

struct AppState {
    storage: Mutex<StudyGraphStorage>,
    workspace_id: Mutex<Option<Uuid>>,
}

#[derive(Debug, Serialize)]
struct DesktopSnapshot {
    workspace: Workspace,
    cards: Vec<StudyCard>,
    graph: StudyGraphData,
    backlinks: Vec<BacklinkReference>,
}

#[derive(Debug, Deserialize)]
struct GeneratedCardInput {
    question: String,
    answer: String,
    deck: String,
    topic: String,
    tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InsertDocCardInput {
    page_id: String,
    doc_page_id: String,
    doc_block_id: String,
    doc_page_title: String,
    question: String,
    answer: String,
    deck: String,
    topic: String,
}

#[derive(Debug, Serialize)]
struct ExportedPage {
    name: String,
    markdown: String,
}

#[derive(Debug, Serialize)]
struct WorkspaceExport {
    pages: Vec<ExportedPage>,
}

#[derive(Debug, Serialize)]
struct FolderExportResult {
    folder_path: String,
    files: Vec<String>,
}

#[derive(Debug, Serialize)]
struct BackupExportResult {
    file_path: String,
    backup: AppBackup,
}

#[derive(Debug, Serialize)]
struct FolderImportResult {
    folder_path: String,
    imported_files: Vec<String>,
    snapshot: DesktopSnapshot,
}

#[derive(Debug, Serialize)]
struct AppDebugInfo {
    app_data_dir: String,
    database_path: String,
    workspace_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDocBlockInput {
    block_id: String,
    kind: DocBlockKind,
    content: String,
    checked: bool,
}

#[tauri::command]
fn load_snapshot(state: tauri::State<'_, AppState>) -> Result<DesktopSnapshot, String> {
    let workspace_id = ensure_workspace(&state)?;
    snapshot_for_workspace(&state, workspace_id)
}

#[tauri::command]
fn app_debug_info(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<AppDebugInfo, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data dir: {error}"))?;
    let workspace_id = state
        .workspace_id
        .lock()
        .map_err(|_| "Workspace state lock poisoned".to_string())?
        .map(|id| id.to_string());

    Ok(AppDebugInfo {
        database_path: app_data_dir
            .join("studygraph.sqlite3")
            .to_string_lossy()
            .to_string(),
        app_data_dir: app_data_dir.to_string_lossy().to_string(),
        workspace_id,
    })
}

#[tauri::command]
fn load_app_settings(state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
    let workspace_id = ensure_workspace(&state)?;
    let storage = lock_storage(&state)?;
    storage
        .load_app_settings(workspace_id)
        .map_err(format_storage_error)
}

#[tauri::command]
fn save_app_settings(
    settings: AppSettings,
    state: tauri::State<'_, AppState>,
) -> Result<AppSettings, String> {
    let workspace_id = ensure_workspace(&state)?;
    let storage = lock_storage(&state)?;
    storage
        .save_app_settings(workspace_id, &settings)
        .map_err(format_storage_error)
}

#[tauri::command]
fn load_doc_pages(state: tauri::State<'_, AppState>) -> Result<Vec<DocPage>, String> {
    let workspace_id = ensure_workspace(&state)?;
    let mut storage = lock_storage(&state)?;
    storage
        .ensure_default_doc_page(workspace_id)
        .map_err(format_storage_error)
}

#[tauri::command]
fn create_doc_page(
    title: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DocPage>, String> {
    let workspace_id = ensure_workspace(&state)?;
    let mut storage = lock_storage(&state)?;
    storage
        .create_doc_page(workspace_id, &title)
        .map_err(format_storage_error)?;
    storage
        .load_doc_pages(workspace_id)
        .map_err(format_storage_error)
}

#[tauri::command]
fn update_doc_page_title(
    page_id: String,
    title: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DocPage>, String> {
    let workspace_id = ensure_workspace(&state)?;
    let page_uuid = Uuid::parse_str(&page_id).map_err(|error| error.to_string())?;
    let storage = lock_storage(&state)?;
    storage
        .update_doc_page_title(page_uuid, &title)
        .map_err(format_storage_error)?;
    storage
        .load_doc_pages(workspace_id)
        .map_err(format_storage_error)
}

#[tauri::command]
fn delete_doc_page(
    page_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DocPage>, String> {
    let workspace_id = ensure_workspace(&state)?;
    let page_uuid = Uuid::parse_str(&page_id).map_err(|error| error.to_string())?;
    let mut storage = lock_storage(&state)?;
    storage
        .delete_doc_page(workspace_id, page_uuid)
        .map_err(format_storage_error)?;
    storage
        .load_doc_pages(workspace_id)
        .map_err(format_storage_error)
}

#[tauri::command]
fn add_doc_block(
    page_id: String,
    kind: DocBlockKind,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DocPage>, String> {
    let workspace_id = ensure_workspace(&state)?;
    let page_uuid = Uuid::parse_str(&page_id).map_err(|error| error.to_string())?;
    let storage = lock_storage(&state)?;
    storage
        .add_doc_block(page_uuid, kind, &content)
        .map_err(format_storage_error)?;
    storage
        .load_doc_pages(workspace_id)
        .map_err(format_storage_error)
}

#[tauri::command]
fn update_doc_block(
    input: UpdateDocBlockInput,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DocPage>, String> {
    let workspace_id = ensure_workspace(&state)?;
    let block_uuid = Uuid::parse_str(&input.block_id).map_err(|error| error.to_string())?;
    let storage = lock_storage(&state)?;
    storage
        .update_doc_block(block_uuid, input.kind, &input.content, input.checked)
        .map_err(format_storage_error)?;
    storage
        .load_doc_pages(workspace_id)
        .map_err(format_storage_error)
}

#[tauri::command]
fn delete_doc_block(
    block_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DocPage>, String> {
    let workspace_id = ensure_workspace(&state)?;
    let block_uuid = Uuid::parse_str(&block_id).map_err(|error| error.to_string())?;
    let storage = lock_storage(&state)?;
    storage
        .delete_doc_block(block_uuid)
        .map_err(format_storage_error)?;
    storage
        .load_doc_pages(workspace_id)
        .map_err(format_storage_error)
}

#[tauri::command]
fn move_doc_block(
    block_id: String,
    direction: i32,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DocPage>, String> {
    let workspace_id = ensure_workspace(&state)?;
    let block_uuid = Uuid::parse_str(&block_id).map_err(|error| error.to_string())?;
    let storage = lock_storage(&state)?;
    storage
        .move_doc_block(block_uuid, direction)
        .map_err(format_storage_error)?;
    storage
        .load_doc_pages(workspace_id)
        .map_err(format_storage_error)
}

#[tauri::command]
fn import_markdown_page(
    page_name: String,
    markdown: String,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let workspace_id = ensure_workspace(&state)?;
    let mut workspace = {
        let storage = lock_storage(&state)?;
        storage
            .load_workspace(workspace_id)
            .map_err(format_storage_error)?
            .ok_or_else(|| "Workspace not found".to_string())?
    };

    let page = import_single_markdown_page(&page_name, &markdown);
    workspace
        .pages
        .retain(|existing| existing.name != page.name);
    workspace.pages.push(page);

    {
        let mut storage = lock_storage(&state)?;
        storage
            .save_workspace(&workspace)
            .map_err(format_storage_error)?;
    }

    snapshot_for_workspace(&state, workspace_id)
}

#[tauri::command]
fn import_markdown_file(
    file_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let path = PathBuf::from(file_path);
    if !path.is_file() {
        return Err("Selected path is not a Markdown file.".to_string());
    }

    let markdown = std::fs::read_to_string(&path)
        .map_err(|error| format!("Could not read Markdown file: {error}"))?;
    let page_name = page_name_from_path(&path);
    import_markdown_page(page_name, markdown, state)
}

#[tauri::command]
fn import_markdown_folder(
    folder_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<FolderImportResult, String> {
    let folder = PathBuf::from(&folder_path);
    if !folder.is_dir() {
        return Err("Selected path is not a folder.".to_string());
    }

    let workspace_id = ensure_workspace(&state)?;
    let markdown_files = collect_markdown_files(&folder)?;
    if markdown_files.is_empty() {
        return Err("No Markdown files found in the selected folder.".to_string());
    }

    let mut imported_pages = Vec::new();
    let mut imported_files = Vec::new();
    for path in markdown_files {
        let markdown = std::fs::read_to_string(&path)
            .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
        let page_name = page_name_from_graph_path(&folder, &path);
        imported_pages.push(import_single_markdown_page(&page_name, &markdown));
        imported_files.push(path.to_string_lossy().to_string());
    }

    {
        let mut storage = lock_storage(&state)?;
        let mut workspace = storage
            .load_workspace(workspace_id)
            .map_err(format_storage_error)?
            .ok_or_else(|| "Workspace not found".to_string())?;
        let imported_names = imported_pages
            .iter()
            .map(|page| page.name.clone())
            .collect::<BTreeSet<_>>();
        workspace
            .pages
            .retain(|existing| !imported_names.contains(&existing.name));
        workspace.pages.extend(imported_pages);
        workspace
            .pages
            .sort_by(|left, right| left.name.cmp(&right.name));
        storage
            .save_workspace(&workspace)
            .map_err(format_storage_error)?;
    }

    let snapshot = snapshot_for_workspace(&state, workspace_id)?;
    Ok(FolderImportResult {
        folder_path,
        imported_files,
        snapshot,
    })
}

#[tauri::command]
fn create_page(name: String, state: tauri::State<'_, AppState>) -> Result<DesktopSnapshot, String> {
    mutate_workspace(&state, |workspace| {
        let page_name = clean_name(&name, "Untitled");
        if workspace.pages.iter().any(|page| page.name == page_name) {
            return Err("A page with this name already exists.".to_string());
        }
        workspace.pages.push(Page {
            id: Uuid::new_v4(),
            name: page_name,
            properties: BTreeMap::new(),
            blocks: Vec::new(),
        });
        Ok(())
    })
}

#[tauri::command]
fn rename_page(
    page_id: String,
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let page_uuid = Uuid::parse_str(&page_id).map_err(|error| error.to_string())?;
    mutate_workspace(&state, |workspace| {
        let next_name = clean_name(&name, "Untitled");
        if workspace
            .pages
            .iter()
            .any(|page| page.id != page_uuid && page.name == next_name)
        {
            return Err("A page with this name already exists.".to_string());
        }
        let page = workspace
            .pages
            .iter_mut()
            .find(|page| page.id == page_uuid)
            .ok_or_else(|| "Page not found".to_string())?;
        page.name = next_name;
        Ok(())
    })
}

#[tauri::command]
fn set_page_property(
    page_id: String,
    key: String,
    value: String,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let page_uuid = Uuid::parse_str(&page_id).map_err(|error| error.to_string())?;
    mutate_workspace(&state, |workspace| {
        let property_key = key.trim();
        if property_key.is_empty() {
            return Err("Property key cannot be empty.".to_string());
        }
        let page = workspace
            .pages
            .iter_mut()
            .find(|page| page.id == page_uuid)
            .ok_or_else(|| "Page not found".to_string())?;
        page.properties
            .insert(property_key.to_string(), value.trim().to_string());
        Ok(())
    })
}

#[tauri::command]
fn remove_page_property(
    page_id: String,
    key: String,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let page_uuid = Uuid::parse_str(&page_id).map_err(|error| error.to_string())?;
    mutate_workspace(&state, |workspace| {
        let property_key = key.trim();
        if property_key.is_empty() {
            return Err("Property key cannot be empty.".to_string());
        }
        let page = workspace
            .pages
            .iter_mut()
            .find(|page| page.id == page_uuid)
            .ok_or_else(|| "Page not found".to_string())?;
        page.properties.remove(property_key);
        Ok(())
    })
}

#[tauri::command]
fn add_root_block(
    page_id: String,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let page_uuid = Uuid::parse_str(&page_id).map_err(|error| error.to_string())?;
    mutate_workspace(&state, |workspace| {
        let page = workspace
            .pages
            .iter_mut()
            .find(|page| page.id == page_uuid)
            .ok_or_else(|| "Page not found".to_string())?;
        page.blocks.push(new_block(content));
        Ok(())
    })
}

#[tauri::command]
fn add_child_block(
    parent_block_id: String,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let parent_uuid = Uuid::parse_str(&parent_block_id).map_err(|error| error.to_string())?;
    mutate_workspace(&state, |workspace| {
        let block = find_block_mut_in_workspace(workspace, parent_uuid)
            .ok_or_else(|| "Parent block not found".to_string())?;
        block.children.push(new_block(content));
        Ok(())
    })
}

#[tauri::command]
fn add_sibling_block(
    block_id: String,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let block_uuid = Uuid::parse_str(&block_id).map_err(|error| error.to_string())?;
    mutate_workspace(&state, |workspace| {
        for page in &mut workspace.pages {
            if insert_sibling_after(&mut page.blocks, block_uuid, &content) {
                return Ok(());
            }
        }
        Err("Block not found".to_string())
    })
}

#[tauri::command]
fn indent_block(
    block_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let block_uuid = Uuid::parse_str(&block_id).map_err(|error| error.to_string())?;
    mutate_workspace(&state, |workspace| {
        for page in &mut workspace.pages {
            if indent_block_in_tree(&mut page.blocks, block_uuid)? {
                return Ok(());
            }
        }
        Err("Block not found or cannot be indented.".to_string())
    })
}

#[tauri::command]
fn outdent_block(
    block_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let block_uuid = Uuid::parse_str(&block_id).map_err(|error| error.to_string())?;
    mutate_workspace(&state, |workspace| {
        for page in &mut workspace.pages {
            if outdent_block_in_tree(&mut page.blocks, block_uuid)? {
                return Ok(());
            }
        }
        Err("Block not found or already at root level.".to_string())
    })
}

#[tauri::command]
fn update_block_content(
    block_id: String,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let block_uuid = Uuid::parse_str(&block_id).map_err(|error| error.to_string())?;
    mutate_workspace(&state, |workspace| {
        let block = find_block_mut_in_workspace(workspace, block_uuid)
            .ok_or_else(|| "Block not found".to_string())?;
        block.content = content.trim().to_string();
        Ok(())
    })
}

#[tauri::command]
fn set_block_property(
    block_id: String,
    key: String,
    value: String,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let block_uuid = Uuid::parse_str(&block_id).map_err(|error| error.to_string())?;
    mutate_workspace(&state, |workspace| {
        let property_key = key.trim();
        if property_key.is_empty() {
            return Err("Property key cannot be empty.".to_string());
        }
        let block = find_block_mut_in_workspace(workspace, block_uuid)
            .ok_or_else(|| "Block not found".to_string())?;
        block
            .properties
            .insert(property_key.to_string(), value.trim().to_string());
        Ok(())
    })
}

#[tauri::command]
fn remove_block_property(
    block_id: String,
    key: String,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let block_uuid = Uuid::parse_str(&block_id).map_err(|error| error.to_string())?;
    mutate_workspace(&state, |workspace| {
        let property_key = key.trim();
        if property_key.is_empty() {
            return Err("Property key cannot be empty.".to_string());
        }
        let block = find_block_mut_in_workspace(workspace, block_uuid)
            .ok_or_else(|| "Block not found".to_string())?;
        block.properties.remove(property_key);
        Ok(())
    })
}

#[tauri::command]
fn delete_block(
    block_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let block_uuid = Uuid::parse_str(&block_id).map_err(|error| error.to_string())?;
    mutate_workspace(&state, |workspace| {
        for page in &mut workspace.pages {
            if remove_block_from_tree(&mut page.blocks, block_uuid) {
                return Ok(());
            }
        }
        Err("Block not found".to_string())
    })
}

#[tauri::command]
fn review_card(
    card_id: String,
    rating: String,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let workspace_id = ensure_workspace(&state)?;
    let card_uuid = Uuid::parse_str(&card_id).map_err(|error| error.to_string())?;
    let rating = parse_rating(&rating);
    let now = Utc::now();
    let card = {
        let storage = lock_storage(&state)?;
        storage
            .load_cards(workspace_id)
            .map_err(format_storage_error)?
            .into_iter()
            .find(|card| card.id == card_uuid)
            .ok_or_else(|| "Card not found".to_string())?
    };
    let next_srs = schedule_review(&card.srs, rating, now, SchedulerSettings::default());
    let event = ReviewEvent {
        id: Uuid::new_v4(),
        card_id: card.id,
        rating,
        reviewed_at: now,
        previous_srs: card.srs,
        next_srs,
    };

    {
        let storage = lock_storage(&state)?;
        storage
            .append_review_event(&event)
            .map_err(format_storage_error)?;
    }

    snapshot_for_workspace(&state, workspace_id)
}

#[tauri::command]
fn insert_generated_cards(
    page_id: String,
    cards: Vec<GeneratedCardInput>,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    if cards.is_empty() {
        return Err("No generated cards to insert.".to_string());
    }

    let page_uuid = Uuid::parse_str(&page_id).map_err(|error| error.to_string())?;
    mutate_workspace(&state, |workspace| {
        let page = workspace
            .pages
            .iter_mut()
            .find(|page| page.id == page_uuid)
            .ok_or_else(|| "Page not found".to_string())?;

        for card in cards {
            let mut block = new_block(format!("{} #card", clean_card_question(&card.question)));
            block
                .properties
                .insert("sgd-deck".to_string(), clean_name(&card.deck, "Generated"));
            block
                .properties
                .insert("sgd-topic".to_string(), clean_name(&card.topic, "General"));
            block
                .properties
                .insert("sgd-generated".to_string(), "true".to_string());
            block
                .properties
                .insert("sgd-source".to_string(), "mock".to_string());

            let tags = card
                .tags
                .iter()
                .map(|tag| tag.trim())
                .filter(|tag| !tag.is_empty())
                .collect::<Vec<_>>();
            if !tags.is_empty() {
                block
                    .properties
                    .insert("sgd-tags".to_string(), tags.join(", "));
            }

            block.children.push(new_block(clean_name(
                &card.answer,
                "Generated answer is empty.",
            )));
            page.blocks.push(block);
        }

        Ok(())
    })
}

#[tauri::command]
fn insert_doc_card(
    input: InsertDocCardInput,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let page_uuid = Uuid::parse_str(&input.page_id).map_err(|error| error.to_string())?;
    let doc_page_uuid = Uuid::parse_str(&input.doc_page_id).map_err(|error| error.to_string())?;
    let doc_block_uuid = Uuid::parse_str(&input.doc_block_id).map_err(|error| error.to_string())?;

    mutate_workspace(&state, |workspace| {
        let page = workspace
            .pages
            .iter_mut()
            .find(|page| page.id == page_uuid)
            .ok_or_else(|| "Page not found".to_string())?;

        let mut block = new_block(format!("{} #card", clean_card_question(&input.question)));
        block
            .properties
            .insert("sgd-deck".to_string(), clean_name(&input.deck, "Generated"));
        block
            .properties
            .insert("sgd-topic".to_string(), clean_name(&input.topic, "General"));
        block
            .properties
            .insert("sgd-source".to_string(), "doc".to_string());
        block.properties.insert(
            "sgd-doc-page".to_string(),
            clean_name(&input.doc_page_title, "Untitled Doc"),
        );
        block
            .properties
            .insert("sgd-doc-page-id".to_string(), doc_page_uuid.to_string());
        block
            .properties
            .insert("sgd-doc-block-id".to_string(), doc_block_uuid.to_string());
        block.children.push(new_block(clean_name(
            &input.answer,
            "Review the linked Doc block for the answer.",
        )));
        page.blocks.push(block);

        Ok(())
    })
}

#[tauri::command]
fn export_workspace_markdown(state: tauri::State<'_, AppState>) -> Result<WorkspaceExport, String> {
    let workspace_id = ensure_workspace(&state)?;
    let storage = lock_storage(&state)?;
    let workspace = storage
        .load_workspace(workspace_id)
        .map_err(format_storage_error)?
        .ok_or_else(|| "Workspace not found".to_string())?;
    let pages = workspace
        .pages
        .iter()
        .map(|page| ExportedPage {
            name: page.name.clone(),
            markdown: export_page_to_logseq_markdown(page),
        })
        .collect();
    Ok(WorkspaceExport { pages })
}

#[tauri::command]
fn export_workspace_markdown_to_folder(
    folder_path: String,
    overwrite: bool,
    state: tauri::State<'_, AppState>,
) -> Result<FolderExportResult, String> {
    let workspace_id = ensure_workspace(&state)?;
    let folder = PathBuf::from(&folder_path);
    std::fs::create_dir_all(&folder)
        .map_err(|error| format!("Could not create export folder: {error}"))?;

    let storage = lock_storage(&state)?;
    let workspace = storage
        .load_workspace(workspace_id)
        .map_err(format_storage_error)?
        .ok_or_else(|| "Workspace not found".to_string())?;

    let mut used_names = BTreeSet::new();
    let mut written_files = Vec::new();
    for page in &workspace.pages {
        let file_name = safe_markdown_file_name(&page.name, &mut used_names);
        let output_path = folder.join(file_name);
        if output_path.exists() && !overwrite {
            return Err(format!(
                "File already exists: {}. Choose overwrite to replace it.",
                output_path.display()
            ));
        }
        std::fs::write(&output_path, export_page_to_logseq_markdown(page))
            .map_err(|error| format!("Could not write {}: {error}", output_path.display()))?;
        written_files.push(output_path.to_string_lossy().to_string());
    }

    Ok(FolderExportResult {
        folder_path,
        files: written_files,
    })
}

#[tauri::command]
fn export_app_backup(state: tauri::State<'_, AppState>) -> Result<AppBackup, String> {
    let workspace_id = ensure_workspace(&state)?;
    let storage = lock_storage(&state)?;
    storage
        .export_app_backup(workspace_id)
        .map_err(format_storage_error)
}

#[tauri::command]
fn export_app_backup_to_folder(
    folder_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<BackupExportResult, String> {
    let workspace_id = ensure_workspace(&state)?;
    let folder = PathBuf::from(&folder_path);
    std::fs::create_dir_all(&folder)
        .map_err(|error| format!("Could not create backup folder: {error}"))?;

    let backup = {
        let storage = lock_storage(&state)?;
        storage
            .export_app_backup(workspace_id)
            .map_err(format_storage_error)?
    };
    let output_path = folder.join(format!(
        "studygraph-backup-{}.json",
        Utc::now().format("%Y%m%d-%H%M%S")
    ));
    let json = serde_json::to_string_pretty(&backup)
        .map_err(|error| format!("Could not serialize backup: {error}"))?;
    std::fs::write(&output_path, json)
        .map_err(|error| format!("Could not write {}: {error}", output_path.display()))?;

    Ok(BackupExportResult {
        file_path: output_path.to_string_lossy().to_string(),
        backup,
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let db_path = database_path(app)?;
            let storage = StudyGraphStorage::open(db_path)
                .map_err(|error| Box::<dyn std::error::Error>::from(format_storage_error(error)))?;
            app.manage(AppState {
                storage: Mutex::new(storage),
                workspace_id: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_snapshot,
            app_debug_info,
            load_app_settings,
            save_app_settings,
            load_doc_pages,
            create_doc_page,
            update_doc_page_title,
            delete_doc_page,
            add_doc_block,
            update_doc_block,
            delete_doc_block,
            move_doc_block,
            import_markdown_page,
            import_markdown_file,
            import_markdown_folder,
            create_page,
            rename_page,
            set_page_property,
            remove_page_property,
            add_root_block,
            add_child_block,
            add_sibling_block,
            indent_block,
            outdent_block,
            update_block_content,
            set_block_property,
            remove_block_property,
            delete_block,
            review_card,
            insert_generated_cards,
            insert_doc_card,
            export_workspace_markdown,
            export_workspace_markdown_to_folder,
            export_app_backup,
            export_app_backup_to_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running StudyGraph desktop app");
}

fn ensure_workspace(state: &tauri::State<'_, AppState>) -> Result<Uuid, String> {
    if let Some(workspace_id) = *state
        .workspace_id
        .lock()
        .map_err(|_| "Workspace state lock poisoned".to_string())?
    {
        return Ok(workspace_id);
    }

    let mut storage = lock_storage(state)?;
    let existing = storage
        .list_workspaces()
        .map_err(format_storage_error)?
        .into_iter()
        .next();

    let workspace_id = if let Some((id, _)) = existing {
        id
    } else {
        let workspace = demo_workspace();
        let id = workspace.id;
        storage
            .save_workspace(&workspace)
            .map_err(format_storage_error)?;
        id
    };

    *state
        .workspace_id
        .lock()
        .map_err(|_| "Workspace state lock poisoned".to_string())? = Some(workspace_id);

    Ok(workspace_id)
}

fn snapshot_for_workspace(
    state: &tauri::State<'_, AppState>,
    workspace_id: Uuid,
) -> Result<DesktopSnapshot, String> {
    let storage = lock_storage(state)?;
    let workspace = storage
        .load_workspace(workspace_id)
        .map_err(format_storage_error)?
        .ok_or_else(|| "Workspace not found".to_string())?;
    let cards = storage
        .load_cards(workspace_id)
        .map_err(format_storage_error)?;
    let graph = build_study_graph(&cards);
    let backlinks = build_backlinks(&workspace);

    Ok(DesktopSnapshot {
        workspace,
        cards,
        graph,
        backlinks,
    })
}

fn mutate_workspace(
    state: &tauri::State<'_, AppState>,
    mutate: impl FnOnce(&mut Workspace) -> Result<(), String>,
) -> Result<DesktopSnapshot, String> {
    let workspace_id = ensure_workspace(state)?;
    {
        let mut storage = lock_storage(state)?;
        let mut workspace = storage
            .load_workspace(workspace_id)
            .map_err(format_storage_error)?
            .ok_or_else(|| "Workspace not found".to_string())?;
        mutate(&mut workspace)?;
        storage
            .save_workspace(&workspace)
            .map_err(format_storage_error)?;
    }
    snapshot_for_workspace(state, workspace_id)
}

fn lock_storage<'a>(
    state: &'a tauri::State<'_, AppState>,
) -> Result<std::sync::MutexGuard<'a, StudyGraphStorage>, String> {
    state
        .storage
        .lock()
        .map_err(|_| "Storage lock poisoned".to_string())
}

fn new_block(content: String) -> Block {
    Block {
        id: Uuid::new_v4(),
        content: content.trim().to_string(),
        properties: BTreeMap::new(),
        children: Vec::new(),
    }
}

fn clean_name(value: &str, fallback: &str) -> String {
    let name = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        fallback.to_string()
    } else {
        name
    }
}

fn clean_card_question(value: &str) -> String {
    let question = value
        .split_whitespace()
        .filter(|part| !part.eq_ignore_ascii_case("#card"))
        .collect::<Vec<_>>()
        .join(" ");
    clean_name(&question, "Generated question")
}

fn page_name_from_path(path: &Path) -> String {
    path.file_stem()
        .map(|stem| decode_percent_text(&stem.to_string_lossy()))
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "Imported Page".to_string())
}

fn page_name_from_graph_path(root: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(root).unwrap_or(path);
    let mut parts = relative
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .map(str::to_string)
        .collect::<Vec<_>>();

    if matches!(
        parts
            .first()
            .map(|part| part.to_ascii_lowercase())
            .as_deref(),
        Some("pages" | "journals")
    ) {
        parts.remove(0);
    }

    if let Some(last) = parts.last_mut() {
        if let Some(stem) = Path::new(last).file_stem().and_then(|stem| stem.to_str()) {
            *last = stem.to_string();
        }
    }

    let joined = parts
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("/");
    let decoded = decode_percent_text(&joined);
    if decoded.trim().is_empty() {
        page_name_from_path(path)
    } else {
        decoded
    }
}

fn collect_markdown_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    collect_markdown_files_inner(root, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_markdown_files_inner(path: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in std::fs::read_dir(path)
        .map_err(|error| format!("Could not read folder {}: {error}", path.display()))?
    {
        let entry = entry.map_err(|error| format!("Could not read folder entry: {error}"))?;
        let entry_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        if entry_path.is_dir() {
            if should_skip_import_folder(&file_name) {
                continue;
            }
            collect_markdown_files_inner(&entry_path, files)?;
        } else if is_markdown_file(&entry_path) {
            files.push(entry_path);
        }
    }
    Ok(())
}

fn should_skip_import_folder(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with('.')
        || matches!(
            lower.as_str(),
            "assets" | "node_modules" | "target" | "dist" | ".git"
        )
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

fn decode_percent_text(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[index + 1..index + 3]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    decoded.push(byte);
                    index += 3;
                    continue;
                }
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(decoded).unwrap_or_else(|_| value.to_string())
}

fn safe_markdown_file_name(page_name: &str, used_names: &mut BTreeSet<String>) -> String {
    let stem = sanitize_file_stem(page_name);
    let mut candidate = format!("{stem}.md");
    let mut suffix = 2;
    while used_names.contains(&candidate) {
        candidate = format!("{stem}-{suffix}.md");
        suffix += 1;
    }
    used_names.insert(candidate.clone());
    candidate
}

fn sanitize_file_stem(value: &str) -> String {
    let mut sanitized = String::new();
    for character in value.chars() {
        let is_invalid = matches!(
            character,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
        ) || character.is_control();
        if is_invalid {
            sanitized.push('_');
        } else {
            sanitized.push(character);
        }
    }

    let trimmed = sanitized.trim().trim_end_matches(['.', ' ']).to_string();
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed
    }
}

fn find_block_mut_in_workspace(workspace: &mut Workspace, block_id: Uuid) -> Option<&mut Block> {
    for page in &mut workspace.pages {
        if let Some(block) = find_block_mut(&mut page.blocks, block_id) {
            return Some(block);
        }
    }
    None
}

fn find_block_mut(blocks: &mut [Block], block_id: Uuid) -> Option<&mut Block> {
    for block in blocks {
        if block.id == block_id {
            return Some(block);
        }
        if let Some(child) = find_block_mut(&mut block.children, block_id) {
            return Some(child);
        }
    }
    None
}

fn remove_block_from_tree(blocks: &mut Vec<Block>, block_id: Uuid) -> bool {
    if let Some(index) = blocks.iter().position(|block| block.id == block_id) {
        blocks.remove(index);
        return true;
    }

    for block in blocks {
        if remove_block_from_tree(&mut block.children, block_id) {
            return true;
        }
    }

    false
}

fn insert_sibling_after(blocks: &mut Vec<Block>, block_id: Uuid, content: &str) -> bool {
    if let Some(index) = blocks.iter().position(|block| block.id == block_id) {
        blocks.insert(index + 1, new_block(content.to_string()));
        return true;
    }

    for block in blocks {
        if insert_sibling_after(&mut block.children, block_id, content) {
            return true;
        }
    }

    false
}

fn indent_block_in_tree(blocks: &mut Vec<Block>, block_id: Uuid) -> Result<bool, String> {
    if let Some(index) = blocks.iter().position(|block| block.id == block_id) {
        if index == 0 {
            return Err("Block has no previous sibling to indent under.".to_string());
        }
        let block = blocks.remove(index);
        blocks[index - 1].children.push(block);
        return Ok(true);
    }

    for block in blocks {
        if indent_block_in_tree(&mut block.children, block_id)? {
            return Ok(true);
        }
    }

    Ok(false)
}

fn outdent_block_in_tree(blocks: &mut Vec<Block>, block_id: Uuid) -> Result<bool, String> {
    for parent_index in 0..blocks.len() {
        if let Some(child_index) = blocks[parent_index]
            .children
            .iter()
            .position(|child| child.id == block_id)
        {
            let block = blocks[parent_index].children.remove(child_index);
            blocks.insert(parent_index + 1, block);
            return Ok(true);
        }
    }

    for block in blocks {
        if outdent_block_in_tree(&mut block.children, block_id)? {
            return Ok(true);
        }
    }

    Ok(false)
}

fn demo_workspace() -> Workspace {
    let markdown = r#"# StudyGraph Demo
sgd-deck:: Linux Shell

- What does `pwd` show? #card
  sgd-topic:: Navigation
  - It prints the current working directory as an absolute path.

- What does `ls -la` show? #card
  sgd-topic:: Navigation
  - It lists all files, including hidden files, in long format.

- What is a pipe in the shell? #card [[Shell]]
  sgd-topic:: Pipes
  - A pipe sends the output of one command into another command.
"#;
    Workspace {
        id: Uuid::new_v4(),
        name: "StudyGraph Local".to_string(),
        pages: vec![import_single_markdown_page("StudyGraph Demo", markdown)],
    }
}

fn database_path(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    Ok(data_dir.join("studygraph.sqlite3"))
}

fn parse_rating(value: &str) -> Rating {
    match value {
        "again" => Rating::Again,
        "hard" => Rating::Hard,
        "easy" => Rating::Easy,
        _ => Rating::Good,
    }
}

fn format_storage_error(error: studygraph_core::StorageError) -> String {
    format!("{error:?}")
}
