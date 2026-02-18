use super::{run_telegram_request, TelegramError, AUTH_STATE};
use crate::db::Database;
use grammers_client::grammers_tl_types as tl;
use base64::Engine;
use log;
use tauri::State;

/// Download the current user's profile photo and return as a base64 data URL.
/// If download is successful, caches the photo in the database for future use.
pub async fn tg_get_my_profile_photo_impl(db: State<'_, Database>) -> Result<Option<String>, TelegramError> {
    log::info!("tg_get_my_profile_photo_impl: Starting profile photo download");
    
    // Check database first
    match db.get_session() {
        Ok(Some(session)) => {
            if let Some(photo) = session.profile_photo {
                log::info!("tg_get_my_profile_photo_impl: Found cached photo in database, skipping download");
                return Ok(Some(photo));
            }
        },
        _ => {}
    }

    // Get client from AUTH_STATE
    let client = {
        let guard = AUTH_STATE.lock().await;
        let state = guard.as_ref().ok_or_else(|| TelegramError {
            message: "Not authorized. Please log in first".to_string(),
        })?;
        state.client.clone()
    };
    
    // Get current user
    let me = match run_telegram_request("tg_get_my_profile_photo_impl.get_me", || async {
        client.get_me().await
    }).await {
        Ok(user) => user,
        Err(e) => {
            log::error!("tg_get_my_profile_photo_impl: Failed to get user info: {}", e);
            return Err(TelegramError {
                message: format!("Failed to get user info: {}", e),
            });
        }
    };
    
    log::info!("tg_get_my_profile_photo_impl: Got user info for id={}", me.raw.id());
    
    // Construct InputUser from current user
    let input_user = tl::types::InputUser {
        user_id: me.raw.id(),
        access_hash: match &me.raw {
            tl::enums::User::User(u) => u.access_hash.unwrap_or(0),
            tl::enums::User::Empty(_) => {
                log::warn!("tg_get_my_profile_photo_impl: User is empty, no profile photo");
                return Ok(None);
            }
        },
    };
    
    // Call users.getPhotos to get profile photos
    let get_photos_request = tl::functions::photos::GetUserPhotos {
        user_id: tl::enums::InputUser::User(input_user),
        offset: 0,
        max_id: 0,
        limit: 1, // Only get the first (current) photo
    };
    
    let photos_result = match run_telegram_request(
        "tg_get_my_profile_photo_impl.get_user_photos",
        || async { client.invoke(&get_photos_request).await },
    ).await {
        Ok(result) => result,
        Err(e) => {
            log::warn!("tg_get_my_profile_photo_impl: Failed to get photos: {}", e);
            return Ok(None); // Return None instead of error - user might not have a photo
        }
    };
    
    // Extract photo from result and clone it to avoid lifetime issues
    let photo = match photos_result {
        tl::enums::photos::Photos::Photos(p) => {
            if p.photos.is_empty() {
                log::info!("tg_get_my_profile_photo_impl: User has no profile photos");
                return Ok(None);
            }
            p.photos[0].clone()
        }
        tl::enums::photos::Photos::Slice(s) => {
            if s.photos.is_empty() {
                log::info!("tg_get_my_profile_photo_impl: User has no profile photos");
                return Ok(None);
            }
            s.photos[0].clone()
        }
    };
    
    // Extract photo details
    let (photo_id, access_hash, file_reference, thumb_size) = match photo {
        tl::enums::Photo::Photo(p) => {
            // Find the first available photo size (for download)
            let smallest_size = p.sizes.iter().find_map(|size| {
                match size {
                    tl::enums::PhotoSize::Size(s) => Some(s.r#type.clone()),
                    _ => None,
                }
            });
            
            if smallest_size.is_none() {
                log::warn!("tg_get_my_profile_photo_impl: No valid photo sizes found");
                return Ok(None);
            }
            
            (p.id, p.access_hash, p.file_reference.clone(), smallest_size.unwrap())
        }
        tl::enums::Photo::Empty(_) => {
            log::info!("tg_get_my_profile_photo_impl: Photo is empty");
            return Ok(None);
        }
    };
    
    log::info!("tg_get_my_profile_photo_impl: Found photo id={}, downloading...", photo_id);
    
    // Construct InputPhotoFileLocation
    let file_location = tl::enums::InputFileLocation::InputPhotoFileLocation(
        tl::types::InputPhotoFileLocation {
            id: photo_id,
            access_hash,
            file_reference,
            thumb_size,
        }
    );
    
    // Download the photo using upload.getFile
    let mut photo_bytes = Vec::new();
    let mut offset = 0;
    let limit = 1024 * 512; // 512KB chunks
    
    loop {
        let get_file_request = tl::functions::upload::GetFile {
            location: file_location.clone(),
            offset,
            limit,
            precise: false,
            cdn_supported: false,
        };
        
        let file_result = match run_telegram_request(
            "tg_get_my_profile_photo_impl.get_file_chunk",
            || async { client.invoke(&get_file_request).await },
        ).await {
            Ok(result) => result,
            Err(e) => {
                log::error!("tg_get_my_profile_photo_impl: Failed to download file chunk: {}", e);
                return Ok(None); // Return None on download failure
            }
        };
        
        match file_result {
            tl::enums::upload::File::File(f) => {
                photo_bytes.extend_from_slice(&f.bytes);
                
                // Check if we got less bytes than requested (means we reached the end)
                if f.bytes.len() < limit as usize {
                    break;
                }
                
                offset += f.bytes.len() as i64;
            }
            tl::enums::upload::File::CdnRedirect(_) => {
                log::warn!("tg_get_my_profile_photo_impl: CDN redirect not supported");
                return Ok(None);
            }
        }
        
        // Safety limit: don't download more than 5MB
        if photo_bytes.len() > 5 * 1024 * 1024 {
            log::warn!("tg_get_my_profile_photo_impl: Photo too large, stopping download");
            break;
        }
    }
    
    if photo_bytes.is_empty() {
        log::warn!("tg_get_my_profile_photo_impl: Downloaded 0 bytes");
        return Ok(None);
    }
    
    log::info!("tg_get_my_profile_photo_impl: Downloaded {} bytes", photo_bytes.len());
    
    // Convert to base64 data URL
    let base64_data = base64::engine::general_purpose::STANDARD.encode(&photo_bytes);
    let data_url = format!("data:image/jpeg;base64,{}", base64_data);
    
    log::info!("tg_get_my_profile_photo_impl: Successfully created data URL");
    
    // Save to database for caching
    match db.update_session_profile_photo(&data_url) {
        Ok(_) => log::info!("tg_get_my_profile_photo_impl: Saved photo to database cache"),
        Err(e) => log::warn!("tg_get_my_profile_photo_impl: Failed to save photo to database: {}", e.message),
    }
    
    Ok(Some(data_url))
}
