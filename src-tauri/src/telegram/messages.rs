use crate::db::{Database, TelegramMessage};
use crate::telegram::{AUTH_STATE, TelegramError};
use grammers_client::types::{Message, Media};
use grammers_client::grammers_tl_types as tl;
use serde_json::json;

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
    let last_id = db.get_last_indexed_message_id(chat_id).map_err(|e| TelegramError {
        message: format!("Database error: {}", e.message),
    })?;

    log::info!("Indexing Saved Messages for user {} starting from message ID {}", chat_id, last_id);

    // Fetch messages for Saved Messages
    let input_peer = match &me.raw {
        tl::enums::User::User(u) => tl::enums::InputPeer::User(tl::types::InputPeerUser {
            user_id: u.id,
            access_hash: u.access_hash.unwrap_or(0),
        }),
        _ => return Err(TelegramError { message: "Invalid user type".to_string() }),
    };
    let mut messages_iter = client.iter_messages(input_peer);
    
    let mut new_count = 0;
    let mut category_counts = std::collections::HashMap::new();

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
            
            new_count += 1;
            *category_counts.entry(tg_msg.category.clone()).or_insert(0) += 1;
        }
    }

    Ok(json!({
        "total_new_messages": new_count,
        "categories": category_counts
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


fn categorize_message(message: &Message, chat_id: i64) -> Option<TelegramMessage> {
    let media = message.media();
    
    let (category, filename, extension, mime_type, size, thumbnail, file_ref) = match media {
        Some(Media::Photo(photo)) => {
            let (id, access_hash, file_ref_bytes) = match &photo.raw.photo {
                Some(tl::enums::Photo::Photo(p)) => (p.id, p.access_hash, p.file_reference.clone()),
                _ => return None,
            };
            let ext = "jpg".to_string();
            let name = format!("photo_{}.{}", message.id(), ext);
            (
                "Images".to_string(),
                Some(name),
                Some(ext),
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
            let fname = doc.name().to_string();
            let ext = fname.split('.').last().unwrap_or("").to_lowercase();
            let mime = match doc.mime_type() {
                Some(m) => Some(m.to_string()),
                None => None,
            };
            let sz = Some(doc.size() as i64);
            
            let category = match ext.as_str() {
                "jpg" | "jpeg" | "png" | "webp" | "gif" => "Images",
                "mp4" | "mkv" | "webm" | "mov" => "Videos",
                "mp3" | "m4a" | "ogg" | "wav" | "flac" => "Audios",
                _ => "Documents"
            }.to_string();

            (
                category,
                Some(fname),
                Some(ext),
                mime,
                sz,
                None,
                json!({"type": "document", "id": id, "access_hash": access_hash, "file_reference": base64_encode(&file_ref_bytes)}).to_string()
            )
        },
        _ => {
            if !message.text().is_empty() {
                (
                    "Notes".to_string(),
                    None,
                    None,
                    None,
                    None,
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
