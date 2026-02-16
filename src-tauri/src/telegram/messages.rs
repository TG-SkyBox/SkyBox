use crate::db::{Database, TelegramMessage, TelegramSavedItem};
use crate::telegram::{AUTH_STATE, TelegramError};
use grammers_client::InputMessage;
use grammers_client::types::{Message, Media};
use grammers_client::grammers_tl_types as tl;
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const DEFAULT_BATCH_SIZE: usize = 50;
const MAX_BATCH_SIZE: usize = 200;

fn backfill_cursor_key(chat_id: i64) -> String {
    format!("tg_saved_backfill_cursor_{}", chat_id)
}

fn backfill_complete_key(chat_id: i64) -> String {
    format!("tg_saved_backfill_complete_{}", chat_id)
}

fn clamp_batch_size(input: Option<i32>) -> usize {
    let parsed = input.unwrap_or(DEFAULT_BATCH_SIZE as i32).max(1) as usize;
    parsed.min(MAX_BATCH_SIZE)
}

fn sanitize_file_name(file_name: &str) -> String {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return "upload.bin".to_string();
    }

    trimmed
        .chars()
        .map(|ch| {
            if matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                ch
            }
        })
        .collect()
}

fn optional_sanitized_name(file_name: &str) -> Option<String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(sanitize_file_name(trimmed))
}

#[derive(Clone, Copy)]
struct ExtensionClassification {
    category: &'static str,
    file_type: &'static str,
}

fn classify_extension(extension: Option<&str>) -> ExtensionClassification {
    match extension.unwrap_or_default() {
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "tiff" | "svg" | "heic" => {
            ExtensionClassification {
                category: "Images",
                file_type: "image",
            }
        }
        "mp4" | "mkv" | "webm" | "mov" | "avi" | "wmv" | "m4v" | "flv" => {
            ExtensionClassification {
                category: "Videos",
                file_type: "video",
            }
        }
        "mp3" | "m4a" | "ogg" | "wav" | "flac" | "aac" | "opus" | "wma" => {
            ExtensionClassification {
                category: "Audios",
                file_type: "audio",
            }
        }
        "txt" | "md" | "rtf" | "log" | "json" | "xml" | "yaml" | "yml" | "csv" | "ini" | "toml" => {
            ExtensionClassification {
                category: "Notes",
                file_type: "text",
            }
        }
        _ => ExtensionClassification {
            category: "Documents",
            file_type: "document",
        },
    }
}

fn extension_from_mime_type(mime_type: Option<&str>) -> Option<String> {
    let mime = mime_type?.trim().to_lowercase();
    let ext = match mime.as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        "image/heic" | "image/heif" => "heic",

        "video/mp4" => "mp4",
        "video/x-matroska" => "mkv",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        "video/x-msvideo" => "avi",
        "video/x-ms-wmv" => "wmv",

        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/mp4" | "audio/x-m4a" => "m4a",
        "audio/ogg" => "ogg",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/aac" => "aac",
        "audio/opus" => "opus",

        "text/plain" => "txt",
        "text/markdown" => "md",

        "application/pdf" => "pdf",
        "application/zip" => "zip",
        "application/x-rar-compressed" => "rar",
        "application/x-7z-compressed" => "7z",
        "application/json" => "json",
        "application/xml" => "xml",
        "application/msword" => "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => "docx",
        "application/vnd.ms-excel" => "xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => "xlsx",
        "application/vnd.ms-powerpoint" => "ppt",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => "pptx",
        "application/octet-stream" => "bin",
        _ => return None,
    };

    Some(ext.to_string())
}

fn default_extension_for_file_type(file_type: &str) -> &'static str {
    match file_type {
        "image" => "jpg",
        "video" => "mp4",
        "audio" => "mp3",
        "text" => "txt",
        _ => "bin",
    }
}

fn normalize_extension(raw_extension: Option<&str>) -> Option<String> {
    raw_extension
        .map(|ext| ext.trim().trim_start_matches('.').to_lowercase())
        .filter(|ext| !ext.is_empty())
}

fn generated_file_name(file_type: &str, extension: Option<&str>) -> String {
    let uuid = Uuid::new_v4().simple().to_string();
    match extension {
        Some(ext) if !ext.is_empty() => format!("{}_{}.{}", file_type, uuid, ext),
        _ => format!("{}_{}", file_type, uuid),
    }
}

fn build_temp_upload_path(file_name: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    std::env::temp_dir().join(format!(
        "skybox_upload_{}_{}_{}",
        std::process::id(),
        timestamp,
        file_name
    ))
}

fn normalize_saved_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim();
    if trimmed.is_empty() || trimmed == "/" {
        return "/Home".to_string();
    }

    let without_trailing = trimmed.trim_end_matches('/');
    if without_trailing.starts_with("/Home") {
        return without_trailing.to_string();
    }

    if without_trailing.starts_with('/') {
        return format!("/Home{}", without_trailing);
    }

    format!("/Home/{}", without_trailing)
}

fn category_to_saved_path(category: &str) -> String {
    match category {
        "Images" => "/Home/Images".to_string(),
        "Videos" => "/Home/Videos".to_string(),
        "Audios" => "/Home/Audios".to_string(),
        "Documents" => "/Home/Documents".to_string(),
        "Notes" => "/Home/Notes".to_string(),
        _ => "/Home".to_string(),
    }
}

fn build_folder_unique_id(owner_id: &str, parent_path: &str, folder_name: &str) -> String {
    let token = format!("{}_{}_{}", owner_id, parent_path, folder_name)
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    format!("folder_{}", token)
}

fn extension_from_name(file_name: &str) -> Option<String> {
    let mut parts = file_name.rsplit('.');
    let maybe_extension = parts.next()?.trim().trim_start_matches('.').to_lowercase();
    let has_name_part = parts.next().is_some();

    if !has_name_part || maybe_extension.is_empty() {
        return None;
    }

    Some(maybe_extension)
}

fn upsert_saved_item_from_message(
    db: &Database,
    owner_id: &str,
    message: &TelegramMessage,
    preferred_path: Option<&str>,
    fallback_file_name: Option<&str>,
) -> Result<(), TelegramError> {
    let preferred_name = fallback_file_name
        .and_then(optional_sanitized_name)
        .or_else(|| message.filename.as_deref().and_then(optional_sanitized_name));

    let extension_from_name_candidate = preferred_name
        .as_deref()
        .and_then(extension_from_name);

    let extension_candidate = normalize_extension(message.extension.as_deref())
        .or(extension_from_name_candidate)
        .or_else(|| extension_from_mime_type(message.mime_type.as_deref()));

    let classification = classify_extension(extension_candidate.as_deref());

    let final_extension = extension_candidate
        .or_else(|| Some(default_extension_for_file_type(classification.file_type).to_string()));

    let file_name = preferred_name.unwrap_or_else(|| {
        generated_file_name(classification.file_type, final_extension.as_deref())
    });

    let path = preferred_path
        .map(normalize_saved_path)
        .unwrap_or_else(|| category_to_saved_path(classification.category));

    let file_unique_id = if message.message_id > 0 {
        format!("msg_{}_{}", message.chat_id, message.message_id)
    } else {
        let token = format!("{}_{}_{}", message.chat_id, message.timestamp, file_name)
            .chars()
            .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
            .collect::<String>();
        format!("msg_{}", token)
    };

    let saved_item = TelegramSavedItem {
        chat_id: message.chat_id,
        message_id: message.message_id,
        thumbnail: message.thumbnail.clone(),
        file_type: classification.file_type.to_string(),
        file_unique_id,
        file_size: message.size.unwrap_or(0),
        file_name,
        file_caption: message.text.clone(),
        file_path: path,
        modified_date: message.timestamp.clone(),
        owner_id: owner_id.to_string(),
    };

    db.upsert_telegram_saved_item(&saved_item).map_err(|e| TelegramError {
        message: format!("Failed to save item metadata: {}", e.message),
    })
}

fn hydrate_saved_items_from_cached_messages(
    db: &Database,
    owner_id: &str,
    chat_id: i64,
) -> Result<usize, TelegramError> {
    let indexed_messages_count = db
        .count_all_indexed_messages(chat_id)
        .map_err(|e| TelegramError {
            message: format!("Failed to count indexed messages: {}", e.message),
        })?;

    if indexed_messages_count == 0 {
        log::debug!("No cached telegram_messages rows found; skipping saved-item hydration");
        return Ok(0);
    }

    let existing_items = db
        .count_telegram_saved_non_folder_items(owner_id)
        .map_err(|e| TelegramError {
            message: format!("Failed to count saved items: {}", e.message),
        })?;

    let unnamed_items = db
        .count_telegram_saved_items_with_empty_name(owner_id)
        .map_err(|e| TelegramError {
            message: format!("Failed to count unnamed saved items: {}", e.message),
        })?;

    if existing_items >= indexed_messages_count && unnamed_items == 0 {
        log::debug!(
            "Saved-item hydration already up-to-date (saved_items={}, indexed_messages={}, unnamed_items={})",
            existing_items,
            indexed_messages_count,
            unnamed_items
        );
        return Ok(0);
    }

    log::info!(
        "Hydrating saved-item metadata from cache (saved_items={}, indexed_messages={}, unnamed_items={})",
        existing_items,
        indexed_messages_count,
        unnamed_items
    );

    let cached_messages = db.get_all_indexed_messages(chat_id).map_err(|e| TelegramError {
        message: format!("Failed to read cached telegram messages: {}", e.message),
    })?;

    if cached_messages.is_empty() {
        return Ok(0);
    }

    let mut hydrated = 0usize;
    for message in cached_messages {
        upsert_saved_item_from_message(db, owner_id, &message, None, None)?;
        hydrated += 1;
    }

    let oldest_message_id = db.get_oldest_indexed_message_id(chat_id).map_err(|e| TelegramError {
        message: format!("Failed to read oldest cached message id: {}", e.message),
    })?;

    if oldest_message_id > 0 {
        db.set_setting(&backfill_cursor_key(chat_id), &oldest_message_id.to_string())
            .map_err(|e| TelegramError {
                message: format!("Failed to update backfill cursor: {}", e.message),
            })?;
        db.set_setting(&backfill_complete_key(chat_id), "0")
            .map_err(|e| TelegramError {
                message: format!("Failed to update backfill completion state: {}", e.message),
            })?;
    }

    Ok(hydrated)
}

pub async fn tg_index_saved_messages_impl(db: Database) -> Result<serde_json::Value, TelegramError> {
    let state_guard = AUTH_STATE.lock().await;
    let state = state_guard.as_ref().ok_or_else(|| TelegramError {
        message: "Not authorized".to_string(),
    })?;

    let client = &state.client;
    let me = client.get_me().await.map_err(|e| TelegramError {
        message: format!("Failed to get user info: {}", e),
    })?;

    let chat_id = me.raw.id();
    let owner_id = chat_id.to_string();
    let last_id = db.get_last_indexed_message_id(chat_id).map_err(|e| TelegramError {
        message: format!("Database error: {}", e.message),
    })?;

    db.ensure_telegram_saved_folders(&owner_id).map_err(|e| TelegramError {
        message: format!("Failed to ensure default folders: {}", e.message),
    })?;

    let hydrated_count = hydrate_saved_items_from_cached_messages(&db, &owner_id, chat_id)?;
    if hydrated_count > 0 {
        log::info!(
            "Hydrated {} saved-item records from existing local telegram_messages cache",
            hydrated_count
        );
    }

    log::info!("Indexing Saved Messages for user {} starting from message ID {}", chat_id, last_id);

    // Fetch messages for Saved Messages
    let input_peer = match &me.raw {
        tl::enums::User::User(u) => tl::enums::InputPeer::User(tl::types::InputPeerUser {
            user_id: u.id,
            access_hash: u.access_hash.unwrap_or(0),
        }),
        _ => return Err(TelegramError { message: "Invalid user type".to_string() }),
    };
    let bootstrap_limited = last_id == 0;
    let mut messages_iter = if bootstrap_limited {
        client.iter_messages(input_peer).limit(DEFAULT_BATCH_SIZE)
    } else {
        client.iter_messages(input_peer)
    };
    
    let mut new_count = 0;
    let mut category_counts = std::collections::HashMap::new();
    let mut min_indexed_id = 0;

    while let Some(message) = messages_iter.next().await.map_err(|e| TelegramError {
        message: format!("Failed to fetch messages: {}", e),
    })? {
        if message.id() <= last_id {
            break;
        }

        if let Some(tg_msg) = categorize_message(&message, chat_id) {
            db.save_telegram_message(&tg_msg).map_err(|e| TelegramError {
                message: format!("Failed to save message: {}", e.message),
            })?;

            upsert_saved_item_from_message(&db, &owner_id, &tg_msg, None, None)?;
              
            new_count += 1;
            if min_indexed_id == 0 || tg_msg.message_id < min_indexed_id {
                min_indexed_id = tg_msg.message_id;
            }
            *category_counts.entry(tg_msg.category.clone()).or_insert(0) += 1;
        }
    }

    if bootstrap_limited && new_count > 0 {
        db.set_setting(&backfill_complete_key(chat_id), "0").map_err(|e| TelegramError {
            message: format!("Failed to update backfill completion state: {}", e.message),
        })?;

        if min_indexed_id > 0 {
            db.set_setting(&backfill_cursor_key(chat_id), &min_indexed_id.to_string()).map_err(|e| TelegramError {
                message: format!("Failed to update backfill cursor: {}", e.message),
            })?;
        }
    }

    Ok(json!({
        "total_new_messages": new_count,
        "categories": category_counts,
        "bootstrap_limited": bootstrap_limited
    }))
}

pub async fn tg_get_indexed_saved_messages_impl(db: Database, category: String) -> Result<Vec<TelegramMessage>, TelegramError> {
    let state_guard = AUTH_STATE.lock().await;
    let state = state_guard.as_ref().ok_or_else(|| TelegramError {
        message: "Not authorized".to_string(),
    })?;

    let me = state.client.get_me().await.map_err(|e| TelegramError {
        message: format!("Failed to get user info: {}", e),
    })?;

    db.get_indexed_messages_by_category(me.raw.id(), &category).map_err(|e| TelegramError {
        message: format!("Database error: {}", e.message),
    })
}

pub async fn tg_list_saved_items_impl(db: Database, file_path: String) -> Result<Vec<TelegramSavedItem>, TelegramError> {
    let state_guard = AUTH_STATE.lock().await;
    let state = state_guard.as_ref().ok_or_else(|| TelegramError {
        message: "Not authorized".to_string(),
    })?;

    let me = state.client.get_me().await.map_err(|e| TelegramError {
        message: format!("Failed to get user info: {}", e),
    })?;

    let owner_id = me.raw.id().to_string();
    let normalized_path = normalize_saved_path(&file_path);

    db.ensure_telegram_saved_folders(&owner_id).map_err(|e| TelegramError {
        message: format!("Failed to ensure default folders: {}", e.message),
    })?;

    db.get_telegram_saved_items_by_path(&owner_id, &normalized_path).map_err(|e| TelegramError {
        message: format!("Database error: {}", e.message),
    })
}

pub async fn tg_list_saved_items_page_impl(
    db: Database,
    file_path: String,
    offset: i64,
    limit: i64,
) -> Result<serde_json::Value, TelegramError> {
    let state_guard = AUTH_STATE.lock().await;
    let state = state_guard.as_ref().ok_or_else(|| TelegramError {
        message: "Not authorized".to_string(),
    })?;

    let me = state.client.get_me().await.map_err(|e| TelegramError {
        message: format!("Failed to get user info: {}", e),
    })?;

    let owner_id = me.raw.id().to_string();
    let normalized_path = normalize_saved_path(&file_path);
    let safe_offset = offset.max(0);
    let safe_limit = limit.clamp(1, MAX_BATCH_SIZE as i64);

    db.ensure_telegram_saved_folders(&owner_id).map_err(|e| TelegramError {
        message: format!("Failed to ensure default folders: {}", e.message),
    })?;

    let mut items = db
        .get_telegram_saved_items_by_path_paginated(&owner_id, &normalized_path, safe_offset, safe_limit + 1)
        .map_err(|e| TelegramError {
            message: format!("Database error: {}", e.message),
        })?;

    let has_more = (items.len() as i64) > safe_limit;
    if has_more {
        let _ = items.pop();
    }

    Ok(json!({
        "items": items,
        "has_more": has_more,
        "next_offset": safe_offset + (items.len() as i64)
    }))
}

pub async fn tg_backfill_saved_messages_batch_impl(
    db: Database,
    batch_size: Option<i32>,
) -> Result<serde_json::Value, TelegramError> {
    let state_guard = AUTH_STATE.lock().await;
    let state = state_guard.as_ref().ok_or_else(|| TelegramError {
        message: "Not authorized".to_string(),
    })?;

    let client = &state.client;
    let me = client.get_me().await.map_err(|e| TelegramError {
        message: format!("Failed to get user info: {}", e),
    })?;

    let chat_id = me.raw.id();
    let owner_id = chat_id.to_string();
    let limit = clamp_batch_size(batch_size);

    db.ensure_telegram_saved_folders(&owner_id).map_err(|e| TelegramError {
        message: format!("Failed to ensure default folders: {}", e.message),
    })?;

    let complete_key = backfill_complete_key(chat_id);
    let complete = db
        .get_setting(&complete_key)
        .map_err(|e| TelegramError {
            message: format!("Failed to read backfill state: {}", e.message),
        })?
        .unwrap_or_default()
        == "1";

    if complete {
        return Ok(json!({
            "fetched_count": 0,
            "indexed_count": 0,
            "has_more": false,
            "is_complete": true,
            "next_offset_id": serde_json::Value::Null
        }));
    }

    let cursor_key = backfill_cursor_key(chat_id);
    let stored_cursor = db
        .get_setting(&cursor_key)
        .map_err(|e| TelegramError {
            message: format!("Failed to read backfill cursor: {}", e.message),
        })?
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(0);

    let initial_cursor = if stored_cursor > 0 {
        stored_cursor
    } else {
        db.get_oldest_indexed_message_id(chat_id).map_err(|e| TelegramError {
            message: format!("Failed to read oldest indexed message: {}", e.message),
        })?
    };

    let input_peer = match &me.raw {
        tl::enums::User::User(u) => tl::enums::InputPeer::User(tl::types::InputPeerUser {
            user_id: u.id,
            access_hash: u.access_hash.unwrap_or(0),
        }),
        _ => return Err(TelegramError { message: "Invalid user type".to_string() }),
    };

    let mut messages_iter = if initial_cursor > 0 {
        client.iter_messages(input_peer).offset_id(initial_cursor)
    } else {
        client.iter_messages(input_peer)
    }
    .limit(limit);

    let mut fetched_count = 0usize;
    let mut indexed_count = 0usize;
    let mut min_message_id = initial_cursor;

    while let Some(message) = messages_iter.next().await.map_err(|e| TelegramError {
        message: format!("Failed to fetch messages: {}", e),
    })? {
        fetched_count += 1;
        if min_message_id == 0 || message.id() < min_message_id {
            min_message_id = message.id();
        }

        if let Some(tg_msg) = categorize_message(&message, chat_id) {
            db.save_telegram_message(&tg_msg).map_err(|e| TelegramError {
                message: format!("Failed to save message: {}", e.message),
            })?;

            upsert_saved_item_from_message(&db, &owner_id, &tg_msg, None, None)?;
            indexed_count += 1;
        }
    }

    if fetched_count > 0 && min_message_id > 0 {
        db.set_setting(&cursor_key, &min_message_id.to_string()).map_err(|e| TelegramError {
            message: format!("Failed to update backfill cursor: {}", e.message),
        })?;
    }

    let has_more = fetched_count == limit;
    db.set_setting(&complete_key, if has_more { "0" } else { "1" }).map_err(|e| TelegramError {
        message: format!("Failed to update backfill completion state: {}", e.message),
    })?;

    Ok(json!({
        "fetched_count": fetched_count,
        "indexed_count": indexed_count,
        "has_more": has_more,
        "is_complete": !has_more,
        "next_offset_id": if min_message_id > 0 { serde_json::Value::from(min_message_id) } else { serde_json::Value::Null }
    }))
}

pub async fn tg_rebuild_saved_items_index_impl(db: Database) -> Result<serde_json::Value, TelegramError> {
    let state_guard = AUTH_STATE.lock().await;
    let state = state_guard.as_ref().ok_or_else(|| TelegramError {
        message: "Not authorized".to_string(),
    })?;

    let me = state.client.get_me().await.map_err(|e| TelegramError {
        message: format!("Failed to get user info: {}", e),
    })?;

    let chat_id = me.raw.id();
    let owner_id = chat_id.to_string();

    db.ensure_telegram_saved_folders(&owner_id).map_err(|e| TelegramError {
        message: format!("Failed to ensure default folders: {}", e.message),
    })?;

    let indexed_messages_count = db
        .count_all_indexed_messages(chat_id)
        .map_err(|e| TelegramError {
            message: format!("Failed to count indexed messages: {}", e.message),
        })?;
    let saved_items_count = db
        .count_telegram_saved_non_folder_items(&owner_id)
        .map_err(|e| TelegramError {
            message: format!("Failed to count saved items: {}", e.message),
        })?;
    let unnamed_items_count = db
        .count_telegram_saved_items_with_empty_name(&owner_id)
        .map_err(|e| TelegramError {
            message: format!("Failed to count unnamed saved items: {}", e.message),
        })?;

    if indexed_messages_count == 0 || (saved_items_count >= indexed_messages_count && unnamed_items_count == 0) {
        return Ok(json!({
            "upserted_count": 0,
            "oldest_message_id": db.get_oldest_indexed_message_id(chat_id).unwrap_or(0)
        }));
    }

    let cached_messages = db.get_all_indexed_messages(chat_id).map_err(|e| TelegramError {
        message: format!("Failed to read cached telegram messages: {}", e.message),
    })?;

    let mut upserted = 0usize;
    for message in cached_messages {
        upsert_saved_item_from_message(&db, &owner_id, &message, None, None)?;
        upserted += 1;
    }

    let oldest_message_id = db.get_oldest_indexed_message_id(chat_id).map_err(|e| TelegramError {
        message: format!("Failed to read oldest cached message id: {}", e.message),
    })?;

    if oldest_message_id > 0 {
        db.set_setting(&backfill_cursor_key(chat_id), &oldest_message_id.to_string())
            .map_err(|e| TelegramError {
                message: format!("Failed to update backfill cursor: {}", e.message),
            })?;
        db.set_setting(&backfill_complete_key(chat_id), "0")
            .map_err(|e| TelegramError {
                message: format!("Failed to update backfill completion state: {}", e.message),
            })?;
    }

    Ok(json!({
        "upserted_count": upserted,
        "oldest_message_id": oldest_message_id
    }))
}

pub async fn tg_create_saved_folder_impl(
    db: Database,
    parent_path: String,
    folder_name: String,
) -> Result<TelegramSavedItem, TelegramError> {
    let trimmed_name = folder_name.trim();
    if trimmed_name.is_empty() {
        return Err(TelegramError {
            message: "Folder name cannot be empty".to_string(),
        });
    }

    let state_guard = AUTH_STATE.lock().await;
    let state = state_guard.as_ref().ok_or_else(|| TelegramError {
        message: "Not authorized".to_string(),
    })?;

    let me = state.client.get_me().await.map_err(|e| TelegramError {
        message: format!("Failed to get user info: {}", e),
    })?;

    let owner_id = me.raw.id().to_string();
    let normalized_parent = normalize_saved_path(&parent_path);

    db.ensure_telegram_saved_folders(&owner_id).map_err(|e| TelegramError {
        message: format!("Failed to ensure default folders: {}", e.message),
    })?;

    let folder_item = TelegramSavedItem {
        chat_id: 0,
        message_id: 0,
        thumbnail: None,
        file_type: "folder".to_string(),
        file_unique_id: build_folder_unique_id(&owner_id, &normalized_parent, trimmed_name),
        file_size: 0,
        file_name: trimmed_name.to_string(),
        file_caption: Some(trimmed_name.to_string()),
        file_path: normalized_parent,
        modified_date: chrono::Utc::now().to_rfc3339(),
        owner_id,
    };

    db.upsert_telegram_saved_item(&folder_item).map_err(|e| TelegramError {
        message: format!("Failed to save folder metadata: {}", e.message),
    })?;

    Ok(folder_item)
}

pub async fn tg_get_message_thumbnail_impl(db: Database, message_id: i32) -> Result<Option<String>, TelegramError> {
    log::info!("tg_get_message_thumbnail_impl: Request for message_id={}", message_id);
    
    let state_guard = AUTH_STATE.lock().await;
    let state = state_guard.as_ref().ok_or_else(|| TelegramError {
        message: "Not authorized".to_string(),
    })?;
    
    let client = &state.client;
    let me = client.get_me().await.map_err(|e| TelegramError {
        message: format!("Failed to get user info: {}", e),
    })?;
    let chat_id = me.raw.id();

    // 1. Check database first
    match db.get_telegram_message(chat_id, message_id) {
        Ok(Some(msg)) => {
            if let Some(thumb) = msg.thumbnail {
                if !thumb.is_empty() {
                    log::info!("tg_get_message_thumbnail_impl: Found cached thumbnail in database for message_id={}", message_id);
                    return Ok(Some(thumb));
                }
            }
        },
        _ => {}
    }

    // 2. Fetch message from Telegram
    let input_peer = match &me.raw {
        tl::enums::User::User(u) => tl::enums::InputPeer::User(tl::types::InputPeerUser {
            user_id: u.id,
            access_hash: u.access_hash.unwrap_or(0),
        }),
        _ => return Err(TelegramError { message: "Invalid user type".to_string() }),
    };

    let mut messages = client.get_messages_by_id(input_peer, &[message_id]).await.map_err(|e| TelegramError {
        message: format!("Failed to fetch message: {}", e),
    })?;

    let message = messages.pop().flatten().ok_or_else(|| TelegramError {
        message: "Message not found".to_string(),
    })?;

    // 3. Extract thumbnail location
    let media = message.media();
    let file_location = match media {
        Some(Media::Photo(photo)) => {
            if let Some(tl::enums::Photo::Photo(p)) = &photo.raw.photo {
                // Find smallest size for thumbnail
                let smallest = p.sizes.iter().find_map(|s| {
                    match s {
                        tl::enums::PhotoSize::Size(sz) => Some(sz.r#type.clone()),
                        _ => None,
                    }
                });
                
                if let Some(thumb_size) = smallest {
                    Some(tl::enums::InputFileLocation::InputPhotoFileLocation(
                        tl::types::InputPhotoFileLocation {
                            id: p.id,
                            access_hash: p.access_hash,
                            file_reference: p.file_reference.clone(),
                            thumb_size,
                        }
                    ))
                } else { None }
            } else { None }
        },
        Some(Media::Document(doc)) => {
            if let Some(tl::enums::Document::Document(d)) = &doc.raw.document {
                // Find a suitable thumbnail
                let thumb_type = d.thumbs.as_ref().and_then(|t| t.iter().find_map(|s| {
                    match s {
                        tl::enums::PhotoSize::Size(sz) => Some(sz.r#type.clone()),
                        _ => None,
                    }
                }));

                if let Some(thumb_size) = thumb_type {
                    Some(tl::enums::InputFileLocation::InputDocumentFileLocation(
                        tl::types::InputDocumentFileLocation {
                            id: d.id,
                            access_hash: d.access_hash,
                            file_reference: d.file_reference.clone(),
                            thumb_size,
                        }
                    ))
                } else { None }
            } else { None }
        },
        _ => None,
    };

    let location = match file_location {
        Some(l) => l,
        None => return Ok(None),
    };

    // 4. Download
    log::info!("tg_get_message_thumbnail_impl: Downloading thumbnail...");
    let mut bytes = Vec::new();
    let mut offset = 0;
    let limit = 1024 * 512;

    loop {
        let request = tl::functions::upload::GetFile {
            location: location.clone(),
            offset,
            limit,
            precise: false,
            cdn_supported: false,
        };

        match client.invoke(&request).await {
            Ok(tl::enums::upload::File::File(f)) => {
                bytes.extend_from_slice(&f.bytes);
                if f.bytes.len() < limit as usize { break; }
                offset += f.bytes.len() as i64;
            },
            _ => break,
        }
    }

    if bytes.is_empty() {
        return Ok(None);
    }

    // 5. Encode and Update DB
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let data_url = format!("data:image/jpeg;base64,{}", b64);

    if let Err(e) = db.update_telegram_message_thumbnail(chat_id, message_id, &data_url) {
        log::error!("tg_get_message_thumbnail_impl: Failed to update database: {}", e.message);
    }

    Ok(Some(data_url))
}

pub async fn tg_upload_file_to_saved_messages_impl(
    db: Database,
    file_name: String,
    file_bytes: Vec<u8>,
    file_path: Option<String>,
) -> Result<TelegramMessage, TelegramError> {
    if file_bytes.is_empty() {
        return Err(TelegramError {
            message: "Cannot upload an empty file".to_string(),
        });
    }

    let safe_file_name = sanitize_file_name(&file_name);

    let client = {
        let state_guard = AUTH_STATE.lock().await;
        let state = state_guard.as_ref().ok_or_else(|| TelegramError {
            message: "Not authorized".to_string(),
        })?;
        state.client.clone()
    };

    let me = client.get_me().await.map_err(|e| TelegramError {
        message: format!("Failed to get user info: {}", e),
    })?;

    let chat_id = me.raw.id();
    let owner_id = chat_id.to_string();
    let input_peer = match &me.raw {
        tl::enums::User::User(user) => tl::enums::InputPeer::User(tl::types::InputPeerUser {
            user_id: user.id,
            access_hash: user.access_hash.unwrap_or(0),
        }),
        _ => {
            return Err(TelegramError {
                message: "Invalid user type".to_string(),
            })
        }
    };

    let temp_path = build_temp_upload_path(&safe_file_name);
    fs::write(&temp_path, &file_bytes).map_err(|e| TelegramError {
        message: format!(
            "Failed to prepare temporary upload file {}: {}",
            temp_path.display(),
            e
        ),
    })?;

    let upload_result = client.upload_file(&temp_path).await;
    if let Err(cleanup_error) = fs::remove_file(&temp_path) {
        log::warn!(
            "Failed to delete temporary upload file {}: {}",
            temp_path.display(),
            cleanup_error
        );
    }

    let uploaded_file = upload_result.map_err(|e| TelegramError {
        message: format!("Failed to upload file to Telegram: {}", e),
    })?;

    let sent_message = client
        .send_message(input_peer, InputMessage::new().file(uploaded_file))
        .await
        .map_err(|e| TelegramError {
            message: format!("Failed to send uploaded file: {}", e),
        })?;

    let telegram_message = if let Some(message) = categorize_message(&sent_message, chat_id) {
        message
    } else {
        let extracted_extension = extension_from_name(&safe_file_name);
        let extension = normalize_extension(extracted_extension.as_deref());
        let classification = classify_extension(extension.as_deref());

        TelegramMessage {
            message_id: sent_message.id(),
            chat_id,
            category: classification.category.to_string(),
            filename: Some(safe_file_name.clone()),
            extension,
            mime_type: None,
            timestamp: sent_message.date().to_rfc3339(),
            size: Some(file_bytes.len() as i64),
            text: if sent_message.text().is_empty() {
                None
            } else {
                Some(sent_message.text().to_string())
            },
            thumbnail: None,
            file_reference: format!("upload:{}:{}", chat_id, sent_message.id()),
        }
    };

    db.save_telegram_message(&telegram_message).map_err(|e| TelegramError {
        message: format!("Failed to save uploaded message metadata: {}", e.message),
    })?;

    db.ensure_telegram_saved_folders(&owner_id).map_err(|e| TelegramError {
        message: format!("Failed to ensure default folders: {}", e.message),
    })?;

    upsert_saved_item_from_message(
        &db,
        &owner_id,
        &telegram_message,
        file_path.as_deref(),
        Some(&safe_file_name),
    )?;

    Ok(telegram_message)
}


fn categorize_message(message: &Message, chat_id: i64) -> Option<TelegramMessage> {
    let media = message.media();
    
    let (category, filename, extension, mime_type, size, thumbnail, file_ref) = match media {
        Some(Media::Photo(photo)) => {
            let (id, access_hash, file_ref_bytes) = match &photo.raw.photo {
                Some(tl::enums::Photo::Photo(p)) => (p.id, p.access_hash, p.file_reference.clone()),
                _ => return None,
            };
            let ext = Some("jpg".to_string());
            let classification = classify_extension(ext.as_deref());
            let name = Some(format!("photo_{}.jpg", message.id()));
            (
                classification.category.to_string(),
                name,
                ext,
                Some("image/jpeg".to_string()),
                None,
                None,
                json!({"type": "photo", "id": id, "access_hash": access_hash, "file_reference": base64_encode(&file_ref_bytes)}).to_string()
            )
        },
        Some(Media::Document(doc)) => {
            let (id, access_hash, file_ref_bytes) = match &doc.raw.document {
                Some(tl::enums::Document::Document(d)) => (d.id, d.access_hash, d.file_reference.clone()),
                _ => return None,
            };
            let file_name = optional_sanitized_name(&doc.name().to_string());
            let mime = match doc.mime_type() {
                Some(m) => Some(m.to_string()),
                None => None,
            };
            let extracted_extension = file_name.as_deref().and_then(extension_from_name);
            let ext = normalize_extension(extracted_extension.as_deref())
                .or_else(|| extension_from_mime_type(mime.as_deref()));
            let classification = classify_extension(ext.as_deref());
            let sz = Some(doc.size() as i64);

            (
                classification.category.to_string(),
                file_name,
                ext,
                mime,
                sz,
                None,
                json!({"type": "document", "id": id, "access_hash": access_hash, "file_reference": base64_encode(&file_ref_bytes)}).to_string()
            )
        },
        _ => {
            if !message.text().is_empty() {
                let ext = Some("txt".to_string());
                let classification = classify_extension(ext.as_deref());
                (
                    classification.category.to_string(),
                    None,
                    ext,
                    Some("text/plain".to_string()),
                    Some(message.text().len() as i64),
                    None,
                    json!({"type": "text"}).to_string()
                )
            } else {
                return None;
            }
        }
    };

    Some(TelegramMessage {
        message_id: message.id(),
        chat_id,
        category,
        filename,
        extension,
        mime_type,
        timestamp: message.date().to_rfc3339(),
        size,
        text: if message.text().is_empty() { None } else { Some(message.text().to_string()) },
        thumbnail,
        file_reference: file_ref,
    })
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}
