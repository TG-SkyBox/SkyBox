use super::{run_telegram_request, TelegramError, AUTH_STATE};
use tokio::time::{timeout, Duration};

pub async fn tg_ping_impl() -> Result<bool, TelegramError> {
    let client = {
        let guard = AUTH_STATE.lock().await;
        let state = guard.as_ref().ok_or_else(|| TelegramError {
            message: "Not authorized".to_string(),
        })?;
        state.client.clone()
    };

    let result = timeout(Duration::from_secs(3), async {
        run_telegram_request("tg_ping_impl.get_me", || async { client.get_me().await }).await
    })
    .await
    .map_err(|_| TelegramError {
        message: "Connection check timed out".to_string(),
    })?;

    result
        .map(|_| true)
        .map_err(|e| TelegramError {
            message: format!("Connection check failed: {e}"),
        })
}

