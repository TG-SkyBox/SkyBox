use super::TelegramError;
#[allow(deprecated)]
use super::{get_api_id, Client, TlSession};
use grammers_client::client::updates::UpdatesLike;
use grammers_mtsender::{SenderPool, SenderPoolHandle};
use std::sync::Arc;
use tokio::sync::{mpsc::UnboundedReceiver, Mutex};
use tokio::task::JoinHandle;

use base64::Engine;

// Helper function to encode session
#[allow(deprecated)]
pub fn encode_session(session: &TlSession) -> String {
    let bytes = session.save();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

// Helper function to decode session
#[allow(deprecated)]
pub fn decode_session(session_data: &str) -> Result<TlSession, TelegramError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(session_data)
        .map_err(|e| TelegramError {
            message: format!("Failed to decode session data: {e}"),
        })?;

    TlSession::load(&bytes).map_err(|e| TelegramError {
        message: format!("Failed to load TlSession: {e}"),
    })
}

// Create a client using a given TlSession storage.

pub struct BuiltClient {
    pub client: Client,
    pub pool_handle: SenderPoolHandle,
    pub pool_task: JoinHandle<()>,
    pub updates: Arc<Mutex<UnboundedReceiver<UpdatesLike>>>,
}

#[allow(deprecated)]
pub fn build_client(session: Arc<TlSession>) -> BuiltClient {
    let pool = SenderPool::new(Arc::clone(&session), get_api_id());

    // Client::new connects "logically", but needs the runner to actually do I/O.
    let client = Client::new(&pool);

    // Move the runner out and KEEP IT RUNNING.
    let SenderPool {
        runner,
        handle,
        updates,
    } = pool;

    let pool_task = tokio::spawn(runner.run());

    BuiltClient {
        client,
        pool_handle: handle,
        pool_task,
        updates: Arc::new(Mutex::new(updates)),
    }
}
