use super::session::ensure_basic_connectivity;
use super::utils::{build_client, encode_session};
use super::Arc;
use super::{get_api_hash, get_api_id, run_telegram_request, Database, AUTH_FLOW_ID, AUTH_STATE};
#[allow(deprecated)]
use super::{Client, SignInError, TlSession};
use super::{
    PasswordToken, QrLoginData, QrLoginStatus, QrPollResult, QrState, TelegramAuthData,
    TelegramAuthResult, TelegramError, UserInfo,
};
use base64::Engine;
use chrono::Utc;
use grammers_client::grammers_tl_types as tl;
use grammers_session::Session as _;
use log;
use std::sync::atomic::Ordering;
use tauri::Emitter;
use tokio::time;

/// Compute proper expiration timestamp from the token's expires field
///
/// Logic:
/// - If expires_field <= 0: return now + 120 seconds
/// - If expires_field < 6 hours (21600): treat as TTL seconds => now + expires_field
/// - Else: treat as absolute Unix timestamp => expires_field
/// - Apply small grace: subtract 1-2 seconds if result is in future
fn compute_expires_at(expires_field: i32, now: i64) -> i64 {
    let computed = if expires_field <= 0 {
        // Invalid or zero TTL, default to 2 minutes
        now + 120
    } else if expires_field < 21600 {
        // Treat as TTL in seconds (less than 6 hours)
        now + expires_field as i64
    } else {
        // Treat as absolute Unix timestamp
        expires_field as i64
    };

    // Apply small grace period (subtract 1 second if still in future)
    if computed > now {
        computed - 1
    } else {
        computed
    }
}

// Helper function to resolve export login token
pub async fn resolve_export_login_token(
    client: &Client,
) -> Result<tl::enums::auth::LoginToken, TelegramError> {
    let export_request = tl::functions::auth::ExportLoginToken {
        api_id: get_api_id(),
        api_hash: get_api_hash().to_string(),
        except_ids: vec![],
    };

    run_telegram_request("resolve_export_login_token", || async {
        client.invoke(&export_request).await
    })
    .await
    .map_err(|e| TelegramError {
        message: format!("Failed to export login token: {}", e),
    })
}

pub async fn tg_request_auth_code_impl(
    auth_data: TelegramAuthData,
) -> Result<TelegramAuthResult, TelegramError> {
    let flow_id = AUTH_FLOW_ID.fetch_add(1, Ordering::Relaxed) + 1;
    log::info!(
        "tg_request_auth_code_impl: flow_id={} phone={}",
        flow_id,
        auth_data.phone_number
    );

    // Create a fresh session and client for this operation
    #[allow(deprecated)]
    let session = Arc::new(TlSession::new());
    let built = build_client(session.clone());

    log::info!(
        "tg_request_auth_code_impl: Calling request_login_code for phone: {}",
        auth_data.phone_number
    );

    // request_login_code(phone, api_hash) -> LoginToken
    let token = run_telegram_request("tg_request_auth_code_impl.request_login_code", || async {
        built
            .client
            .request_login_code(&auth_data.phone_number, get_api_hash())
            .await
    })
    .await
    .map_err(|e| {
        log::error!(
            "tg_request_auth_code_impl: Failed to request auth code for phone '{}': {}",
            auth_data.phone_number,
            e
        );

        let s = e.to_string().to_lowercase();

        let error_message: String =
            if (s.contains("dropped") || s.contains("cancelled")) && !s.contains("timeout") {
                format!(
                "Connection interrupted: {}. Please check your internet connection and try again.",
                e
            )
            } else if s.contains("timeout") {
                format!(
                    "Request timed out: {}. Please check your network connection and try again.",
                    e
                )
            } else if s.contains("invalid") {
                format!(
                    "Invalid phone number format: {}. Please check the number and try again.",
                    e
                )
            } else if s.contains("flood") {
                format!(
                    "Too many requests: {}. Please wait a few minutes before trying again.",
                    e
                )
            } else if (s.contains("api_id") || s.contains("api")) && !s.contains("invalid") {
                format!(
                    "Authentication service error: {}. Please try again later.",
                    e
                )
            } else {
                format!("Failed to request auth code: {}", e)
            };

        TelegramError {
            message: error_message,
        }
    })?;

    log::info!(
        "tg_request_auth_code_impl: Successfully requested auth code for phone: {}",
        auth_data.phone_number
    );

    *AUTH_STATE.lock().await = Some(super::AuthState {
        client: built.client,
        session,
        pool_handle: built.pool_handle,
        pool_task: built.pool_task,
        updates: built.updates,
        login_token: Some(token),
        password_token: None,
        phone_number: Some(auth_data.phone_number.clone()),
        flow_id,
        qr_state: None,
        is_migrating: false,
        current_dc_id: None, // Will be determined by the client
    });

    log::info!(
        "tg_request_auth_code_impl: stored state flow_id={} for phone={}",
        flow_id,
        auth_data.phone_number
    );

    Ok(TelegramAuthResult {
        authorized: false,
        session_data: None,
        user_info: None,
        requires_password: false,
    })
}

pub async fn tg_sign_in_with_code_impl(
    phone_code: String,
) -> Result<TelegramAuthResult, TelegramError> {
    let code = phone_code.trim().to_string();
    log::info!("tg_sign_in_with_code_impl: start code_len={}", code.len());

    // Take token out (LoginToken is NOT Clone)
    let (client, session, token, stored_phone, flow_id) = {
        let mut guard = AUTH_STATE.lock().await;

        let state = guard.as_mut().ok_or_else(|| TelegramError {
            message: "No active auth session. Call tg_request_auth_code first.".into(),
        })?;

        log::info!(
            "tg_sign_in_with_code_impl: state ok (has_login_token={}, has_password_token={}) phone={:?} flow_id={}",
            state.login_token.is_some(),
            state.password_token.is_some(),
            state.phone_number,
            state.flow_id,
        );

        let token = state.login_token.take().ok_or_else(|| TelegramError {
            message: "Missing login token. Restart auth flow.".into(),
        })?;

        (
            state.client.clone(),
            Arc::clone(&state.session),
            token,
            state.phone_number.clone(),
            state.flow_id,
        )
    };

    if code.is_empty() {
        // restore token so user can retry
        let mut guard = AUTH_STATE.lock().await;
        if let Some(state) = guard.as_mut() {
            state.login_token = Some(token);
        }
        return Err(TelegramError {
            message: "Empty code".into(),
        });
    }

    // Mask code in logs
    let masked = if code.len() <= 2 {
        "**".to_string()
    } else {
        format!("{}***{}", &code[0..1], &code[code.len() - 1..])
    };
    log::info!(
        "tg_sign_in_with_code_impl: attempting sign_in code={} for phone={:?} flow_id={}",
        masked,
        stored_phone,
        flow_id
    );

    match run_telegram_request("tg_sign_in_with_code_impl.sign_in", || async {
        client.sign_in(&token, &code).await
    })
    .await
    {
        Ok(user) => {
            log::info!(
                "tg_sign_in_with_code_impl: sign_in OK user_id={}",
                user.raw.id()
            );

            let me = run_telegram_request("tg_sign_in_with_code_impl.get_me", || async {
                client.get_me().await
            })
            .await
            .map_err(|e| TelegramError {
                message: format!("get_me failed after sign_in: {e}"),
            })?;

            log::info!(
                "tg_sign_in_with_code_impl: get_me OK id={} username={:?}",
                me.raw.id(),
                me.username()
            );

            // Clear password token (login token already consumed)
            {
                let mut guard = AUTH_STATE.lock().await;
                if let Some(state) = guard.as_mut() {
                    state.password_token = None;
                }
            }

            Ok(TelegramAuthResult {
                authorized: true,
                session_data: Some(encode_session(&session)),
                user_info: Some(UserInfo {
                    id: me.raw.id(),
                    username: me.username().map(|s| s.to_string()),
                    first_name: me.first_name().map(|s| s.to_string()),
                    last_name: me.last_name().map(|s| s.to_string()),
                    profile_photo: None,
                }),
                requires_password: false,
            })
        }

        Err(SignInError::PasswordRequired(password_token)) => {
            log::warn!("tg_sign_in_with_code_impl: PasswordRequired (2FA enabled)");

            let mut guard = AUTH_STATE.lock().await;
            if let Some(state) = guard.as_mut() {
                state.password_token = Some(password_token);
            }

            Ok(TelegramAuthResult {
                authorized: false,
                session_data: None,
                user_info: None,
                requires_password: true,
            })
        }

        Err(SignInError::InvalidCode) => {
            log::warn!("tg_sign_in_with_code_impl: InvalidCode");
            // restore token so they can try again
            let mut guard = AUTH_STATE.lock().await;
            if let Some(state) = guard.as_mut() {
                state.login_token = Some(token);
            }
            Err(TelegramError {
                message: "Invalid code (check what the frontend is sending)".into(),
            })
        }

        Err(SignInError::SignUpRequired {
            terms_of_service: _,
        }) => {
            log::warn!("tg_sign_in_with_code_impl: SignUpRequired (number not registered?)");
            // restore token so they can retry or switch flow
            let mut guard = AUTH_STATE.lock().await;
            if let Some(state) = guard.as_mut() {
                state.login_token = Some(token);
            }
            Err(TelegramError {
                message: "This number requires sign-up (not logged in yet)".into(),
            })
        }

        Err(SignInError::InvalidPassword) => {
            log::warn!(
                "tg_sign_in_with_code_impl: InvalidPassword (this shouldn't happen in code step)"
            );
            let mut guard = AUTH_STATE.lock().await;
            if let Some(state) = guard.as_mut() {
                state.login_token = Some(token);
            }
            Err(TelegramError {
                message: "Invalid password".into(),
            })
        }

        Err(SignInError::Other(e)) => {
            log::error!("tg_sign_in_with_code_impl: Other InvocationError: {}", e);
            let mut guard = AUTH_STATE.lock().await;
            if let Some(state) = guard.as_mut() {
                state.login_token = Some(token);
            }
            Err(TelegramError {
                message: format!("Sign-in failed: {e}"),
            })
        }
    }
}

pub async fn tg_generate_qr_code_impl(
    _app: tauri::AppHandle,
) -> Result<QrLoginData, TelegramError> {
    log::info!("tg_generate_qr_code_impl: Generating QR login code");

    // Avoid spinning up a Telegram client when basic connectivity is clearly
    // unavailable. This prevents runtime stack overflows when the device is
    // offline and we repeatedly try to open a QR login flow.
    if let Err(e) = ensure_basic_connectivity().await {
        log::warn!(
            "tg_generate_qr_code_impl: Skipping QR generation due to failed connectivity check: {}",
            e
        );
        return Err(TelegramError {
            message: "Network appears offline or unreachable. Please check your connection and try again."
                .to_string(),
        });
    }

    // Check if there's already an active QR flow
    {
        let guard = AUTH_STATE.lock().await;
        if let Some(state) = guard.as_ref() {
            if let Some(qr_state) = &state.qr_state {
                let now = Utc::now().timestamp();
                if qr_state.expires_unix > now {
                    log::info!(
                        "tg_generate_qr_code_impl: Active QR flow already exists (flow_id={}), returning existing QR",
                        state.flow_id
                    );
                    return Ok(QrLoginData {
                        qr_url: qr_state.qr_url.clone(),
                        expires_at_unix: qr_state.expires_unix,
                        flow_id: state.flow_id,
                    });
                } else {
                    log::info!(
                        "tg_generate_qr_code_impl: Existing QR flow expired (flow_id={}), generating new one",
                        state.flow_id
                    );
                }
            }
        }
    }

    // Create a fresh session for QR login
    #[allow(deprecated)]
    let session = Arc::new(TlSession::new());
    let built = build_client(session.clone());

    let flow_id = AUTH_FLOW_ID.fetch_add(1, Ordering::Relaxed) + 1;
    log::info!(
        "tg_generate_qr_code_impl: Starting new QR flow (flow_id={})",
        flow_id
    );

    // Export login token and resolve any DC migrations.
    // Telegram can return LoginTokenMigrateTo, in which case we must import the token in the target DC.
    let mut token_result = resolve_export_login_token(&built.client).await?;
    let mut hops: u8 = 0;
    while let tl::enums::auth::LoginToken::MigrateTo(m) = token_result {
        hops = hops.saturating_add(1);
        if hops > 5 {
            return Err(TelegramError {
                message: "Too many DC migrations while exporting login token".to_string(),
            });
        }

        let old_home_dc = session.home_dc_id();
        session.set_home_dc_id(m.dc_id);
        let _ = built.pool_handle.disconnect_from_dc(old_home_dc);

        log::info!(
            "tg_generate_qr_code_impl: ExportLoginToken requested migration to DC {} (hop={})",
            m.dc_id,
            hops
        );

        let import_req = tl::functions::auth::ImportLoginToken { token: m.token };
        token_result =
            run_telegram_request("tg_generate_qr_code_impl.import_login_token", || async {
                built.client.invoke_in_dc(m.dc_id, &import_req).await
            })
            .await
            .map_err(|e| TelegramError {
                message: format!(
                    "Failed to import login token during export migration to DC {}: {}",
                    m.dc_id, e
                ),
            })?;
    }

    // Handle the response
    let (token_bytes, raw_expires_field, _token_obj) = match token_result {
        tl::enums::auth::LoginToken::Token(t) => (t.token.clone(), t.expires, t),
        tl::enums::auth::LoginToken::Success(_s) => {
            // Already authorized - this is rare but possible
            log::info!(
                "tg_generate_qr_code_impl: Already authorized (flow_id={})",
                flow_id
            );
            return handle_already_authorized(built.client, session, flow_id).await;
        }
        tl::enums::auth::LoginToken::MigrateTo(_m) => unreachable!("MigrateTo handled in loop"),
    };

    // Compute proper expiration using the helper function
    let now = Utc::now().timestamp();
    let expires_at_unix = compute_expires_at(raw_expires_field, now);
    let seconds_remaining = expires_at_unix - now;

    // Generate QR URL
    let token_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&token_bytes);
    let qr_url = format!("tg://login?token={}", token_b64);

    // Log token hash for correlation (first 6 bytes only)
    let token_hash = if token_bytes.len() >= 6 {
        format!(
            "{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
            token_bytes[0],
            token_bytes[1],
            token_bytes[2],
            token_bytes[3],
            token_bytes[4],
            token_bytes[5]
        )
    } else {
        "<short>".to_string()
    };

    log::info!(
        "tg_generate_qr_code_impl: Generated QR code (flow_id={}, token_hash={}, raw_expires_field={}, computed_expires_at_unix={}, now={}, seconds_remaining={})", 
        flow_id, token_hash, raw_expires_field, expires_at_unix, now, seconds_remaining
    );

    // Store QR login state
    let qr_state = QrState {
        token: token_bytes,
        qr_url: qr_url.clone(),
        expires_unix: expires_at_unix,
        last_token_b64: token_b64,
        api_hash: get_api_hash().to_string(),
        started_at_unix: now,
    };

    // Minimal delay to allow token to settle (reduced from 1.5s to 100ms)
    time::sleep(time::Duration::from_millis(100)).await;

    *AUTH_STATE.lock().await = Some(super::AuthState {
        client: built.client,
        session,
        pool_handle: built.pool_handle,
        pool_task: built.pool_task,
        updates: built.updates,
        login_token: None,
        password_token: None,
        phone_number: None,
        flow_id,
        qr_state: Some(qr_state),
        is_migrating: false,
        current_dc_id: None,
    });

    Ok(QrLoginData {
        qr_url,
        expires_at_unix,
        flow_id,
    })
}

pub async fn tg_poll_qr_login_impl(app: tauri::AppHandle) -> Result<QrPollResult, TelegramError> {
    use tauri::Emitter;

    // SINGLE-FLIGHT: Only one poll can run at a time
    let _guard = super::QR_POLL_LOCK.lock().await;

    log::debug!("tg_poll_qr_login_impl: Polling QR login status via updates");

    // Step 1: Get current client and flow state
    let (client, flow_id, _expires_unix, updates_stream) = {
        let guard = AUTH_STATE.lock().await;
        let state = match guard.as_ref() {
            Some(s) => s,
            None => {
                return Err(TelegramError {
                    message: "No active QR session".into(),
                })
            }
        };

        // If no QR state, check if we're migrating
        let qr_state = match &state.qr_state {
            Some(qs) => qs.clone(),
            None => {
                if state.is_migrating {
                    return Ok(QrPollResult {
                        status: QrLoginStatus::Pending,
                        qr_url: None,
                        user_info: None,
                        session_data: None,
                        requires_password: false,
                        message: Some("Migration in progress...".to_string()),
                    });
                } else {
                    return Err(TelegramError {
                        message: "QR flow not started".into(),
                    });
                }
            }
        };

        // If expired by time, return Expired
        let now = Utc::now().timestamp();
        if now >= qr_state.expires_unix {
            return Ok(QrPollResult {
                status: QrLoginStatus::Expired,
                qr_url: None,
                user_info: None,
                session_data: None,
                requires_password: false,
                message: Some("QR code expired".to_string()),
            });
        }

        (
            state.client.clone(),
            state.flow_id,
            qr_state.expires_unix,
            state.updates.clone(),
        )
    };

    // Step 2: Wait for updates with short timeout (matches front-end polling interval)
    // We wait up to 900ms to allow some breathing room for the next poll
    let upd_timeout = tokio::time::timeout(
        tokio::time::Duration::from_millis(900),
        updates_stream.lock().await.recv(),
    )
    .await;

    match upd_timeout {
        Ok(Some(_upd)) => {
            // Check if this is an updateLoginToken
            // Note: In grammers, we need to inspect the update enum
            // For now, if we get ANY update, we try a second export to see if it finalized
            // This is safer than exhaustive matching if the enum variant is complex
            log::info!("tg_poll_qr_login_impl: Received update, checking login status...");

            match resolve_export_login_token(&client).await? {
                tl::enums::auth::LoginToken::Success(s) => {
                    log::info!("tg_poll_qr_login_impl: Finalized login successfully!");
                    return handle_login_success(s, flow_id).await;
                }
                tl::enums::auth::LoginToken::MigrateTo(m) => {
                    log::info!(
                        "tg_poll_qr_login_impl: Finalized to migration DC {}",
                        m.dc_id
                    );
                    return handle_dc_migration_safe(&client, m.dc_id, m.token, flow_id, app).await;
                }
                tl::enums::auth::LoginToken::Token(t) => {
                    // Token refreshed or still pending
                    let now = Utc::now().timestamp();
                    let new_expires_at = compute_expires_at(t.expires, now);

                    let mut guard = AUTH_STATE.lock().await;
                    if let Some(state) = guard.as_mut() {
                        if let Some(qr) = &mut state.qr_state {
                            if qr.token != t.token {
                                log::info!(
                                    "tg_poll_qr_login_impl: Token updated during update check"
                                );
                                qr.token = t.token.clone();
                                let token_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD
                                    .encode(&t.token);
                                qr.last_token_b64 = token_b64.clone();
                                qr.qr_url = format!("tg://login?token={}", token_b64);
                                qr.expires_unix = new_expires_at;

                                // Notify UI
                                let _ = app.emit(
                                    "qr-token-updated",
                                    serde_json::json!({
                                        "flow_id": flow_id,
                                        "qr_url": qr.qr_url,
                                        "expires_at_unix": new_expires_at,
                                    }),
                                );
                            }
                        }
                    }
                }
            }
        }
        _ => {
            // Timeout or no update yet, still pending
        }
    }

    Ok(QrPollResult {
        status: QrLoginStatus::Pending,
        qr_url: None,
        user_info: None,
        session_data: None,
        requires_password: false,
        message: None,
    })
}

// Handle LoginTokenMigrateTo by importing the token on the target DC.
async fn handle_dc_migration_safe(
    current_client: &Client,
    dc_id: i32,
    migration_token: Vec<u8>,
    flow_id: u64,
    app: tauri::AppHandle,
) -> Result<QrPollResult, TelegramError> {
    // Check if migration is already in progress
    {
        let guard = AUTH_STATE.lock().await;
        if let Some(state) = guard.as_ref() {
            if state.is_migrating {
                log::warn!("handle_dc_migration_safe: Migration already in progress, skipping");
                return Ok(QrPollResult {
                    status: QrLoginStatus::Pending,
                    qr_url: None,
                    user_info: None,
                    session_data: None,
                    requires_password: false,
                    message: Some("Migration in progress...".to_string()),
                });
            }
        }
    }

    // Mark migration in progress and switch home DC.
    let (old_home_dc, pool_handle) = {
        let mut guard = AUTH_STATE.lock().await;
        let state = guard.as_mut().ok_or_else(|| TelegramError {
            message: "No active session".into(),
        })?;

        state.is_migrating = true;
        state.qr_state = None;

        let old_home_dc = state.session.home_dc_id();
        state.session.set_home_dc_id(dc_id);
        state.current_dc_id = Some(dc_id);

        (old_home_dc, state.pool_handle.clone())
    };

    if old_home_dc != dc_id {
        let _ = pool_handle.disconnect_from_dc(old_home_dc);
    }

    log::info!(
        "handle_dc_migration_safe: Importing login token on DC {} (flow_id={})",
        dc_id,
        flow_id
    );

    let mut current_dc = dc_id;
    let mut token = migration_token;
    let mut hops: u8 = 0;

    loop {
        hops = hops.saturating_add(1);
        if hops > 5 {
            let mut guard = AUTH_STATE.lock().await;
            if let Some(state) = guard.as_mut() {
                state.is_migrating = false;
                state.session.set_home_dc_id(old_home_dc);
                state.current_dc_id = Some(old_home_dc);
            }
            return Err(TelegramError {
                message: "Too many DC migrations while importing login token".to_string(),
            });
        }

        let import_req = tl::functions::auth::ImportLoginToken { token };
        let import_result = match run_telegram_request(
            "handle_dc_migration_safe.import_login_token",
            || async { current_client.invoke_in_dc(current_dc, &import_req).await },
        )
        .await
        {
            Ok(res) => res,

            Err(e) if e.is("SESSION_PASSWORD_NEEDED") => {
                log::info!(
                    "handle_dc_migration_safe: 2FA password required after importLoginToken on DC {}",
                    current_dc
                );

                let pwd: tl::types::account::Password =
                    run_telegram_request("handle_dc_migration_safe.get_password", || async {
                        current_client
                            .invoke_in_dc(current_dc, &tl::functions::account::GetPassword {})
                            .await
                    })
                    .await
                    .map(|p| p.into())
                    .map_err(|err| TelegramError {
                        message: format!("Failed to get password info: {err}"),
                    })?;

                let password_token = PasswordToken::new(pwd);

                {
                    let mut guard = AUTH_STATE.lock().await;
                    if let Some(state) = guard.as_mut() {
                        state.password_token = Some(password_token);
                        state.qr_state = None;
                        state.is_migrating = false;
                        state.current_dc_id = Some(current_dc);
                    }
                }

                return Ok(QrPollResult {
                    status: QrLoginStatus::PasswordRequired,
                    qr_url: None,
                    user_info: None,
                    session_data: None,
                    requires_password: true,
                    message: Some(
                        "2-Step Verification enabled. Please enter your password.".to_string(),
                    ),
                });
            }

            Err(e) => {
                let msg = e.to_string();
                log::error!(
                    "handle_dc_migration_safe: Import failed on DC {}: {}",
                    current_dc,
                    msg
                );

                let mut guard = AUTH_STATE.lock().await;
                if let Some(state) = guard.as_mut() {
                    state.is_migrating = false;
                    state.session.set_home_dc_id(old_home_dc);
                    state.current_dc_id = Some(old_home_dc);
                    state.qr_state = None;
                }

                if msg.contains("AUTH_TOKEN_EXPIRED") {
                    return Ok(QrPollResult {
                        status: QrLoginStatus::Expired,
                        qr_url: None,
                        user_info: None,
                        session_data: None,
                        requires_password: false,
                        message: Some(
                            "Login token expired during DC migration. Please generate a new QR code."
                                .to_string(),
                        ),
                    });
                }

                return Err(TelegramError {
                    message: format!("Failed to import login token on DC {}: {}", current_dc, e),
                });
            }
        };

        match import_result {
            tl::enums::auth::LoginToken::Success(s) => {
                {
                    let mut guard = AUTH_STATE.lock().await;
                    if let Some(state) = guard.as_mut() {
                        state.is_migrating = false;
                        state.current_dc_id = Some(current_dc);
                    }
                }
                return handle_login_success(s, flow_id).await;
            }

            tl::enums::auth::LoginToken::Token(t) => {
                log::info!(
                    "handle_dc_migration_safe: Imported token on DC {}, pending scan",
                    current_dc
                );
                let now = Utc::now().timestamp();
                let new_expires_at = compute_expires_at(t.expires, now);
                let new_token_b64 =
                    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&t.token);
                let new_qr_url = format!("tg://login?token={}", new_token_b64);

                {
                    let mut guard = AUTH_STATE.lock().await;
                    if let Some(state) = guard.as_mut() {
                        state.qr_state = Some(QrState {
                            token: t.token,
                            qr_url: new_qr_url.clone(),
                            expires_unix: new_expires_at,
                            last_token_b64: new_token_b64,
                            api_hash: get_api_hash().to_string(),
                            started_at_unix: now,
                        });
                        state.is_migrating = false;
                        state.current_dc_id = Some(current_dc);
                    }
                }

                let _ = app.emit(
                    "qr-token-updated",
                    serde_json::json!({
                        "flow_id": flow_id,
                        "qr_url": new_qr_url,
                        "expires_at_unix": new_expires_at,
                    }),
                );

                return Ok(QrPollResult {
                    status: QrLoginStatus::Pending,
                    qr_url: Some(new_qr_url),
                    user_info: None,
                    session_data: None,
                    requires_password: false,
                    message: Some(format!("Switched to server DC{}", current_dc)),
                });
            }

            tl::enums::auth::LoginToken::MigrateTo(m) => {
                log::info!(
                    "handle_dc_migration_safe: Server requested another migration to DC {}",
                    m.dc_id
                );
                let prev_dc = current_dc;
                current_dc = m.dc_id;
                token = m.token;

                {
                    let mut guard = AUTH_STATE.lock().await;
                    if let Some(state) = guard.as_mut() {
                        state.session.set_home_dc_id(current_dc);
                        state.current_dc_id = Some(current_dc);
                    }
                }

                if prev_dc != current_dc {
                    let _ = pool_handle.disconnect_from_dc(prev_dc);
                }

                continue;
            }
        }
    }
}

// Added helper to handle login success response
async fn handle_login_success(
    s: tl::types::auth::LoginTokenSuccess,
    _flow_id: u64,
) -> Result<QrPollResult, TelegramError> {
    let user = match s.authorization {
        tl::enums::auth::Authorization::Authorization(a) => match a.user {
            tl::enums::User::User(u) => u,
            _ => {
                return Err(TelegramError {
                    message: "Unexpected user type on success".into(),
                })
            }
        },
        _ => {
            return Err(TelegramError {
                message: "Sign-up required or other authorization error".into(),
            })
        }
    };

    // Lock and update
    let (encoded_session, user_id) = {
        let mut guard = AUTH_STATE.lock().await;
        let state = match guard.as_mut() {
            Some(s) => s,
            None => {
                return Err(TelegramError {
                    message: "Session lost during success".into(),
                })
            }
        };

        let encoded = encode_session(&state.session);
        state.qr_state = None; // clear QR state
        state.login_token = None;
        (encoded, user.id)
    };

    log::info!("handle_login_success: Success for user_id={}", user_id);

    Ok(QrPollResult {
        status: QrLoginStatus::Success,
        qr_url: None,
        user_info: Some(UserInfo {
            id: user.id,
            username: user.username.map(|s| s.to_string()),
            first_name: user.first_name.map(|s| s.to_string()),
            last_name: user.last_name.map(|s| s.to_string()),
            profile_photo: None,
        }),
        session_data: Some(encoded_session),
        requires_password: false,
        message: None,
    })
}

pub async fn tg_sign_in_with_password_impl(
    password: String,
    db: Database,
) -> Result<TelegramAuthResult, TelegramError> {
    let pwd = password.trim().to_string();
    log::info!("tg_sign_in_with_password_impl: start (len={})", pwd.len());

    // Pull what we need without holding lock across awaits
    let (client, session, password_token, stored_phone, flow_id) = {
        let mut guard = AUTH_STATE.lock().await;

        let state = guard.as_mut().ok_or_else(|| TelegramError {
            message: "No active auth session. Start sign-in first.".into(),
        })?;

        log::info!(
            "tg_sign_in_with_password_impl: state ok (has_password_token={}, phone={:?}, flow_id={})",
            state.password_token.is_some(),
            state.phone_number,
            state.flow_id
        );

        let token = state.password_token.take().ok_or_else(|| TelegramError {
            message: "No password token available. Call sign-in with code first.".into(),
        })?;

        (
            state.client.clone(),
            Arc::clone(&state.session),
            token,
            state.phone_number.clone(),
            state.flow_id,
        )
    };

    if pwd.is_empty() {
        // restore token so user can retry
        let mut guard = AUTH_STATE.lock().await;
        if let Some(state) = guard.as_mut() {
            state.password_token = Some(password_token);
        }
        return Err(TelegramError {
            message: "Empty password".into(),
        });
    }

    log::info!(
        "tg_sign_in_with_password_impl: attempting check_password (phone={:?}, flow_id={})",
        stored_phone,
        flow_id
    );

    // PasswordToken is Clone, keep a copy so user can retry on failure.
    let password_token_retry = password_token.clone();
    let check = run_telegram_request("tg_sign_in_with_password_impl.check_password", || async {
        client
            .check_password(password_token.clone(), pwd.as_bytes())
            .await
    })
    .await;

    match check {
        Ok(_user) => {
            log::info!("tg_sign_in_with_password_impl: check_password OK");

            let me = run_telegram_request("tg_sign_in_with_password_impl.get_me", || async {
                client.get_me().await
            })
            .await
            .map_err(|e| TelegramError {
                message: format!("Failed to get user info: {e}"),
            })?;

            log::info!(
                "tg_sign_in_with_password_impl: get_me OK id={} username={:?}",
                me.raw.id(),
                me.username()
            );

            // Encode session data
            let encoded_session = encode_session(&session);
            log::info!(
                "tg_sign_in_with_password_impl: encode_session len={} empty={}",
                encoded_session.len(),
                encoded_session.trim().is_empty()
            );

            // Save session to database directly from Rust
            // Phone-based login already has the phone. For QR login, try to get the phone from Telegram.
            let phone_for_db = stored_phone
                .clone()
                .or_else(|| {
                    me.phone().map(|p| {
                        if p.starts_with('+') {
                            p.to_string()
                        } else {
                            format!("+{}", p)
                        }
                    })
                })
                .unwrap_or_else(|| format!("user:{}", me.raw.id()));

            match db.create_session(
                &phone_for_db,
                Some(&encoded_session),
                None,
                me.first_name(),
                me.last_name(),
                me.username(),
            ) {
                Ok(session_id) => {
                    log::info!(
                        "tg_sign_in_with_password_impl: Session saved to database successfully with ID: {}",
                        session_id
                    );
                }
                Err(e) => {
                    log::error!(
                        "tg_sign_in_with_password_impl: Failed to save session to database: {}",
                        e.message
                    );
                }
            }

            // Success: clear tokens
            let mut guard = AUTH_STATE.lock().await;
            if let Some(state) = guard.as_mut() {
                state.login_token = None;
                state.password_token = None;
            }

            Ok(TelegramAuthResult {
                authorized: true,
                session_data: Some(encoded_session),
                user_info: Some(UserInfo {
                    id: me.raw.id(),
                    username: me.username().map(|s| s.to_string()),
                    first_name: me.first_name().map(|s| s.to_string()),
                    last_name: me.last_name().map(|s| s.to_string()),
                    profile_photo: None,
                }),
                requires_password: false,
            })
        }

        Err(e) => {
            log::error!(
                "tg_sign_in_with_password_impl: check_password FAILED: {}",
                e
            );

            // Restore token so user can retry password
            let mut guard = AUTH_STATE.lock().await;
            if let Some(state) = guard.as_mut() {
                state.password_token = Some(password_token_retry);
            }

            // Better human message
            let msg = e.to_string().to_lowercase();
            if msg.contains("password_hash_invalid") || msg.contains("invalid") {
                return Err(TelegramError {
                    message: "Wrong 2FA password.".into(),
                });
            }

            Err(TelegramError {
                message: format!("Password authentication failed: {e}"),
            })
        }
    }
}
// Cancel active QR login flow
#[allow(dead_code)]
pub async fn tg_cancel_qr_login_impl() -> Result<bool, TelegramError> {
    let mut guard = AUTH_STATE.lock().await;

    if let Some(state) = guard.as_mut() {
        if state.qr_state.is_some() {
            log::info!(
                "tg_cancel_qr_login_impl: Cancelling QR flow (flow_id={})",
                state.flow_id
            );
            state.qr_state = None;
            return Ok(true);
        }
    }

    log::debug!("tg_cancel_qr_login_impl: No active QR flow to cancel");
    Ok(false)
}

// Restore missing handle_already_authorized function
#[allow(deprecated)]
async fn handle_already_authorized(
    client: Client,
    session: Arc<TlSession>,
    _flow_id: u64,
) -> Result<QrLoginData, TelegramError> {
    let user = run_telegram_request("handle_already_authorized.get_me", || async {
        client.get_me().await
    })
    .await
    .map_err(|e| TelegramError {
        message: format!("Failed to get authorized user: {}", e),
    })?;

    let _encoded_session = encode_session(&session);

    log::info!(
        "handle_already_authorized: Already logged in as user_id={}",
        user.raw.id()
    );

    // Clear QR state since we're already authorized
    let mut guard = AUTH_STATE.lock().await;
    if let Some(state) = guard.as_mut() {
        state.qr_state = None;
    }

    // Return error to indicate flow finished (or we could change return type to Result<Enum, Error>)
    // For now, mirroring previous behavior: return error "Already authorized"
    Err(TelegramError {
        message: "Already authorized".to_string(),
    })
}
