// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use std::sync::Arc;
use once_cell::sync::Lazy;
use tokio::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

mod fs;
mod db;
mod telegram;
mod utils;

use db::Database;

// Global state for the Telegram client during authentication
static TG_CLIENT_STATE: Lazy<Arc<Mutex<Option<grammers_client::Client>>>> = 
    Lazy::new(|| Arc::new(Mutex::new(None)));

// Track if disconnect is already in progress
static DISCONNECT_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load environment variables from .env file (if it exists)
    // This will not override real environment variables
    dotenv::dotenv().ok();
    
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            // FS Commands
            fs::read_directory,
            fs::read_file,
            fs::write_file,
            fs::create_directory,
            fs::delete_file,
            fs::rename_file,
            fs::copy_file,
            fs::move_file,
            fs::get_file_info,
            fs::search_files,

            // DB Commands
            db::db_get_setting,
            db::db_set_setting,
            db::db_get_recent_paths,
            db::db_add_recent_path,
            db::db_get_favorites,
            db::db_add_favorite,
            db::db_remove_favorite,
            db::db_get_session,
            db::db_create_session,
            db::db_update_session_profile_photo,
            db::db_update_session_user_info,
            db::db_clear_session,

            // Telegram Commands
            telegram::tg_request_auth_code,
            telegram::tg_sign_in_with_code,
            telegram::tg_sign_in_with_password,
            telegram::tg_generate_qr_code,
            telegram::tg_poll_qr_login,
            telegram::tg_restore_session,
            telegram::tg_logout,
            telegram::tg_get_my_profile_photo,
            telegram::tg_index_saved_messages,
            telegram::tg_get_indexed_saved_messages,
            telegram::tg_list_saved_items,
            telegram::tg_list_saved_items_page,
            telegram::tg_backfill_saved_messages_batch,
            telegram::tg_rebuild_saved_items_index,
            telegram::tg_create_saved_folder,
            telegram::tg_move_saved_item,
            telegram::tg_move_saved_item_to_recycle_bin,
            telegram::tg_restore_saved_item,
            telegram::tg_delete_saved_item_permanently,
            telegram::tg_rename_saved_item,
            telegram::tg_send_saved_note_message,
            telegram::tg_edit_saved_note_message,
            telegram::tg_get_message_thumbnail,
            telegram::tg_prefetch_message_thumbnails,
            telegram::tg_download_saved_file,
            telegram::tg_cancel_saved_file_download,
            telegram::tg_cancel_saved_file_upload,
            telegram::tg_prepare_saved_media_preview,
            telegram::tg_upload_file_to_saved_messages,

            // Logger Commands
            utils::logger::log_debug,
            utils::logger::log_info,
            utils::logger::log_warn,
            utils::logger::log_error,
        ])
        .setup(|app| {
            // Initialize database
            let db = Database::new().expect("Failed to create database");
            app.manage(db);

            // Initialize global Telegram client state
            app.manage(Arc::clone(&TG_CLIENT_STATE));

            Ok(())
        })
        .on_window_event(|_window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { .. } => {
                    // Check if disconnect is already in progress
                    if DISCONNECT_IN_PROGRESS.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed).is_ok() {
                        // Disconnect Telegram client in background without preventing window close
                        tauri::async_runtime::spawn(async move {
                            // Disconnect the Telegram client connection gracefully
                            telegram::disconnect_client().await;
                            
                            // Reset the disconnect flag
                            DISCONNECT_IN_PROGRESS.store(false, Ordering::Release);
                        });
                    }
                    // Allow window to close immediately - disconnect happens in background
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
