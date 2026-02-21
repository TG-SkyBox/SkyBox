use log;

#[tauri::command]
pub fn log_debug(message: String) {
    log::debug!("[React] {}", message);
}

#[tauri::command]
pub fn log_info(message: String) {
    log::info!("[React] {}", message);
}

#[tauri::command]
pub fn log_warn(message: String) {
    log::warn!("[React] {}", message);
}

#[tauri::command]
pub fn log_error(message: String) {
    log::error!("[React] {}", message);
}
