#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use studygraph_core::{
    build_backlinks, build_study_graph, export_page_to_logseq_markdown,
    import_single_markdown_page, schedule_review_with_response_time, AppBackup, AppSettings,
    BacklinkReference, Block, DocBlockKind, DocPage, Page, Rating, ReviewEvent, ReviewSession,
    SchedulerSettings, StudyCard, StudyGraphData, StudyGraphStorage, Workspace,
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
struct BackupRestoreResult {
    file_path: String,
    snapshot: DesktopSnapshot,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDocPageMetadataInput {
    page_id: String,
    tags: Vec<String>,
    source: String,
    language: String,
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
fn update_doc_page_metadata(
    input: UpdateDocPageMetadataInput,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DocPage>, String> {
    let workspace_id = ensure_workspace(&state)?;
    let page_uuid = Uuid::parse_str(&input.page_id).map_err(|error| error.to_string())?;
    let storage = lock_storage(&state)?;
    storage
        .update_doc_page_metadata(page_uuid, input.tags, &input.source, &input.language)
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
    response_time_ms: Option<u32>,
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
    let next_srs = schedule_review_with_response_time(
        &card.srs,
        rating,
        response_time_ms,
        now,
        SchedulerSettings::default(),
    );
    let event = ReviewEvent {
        id: Uuid::new_v4(),
        card_id: card.id,
        rating,
        reviewed_at: now,
        response_time_ms,
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
fn load_review_sessions(state: tauri::State<'_, AppState>) -> Result<Vec<ReviewSession>, String> {
    let workspace_id = ensure_workspace(&state)?;
    let storage = lock_storage(&state)?;
    storage
        .load_review_sessions(workspace_id, 20)
        .map_err(format_storage_error)
}

#[tauri::command]
fn save_review_session(
    mut session: ReviewSession,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ReviewSession>, String> {
    let workspace_id = ensure_workspace(&state)?;
    session.workspace_id = workspace_id;
    for (position, item) in session.items.iter_mut().enumerate() {
        item.session_id = session.id;
        item.position = position as u32;
    }
    let storage = lock_storage(&state)?;
    storage
        .save_review_session(&session)
        .map_err(format_storage_error)?;
    storage
        .load_review_sessions(workspace_id, 20)
        .map_err(format_storage_error)
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
                .insert("sgd-source".to_string(), "local-generator".to_string());

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

#[tauri::command]
fn restore_app_backup_from_file(
    file_path: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<BackupRestoreResult, String> {
    let json = std::fs::read_to_string(&file_path)
        .map_err(|error| format!("Could not read backup file: {error}"))?;
    let backup: AppBackup = serde_json::from_str(&json)
        .map_err(|error| format!("Invalid StudyGraph backup JSON: {error}"))?;
    if backup.schema_version != 1 {
        return Err(format!(
            "Unsupported backup schema version: {}",
            backup.schema_version
        ));
    }

    {
        let current_workspace_id = ensure_workspace(&state)?;
        let backup_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Could not resolve app data dir: {error}"))?
            .join("safety-backups");
        std::fs::create_dir_all(&backup_dir)
            .map_err(|error| format!("Could not create safety backup folder: {error}"))?;

        let safety_backup = {
            let storage = lock_storage(&state)?;
            storage
                .export_app_backup(current_workspace_id)
                .map_err(format_storage_error)?
        };
        let safety_path = backup_dir.join(format!(
            "before-restore-{}.json",
            Utc::now().format("%Y%m%d-%H%M%S")
        ));
        let safety_json = serde_json::to_string_pretty(&safety_backup)
            .map_err(|error| format!("Could not serialize safety backup: {error}"))?;
        std::fs::write(&safety_path, safety_json)
            .map_err(|error| format!("Could not write safety backup: {error}"))?;

        let mut storage = lock_storage(&state)?;
        storage
            .restore_app_backup(&backup)
            .map_err(format_storage_error)?;
    }
    *state
        .workspace_id
        .lock()
        .map_err(|_| "Workspace state lock poisoned".to_string())? = Some(backup.workspace.id);

    Ok(BackupRestoreResult {
        file_path,
        snapshot: snapshot_for_workspace(&state, backup.workspace.id)?,
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
            update_doc_page_metadata,
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
            load_review_sessions,
            save_review_session,
            insert_generated_cards,
            insert_doc_card,
            export_workspace_markdown,
            export_workspace_markdown_to_folder,
            export_app_backup,
            export_app_backup_to_folder,
            restore_app_backup_from_file
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

    if let Some(mut workspace) = storage
        .load_workspace(workspace_id)
        .map_err(format_storage_error)?
    {
        if ensure_seed_study_decks(&mut workspace) {
            storage
                .save_workspace(&workspace)
                .map_err(format_storage_error)?;
        }
    }

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

struct SeedCard {
    question: &'static str,
    answer: &'static str,
    topic: &'static str,
}

fn ensure_seed_study_decks(workspace: &mut Workspace) -> bool {
    let mut changed = false;
    changed |= ensure_seed_page(
        workspace,
        "Decks/CPU Architecture",
        "CPU Architecture",
        cpu_architecture_seed_cards(),
    );
    changed |= ensure_seed_page(
        workspace,
        "Decks/Mathe für AI",
        "Mathe für AI",
        ai_math_seed_cards(),
    );
    changed
}

fn ensure_seed_page(
    workspace: &mut Workspace,
    page_name: &str,
    deck_name: &str,
    cards: &[SeedCard],
) -> bool {
    if workspace.pages.iter().any(|page| page.name == page_name) {
        return false;
    }

    let mut properties = BTreeMap::new();
    properties.insert("sgd-deck".to_string(), deck_name.to_string());
    properties.insert("sgd-seed".to_string(), "studygraph-builtins-v1".to_string());

    let blocks = cards
        .iter()
        .map(|card| {
            let mut block = new_block(format!("{} #card", card.question));
            block
                .properties
                .insert("sgd-deck".to_string(), deck_name.to_string());
            block
                .properties
                .insert("sgd-topic".to_string(), card.topic.to_string());
            block
                .properties
                .insert("sgd-seed".to_string(), "studygraph-builtins-v1".to_string());
            block.children.push(new_block(card.answer.to_string()));
            block
        })
        .collect();

    workspace.pages.push(Page {
        id: Uuid::new_v4(),
        name: page_name.to_string(),
        properties,
        blocks,
    });
    true
}

fn cpu_architecture_seed_cards() -> &'static [SeedCard; 50] {
    &[
        SeedCard { question: "What is an instruction set architecture (ISA)?", answer: "An ISA is the contract between software and CPU hardware: instructions, registers, memory model, and encodings. Example: x86-64 and ARMv8 are different ISAs.", topic: "ISA" },
        SeedCard { question: "What is a microarchitecture?", answer: "Microarchitecture is how a processor implements an ISA internally. Example: two ARM CPUs can share ARMv8 but differ in pipeline width, cache sizes, and branch predictors.", topic: "Microarchitecture" },
        SeedCard { question: "What is the fetch-decode-execute cycle?", answer: "The CPU fetches an instruction, decodes its operation and operands, then executes it and writes results. Example: ADD R1,R2,R3 is fetched, decoded as addition, then computed by the ALU.", topic: "Execution" },
        SeedCard { question: "What does the program counter store?", answer: "The program counter stores the address of the next instruction to fetch. Example: after a 4-byte instruction, many RISC CPUs advance PC by 4 unless a branch changes it.", topic: "Registers" },
        SeedCard { question: "What is a general-purpose register?", answer: "A general-purpose register is a small fast storage location for operands, addresses, or intermediate values. Example: x86-64 RAX can hold an integer result.", topic: "Registers" },
        SeedCard { question: "What is an arithmetic logic unit (ALU)?", answer: "The ALU performs integer arithmetic and logical operations. Example: addition, subtraction, AND, OR, and XOR are ALU operations.", topic: "Datapath" },
        SeedCard { question: "What is a floating-point unit (FPU)?", answer: "The FPU executes floating-point arithmetic with IEEE-like formats. Example: multiplying two 32-bit floats in a matrix operation uses the FPU or vector FP units.", topic: "Datapath" },
        SeedCard { question: "What is pipelining?", answer: "Pipelining overlaps instruction stages so multiple instructions progress at once. Example: while one instruction executes, the next can decode and another can fetch.", topic: "Pipeline" },
        SeedCard { question: "What is pipeline latency vs throughput?", answer: "Latency is time for one instruction to pass through; throughput is completed instructions per time. Example: a 5-stage pipeline may have 5-cycle latency but near 1 instruction/cycle throughput.", topic: "Pipeline" },
        SeedCard { question: "What is a pipeline hazard?", answer: "A hazard prevents the next instruction from executing safely in the next cycle. Example: an instruction needing a value not yet produced causes a data hazard.", topic: "Pipeline" },
        SeedCard { question: "What is a data hazard?", answer: "A data hazard occurs when instructions depend on unfinished results. Example: ADD writes R1 and the following SUB reads R1 before writeback.", topic: "Pipeline" },
        SeedCard { question: "What is forwarding/bypassing?", answer: "Forwarding sends a result directly from a pipeline stage to a dependent instruction without waiting for register writeback. Example: ALU output feeds the next ALU operation.", topic: "Pipeline" },
        SeedCard { question: "What is a control hazard?", answer: "A control hazard happens when the CPU does not yet know the next PC after a branch or jump. Example: a conditional branch may force wrong-path instructions to be flushed.", topic: "Branching" },
        SeedCard { question: "What is branch prediction?", answer: "Branch prediction guesses branch direction/target to keep the pipeline full. Example: a loop branch is predicted taken until the final iteration.", topic: "Branching" },
        SeedCard { question: "What is speculative execution?", answer: "Speculative execution runs instructions before knowing they are definitely needed. Example: a CPU executes predicted branch-path instructions and discards them if prediction was wrong.", topic: "Branching" },
        SeedCard { question: "What is out-of-order execution?", answer: "Out-of-order execution runs ready instructions before older stalled ones while preserving architectural results. Example: a cache-miss load waits while independent arithmetic continues.", topic: "Execution" },
        SeedCard { question: "What is register renaming?", answer: "Register renaming maps architectural registers to physical registers to remove false dependencies. Example: two writes to R1 can use different physical registers internally.", topic: "Execution" },
        SeedCard { question: "What is superscalar execution?", answer: "A superscalar CPU can issue multiple instructions per cycle to multiple execution units. Example: one load and one integer add may start in the same cycle.", topic: "Execution" },
        SeedCard { question: "What is SIMD?", answer: "SIMD applies one instruction to multiple data lanes. Example: adding eight 32-bit integers with one AVX2 vector instruction.", topic: "Vector" },
        SeedCard { question: "What is a vector register?", answer: "A vector register holds multiple values processed together by SIMD/vector instructions. Example: a 256-bit register can hold eight 32-bit floats.", topic: "Vector" },
        SeedCard { question: "What is the memory hierarchy?", answer: "The memory hierarchy orders storage by speed, size, and cost: registers, caches, RAM, SSD. Example: L1 cache is tiny and fast; DRAM is larger and slower.", topic: "Memory" },
        SeedCard { question: "What is an L1 cache?", answer: "L1 cache is the smallest, fastest cache closest to the core. Example: separate L1 instruction and data caches often serve accesses in a few cycles.", topic: "Cache" },
        SeedCard { question: "What is cache locality?", answer: "Locality means programs reuse nearby or recently used data. Example: iterating an array sequentially benefits from spatial locality.", topic: "Cache" },
        SeedCard { question: "What is a cache line?", answer: "A cache line is the fixed-size block transferred between cache and memory. Example: reading one byte may load a 64-byte line containing neighboring bytes.", topic: "Cache" },
        SeedCard { question: "What is a cache miss?", answer: "A cache miss occurs when requested data is not in the cache and must be fetched from a lower level. Example: first access to a large array line misses in L1.", topic: "Cache" },
        SeedCard { question: "What is cache associativity?", answer: "Associativity defines how many cache locations can hold a given memory block. Example: 8-way set-associative cache allows a line in one of eight ways in its set.", topic: "Cache" },
        SeedCard { question: "What is cache coherence?", answer: "Cache coherence keeps multiple cores' cached copies consistent. Example: if core A writes a shared variable, core B must not keep using a stale copy.", topic: "Multicore" },
        SeedCard { question: "What is MESI?", answer: "MESI is a common cache-coherence state model: Modified, Exclusive, Shared, Invalid. Example: a written private line becomes Modified until shared or written back.", topic: "Multicore" },
        SeedCard { question: "What is virtual memory?", answer: "Virtual memory gives each process its own address space mapped to physical memory. Example: two programs can both use virtual address 0x400000 safely.", topic: "Memory" },
        SeedCard { question: "What is a page table?", answer: "A page table maps virtual pages to physical frames with permissions. Example: a load address is translated before accessing memory.", topic: "Memory" },
        SeedCard { question: "What is a TLB?", answer: "A translation lookaside buffer caches virtual-to-physical address translations. Example: repeated access to the same page avoids walking the page table.", topic: "Memory" },
        SeedCard { question: "What is endianness?", answer: "Endianness defines byte order for multi-byte values in memory. Example: little-endian stores the least significant byte of 0x12345678 first.", topic: "Data Representation" },
        SeedCard { question: "What is word size?", answer: "Word size is the natural integer/address size a CPU handles efficiently. Example: a 64-bit CPU typically uses 64-bit general-purpose registers and virtual addresses.", topic: "Data Representation" },
        SeedCard { question: "What is RISC?", answer: "RISC favors simpler, regular instructions and load/store design. Example: ARM and RISC-V usually operate on registers and use separate load/store instructions.", topic: "ISA" },
        SeedCard { question: "What is CISC?", answer: "CISC supports more complex instructions and addressing modes. Example: x86 can combine memory access and arithmetic in one instruction.", topic: "ISA" },
        SeedCard { question: "What is a load/store architecture?", answer: "Only load/store instructions access memory; arithmetic uses registers. Example: RISC-V loads values into registers before ADD.", topic: "ISA" },
        SeedCard { question: "What is an addressing mode?", answer: "An addressing mode describes how an instruction computes an operand address. Example: base + offset addressing reads memory at register plus immediate displacement.", topic: "ISA" },
        SeedCard { question: "What is an interrupt?", answer: "An interrupt pauses normal execution to handle an external or internal event. Example: a timer interrupt lets the OS scheduler run.", topic: "System" },
        SeedCard { question: "What is an exception?", answer: "An exception is a synchronous event caused by the current instruction. Example: divide-by-zero or page fault transfers control to an OS handler.", topic: "System" },
        SeedCard { question: "What is privilege level?", answer: "Privilege levels restrict sensitive instructions and memory access. Example: user mode cannot directly modify page tables; kernel mode can.", topic: "System" },
        SeedCard { question: "What is a system call?", answer: "A system call is a controlled transition from user code to the kernel. Example: read() asks the OS to fetch bytes from a file descriptor.", topic: "System" },
        SeedCard { question: "What is a memory barrier?", answer: "A memory barrier constrains reordering of memory operations. Example: lock-free code uses barriers so another core observes writes in the intended order.", topic: "Concurrency" },
        SeedCard { question: "What is atomic read-modify-write?", answer: "An atomic RMW reads and updates memory as one indivisible operation. Example: compare-and-swap changes a value only if it still equals the expected value.", topic: "Concurrency" },
        SeedCard { question: "What is simultaneous multithreading (SMT)?", answer: "SMT lets one physical core issue instructions from multiple hardware threads. Example: Intel Hyper-Threading can use idle execution units from a second thread.", topic: "Multicore" },
        SeedCard { question: "What is a core vs a socket?", answer: "A core is an execution engine; a socket is a physical CPU package containing one or more cores. Example: a server may have two sockets with 32 cores each.", topic: "Multicore" },
        SeedCard { question: "What is NUMA?", answer: "NUMA means memory access time depends on which CPU node owns the memory. Example: a thread runs faster when its data is allocated on the local socket.", topic: "Multicore" },
        SeedCard { question: "What is a hardware prefetcher?", answer: "A prefetcher predicts future memory accesses and loads data before demand. Example: sequential array traversal may trigger prefetching of upcoming cache lines.", topic: "Cache" },
        SeedCard { question: "What is a reorder buffer (ROB)?", answer: "A ROB tracks in-flight instructions and commits them in program order. Example: out-of-order execution finishes early operations but retires them safely through the ROB.", topic: "Execution" },
        SeedCard { question: "What is microcode?", answer: "Microcode is internal control code used to implement complex instructions or patches. Example: a complex x86 instruction may decode into micro-operations controlled by microcode.", topic: "Microarchitecture" },
        SeedCard { question: "What is performance per watt?", answer: "Performance per watt measures work completed for each unit of power. Example: mobile CPUs prioritize high performance per watt to preserve battery life.", topic: "Performance" },
    ]
}

fn ai_math_seed_cards() -> &'static [SeedCard; 50] {
    &[
        SeedCard { question: "Was ist eine Menge?", answer: "Eine Menge ist eine Sammlung unterscheidbarer Elemente. Beispiel: A = {1, 2, 3} kann die Klassen-IDs eines Klassifikators enthalten.", topic: "Mengenlehre" },
        SeedCard { question: "Was bedeutet Teilmenge A ⊆ B?", answer: "A ist Teilmenge von B, wenn jedes Element aus A auch in B liegt. Beispiel: Trainingsbilder mit Label Katze sind Teilmenge aller Trainingsbilder.", topic: "Mengenlehre" },
        SeedCard { question: "Was ist die Vereinigung A ∪ B?", answer: "Die Vereinigung enthält alle Elemente, die in A oder B liegen. Beispiel: Daten aus Quelle A und Quelle B werden zu einem größeren Trainingsset vereinigt.", topic: "Mengenlehre" },
        SeedCard { question: "Was ist der Schnitt A ∩ B?", answer: "Der Schnitt enthält Elemente, die in A und B liegen. Beispiel: Bilder, die sowohl 'Hund' als auch 'Outdoor' markiert sind.", topic: "Mengenlehre" },
        SeedCard { question: "Was ist die Differenz A \\ B?", answer: "A \\ B enthält Elemente aus A, die nicht in B liegen. Beispiel: Trainingsdaten ohne die bereits im Validierungsset genutzten Beispiele.", topic: "Mengenlehre" },
        SeedCard { question: "Was ist das kartesische Produkt A × B?", answer: "A × B ist die Menge aller geordneten Paare aus A und B. Beispiel: Nutzer × Filme beschreibt mögliche Ratings in einem Empfehlungssystem.", topic: "Mengenlehre" },
        SeedCard { question: "Was ist eine Relation?", answer: "Eine Relation verknüpft Elemente aus Mengen, oft als Teilmenge eines kartesischen Produkts. Beispiel: 'Bild hat Label' ist eine Relation zwischen Bildern und Klassen.", topic: "Mengenlehre" },
        SeedCard { question: "Was ist eine Funktion?", answer: "Eine Funktion ordnet jedem Eingabewert genau einen Ausgabewert zu. Beispiel: ein neuronales Netz f(x) gibt für ein Bild x Klassenwahrscheinlichkeiten zurück.", topic: "Funktionen" },
        SeedCard { question: "Was bedeutet Injektivität?", answer: "Eine Funktion ist injektiv, wenn verschiedene Eingaben verschiedene Ausgaben haben. Beispiel: ein perfektes Encoding ohne Kollisionen wäre injektiv.", topic: "Funktionen" },
        SeedCard { question: "Was ist Komposition von Funktionen?", answer: "Bei Komposition wird die Ausgabe einer Funktion Eingabe der nächsten. Beispiel: h(x)=g(f(x)) entspricht mehreren Layern in einem neuronalen Netz.", topic: "Funktionen" },
        SeedCard { question: "Was ist ein Vektor?", answer: "Ein Vektor ist eine geordnete Liste von Zahlen mit Richtung/Koordinaten. Beispiel: ein Embedding [0.2, -0.1, 0.7] repräsentiert ein Wort im Modellraum.", topic: "Lineare Algebra" },
        SeedCard { question: "Was ist eine Matrix?", answer: "Eine Matrix ist ein rechteckiges Zahlenschema für lineare Abbildungen oder Daten. Beispiel: Gewichte eines Dense-Layers bilden eine Matrix W.", topic: "Lineare Algebra" },
        SeedCard { question: "Was bedeutet Matrix-Vektor-Multiplikation?", answer: "Sie transformiert einen Vektor linear durch gewichtete Summen. Beispiel: y = Wx berechnet die Voraktivierungen eines neuronalen Layers.", topic: "Lineare Algebra" },
        SeedCard { question: "Was ist ein Skalarprodukt?", answer: "Das Skalarprodukt misst gewichtete Ähnlichkeit zweier Vektoren. Beispiel: Query- und Key-Vektoren in Attention werden per Dot Product verglichen.", topic: "Lineare Algebra" },
        SeedCard { question: "Was ist die Norm eines Vektors?", answer: "Eine Norm misst die Länge oder Größe eines Vektors. Beispiel: ||w||₂ wird in L2-Regularisierung bestraft, um Gewichte klein zu halten.", topic: "Lineare Algebra" },
        SeedCard { question: "Was ist Kosinusähnlichkeit?", answer: "Kosinusähnlichkeit misst den Winkel zwischen Vektoren unabhängig von der Länge. Beispiel: semantisch ähnliche Text-Embeddings haben oft hohen Kosinuswert.", topic: "Lineare Algebra" },
        SeedCard { question: "Was ist ein Eigenvektor?", answer: "Ein Eigenvektor ändert durch eine Matrix nur seine Länge, nicht seine Richtung. Beispiel: PCA nutzt Eigenvektoren der Kovarianzmatrix als Hauptachsen.", topic: "Lineare Algebra" },
        SeedCard { question: "Was ist Rang einer Matrix?", answer: "Der Rang ist die Anzahl unabhängiger Richtungen/Spalten. Beispiel: niedriger Rang kann Modellgewichte komprimieren, etwa bei Low-Rank-Adaptern.", topic: "Lineare Algebra" },
        SeedCard { question: "Was ist ein Tensor?", answer: "Ein Tensor ist ein mehrdimensionales Zahlenarray. Beispiel: ein Bildbatch kann Form [Batch, Höhe, Breite, Kanäle] haben.", topic: "Lineare Algebra" },
        SeedCard { question: "Was bedeutet Broadcasting?", answer: "Broadcasting erweitert kleinere Arrays implizit auf kompatible Formen. Beispiel: ein Bias-Vektor wird zu jeder Zeile einer Aktivierungsmatrix addiert.", topic: "Lineare Algebra" },
        SeedCard { question: "Was ist eine Ableitung?", answer: "Eine Ableitung misst lokale Änderungsrate einer Funktion. Beispiel: dLoss/dw zeigt, wie stark ein Gewicht den Fehler verändert.", topic: "Analysis" },
        SeedCard { question: "Was ist ein Gradient?", answer: "Der Gradient ist der Vektor aller partiellen Ableitungen. Beispiel: ∇L zeigt die Richtung des steilsten Anstiegs der Loss-Funktion.", topic: "Analysis" },
        SeedCard { question: "Was ist partielle Ableitung?", answer: "Eine partielle Ableitung betrachtet die Änderung nach einer Variable, während andere konstant bleiben. Beispiel: ∂L/∂w_i für ein einzelnes Gewicht.", topic: "Analysis" },
        SeedCard { question: "Was ist die Kettenregel?", answer: "Die Kettenregel leitet zusammengesetzte Funktionen ab. Beispiel: Backpropagation nutzt sie, um Gradienten durch Layer eines Netzes zu propagieren.", topic: "Analysis" },
        SeedCard { question: "Was ist der Hessian?", answer: "Der Hessian ist die Matrix zweiter Ableitungen und beschreibt Krümmung. Beispiel: Optimierer können Krümmungsinformation nutzen, sind aber bei großen Netzen teuer.", topic: "Analysis" },
        SeedCard { question: "Was ist Konvexität?", answer: "Eine konvexe Funktion hat keine schlechten lokalen Minima: jede Verbindungslinie liegt über dem Graphen. Beispiel: lineare Regression mit MSE ist konvex.", topic: "Optimierung" },
        SeedCard { question: "Was ist Gradientenabstieg?", answer: "Gradientenabstieg aktualisiert Parameter entgegen dem Gradienten, um Loss zu senken. Beispiel: w := w - η∇L.", topic: "Optimierung" },
        SeedCard { question: "Was ist Lernrate η?", answer: "Die Lernrate steuert die Schrittgröße beim Optimieren. Beispiel: zu große η kann divergieren, zu kleine η lernt sehr langsam.", topic: "Optimierung" },
        SeedCard { question: "Was ist Stochastic Gradient Descent (SGD)?", answer: "SGD schätzt Gradienten mit einzelnen Beispielen oder Mini-Batches. Beispiel: ein Batch von 64 Bildern liefert ein Update statt des ganzen Datensatzes.", topic: "Optimierung" },
        SeedCard { question: "Was ist Momentum?", answer: "Momentum glättet Updates durch eine laufende Bewegungsrichtung. Beispiel: es hilft, durch flache Täler schneller in konsistenter Richtung zu laufen.", topic: "Optimierung" },
        SeedCard { question: "Was ist Adam?", answer: "Adam kombiniert Momentum mit adaptiven Lernraten pro Parameter. Beispiel: Transformer werden häufig mit Adam oder AdamW trainiert.", topic: "Optimierung" },
        SeedCard { question: "Was ist Regularisierung?", answer: "Regularisierung begrenzt Modellkomplexität, um Overfitting zu reduzieren. Beispiel: L2-Regularisierung bestraft große Gewichte.", topic: "Optimierung" },
        SeedCard { question: "Was ist Wahrscheinlichkeit P(A)?", answer: "P(A) misst, wie wahrscheinlich ein Ereignis A ist, zwischen 0 und 1. Beispiel: P(Label=Katze | Bild)=0.82 als Modellvorhersage.", topic: "Wahrscheinlichkeit" },
        SeedCard { question: "Was ist bedingte Wahrscheinlichkeit?", answer: "P(A|B) ist die Wahrscheinlichkeit von A unter der Annahme, dass B gilt. Beispiel: P(Spam | Wörter im Text) in einem Spamfilter.", topic: "Wahrscheinlichkeit" },
        SeedCard { question: "Was sagt der Satz von Bayes?", answer: "Bayes aktualisiert Wahrscheinlichkeiten mit Evidenz: P(A|B)=P(B|A)P(A)/P(B). Beispiel: Diagnosewahrscheinlichkeit nach positivem Test.", topic: "Wahrscheinlichkeit" },
        SeedCard { question: "Was ist eine Zufallsvariable?", answer: "Eine Zufallsvariable ordnet Ergebnissen Zahlen zu. Beispiel: X kann die Anzahl korrekt klassifizierter Bilder in einem Batch sein.", topic: "Wahrscheinlichkeit" },
        SeedCard { question: "Was ist Erwartungswert?", answer: "Der Erwartungswert ist der langfristige Durchschnitt einer Zufallsvariable. Beispiel: die erwartete Loss über die Datenverteilung wird minimiert.", topic: "Wahrscheinlichkeit" },
        SeedCard { question: "Was ist Varianz?", answer: "Varianz misst Streuung um den Mittelwert. Beispiel: hohe Gradientenvarianz macht Training instabiler.", topic: "Wahrscheinlichkeit" },
        SeedCard { question: "Was ist eine Normalverteilung?", answer: "Eine Normalverteilung ist glockenförmig und durch Mittelwert und Varianz bestimmt. Beispiel: Initialisierungen oder Rauschannahmen werden oft normal modelliert.", topic: "Wahrscheinlichkeit" },
        SeedCard { question: "Was ist Maximum Likelihood?", answer: "Maximum Likelihood wählt Parameter, die beobachtete Daten möglichst wahrscheinlich machen. Beispiel: Klassifikationsmodelle maximieren die Wahrscheinlichkeit der richtigen Labels.", topic: "Statistik" },
        SeedCard { question: "Was ist Entropie?", answer: "Entropie misst Unsicherheit einer Verteilung. Beispiel: [0.5,0.5] hat mehr Entropie als [0.99,0.01].", topic: "Informationstheorie" },
        SeedCard { question: "Was ist Kreuzentropie?", answer: "Kreuzentropie misst, wie schlecht vorhergesagte Wahrscheinlichkeiten zu Ziel-Labels passen. Beispiel: für Klasse Katze wird -log(p_Katze) minimiert.", topic: "Informationstheorie" },
        SeedCard { question: "Was ist KL-Divergenz?", answer: "KL-Divergenz misst, wie stark eine Verteilung Q von P abweicht. Beispiel: Distillation kann Student- und Teacher-Verteilungen angleichen.", topic: "Informationstheorie" },
        SeedCard { question: "Was ist Softmax?", answer: "Softmax wandelt Logits in Wahrscheinlichkeiten, die sich zu 1 summieren. Beispiel: Logits [2,1] werden zu Klassenwahrscheinlichkeiten.", topic: "Funktionen" },
        SeedCard { question: "Was ist Log-Likelihood?", answer: "Log-Likelihood ist der Logarithmus der Wahrscheinlichkeit der Daten unter dem Modell. Beispiel: statt Produkte vieler Wahrscheinlichkeiten summiert man Logs numerisch stabil.", topic: "Statistik" },
        SeedCard { question: "Was ist ein Bias-Variance-Tradeoff?", answer: "Bias ist systematischer Fehler, Varianz Empfindlichkeit gegenüber Daten. Beispiel: ein zu simples Modell hat hohen Bias, ein zu komplexes oft hohe Varianz.", topic: "Statistik" },
        SeedCard { question: "Was ist eine Metrik?", answer: "Eine Metrik misst Abstand und erfüllt Nichtnegativität, Symmetrie und Dreiecksungleichung. Beispiel: euklidischer Abstand zwischen Embeddings.", topic: "Geometrie" },
        SeedCard { question: "Was ist ein Graph?", answer: "Ein Graph besteht aus Knoten und Kanten. Beispiel: in Graph Neural Networks sind Molekülatome Knoten und chemische Bindungen Kanten.", topic: "Graphen" },
        SeedCard { question: "Was ist ein Laplace-Operator auf Graphen?", answer: "Der Graph-Laplacian beschreibt Nachbarschaftsstruktur und Glättung auf Graphen. Beispiel: GNNs nutzen Nachbarschaftsaggregation, die eng mit Laplacian-Ideen verwandt ist.", topic: "Graphen" },
        SeedCard { question: "Was ist Big-O-Notation?", answer: "Big-O beschreibt asymptotisches Wachstum von Rechenaufwand. Beispiel: Self-Attention ist in der Sequenzlänge oft O(n²), weil alle Tokenpaare verglichen werden.", topic: "Diskrete Mathematik" },
    ]
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
