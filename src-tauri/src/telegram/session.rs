use super::utils::{build_client, decode_session};
use super::{run_telegram_request, AUTH_STATE};
use super::{AuthState, TelegramAuthResult, TelegramError, UserInfo};
use crate::db::Database;
use log;
use std::sync::Arc;
use tauri::State;
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

pub(crate) async fn ensure_basic_connectivity() -> Result<(), TelegramError> {
    // Simple, fast connectivity probe to avoid triggering heavy Telegram
    // client startup work when the device is clearly offline.
    let addr = "1.1.1.1:443";

    match timeout(Duration::from_secs(2), TcpStream::connect(addr)).await {
        Ok(Ok(_stream)) => Ok(()),
        Ok(Err(e)) => Err(TelegramError {
            message: format!("Basic connectivity check failed: {e}"),
        }),
        Err(_) => Err(TelegramError {
            message: "Basic connectivity check timed out".to_string(),
        }),
    }
}

pub async fn tg_restore_session_impl(
    db: State<'_, Database>,
    session_data: String,
) -> Result<TelegramAuthResult, TelegramError> {
    log::info!("tg_restore_session_impl: Starting session restore");

    // Fast path: if we appear offline, avoid spinning up the Telegram client
    // at all. This prevents native stack overflows when the runtime repeatedly
    // fails to connect while restoring a session.
    if let Err(e) = ensure_basic_connectivity().await {
        log::warn!(
            "tg_restore_session_impl: Skipping session restore due to failed connectivity check: {}",
            e
        );
        return Err(TelegramError {
            message: "Network appears offline or unreachable. Please check your connection and try again."
                .to_string(),
        });
    }

    let loaded = decode_session(&session_data)?;
    let session = Arc::new(loaded);

    log::info!("tg_restore_session_impl: Session decoded successfully");

    // build_client returns BuiltClient { client, pool_handle, pool_task }
    let built = build_client(Arc::clone(&session));

    log::info!(
        "tg_restore_session_impl: Client built, attempting to get user info to verify session"
    );

    // Instead of checking is_authorized() which might fail, try to get user info directly
    // If this succeeds, the session is valid
    let me = match run_telegram_request("tg_restore_session_impl.get_me", || async {
        built.client.get_me().await
    })
    .await
    {
        Ok(user) => {
            log::info!("tg_restore_session_impl: Successfully got user info, session is valid");
            user
        }
        Err(e) => {
            log::error!("tg_restore_session_impl: Failed to get user info: {}", e);

            // Stop the pool cleanly since the session is invalid
            built.pool_handle.quit();
            built.pool_task.abort();

            // Check if it's an Auth Key error (401)
            let msg = e.to_string();
            if msg.contains("AUTH_KEY_UNREGISTERED") || msg.contains("401") {
                log::warn!("tg_restore_session_impl: Session is invalid (Auth Key Unregistered). Clearing database.");
                if let Err(db_err) = db.clear_session() {
                    log::error!(
                        "tg_restore_session_impl: Failed to clear invalid session: {}",
                        db_err.message
                    );
                }
            }

            return Err(TelegramError {
                message: format!("Session is not valid: {e}"),
            });
        }
    };

    // Store restored state ONCE (including pool fields)
    let mut guard = AUTH_STATE.lock().await;
    *guard = Some(AuthState {
        client: built.client,
        session,
        pool_handle: built.pool_handle,
        pool_task: built.pool_task,
        updates: built.updates,
        login_token: None,
        password_token: None,
        phone_number: None,
        flow_id: u64::MAX,
        qr_state: None,
        is_migrating: false,
        current_dc_id: None, // Will be determined when needed
    });

    log::info!(
        "tg_restore_session_impl: Session restored successfully for user: {:?}",
        me.username()
    );

    // Get cached profile photo if any
    let cached_photo = match db.get_session() {
        Ok(Some(s)) => s.profile_photo,
        _ => None,
    };

    let user_info = UserInfo {
        id: me.raw.id(),
        username: me.username().map(|s| s.to_string()),
        first_name: me.first_name().map(|s| s.to_string()),
        last_name: me.last_name().map(|s| s.to_string()),
        profile_photo: cached_photo,
    };

    // Cache user info in database
    match db.update_session_user_info(
        user_info.first_name.as_deref(),
        user_info.last_name.as_deref(),
        user_info.username.as_deref(),
    ) {
        Ok(_) => log::info!("tg_restore_session_impl: Updated user info cache in database"),
        Err(e) => log::warn!(
            "tg_restore_session_impl: Failed to update user info cache: {}",
            e.message
        ),
    }

    Ok(TelegramAuthResult {
        authorized: true,
        session_data: Some(session_data),
        user_info: Some(user_info),
        requires_password: false,
    })
}

pub async fn tg_logout_impl() -> Result<bool, TelegramError> {
    log::info!("tg_logout_impl: Initiating logout");

    // Take the current state out so we can drop/stop it cleanly
    let state = {
        let mut guard = AUTH_STATE.lock().await;
        guard.take()
    };

    if let Some(state) = state {
        state.pool_handle.quit();
        state.pool_task.abort();
        log::info!("tg_logout_impl: Client pool stopped");
    }

    log::info!("tg_logout_impl: Logout completed");
    Ok(true)
}
