use super::{TelegramError, AUTH_STATE};
use grammers_client::client::updates::UpdatesLike;
use log;
use tauri::{AppHandle, Emitter};
use tokio::time::{interval, Duration};
use serde_json::json;

// Background sync task that processes Telegram updates
pub async fn start_real_time_sync(app: AppHandle) {
    log::info!("Starting real-time Telegram sync background task");
    
    let mut interval = interval(Duration::from_secs(2)); // Check for updates every 2 seconds
    
    loop {
        interval.tick().await;
        
        // Check if we have an active session
        let updates_stream = {
            let guard = AUTH_STATE.lock().await;
            if let Some(state) = guard.as_ref() {
                Some(state.updates.clone())
            } else {
                None
            }
        };
        
        if let Some(updates) = updates_stream {
            // Try to receive updates with a short timeout
            let timeout_result = tokio::time::timeout(
                Duration::from_millis(100),
                updates.lock().await.recv()
            ).await;
            
            match timeout_result {
                Ok(Some(update)) => {
                    log::debug!("Received Telegram update");
                    if let Err(e) = process_update(&app, update).await {
                        log::warn!("Failed to process Telegram update: {}", e);
                    }
                }
                Ok(None) => {
                    log::debug!("Updates stream closed");
                    break;
                }
                Err(_) => {
                    // Timeout - no updates available, continue loop
                    continue;
                }
            }
        } else {
            // No active session, wait before checking again
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    }
    
    log::info!("Real-time sync task stopped");
}

// Process individual Telegram updates
async fn process_update(app: &AppHandle, update: UpdatesLike) -> Result<(), TelegramError> {
    // Simply emit the update with a timestamp
    // We'll send the debug format for now, and the frontend can handle parsing
    let update_json = json!({
        "update": format!("{:?}", update),
        "timestamp": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    });
    
    app.emit("tg-update-received", update_json).map_err(|e| TelegramError {
        message: format!("Failed to emit update event: {}", e),
    })?;
    
    Ok(())
}

// Start the sync task when session is established
pub async fn initialize_sync_task(app: AppHandle) {
    tokio::spawn(async move {
        start_real_time_sync(app).await;
    });
}