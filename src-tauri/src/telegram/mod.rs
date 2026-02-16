use serde::{Deserialize, Serialize};
use grammers_client::{Client, SignInError};
use grammers_client::types::{LoginToken, PasswordToken};
#[allow(deprecated)]
use grammers_session::storages::TlSession;
use grammers_mtsender::SenderPoolHandle;
use tokio::task::JoinHandle;
use tokio::sync::{Mutex, mpsc::UnboundedReceiver};
use once_cell::sync::Lazy;
use std::sync::Arc;
use std::sync::atomic::AtomicU64;
use log;
use once_cell::sync::OnceCell;
use std::env;
use tauri::State;

// Global mutex to ensure single-flight QR polling
pub(crate) static QR_POLL_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

// ===== Database access =====
pub use crate::db::Database;

// ===== Flow tracking =====

pub static AUTH_FLOW_ID: AtomicU64 = AtomicU64::new(0);

// ===== Models =====

#[derive(Debug, Serialize, Deserialize)]
pub struct TelegramError {
    pub message: String,
}

impl std::fmt::Display for TelegramError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for TelegramError {}

#[derive(Debug, Serialize, Deserialize)]
pub struct TelegramAuthData {
    pub phone_number: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TelegramAuthResult {
    pub authorized: bool,
    pub session_data: Option<String>,
    pub user_info: Option<UserInfo>,
    pub requires_password: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: i64,
    pub username: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub profile_photo: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QrLoginData {
    pub qr_url: String,
    pub expires_at_unix: i64,
    pub flow_id: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QrPollResult {
    pub status: QrLoginStatus,
    pub qr_url: Option<String>,
    pub user_info: Option<UserInfo>,
    pub session_data: Option<String>,
    pub requires_password: bool,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum QrLoginStatus {
    Pending,
    Success,
    Expired,
    PasswordRequired,
    Error,
}

#[derive(Debug, Clone)]
pub struct QrState {
    #[allow(dead_code)]
    pub token: Vec<u8>,
    #[allow(dead_code)]
    pub qr_url: String,
    #[allow(dead_code)]
    pub expires_unix: i64,
    pub last_token_b64: String,
    #[allow(dead_code)]
    pub api_hash: String,
    #[allow(dead_code)]
    pub started_at_unix: i64,
}

// ===== Global auth state =====


pub(crate) struct AuthState {
    pub client: Client,
    #[allow(deprecated)]
    pub session: Arc<TlSession>,

    pub pool_handle: SenderPoolHandle,
    pub pool_task: JoinHandle<()>,
    pub updates: Arc<Mutex<UnboundedReceiver<grammers_client::client::updates::UpdatesLike>>>,

    pub login_token: Option<LoginToken>,
    pub password_token: Option<PasswordToken>,
    // NEW: add flow tracking
    pub phone_number: Option<String>,
    pub flow_id: u64,
    
    // QR Login state
    pub qr_state: Option<QrState>,
    // Migration state to prevent concurrent migrations
    pub is_migrating: bool,
    // Current DC ID for this session
    pub current_dc_id: Option<i32>,
}


pub(crate) static AUTH_STATE: Lazy<Mutex<Option<AuthState>>> = Lazy::new(|| Mutex::const_new(None));

// ===== Constants =====
// Dev builds: read from runtime env (dotenvy loads .env)
// Release builds: embedded at compile time from build environment (GitHub Actions secrets)

static API_ID_CELL: OnceCell<i32> = OnceCell::new();
static API_HASH_CELL: OnceCell<String> = OnceCell::new();

#[cfg(debug_assertions)]
fn load_api_credentials() -> (i32, String) {
    // Only for dev builds: load .env if present
    let _ = dotenv::dotenv();

    let api_id_str = env::var("TELEGRAM_API_ID")
        .expect("TELEGRAM_API_ID is required in dev (.env)");
    let api_id = api_id_str.parse::<i32>()
        .expect("TELEGRAM_API_ID must be an integer");

    let api_hash = env::var("TELEGRAM_API_HASH")
        .expect("TELEGRAM_API_HASH is required in dev (.env)");

    if api_hash.is_empty() {
        panic!("TELEGRAM_API_HASH cannot be empty");
    }

    log::info!("Telegram API creds loaded from .env/runtime env (dev)");
    (api_id, api_hash)
}

#[cfg(not(debug_assertions))]
fn load_api_credentials() -> (i32, String) {
    // Embed as string literals at compile time (baked into binary)
    const API_ID_STR: &str = env!("TELEGRAM_API_ID");
    const API_HASH_STR: &str = env!("TELEGRAM_API_HASH");

    let api_id = API_ID_STR.parse::<i32>()
        .expect("Invalid TELEGRAM_API_ID in build env (must be integer)");

    if API_HASH_STR.is_empty() {
        panic!("TELEGRAM_API_HASH cannot be empty (build env)");
    }

    log::info!("Telegram API creds embedded at build time (release)");
    (api_id, API_HASH_STR.to_string())
}

pub fn get_api_id() -> i32 {
    *API_ID_CELL.get_or_init(|| load_api_credentials().0)
}

pub fn get_api_hash() -> &'static str {
    API_HASH_CELL.get_or_init(|| load_api_credentials().1).as_str()
}
// ===== Modules =====

pub mod utils;
mod login;
mod session;
mod photo;
pub mod messages;

// ===== Re-export implementation functions =====

use login::{
    tg_request_auth_code_impl,
    tg_sign_in_with_code_impl,
    tg_sign_in_with_password_impl,
    tg_generate_qr_code_impl,
    tg_poll_qr_login_impl,
    tg_cancel_qr_login_impl,
};

use session::{
    tg_restore_session_impl,
    tg_logout_impl,
};

use photo::{
    tg_get_my_profile_photo_impl,
};

use messages::{
    tg_index_saved_messages_impl,
    tg_get_indexed_saved_messages_impl,
    tg_list_saved_items_impl,
    tg_list_saved_items_page_impl,
    tg_backfill_saved_messages_batch_impl,
    tg_rebuild_saved_items_index_impl,
    tg_create_saved_folder_impl,
    tg_get_message_thumbnail_impl,
    tg_upload_file_to_saved_messages_impl,
};

// ===== Tauri Commands =====

#[tauri::command]
pub async fn tg_request_auth_code(auth_data: TelegramAuthData) -> Result<TelegramAuthResult, TelegramError> {
    tg_request_auth_code_impl(auth_data).await
}

#[tauri::command]
pub async fn tg_sign_in_with_code(phone_code: String) -> Result<TelegramAuthResult, TelegramError> {
    tg_sign_in_with_code_impl(phone_code).await
}

#[tauri::command]
pub async fn tg_sign_in_with_password(password: String, state: tauri::State<'_, Database>) -> Result<TelegramAuthResult, TelegramError> {
    tg_sign_in_with_password_impl(password, state.inner().clone()).await
}

#[tauri::command]
pub async fn tg_generate_qr_code(app: tauri::AppHandle) -> Result<QrLoginData, TelegramError> {
    tg_generate_qr_code_impl(app).await
}

#[tauri::command]
pub async fn tg_poll_qr_login(app: tauri::AppHandle) -> Result<QrPollResult, TelegramError> {
    tg_poll_qr_login_impl(app).await
}

#[tauri::command]
#[allow(dead_code)]
pub async fn tg_cancel_qr_login() -> Result<bool, TelegramError> {
    tg_cancel_qr_login_impl().await
}

#[tauri::command]
pub async fn tg_restore_session(db: State<'_, crate::db::Database>, session_data: String) -> Result<TelegramAuthResult, TelegramError> {
    tg_restore_session_impl(db, session_data).await
}

#[tauri::command]
pub async fn tg_logout() -> Result<bool, TelegramError> {
    tg_logout_impl().await
}

#[tauri::command]
pub async fn tg_get_my_profile_photo(db: State<'_, crate::db::Database>) -> Result<Option<String>, TelegramError> {
    tg_get_my_profile_photo_impl(db).await
}

#[tauri::command]
pub async fn tg_index_saved_messages(db: State<'_, crate::db::Database>) -> Result<serde_json::Value, TelegramError> {
    tg_index_saved_messages_impl(db.inner().clone()).await
}

#[tauri::command]
pub async fn tg_get_indexed_saved_messages(db: State<'_, crate::db::Database>, category: String) -> Result<Vec<crate::db::TelegramMessage>, TelegramError> {
    tg_get_indexed_saved_messages_impl(db.inner().clone(), category).await
}

#[tauri::command]
pub async fn tg_list_saved_items(
    db: State<'_, crate::db::Database>,
    file_path: String,
) -> Result<Vec<crate::db::TelegramSavedItem>, TelegramError> {
    tg_list_saved_items_impl(db.inner().clone(), file_path).await
}

#[tauri::command]
pub async fn tg_list_saved_items_page(
    db: State<'_, crate::db::Database>,
    file_path: String,
    offset: i64,
    limit: i64,
) -> Result<serde_json::Value, TelegramError> {
    tg_list_saved_items_page_impl(db.inner().clone(), file_path, offset, limit).await
}

#[tauri::command]
pub async fn tg_backfill_saved_messages_batch(
    db: State<'_, crate::db::Database>,
    batch_size: Option<i32>,
) -> Result<serde_json::Value, TelegramError> {
    tg_backfill_saved_messages_batch_impl(db.inner().clone(), batch_size).await
}

#[tauri::command]
pub async fn tg_rebuild_saved_items_index(
    db: State<'_, crate::db::Database>,
) -> Result<serde_json::Value, TelegramError> {
    tg_rebuild_saved_items_index_impl(db.inner().clone()).await
}

#[tauri::command]
pub async fn tg_create_saved_folder(
    db: State<'_, crate::db::Database>,
    parent_path: String,
    folder_name: String,
) -> Result<crate::db::TelegramSavedItem, TelegramError> {
    tg_create_saved_folder_impl(db.inner().clone(), parent_path, folder_name).await
}

#[tauri::command]
pub async fn tg_get_message_thumbnail(db: State<'_, crate::db::Database>, message_id: i32) -> Result<Option<String>, TelegramError> {
    tg_get_message_thumbnail_impl(db.inner().clone(), message_id).await
}

#[tauri::command]
pub async fn tg_upload_file_to_saved_messages(
    db: State<'_, crate::db::Database>,
    file_name: String,
    file_bytes: Vec<u8>,
    file_path: Option<String>,
) -> Result<crate::db::TelegramMessage, TelegramError> {
    tg_upload_file_to_saved_messages_impl(db.inner().clone(), file_name, file_bytes, file_path).await
}

// ===== Utility Functions =====

// Function to disconnect the Telegram client gracefully when the app closes
pub async fn disconnect_client() {
    log::info!("Disconnecting Telegram client in background...");
    
    // Check if there's an active QR login flow
    {
        let guard = AUTH_STATE.lock().await;
        if let Some(state) = guard.as_ref() {
            if state.qr_state.is_some() {
                log::warn!("disconnect_client: QR login flow is active (flow_id={}), skipping disconnect to prevent interruption", state.flow_id);
                return;
            }
        }
    }
    
    // Take the current state out so we can drop/stop it cleanly
    let state = {
        let mut guard = AUTH_STATE.lock().await;
        guard.take()
    };

    match state {
        Some(state) => {
            log::info!("Found active Telegram client, initiating disconnect sequence...");
            
            // Stop the sender pool first (non-blocking)
            state.pool_handle.quit();
            state.pool_task.abort();
            
            log::info!("Pool stopped, disconnecting client...");
            
            // Disconnect the client gracefully
            state.client.disconnect();
            
            log::info!("Client disconnect initiated");
            
            // Give a small delay to ensure cleanup completes
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            
            log::info!("Telegram client disconnected successfully");
        },
        None => {
            log::info!("No active Telegram client to disconnect");
        }
    }
}
