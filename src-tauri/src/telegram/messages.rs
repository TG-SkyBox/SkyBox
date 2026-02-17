use crate::db::{Database, TelegramMessage, TelegramSavedItem};
use crate::telegram::{AUTH_STATE, TelegramError};
use directories::BaseDirs;
use grammers_client::InputMessage;
use grammers_client::types::{Attribute, Media, Message};
use grammers_client::grammers_tl_types as tl;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const DEFAULT_BATCH_SIZE: usize = 50;
const MAX_BATCH_SIZE: usize = 200;
const SAVED_ROOT_PATH: &str = "/Home";
const RECYCLE_BIN_SAVED_PATH: &str = "/Home/Recycle Bin";
const TELEGRAM_DELETE_BATCH_SIZE: usize = 100;

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum UploadMediaKind {
    Photo,
    Video,
    Audio,
    Document,
}

fn build_upload_file_name(file_name: &str) -> (String, Option<String>) {
    let safe_file_name = sanitize_file_name(file_name);
    let safe_path = Path::new(&safe_file_name);

    let extension = safe_path
        .extension()
        .and_then(|ext| ext.to_str())
        .and_then(|ext| normalize_extension(Some(ext)));

    let stem = safe_path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(sanitize_file_name)
        .unwrap_or_else(|| "upload".to_string());

    let uuid = Uuid::new_v4().simple().to_string();
    let upload_file_name = match extension.as_deref() {
        Some(ext) => format!("{}_{}.{}", stem, uuid, ext),
        None => format!("{}_{}", stem, uuid),
    };

    (upload_file_name, extension)
}

fn upload_media_kind_for_extension(extension: Option<&str>) -> UploadMediaKind {
    match extension.unwrap_or_default() {
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" => UploadMediaKind::Photo,
        "mp4" | "mkv" | "webm" | "mov" | "avi" | "wmv" | "m4v" | "flv" => {
            UploadMediaKind::Video
        }
        "mp3" | "m4a" | "ogg" | "wav" | "flac" | "aac" | "opus" | "wma" => {
            UploadMediaKind::Audio
        }
        _ => UploadMediaKind::Document,
    }
}

fn mime_type_from_extension(extension: Option<&str>) -> Option<&'static str> {
    match extension.unwrap_or_default() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        "mp4" => Some("video/mp4"),
        "mkv" => Some("video/x-matroska"),
        "webm" => Some("video/webm"),
        "mov" => Some("video/quicktime"),
        "avi" => Some("video/x-msvideo"),
        "wmv" => Some("video/x-ms-wmv"),
        "m4v" => Some("video/mp4"),
        "flv" => Some("video/x-flv"),
        "mp3" => Some("audio/mpeg"),
        "m4a" => Some("audio/mp4"),
        "ogg" => Some("audio/ogg"),
        "wav" => Some("audio/wav"),
        "flac" => Some("audio/flac"),
        "aac" => Some("audio/aac"),
        "opus" => Some("audio/opus"),
        "wma" => Some("audio/x-ms-wma"),
        _ => None,
    }
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

fn fallback_file_name_for_non_media(message_id: i32, file_type: &str, extension: Option<&str>) -> String {
    let base = if file_type == "text" {
        format!("note_{}", message_id)
    } else {
        format!("message_{}", message_id)
    };

    match extension {
        Some(ext) if !ext.is_empty() => format!("{}.{}", base, ext),
        _ => base,
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

fn get_thumbnail_cache_dir() -> Result<PathBuf, TelegramError> {
    let base_dirs = BaseDirs::new().ok_or_else(|| TelegramError {
        message: "Failed to resolve app data directory".to_string(),
    })?;

    let thumbnails_dir = base_dirs.data_local_dir().join("Skybox").join(".thumbnails");
    fs::create_dir_all(&thumbnails_dir).map_err(|e| TelegramError {
        message: format!(
            "Failed to create thumbnail cache directory {}: {}",
            thumbnails_dir.display(),
            e
        ),
    })?;

    Ok(thumbnails_dir)
}

fn detect_thumbnail_extension(bytes: &[u8]) -> &'static str {
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return "jpg";
    }
    if bytes.len() >= 8
        && bytes[0] == 0x89
        && bytes[1] == 0x50
        && bytes[2] == 0x4E
        && bytes[3] == 0x47
        && bytes[4] == 0x0D
        && bytes[5] == 0x0A
        && bytes[6] == 0x1A
        && bytes[7] == 0x0A
    {
        return "png";
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return "webp";
    }
    if bytes.len() >= 4 && &bytes[0..4] == b"GIF8" {
        return "gif";
    }

    "jpg"
}

fn cache_thumbnail_bytes(chat_id: i64, message_id: i32, bytes: &[u8]) -> Result<String, TelegramError> {
    let extension = detect_thumbnail_extension(bytes);
    let thumbnail_dir = get_thumbnail_cache_dir()?;
    let thumbnail_path = thumbnail_dir.join(format!("{}_{}.{}", chat_id, message_id, extension));

    fs::write(&thumbnail_path, bytes).map_err(|e| TelegramError {
        message: format!(
            "Failed to write thumbnail cache file {}: {}",
            thumbnail_path.display(),
            e
        ),
    })?;

    Ok(thumbnail_path.to_string_lossy().replace('\\', "/"))
}

fn decode_data_url_image_bytes(data_url: &str) -> Option<Vec<u8>> {
    let base64_marker = "base64,";
    let payload_index = data_url.find(base64_marker)? + base64_marker.len();
    let payload = &data_url[payload_index..];

    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(payload).ok()
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

fn virtual_to_saved_path(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.starts_with("tg://saved") {
        let relative = trimmed
            .trim_start_matches("tg://saved")
            .trim_start_matches('/')
            .trim_end_matches('/');

        if relative.is_empty() {
            return Some("/Home".to_string());
        }

        return Some(format!("/Home/{}", relative));
    }

    if trimmed.starts_with("/Home") || trimmed.starts_with('/') {
        return Some(normalize_saved_path(trimmed));
    }

    None
}

fn parse_message_id_from_virtual_path(path: &str) -> Option<i32> {
    path
        .trim()
        .strip_prefix("tg://msg/")
        .and_then(|value| value.parse::<i32>().ok())
}

fn split_saved_parent_and_name(path: &str) -> Option<(String, String)> {
    let normalized = normalize_saved_path(path);
    if normalized == SAVED_ROOT_PATH {
        return None;
    }

    let trimmed = normalized.trim_end_matches('/');
    let index = trimmed.rfind('/')?;
    let parent = if index == 0 {
        "/Home".to_string()
    } else {
        trimmed[..index].to_string()
    };
    let name = trimmed[index + 1..].trim().to_string();

    if name.is_empty() {
        return None;
    }

    Some((parent, name))
}

fn is_recycle_bin_saved_path(path: &str) -> bool {
    path == RECYCLE_BIN_SAVED_PATH || path.starts_with(&format!("{}/", RECYCLE_BIN_SAVED_PATH))
}

fn ensure_saved_folder_hierarchy(
    db: &Database,
    owner_id: &str,
    destination_path: &str,
    modified_date: &str,
) -> Result<(), TelegramError> {
    let normalized_destination = normalize_saved_path(destination_path);
    if normalized_destination == SAVED_ROOT_PATH {
        return Ok(());
    }

    let relative = normalized_destination
        .trim_start_matches(&format!("{}/", SAVED_ROOT_PATH))
        .trim();
    if relative.is_empty() {
        return Ok(());
    }

    let mut parent_path = SAVED_ROOT_PATH.to_string();
    for segment in relative.split('/') {
        let folder_name = segment.trim();
        if folder_name.is_empty() {
            continue;
        }

        let folder_exists = db
            .telegram_saved_folder_exists(owner_id, &parent_path, folder_name)
            .map_err(|e| TelegramError {
                message: format!("Failed to check folder hierarchy: {}", e.message),
            })?;

        if !folder_exists {
            let folder_item = TelegramSavedItem {
                chat_id: 0,
                message_id: 0,
                thumbnail: None,
                file_type: "folder".to_string(),
                file_unique_id: build_folder_unique_id(owner_id, &parent_path, folder_name),
                file_size: 0,
                file_name: folder_name.to_string(),
                file_caption: Some(folder_name.to_string()),
                file_path: parent_path.clone(),
                recycle_origin_path: None,
                modified_date: modified_date.to_string(),
                owner_id: owner_id.to_string(),
            };

            db.upsert_telegram_saved_item(&folder_item)
                .map_err(|e| TelegramError {
                    message: format!("Failed to create folder hierarchy: {}", e.message),
                })?;
        }

        parent_path = format!("{}/{}", parent_path.trim_end_matches('/'), folder_name);
    }

    Ok(())
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

    let file_name = preferred_name.unwrap_or_else(|| match classification.file_type {
        "image" | "video" | "audio" => {
            generated_file_name(classification.file_type, final_extension.as_deref())
        }
        _ => fallback_file_name_for_non_media(
            message.message_id,
            classification.file_type,
            final_extension.as_deref(),
        ),
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
        recycle_origin_path: None,
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

    let generated_without_extension = db
        .count_telegram_generated_names_missing_extension(owner_id)
        .map_err(|e| TelegramError {
            message: format!("Failed to count generated names without extension: {}", e.message),
        })?;

    if existing_items >= indexed_messages_count && unnamed_items == 0 && generated_without_extension == 0 {
        log::debug!(
            "Saved-item hydration already up-to-date (saved_items={}, indexed_messages={}, unnamed_items={}, generated_without_extension={})",
            existing_items,
            indexed_messages_count,
            unnamed_items,
            generated_without_extension
        );
        return Ok(0);
    }

    log::info!(
        "Hydrating saved-item metadata from cache (saved_items={}, indexed_messages={}, unnamed_items={}, generated_without_extension={})",
        existing_items,
        indexed_messages_count,
        unnamed_items,
        generated_without_extension
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
    let started_from_empty_db = last_id == 0;
    let mut messages_iter = client.iter_messages(input_peer);
    
    let mut new_count = 0;
    let mut category_counts = std::collections::HashMap::new();
    let mut min_indexed_id = 0;

    while let Some(message) = messages_iter.next().await.map_err(|e| TelegramError {
        message: format!("Failed to fetch messages: {}", e),
    })? {
        if !started_from_empty_db && message.id() <= last_id {
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

    if started_from_empty_db {
        db.set_setting(&backfill_complete_key(chat_id), "1").map_err(|e| TelegramError {
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
        "started_from_empty_db": started_from_empty_db
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
    let generated_without_extension_count = db
        .count_telegram_generated_names_missing_extension(&owner_id)
        .map_err(|e| TelegramError {
            message: format!("Failed to count generated names without extension: {}", e.message),
        })?;

    if indexed_messages_count == 0
        || (saved_items_count >= indexed_messages_count
            && unnamed_items_count == 0
            && generated_without_extension_count == 0)
    {
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
        recycle_origin_path: None,
        modified_date: chrono::Utc::now().to_rfc3339(),
        owner_id,
    };

    db.upsert_telegram_saved_item(&folder_item).map_err(|e| TelegramError {
        message: format!("Failed to save folder metadata: {}", e.message),
    })?;

    Ok(folder_item)
}

pub async fn tg_move_saved_item_to_recycle_bin_impl(
    db: Database,
    source_path: String,
) -> Result<(), TelegramError> {
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

    let owner_id = me.raw.id().to_string();
    db.ensure_telegram_saved_folders(&owner_id).map_err(|e| TelegramError {
        message: format!("Failed to ensure default folders: {}", e.message),
    })?;

    let modified_date = chrono::Utc::now().to_rfc3339();

    if let Some(message_id) = parse_message_id_from_virtual_path(&source_path) {
        let file_location = db
            .get_telegram_saved_file_path_and_recycle_origin_by_message_id(&owner_id, message_id)
            .map_err(|e| TelegramError {
                message: format!("Failed to read source file metadata: {}", e.message),
            })?;

        let Some((current_file_path, _)) = file_location else {
            return Err(TelegramError {
                message: "Source file was not found in local index".to_string(),
            });
        };

        if is_recycle_bin_saved_path(&current_file_path) {
            return Err(TelegramError {
                message: "Item is already in Recycle Bin".to_string(),
            });
        }

        db.recycle_telegram_saved_file_by_message_id(
            &owner_id,
            message_id,
            RECYCLE_BIN_SAVED_PATH,
            &modified_date,
        )
        .map_err(|e| TelegramError {
            message: format!("Failed to move file to Recycle Bin: {}", e.message),
        })?;

        return Ok(());
    }

    let source_saved_path = virtual_to_saved_path(&source_path).ok_or_else(|| TelegramError {
        message: "Invalid source path".to_string(),
    })?;

    if source_saved_path == SAVED_ROOT_PATH {
        return Err(TelegramError {
            message: "Cannot move the root folder".to_string(),
        });
    }

    if is_recycle_bin_saved_path(&source_saved_path) {
        return Err(TelegramError {
            message: "Item is already in Recycle Bin".to_string(),
        });
    }

    let (source_parent_path, folder_name) =
        split_saved_parent_and_name(&source_saved_path).ok_or_else(|| TelegramError {
            message: "Invalid source folder path".to_string(),
        })?;

    if !db
        .telegram_saved_folder_exists(&owner_id, &source_parent_path, &folder_name)
        .map_err(|e| TelegramError {
            message: format!("Failed to check source folder: {}", e.message),
        })?
    {
        return Err(TelegramError {
            message: "Source folder was not found in local index".to_string(),
        });
    }

    let destination_folder_path = format!(
        "{}/{}",
        RECYCLE_BIN_SAVED_PATH.trim_end_matches('/'),
        folder_name
    );

    db.recycle_telegram_saved_folder_tree(
        &owner_id,
        &source_parent_path,
        &folder_name,
        &source_saved_path,
        RECYCLE_BIN_SAVED_PATH,
        &destination_folder_path,
        &modified_date,
    )
    .map_err(|e| TelegramError {
        message: format!("Failed to move folder to Recycle Bin: {}", e.message),
    })?;

    Ok(())
}

pub async fn tg_restore_saved_item_impl(
    db: Database,
    source_path: String,
) -> Result<(), TelegramError> {
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

    let owner_id = me.raw.id().to_string();
    db.ensure_telegram_saved_folders(&owner_id).map_err(|e| TelegramError {
        message: format!("Failed to ensure default folders: {}", e.message),
    })?;

    let modified_date = chrono::Utc::now().to_rfc3339();

    if let Some(message_id) = parse_message_id_from_virtual_path(&source_path) {
        let file_location = db
            .get_telegram_saved_file_path_and_recycle_origin_by_message_id(&owner_id, message_id)
            .map_err(|e| TelegramError {
                message: format!("Failed to read source file metadata: {}", e.message),
            })?;

        let Some((current_file_path, recycle_origin_path)) = file_location else {
            return Err(TelegramError {
                message: "Source file was not found in local index".to_string(),
            });
        };

        if !is_recycle_bin_saved_path(&current_file_path) {
            return Err(TelegramError {
                message: "Only items in Recycle Bin can be restored".to_string(),
            });
        }

        let destination_path = recycle_origin_path.unwrap_or_else(|| SAVED_ROOT_PATH.to_string());
        ensure_saved_folder_hierarchy(&db, &owner_id, &destination_path, &modified_date)?;

        db.restore_telegram_saved_file_by_message_id(
            &owner_id,
            message_id,
            &destination_path,
            &modified_date,
        )
        .map_err(|e| TelegramError {
            message: format!("Failed to restore file metadata: {}", e.message),
        })?;

        return Ok(());
    }

    let source_saved_path = virtual_to_saved_path(&source_path).ok_or_else(|| TelegramError {
        message: "Invalid source path".to_string(),
    })?;

    if !is_recycle_bin_saved_path(&source_saved_path) {
        return Err(TelegramError {
            message: "Only folders in Recycle Bin can be restored".to_string(),
        });
    }

    let (source_parent_path, folder_name) =
        split_saved_parent_and_name(&source_saved_path).ok_or_else(|| TelegramError {
            message: "Invalid source folder path".to_string(),
        })?;

    if !db
        .telegram_saved_folder_exists(&owner_id, &source_parent_path, &folder_name)
        .map_err(|e| TelegramError {
            message: format!("Failed to check source folder: {}", e.message),
        })?
    {
        return Err(TelegramError {
            message: "Source folder was not found in local index".to_string(),
        });
    }

    let destination_parent_path = db
        .get_telegram_saved_folder_recycle_origin(&owner_id, &source_parent_path, &folder_name)
        .map_err(|e| TelegramError {
            message: format!("Failed to read folder restore path: {}", e.message),
        })?
        .unwrap_or_else(|| SAVED_ROOT_PATH.to_string());

    ensure_saved_folder_hierarchy(&db, &owner_id, &destination_parent_path, &modified_date)?;

    let destination_folder_path = format!(
        "{}/{}",
        destination_parent_path.trim_end_matches('/'),
        folder_name
    );

    db.restore_telegram_saved_folder_tree(
        &owner_id,
        &source_parent_path,
        &folder_name,
        &source_saved_path,
        &destination_parent_path,
        &destination_folder_path,
        &modified_date,
    )
    .map_err(|e| TelegramError {
        message: format!("Failed to restore folder metadata: {}", e.message),
    })?;

    Ok(())
}

pub async fn tg_delete_saved_item_permanently_impl(
    db: Database,
    source_path: String,
) -> Result<(), TelegramError> {
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

    if let Some(message_id) = parse_message_id_from_virtual_path(&source_path) {
        let file_location = db
            .get_telegram_saved_file_path_and_recycle_origin_by_message_id(&owner_id, message_id)
            .map_err(|e| TelegramError {
                message: format!("Failed to read source file metadata: {}", e.message),
            })?;

        let Some((current_file_path, _)) = file_location else {
            return Err(TelegramError {
                message: "Source file was not found in local index".to_string(),
            });
        };

        if !is_recycle_bin_saved_path(&current_file_path) {
            return Err(TelegramError {
                message: "Only items in Recycle Bin can be deleted permanently".to_string(),
            });
        }

        client
            .delete_messages(input_peer.clone(), &[message_id])
            .await
            .map_err(|e| TelegramError {
                message: format!("Failed to delete Telegram message: {}", e),
            })?;

        db.delete_telegram_saved_file_by_message_id(&owner_id, message_id)
            .map_err(|e| TelegramError {
                message: format!("Failed to delete local file metadata: {}", e.message),
            })?;

        db.delete_telegram_messages_by_ids(chat_id, &[message_id])
            .map_err(|e| TelegramError {
                message: format!("Failed to delete cached telegram message: {}", e.message),
            })?;

        return Ok(());
    }

    let source_saved_path = virtual_to_saved_path(&source_path).ok_or_else(|| TelegramError {
        message: "Invalid source path".to_string(),
    })?;

    if !is_recycle_bin_saved_path(&source_saved_path) {
        return Err(TelegramError {
            message: "Only folders in Recycle Bin can be deleted permanently".to_string(),
        });
    }

    let (source_parent_path, folder_name) =
        split_saved_parent_and_name(&source_saved_path).ok_or_else(|| TelegramError {
            message: "Invalid source folder path".to_string(),
        })?;

    if !db
        .telegram_saved_folder_exists(&owner_id, &source_parent_path, &folder_name)
        .map_err(|e| TelegramError {
            message: format!("Failed to check source folder: {}", e.message),
        })?
    {
        return Err(TelegramError {
            message: "Source folder was not found in local index".to_string(),
        });
    }

    let message_ids = db
        .get_telegram_saved_message_ids_by_folder_tree(&owner_id, &source_saved_path)
        .map_err(|e| TelegramError {
            message: format!("Failed to collect folder message ids: {}", e.message),
        })?;

    for chunk in message_ids.chunks(TELEGRAM_DELETE_BATCH_SIZE) {
        if chunk.is_empty() {
            continue;
        }

        client
            .delete_messages(input_peer.clone(), chunk)
            .await
            .map_err(|e| TelegramError {
                message: format!("Failed to delete Telegram messages: {}", e),
            })?;
    }

    db.delete_telegram_saved_folder_tree(
        &owner_id,
        &source_parent_path,
        &folder_name,
        &source_saved_path,
    )
    .map_err(|e| TelegramError {
        message: format!("Failed to delete local folder metadata: {}", e.message),
    })?;

    db.delete_telegram_messages_by_ids(chat_id, &message_ids)
        .map_err(|e| TelegramError {
            message: format!("Failed to delete cached telegram messages: {}", e.message),
        })?;

    Ok(())
}

pub async fn tg_move_saved_item_impl(
    db: Database,
    source_path: String,
    destination_path: String,
) -> Result<(), TelegramError> {
    let state_guard = AUTH_STATE.lock().await;
    let state = state_guard.as_ref().ok_or_else(|| TelegramError {
        message: "Not authorized".to_string(),
    })?;

    let me = state.client.get_me().await.map_err(|e| TelegramError {
        message: format!("Failed to get user info: {}", e),
    })?;

    let owner_id = me.raw.id().to_string();
    let normalized_destination = virtual_to_saved_path(&destination_path).ok_or_else(|| TelegramError {
        message: "Invalid destination path".to_string(),
    })?;

    db.ensure_telegram_saved_folders(&owner_id).map_err(|e| TelegramError {
        message: format!("Failed to ensure default folders: {}", e.message),
    })?;

    let modified_date = chrono::Utc::now().to_rfc3339();

    if let Some(message_id) = parse_message_id_from_virtual_path(&source_path) {
        if !db
            .telegram_saved_file_exists_by_message_id(&owner_id, message_id)
            .map_err(|e| TelegramError {
                message: format!("Failed to check source file: {}", e.message),
            })?
        {
            return Err(TelegramError {
                message: "Source file was not found in local index".to_string(),
            });
        }

        db.move_telegram_saved_file_by_message_id(&owner_id, message_id, &normalized_destination, &modified_date)
            .map_err(|e| TelegramError {
                message: format!("Failed to move file metadata: {}", e.message),
            })?;

        return Ok(());
    }

    let source_saved_path = virtual_to_saved_path(&source_path).ok_or_else(|| TelegramError {
        message: "Invalid source path".to_string(),
    })?;

    if source_saved_path == "/Home" {
        return Err(TelegramError {
            message: "Cannot move the root folder".to_string(),
        });
    }

    if source_saved_path == normalized_destination {
        return Ok(());
    }

    let destination_prefix = format!("{}/", source_saved_path);
    if normalized_destination.starts_with(&destination_prefix) {
        return Err(TelegramError {
            message: "Cannot move a folder into its own child".to_string(),
        });
    }

    let (source_parent_path, folder_name) = split_saved_parent_and_name(&source_saved_path).ok_or_else(|| TelegramError {
        message: "Invalid source folder path".to_string(),
    })?;

    if !db
        .telegram_saved_folder_exists(&owner_id, &source_parent_path, &folder_name)
        .map_err(|e| TelegramError {
            message: format!("Failed to check source folder: {}", e.message),
        })?
    {
        return Err(TelegramError {
            message: "Source folder was not found in local index".to_string(),
        });
    }

    let destination_folder_path = format!("{}/{}", normalized_destination.trim_end_matches('/'), folder_name);

    db.move_telegram_saved_folder_tree(
        &owner_id,
        &source_parent_path,
        &folder_name,
        &source_saved_path,
        &normalized_destination,
        &destination_folder_path,
        &modified_date,
    )
    .map_err(|e| TelegramError {
        message: format!("Failed to move folder metadata: {}", e.message),
    })?;

    Ok(())
}

pub async fn tg_rename_saved_item_impl(
    db: Database,
    source_path: String,
    new_name: String,
) -> Result<(), TelegramError> {
    let trimmed_name = new_name.trim();
    if trimmed_name.is_empty() {
        return Err(TelegramError {
            message: "New name cannot be empty".to_string(),
        });
    }

    let normalized_name = sanitize_file_name(trimmed_name);

    let state_guard = AUTH_STATE.lock().await;
    let state = state_guard.as_ref().ok_or_else(|| TelegramError {
        message: "Not authorized".to_string(),
    })?;

    let me = state.client.get_me().await.map_err(|e| TelegramError {
        message: format!("Failed to get user info: {}", e),
    })?;

    let owner_id = me.raw.id().to_string();

    db.ensure_telegram_saved_folders(&owner_id)
        .map_err(|e| TelegramError {
            message: format!("Failed to ensure default folders: {}", e.message),
        })?;

    let modified_date = chrono::Utc::now().to_rfc3339();

    if let Some(message_id) = parse_message_id_from_virtual_path(&source_path) {
        if !db
            .telegram_saved_file_exists_by_message_id(&owner_id, message_id)
            .map_err(|e| TelegramError {
                message: format!("Failed to check source file: {}", e.message),
            })?
        {
            return Err(TelegramError {
                message: "Source file was not found in local index".to_string(),
            });
        }

        db.rename_telegram_saved_file_by_message_id(
            &owner_id,
            message_id,
            &normalized_name,
            &modified_date,
        )
        .map_err(|e| TelegramError {
            message: format!("Failed to rename file metadata: {}", e.message),
        })?;

        return Ok(());
    }

    let source_saved_path = virtual_to_saved_path(&source_path).ok_or_else(|| TelegramError {
        message: "Invalid source path".to_string(),
    })?;

    if source_saved_path == "/Home" {
        return Err(TelegramError {
            message: "Cannot rename the root folder".to_string(),
        });
    }

    let (parent_path, current_folder_name) =
        split_saved_parent_and_name(&source_saved_path).ok_or_else(|| TelegramError {
            message: "Invalid source folder path".to_string(),
        })?;

    if current_folder_name == normalized_name {
        return Ok(());
    }

    let destination_folder_path = format!(
        "{}/{}",
        parent_path.trim_end_matches('/'),
        normalized_name.as_str()
    );

    db.rename_telegram_saved_folder_tree(
        &owner_id,
        &parent_path,
        &current_folder_name,
        &normalized_name,
        &source_saved_path,
        &destination_folder_path,
        &modified_date,
    )
    .map_err(|e| TelegramError {
        message: format!("Failed to rename folder metadata: {}", e.message),
    })?;

    Ok(())
}

async fn get_or_fetch_message_thumbnail_impl(
    db: &Database,
    client: &grammers_client::Client,
    chat_id: i64,
    input_peer: &tl::enums::InputPeer,
    message_id: i32,
) -> Result<Option<String>, TelegramError> {
    match db.get_telegram_message(chat_id, message_id) {
        Ok(Some(msg)) => {
            if let Some(thumb) = msg.thumbnail {
                if !thumb.is_empty() {
                    if thumb.starts_with("data:") {
                        if let Some(image_bytes) = decode_data_url_image_bytes(&thumb) {
                            if let Ok(cached_path) = cache_thumbnail_bytes(chat_id, message_id, &image_bytes) {
                                if let Err(e) =
                                    db.update_telegram_message_thumbnail(chat_id, message_id, &cached_path)
                                {
                                    log::error!(
                                        "tg_get_message_thumbnail_impl: Failed to update cached thumbnail path in telegram_messages: {}",
                                        e.message
                                    );
                                }

                                let owner_id = chat_id.to_string();
                                if let Err(e) = db.update_telegram_saved_item_thumbnail(
                                    &owner_id,
                                    message_id,
                                    &cached_path,
                                ) {
                                    log::error!(
                                        "tg_get_message_thumbnail_impl: Failed to update cached thumbnail path in telegram_saved_items: {}",
                                        e.message
                                    );
                                }

                                return Ok(Some(cached_path));
                            }
                        }

                        return Ok(Some(thumb));
                    }

                    if Path::new(&thumb).exists() {
                        return Ok(Some(thumb));
                    }
                }
            }
        }
        _ => {}
    }

    let mut messages = client
        .get_messages_by_id(input_peer.clone(), &[message_id])
        .await
        .map_err(|e| TelegramError {
            message: format!("Failed to fetch message: {}", e),
        })?;

    let message = messages.pop().flatten().ok_or_else(|| TelegramError {
        message: "Message not found".to_string(),
    })?;

    let media = message.media();
    let file_location = match media {
        Some(Media::Photo(photo)) => {
            if let Some(tl::enums::Photo::Photo(p)) = &photo.raw.photo {
                let smallest = p.sizes.iter().find_map(|s| match s {
                    tl::enums::PhotoSize::Size(sz) => Some(sz.r#type.clone()),
                    _ => None,
                });

                if let Some(thumb_size) = smallest {
                    Some(tl::enums::InputFileLocation::InputPhotoFileLocation(
                        tl::types::InputPhotoFileLocation {
                            id: p.id,
                            access_hash: p.access_hash,
                            file_reference: p.file_reference.clone(),
                            thumb_size,
                        },
                    ))
                } else {
                    None
                }
            } else {
                None
            }
        }
        Some(Media::Document(doc)) => {
            if let Some(tl::enums::Document::Document(d)) = &doc.raw.document {
                let thumb_type = d.thumbs.as_ref().and_then(|t| {
                    t.iter().find_map(|s| match s {
                        tl::enums::PhotoSize::Size(sz) => Some(sz.r#type.clone()),
                        _ => None,
                    })
                });

                if let Some(thumb_size) = thumb_type {
                    Some(tl::enums::InputFileLocation::InputDocumentFileLocation(
                        tl::types::InputDocumentFileLocation {
                            id: d.id,
                            access_hash: d.access_hash,
                            file_reference: d.file_reference.clone(),
                            thumb_size,
                        },
                    ))
                } else {
                    None
                }
            } else {
                None
            }
        }
        _ => None,
    };

    let location = match file_location {
        Some(l) => l,
        None => return Ok(None),
    };

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
                if f.bytes.len() < limit as usize {
                    break;
                }
                offset += f.bytes.len() as i64;
            }
            _ => break,
        }
    }

    if bytes.is_empty() {
        return Ok(None);
    }

    let cached_path = cache_thumbnail_bytes(chat_id, message_id, &bytes)?;

    if let Err(e) = db.update_telegram_message_thumbnail(chat_id, message_id, &cached_path) {
        log::error!(
            "tg_get_message_thumbnail_impl: Failed to update telegram_messages thumbnail path: {}",
            e.message
        );
    }

    let owner_id = chat_id.to_string();
    if let Err(e) = db.update_telegram_saved_item_thumbnail(&owner_id, message_id, &cached_path) {
        log::error!(
            "tg_get_message_thumbnail_impl: Failed to update telegram_saved_items thumbnail path: {}",
            e.message
        );
    }

    Ok(Some(cached_path))
}

pub async fn tg_get_message_thumbnail_impl(db: Database, message_id: i32) -> Result<Option<String>, TelegramError> {
    log::info!("tg_get_message_thumbnail_impl: Request for message_id={}", message_id);

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

    let input_peer = match &me.raw {
        tl::enums::User::User(u) => tl::enums::InputPeer::User(tl::types::InputPeerUser {
            user_id: u.id,
            access_hash: u.access_hash.unwrap_or(0),
        }),
        _ => return Err(TelegramError { message: "Invalid user type".to_string() }),
    };

    get_or_fetch_message_thumbnail_impl(&db, &client, chat_id, &input_peer, message_id).await
}

pub async fn tg_prefetch_message_thumbnails_impl(
    db: Database,
    message_ids: Vec<i32>,
) -> Result<serde_json::Value, TelegramError> {
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

    let input_peer = match &me.raw {
        tl::enums::User::User(u) => tl::enums::InputPeer::User(tl::types::InputPeerUser {
            user_id: u.id,
            access_hash: u.access_hash.unwrap_or(0),
        }),
        _ => return Err(TelegramError { message: "Invalid user type".to_string() }),
    };

    let mut ids: Vec<i32> = message_ids.into_iter().filter(|id| *id > 0).collect();
    ids.sort_unstable();
    ids.dedup();

    let mut cached_count = 0usize;
    let mut failed_count = 0usize;

    for message_id in ids {
        match get_or_fetch_message_thumbnail_impl(&db, &client, chat_id, &input_peer, message_id).await {
            Ok(Some(_)) => {
                cached_count += 1;
            }
            Ok(None) => {}
            Err(error) => {
                failed_count += 1;
                log::warn!(
                    "tg_prefetch_message_thumbnails_impl: Failed to prefetch thumbnail for message {}: {}",
                    message_id,
                    error.message
                );
            }
        }
    }

    Ok(json!({
        "cached_count": cached_count,
        "failed_count": failed_count
    }))
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

    let (upload_file_name, upload_extension) = build_upload_file_name(&file_name);
    let upload_media_kind = upload_media_kind_for_extension(upload_extension.as_deref());
    let upload_mime_type = mime_type_from_extension(upload_extension.as_deref());

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

    let temp_path = build_temp_upload_path(&upload_file_name);
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

    let input_message = match upload_media_kind {
        UploadMediaKind::Photo => InputMessage::new().photo(uploaded_file),
        UploadMediaKind::Video | UploadMediaKind::Audio => {
            let message = match upload_mime_type {
                Some(mime_type) => InputMessage::new().mime_type(mime_type).document(uploaded_file),
                None => InputMessage::new().document(uploaded_file),
            };

            message.attribute(Attribute::FileName(upload_file_name.clone()))
        }
        UploadMediaKind::Document => {
            let message = match upload_mime_type {
                Some(mime_type) => InputMessage::new().mime_type(mime_type).file(uploaded_file),
                None => InputMessage::new().file(uploaded_file),
            };

            message.attribute(Attribute::FileName(upload_file_name.clone()))
        }
    };

    let sent_message = client
        .send_message(input_peer, input_message)
        .await
        .map_err(|e| TelegramError {
            message: format!("Failed to send uploaded file: {}", e),
        })?;

    let mut telegram_message = if let Some(message) = categorize_message(&sent_message, chat_id) {
        message
    } else {
        let extracted_extension = extension_from_name(&upload_file_name);
        let extension = normalize_extension(extracted_extension.as_deref());
        let classification = classify_extension(extension.as_deref());

        TelegramMessage {
            message_id: sent_message.id(),
            chat_id,
            category: classification.category.to_string(),
            filename: Some(upload_file_name.clone()),
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

    let upload_classification = classify_extension(upload_extension.as_deref());
    telegram_message.category = upload_classification.category.to_string();
    telegram_message.filename = Some(upload_file_name.clone());
    telegram_message.extension = upload_extension.clone();
    if telegram_message.mime_type.is_none() {
        telegram_message.mime_type = upload_mime_type.map(|value| value.to_string());
    }

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
        Some(&upload_file_name),
    )?;

    Ok(telegram_message)
}


fn estimate_photo_message_size(photo: &tl::types::Photo) -> Option<i64> {
    let mut max_size = 0_i64;

    for size in &photo.sizes {
        let estimated = match size {
            tl::enums::PhotoSize::Size(sz) => sz.size.max(0) as i64,
            tl::enums::PhotoSize::Progressive(sz) => {
                sz.sizes.iter().copied().max().unwrap_or(0).max(0) as i64
            }
            tl::enums::PhotoSize::PhotoCachedSize(sz) => sz.bytes.len() as i64,
            tl::enums::PhotoSize::PhotoStrippedSize(sz) => {
                if sz.bytes.len() >= 3 && sz.bytes[0] == 0x01 {
                    (sz.bytes.len() + 622) as i64
                } else {
                    sz.bytes.len() as i64
                }
            }
            tl::enums::PhotoSize::PhotoPathSize(sz) => sz.bytes.len() as i64,
            tl::enums::PhotoSize::Empty(_) => 0,
        };

        if estimated > max_size {
            max_size = estimated;
        }
    }

    (max_size > 0).then_some(max_size)
}

fn categorize_message(message: &Message, chat_id: i64) -> Option<TelegramMessage> {
    let media = message.media();
    
    let (category, filename, extension, mime_type, size, thumbnail, file_ref) = match media {
        Some(Media::Photo(photo)) => {
            let (id, access_hash, file_ref_bytes, size) = match &photo.raw.photo {
                Some(tl::enums::Photo::Photo(p)) => (
                    p.id,
                    p.access_hash,
                    p.file_reference.clone(),
                    estimate_photo_message_size(p),
                ),
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
                size,
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
