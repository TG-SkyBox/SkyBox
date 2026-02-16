use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::State;
use sqlite::{Connection, State as SqliteState};
use std::path::PathBuf;
use std::fs;
use directories::ProjectDirs;
// Helper function to get the app data directory
fn get_app_data_dir() -> Result<PathBuf, DbError> {
    let project_dirs = ProjectDirs::from("com", "skybox", "Skybox")
        .ok_or_else(|| DbError {
            message: "Failed to get project directories".to_string(),
        })?;
    
    let data_dir = project_dirs.data_local_dir();
    
    // Create the directory if it doesn't exist
    fs::create_dir_all(data_dir)
        .map_err(|e| DbError {
            message: format!("Failed to create app data directory: {}", e),
        })?;
    
    Ok(data_dir.to_path_buf())
}

// Helper function to get the full database path
fn get_database_path() -> Result<PathBuf, DbError> {
    let app_data_dir = get_app_data_dir()?;
    Ok(app_data_dir.join("Skybox.db"))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DbError {
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Session {
    pub id: i32,
    pub phone: String,
    pub session_data: Option<String>,  // Store the actual session data
    pub profile_photo: Option<String>, // Store profile photo data URL
    pub first_name: Option<String>,    // User's first name
    pub last_name: Option<String>,     // User's last name
    pub username: Option<String>,      // User's username
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct Setting {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecentPath {
    pub id: i32,
    pub path: String,
    pub last_opened: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Favorite {
    pub id: i32,
    pub path: String,
    pub label: String,
}



#[derive(Debug, Serialize, Deserialize)]
pub struct TelegramMessage {
    pub message_id: i32,
    pub chat_id: i64,
    pub category: String,
    pub filename: Option<String>,
    pub extension: Option<String>,
    pub mime_type: Option<String>,
    pub timestamp: String,
    pub size: Option<i64>,
    pub text: Option<String>,
    pub thumbnail: Option<String>,
    pub file_reference: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TelegramSavedItem {
    pub chat_id: i64,
    pub message_id: i32,
    pub thumbnail: Option<String>,
    pub file_type: String,
    pub file_unique_id: String,
    pub file_size: i64,
    pub file_name: String,
    pub file_caption: Option<String>,
    pub file_path: String,
    pub modified_date: String,
    pub owner_id: String,
}

#[derive(Clone)]
pub struct Database(Arc<Mutex<Connection>>);

impl Database {
    pub fn new() -> Result<Self, DbError> {
        let db_path = get_database_path()?;
        let conn = Connection::open(&db_path)
            .map_err(|e| DbError {
                message: format!("Failed to open database at {}: {}", db_path.display(), e),
            })?;

        // Create tables
        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )",
        ).map_err(|e| DbError {
            message: format!("Failed to create settings table: {}", e),
        })?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS recent_paths (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL,
                last_opened TEXT NOT NULL
            )",
        ).map_err(|e| DbError {
            message: format!("Failed to create recent_paths table: {}", e),
        })?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS favorites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL,
                label TEXT NOT NULL
            )",
        ).map_err(|e| DbError {
            message: format!("Failed to create favorites table: {}", e),
        })?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS session (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL,
                session_data TEXT,
                created_at TEXT NOT NULL
            )",
        ).map_err(|e| DbError {
            message: format!("Failed to create session table: {}", e),
        })?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS telegram_messages (
                message_id INTEGER NOT NULL,
                chat_id INTEGER NOT NULL,
                category TEXT NOT NULL,
                filename TEXT,
                extension TEXT,
                mime_type TEXT,
                timestamp TEXT NOT NULL,
                size INTEGER,
                text TEXT,
                thumbnail TEXT,
                file_reference TEXT NOT NULL,
                PRIMARY KEY (message_id, chat_id)
            )",
        ).map_err(|e| DbError {
            message: format!("Failed to create telegram_messages table: {}", e),
        })?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS telegram_saved_items (
                file_unique_id TEXT PRIMARY KEY,
                chat_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                thumbnail TEXT,
                file_type TEXT NOT NULL,
                file_size INTEGER NOT NULL DEFAULT 0,
                file_name TEXT NOT NULL,
                file_caption TEXT,
                file_path TEXT NOT NULL,
                modified_date TEXT NOT NULL,
                owner_id TEXT NOT NULL
            )",
        ).map_err(|e| DbError {
            message: format!("Failed to create telegram_saved_items table: {}", e),
        })?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_telegram_saved_items_owner_path ON telegram_saved_items (owner_id, file_path)",
        ).map_err(|e| DbError {
            message: format!("Failed to create telegram_saved_items index: {}", e),
        })?;

        // Migration: Add missing columns if they don't exist
        let columns_to_add = [
            ("profile_photo", "TEXT"),
            ("first_name", "TEXT"),
            ("last_name", "TEXT"),
            ("username", "TEXT"),
        ];

        for (col_name, col_type) in columns_to_add {
            let check_query = format!("PRAGMA table_info(session)");
            let mut statement = conn.prepare(&check_query).map_err(|e| DbError {
                message: format!("Failed to prepare pragma check: {}", e),
            })?;
            
            let mut exists = false;
            while let Ok(SqliteState::Row) = statement.next() {
                let name: String = statement.read(1).unwrap_or_default();
                if name == col_name {
                    exists = true;
                    break;
                }
            }

            if !exists {
                println!("[DB DEBUG] Migrating session table: Adding column {}", col_name);
                let alter_query = format!("ALTER TABLE session ADD COLUMN {} {}", col_name, col_type);
                conn.execute(&alter_query).map_err(|e| DbError {
                    message: format!("Failed to migrate session table (adding {}): {}", col_name, e),
                })?;
            }
        }

        Ok(Database(Mutex::new(conn).into()))
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, DbError> {
        let conn = self.0.lock().unwrap();
        
        let mut statement = conn.prepare("SELECT value FROM settings WHERE key = ?")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;
        statement.bind((1, key)).map_err(|e| DbError {
            message: format!("Failed to bind parameter: {}", e),
        })?;

        match statement.next() {
            Ok(SqliteState::Row) => {
                let value: String = statement.read::<String, usize>(0)
                    .map_err(|e| DbError {
                        message: format!("Failed to read value: {}", e),
                    })?;
                Ok(Some(value))
            }
            Ok(SqliteState::Done) => Ok(None),
            Err(e) => Err(DbError {
                message: format!("Failed to get setting: {}", e),
            }),
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), DbError> {
        let conn = self.0.lock().unwrap();
        
        let mut statement = conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;
        statement.bind((1, key)).map_err(|e| DbError {
            message: format!("Failed to bind key parameter: {}", e),
        })?;
        statement.bind((2, value)).map_err(|e| DbError {
            message: format!("Failed to bind value parameter: {}", e),
        })?;

        statement.next().map_err(|e| DbError {
            message: format!("Failed to execute statement: {}", e),
        })?;

        Ok(())
    }

    pub fn get_recent_paths(&self, limit: i32) -> Result<Vec<RecentPath>, DbError> {
        let conn = self.0.lock().unwrap();
        
        let mut statement = conn.prepare("SELECT id, path, last_opened FROM recent_paths ORDER BY last_opened DESC LIMIT ?")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;
        statement.bind((1, limit as i64)).map_err(|e| DbError {
            message: format!("Failed to bind limit parameter: {}", e),
        })?;

        let mut paths = Vec::new();
        while let SqliteState::Row = statement.next().map_err(|e| DbError {
            message: format!("Failed to query recent paths: {}", e),
        })? {
            let id: i32 = statement.read::<i64, usize>(0).map(|v| v as i32)
                .map_err(|e| DbError {
                    message: format!("Failed to read id: {}", e),
                })?;
            let path: String = statement.read::<String, usize>(1)
                .map_err(|e| DbError {
                    message: format!("Failed to read path: {}", e),
                })?;
            let last_opened: String = statement.read::<String, usize>(2)
                .map_err(|e| DbError {
                    message: format!("Failed to read last_opened: {}", e),
                })?;
            
            paths.push(RecentPath {
                id,
                path,
                last_opened,
            });
        }

        Ok(paths)
    }

    pub fn add_recent_path(&self, path: &str) -> Result<(), DbError> {
        let conn = self.0.lock().unwrap();
        
        let mut statement = conn.prepare("INSERT INTO recent_paths (path, last_opened) VALUES (?, datetime('now'))")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;
        statement.bind((1, path)).map_err(|e| DbError {
            message: format!("Failed to bind path parameter: {}", e),
        })?;

        statement.next().map_err(|e| DbError {
            message: format!("Failed to execute statement: {}", e),
        })?;

        Ok(())
    }

    pub fn get_favorites(&self) -> Result<Vec<Favorite>, DbError> {
        let conn = self.0.lock().unwrap();
        
        let mut statement = conn.prepare("SELECT id, path, label FROM favorites")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;

        let mut favorites = Vec::new();
        while let SqliteState::Row = statement.next().map_err(|e| DbError {
            message: format!("Failed to query favorites: {}", e),
        })? {
            let id: i32 = statement.read::<i64, usize>(0).map(|v| v as i32)
                .map_err(|e| DbError {
                    message: format!("Failed to read id: {}", e),
                })?;
            let path: String = statement.read::<String, usize>(1)
                .map_err(|e| DbError {
                    message: format!("Failed to read path: {}", e),
                })?;
            let label: String = statement.read::<String, usize>(2)
                .map_err(|e| DbError {
                    message: format!("Failed to read label: {}", e),
                })?;
            
            favorites.push(Favorite {
                id,
                path,
                label,
            });
        }

        Ok(favorites)
    }

    pub fn add_favorite(&self, path: &str, label: &str) -> Result<i32, DbError> {
        let conn = self.0.lock().unwrap();
        
        let mut statement = conn.prepare("INSERT INTO favorites (path, label) VALUES (?, ?)")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;
        statement.bind((1, path)).map_err(|e| DbError {
            message: format!("Failed to bind path parameter: {}", e),
        })?;
        statement.bind((2, label)).map_err(|e| DbError {
            message: format!("Failed to bind label parameter: {}", e),
        })?;

        statement.next().map_err(|e| DbError {
            message: format!("Failed to execute statement: {}", e),
        })?;

        // Get the last inserted ID using a separate query since sqlite crate doesn't expose last_insert_rowid
        let mut id_statement = conn.prepare("SELECT last_insert_rowid()").map_err(|e| DbError {
            message: format!("Failed to prepare id query: {}", e),
        })?;
        
        id_statement.next().map_err(|e| DbError {
            message: format!("Failed to execute id query: {}", e),
        })?;
        
        let id: i64 = id_statement.read::<i64, usize>(0).map_err(|e| DbError {
            message: format!("Failed to read id: {}", e),
        })?;

        Ok(id as i32)
    }

    pub fn remove_favorite(&self, id: i32) -> Result<(), DbError> {
        let conn = self.0.lock().unwrap();
        
        let mut statement = conn.prepare("DELETE FROM favorites WHERE id = ?")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;
        statement.bind((1, id as i64)).map_err(|e| DbError {
            message: format!("Failed to bind id parameter: {}", e),
        })?;

        statement.next().map_err(|e| DbError {
            message: format!("Failed to execute statement: {}", e),
        })?;

        Ok(())
    }

    pub fn get_session(&self) -> Result<Option<Session>, DbError> {
        let conn = self.0.lock().unwrap();
        
        let mut statement = conn.prepare("SELECT id, phone, session_data, profile_photo, first_name, last_name, username, created_at
         FROM session
         WHERE session_data IS NOT NULL AND session_data <> ''
         ORDER BY created_at DESC
         LIMIT 1")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;

        match statement.next() {
            Ok(SqliteState::Row) => {
                let id: i32 = statement.read::<i64, usize>(0).map(|v| v as i32)
                    .map_err(|e| DbError {
                        message: format!("Failed to read id: {}", e),
                    })?;
                let phone: String = statement.read::<String, usize>(1)
                    .map_err(|e| DbError {
                        message: format!("Failed to read phone: {}", e),
                    })?;
                let session_data: Option<String> = statement.read::<Option<String>, usize>(2)
                    .map_err(|e| DbError {
                        message: format!("Failed to read session_data: {}", e),
                    })?;
                let profile_photo: Option<String> = statement.read::<Option<String>, usize>(3)
                    .map_err(|e| DbError {
                        message: format!("Failed to read profile_photo: {}", e),
                    })?;
                let first_name: Option<String> = statement.read::<Option<String>, usize>(4)
                    .map_err(|e| DbError {
                        message: format!("Failed to read first_name: {}", e),
                    })?;
                let last_name: Option<String> = statement.read::<Option<String>, usize>(5)
                    .map_err(|e| DbError {
                        message: format!("Failed to read last_name: {}", e),
                    })?;
                let username: Option<String> = statement.read::<Option<String>, usize>(6)
                    .map_err(|e| DbError {
                        message: format!("Failed to read username: {}", e),
                    })?;
                let created_at: String = statement.read::<String, usize>(7)
                    .map_err(|e| DbError {
                        message: format!("Failed to read created_at: {}", e),
                    })?;
                
                // Debug logging
                println!("[DB DEBUG] Found session - id: {}, phone: {}, has_session_data: {}, has_profile_photo: {}, created_at: {}", 
                         id, phone, session_data.is_some(), profile_photo.is_some(), created_at);
                
                Ok(Some(Session {
                    id,
                    phone,
                    session_data,
                    profile_photo,
                    first_name,
                    last_name,
                    username,
                    created_at,
                }))
            }
            Ok(SqliteState::Done) => {
                println!("[DB DEBUG] No session found in database");
                Ok(None)
            },
            Err(e) => {
                println!("[DB DEBUG] Error querying session: {}", e);
                Err(DbError {
                    message: format!("Failed to get session: {}", e),
                })
            },
        }
    }

    pub fn create_session(
        &self, 
        phone: &str, 
        session_data: Option<&str>, 
        profile_photo: Option<&str>,
        first_name: Option<&str>,
        last_name: Option<&str>,
        username: Option<&str>,
    ) -> Result<i32, DbError> {
        let conn = self.0.lock().unwrap();
        conn.execute("DELETE FROM session").map_err(|e| DbError {
            message: format!("Failed to clear session: {}", e),
        })?;
        println!("[DB DEBUG] Creating session - phone: {}, has_session_data: {}, has_profile_photo: {}", 
                 phone, session_data.is_some(), profile_photo.is_some());
        
        let mut statement = conn.prepare("INSERT INTO session (phone, session_data, profile_photo, first_name, last_name, username, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;
        statement.bind((1, phone)).map_err(|e| DbError {
            message: format!("Failed to bind phone parameter: {}", e),
        })?;
        
        match session_data {
            Some(data) => {
                println!("[DB DEBUG] Binding session data (length: {})", data.len());
                statement.bind((2, data)).map_err(|e| DbError {
                    message: format!("Failed to bind session_data parameter: {}", e),
                })?;
            },
            None => {
                println!("[DB DEBUG] Binding NULL session data");
                statement.bind((2, ())).map_err(|e| DbError {
                    message: format!("Failed to bind null session_data parameter: {}", e),
                })?;
            }
        }
        
        match profile_photo {
            Some(photo) => {
                println!("[DB DEBUG] Binding profile photo (length: {})", photo.len());
                statement.bind((3, photo)).map_err(|e| DbError {
                    message: format!("Failed to bind profile_photo parameter: {}", e),
                })?;
            },
            None => {
                statement.bind((3, ())).map_err(|e| DbError {
                    message: format!("Failed to bind null profile_photo parameter: {}", e),
                })?;
            }
        }

        statement.bind((4, first_name)).map_err(|e| DbError {
            message: format!("Failed to bind first_name parameter: {}", e),
        })?;
        statement.bind((5, last_name)).map_err(|e| DbError {
            message: format!("Failed to bind last_name parameter: {}", e),
        })?;
        statement.bind((6, username)).map_err(|e| DbError {
            message: format!("Failed to bind username parameter: {}", e),
        })?;

        statement.next().map_err(|e| DbError {
            message: format!("Failed to execute statement: {}", e),
        })?;

        // Get the last inserted ID using a separate query since sqlite crate doesn't expose last_insert_rowid
        let mut id_statement = conn.prepare("SELECT last_insert_rowid()").map_err(|e| DbError {
            message: format!("Failed to prepare id query: {}", e),
        })?;
        
        id_statement.next().map_err(|e| DbError {
            message: format!("Failed to execute id query: {}", e),
        })?;
        
        let id: i64 = id_statement.read::<i64, usize>(0).map_err(|e| DbError {
            message: format!("Failed to read id: {}", e),
        })?;

        println!("[DB DEBUG] Session created with ID: {}", id);        
        Ok(id as i32)
    }
    
    pub fn update_session_profile_photo(&self, profile_photo: &str) -> Result<(), DbError> {
        let conn = self.0.lock().unwrap();
        
        let mut statement = conn.prepare("UPDATE session SET profile_photo = ?")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;
        statement.bind((1, profile_photo)).map_err(|e| DbError {
            message: format!("Failed to bind profile_photo parameter: {}", e),
        })?;

        statement.next().map_err(|e| DbError {
            message: format!("Failed to execute statement: {}", e),
        })?;
        
        println!("[DB DEBUG] Updated session profile photo (length: {})", profile_photo.len());
        Ok(())
    }

    pub fn update_session_user_info(
        &self, 
        first_name: Option<&str>, 
        last_name: Option<&str>, 
        username: Option<&str>
    ) -> Result<(), DbError> {
        let conn = self.0.lock().unwrap();
        
        let mut statement = conn.prepare("UPDATE session SET first_name = ?, last_name = ?, username = ?")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;
        statement.bind((1, first_name)).map_err(|e| DbError {
            message: format!("Failed to bind first_name parameter: {}", e),
        })?;
        statement.bind((2, last_name)).map_err(|e| DbError {
            message: format!("Failed to bind last_name parameter: {}", e),
        })?;
        statement.bind((3, username)).map_err(|e| DbError {
            message: format!("Failed to bind username parameter: {}", e),
        })?;

        statement.next().map_err(|e| DbError {
            message: format!("Failed to execute statement: {}", e),
        })?;
        
        println!("[DB DEBUG] Updated session user info - first_name: {:?}, last_name: {:?}, username: {:?}", 
                 first_name, last_name, username);
        Ok(())
    }

    pub fn clear_session(&self) -> Result<(), DbError> {
        let conn = self.0.lock().unwrap();
        
        let mut statement = conn.prepare("DELETE FROM session")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;

        statement.next().map_err(|e| DbError {
            message: format!("Failed to execute statement: {}", e),
        })?;

        Ok(())
    }
    pub fn save_telegram_message(&self, msg: &TelegramMessage) -> Result<(), DbError> {
        let conn = self.0.lock().unwrap();
        
        let mut statement = conn.prepare("INSERT OR REPLACE INTO telegram_messages (message_id, chat_id, category, filename, extension, mime_type, timestamp, size, text, thumbnail, file_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;
        
        statement.bind((1, msg.message_id as i64)).map_err(|e| DbError {
            message: format!("Failed to bind message_id: {}", e),
        })?;
        statement.bind((2, msg.chat_id)).map_err(|e| DbError {
            message: format!("Failed to bind chat_id: {}", e),
        })?;
        statement.bind((3, msg.category.as_str())).map_err(|e| DbError {
            message: format!("Failed to bind category: {}", e),
        })?;
        statement.bind((4, msg.filename.as_deref())).map_err(|e| DbError {
            message: format!("Failed to bind filename: {}", e),
        })?;
        statement.bind((5, msg.extension.as_deref())).map_err(|e| DbError {
            message: format!("Failed to bind extension: {}", e),
        })?;
        statement.bind((6, msg.mime_type.as_deref())).map_err(|e| DbError {
            message: format!("Failed to bind mime_type: {}", e),
        })?;
        statement.bind((7, msg.timestamp.as_str())).map_err(|e| DbError {
            message: format!("Failed to bind timestamp: {}", e),
        })?;
        statement.bind((8, msg.size)).map_err(|e| DbError {
            message: format!("Failed to bind size: {}", e),
        })?;
        statement.bind((9, msg.text.as_deref())).map_err(|e| DbError {
            message: format!("Failed to bind text: {}", e),
        })?;
        statement.bind((10, msg.thumbnail.as_deref())).map_err(|e| DbError {
            message: format!("Failed to bind thumbnail: {}", e),
        })?;
        statement.bind((11, msg.file_reference.as_str())).map_err(|e| DbError {
            message: format!("Failed to bind file_reference: {}", e),
        })?;

        statement.next().map_err(|e| DbError {
            message: format!("Failed to execute statement: {}", e),
        })?;

        Ok(())
    }

    pub fn get_telegram_message(&self, chat_id: i64, message_id: i32) -> Result<Option<TelegramMessage>, DbError> {
        let conn = self.0.lock().unwrap();
        
        let mut statement = conn.prepare("SELECT message_id, chat_id, category, filename, extension, mime_type, timestamp, size, text, thumbnail, file_reference FROM telegram_messages WHERE chat_id = ? AND message_id = ?")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;
        
        statement.bind((1, chat_id)).map_err(|e| DbError {
            message: format!("Failed to bind chat_id: {}", e),
        })?;
        statement.bind((2, message_id as i64)).map_err(|e| DbError {
            message: format!("Failed to bind message_id: {}", e),
        })?;

        if let Ok(SqliteState::Row) = statement.next() {
            Ok(Some(TelegramMessage {
                message_id: statement.read::<i64, usize>(0).unwrap() as i32,
                chat_id: statement.read::<i64, usize>(1).unwrap(),
                category: statement.read::<String, usize>(2).unwrap(),
                filename: statement.read::<Option<String>, usize>(3).unwrap(),
                extension: statement.read::<Option<String>, usize>(4).unwrap(),
                mime_type: statement.read::<Option<String>, usize>(5).unwrap(),
                timestamp: statement.read::<String, usize>(6).unwrap(),
                size: statement.read::<Option<i64>, usize>(7).unwrap(),
                text: statement.read::<Option<String>, usize>(8).unwrap(),
                thumbnail: statement.read::<Option<String>, usize>(9).unwrap(),
                file_reference: statement.read::<String, usize>(10).unwrap(),
            }))
        } else {
            Ok(None)
        }
    }

    pub fn update_telegram_message_thumbnail(&self, chat_id: i64, message_id: i32, thumbnail: &str) -> Result<(), DbError> {
        let conn = self.0.lock().unwrap();
        
        let mut statement = conn.prepare("UPDATE telegram_messages SET thumbnail = ? WHERE chat_id = ? AND message_id = ?")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;
        
        statement.bind((1, thumbnail)).map_err(|e| DbError {
            message: format!("Failed to bind thumbnail: {}", e),
        })?;
        statement.bind((2, chat_id)).map_err(|e| DbError {
            message: format!("Failed to bind chat_id: {}", e),
        })?;
        statement.bind((3, message_id as i64)).map_err(|e| DbError {
            message: format!("Failed to bind message_id: {}", e),
        })?;

        statement.next().map_err(|e| DbError {
            message: format!("Failed to execute statement: {}", e),
        })?;

        Ok(())
    }

    pub fn get_indexed_messages_by_category(&self, chat_id: i64, category: &str) -> Result<Vec<TelegramMessage>, DbError> {
        let conn = self.0.lock().unwrap();
        
        let mut statement = conn.prepare("SELECT message_id, chat_id, category, filename, extension, mime_type, timestamp, size, text, thumbnail, file_reference FROM telegram_messages WHERE chat_id = ? AND category = ? ORDER BY timestamp DESC")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;
        
        statement.bind((1, chat_id)).map_err(|e| DbError {
            message: format!("Failed to bind chat_id: {}", e),
        })?;
        statement.bind((2, category)).map_err(|e| DbError {
            message: format!("Failed to bind category: {}", e),
        })?;

        let mut messages = Vec::new();
        while let Ok(SqliteState::Row) = statement.next() {
            messages.push(TelegramMessage {
                message_id: statement.read::<i64, usize>(0).unwrap() as i32,
                chat_id: statement.read::<i64, usize>(1).unwrap(),
                category: statement.read::<String, usize>(2).unwrap(),
                filename: statement.read::<Option<String>, usize>(3).unwrap(),
                extension: statement.read::<Option<String>, usize>(4).unwrap(),
                mime_type: statement.read::<Option<String>, usize>(5).unwrap(),
                timestamp: statement.read::<String, usize>(6).unwrap(),
                size: statement.read::<Option<i64>, usize>(7).unwrap(),
                text: statement.read::<Option<String>, usize>(8).unwrap(),
                thumbnail: statement.read::<Option<String>, usize>(9).unwrap(),
                file_reference: statement.read::<String, usize>(10).unwrap(),
            });
        }

        Ok(messages)
    }

    pub fn get_all_indexed_messages(&self, chat_id: i64) -> Result<Vec<TelegramMessage>, DbError> {
        let conn = self.0.lock().unwrap();

        let mut statement = conn.prepare("SELECT message_id, chat_id, category, filename, extension, mime_type, timestamp, size, text, thumbnail, file_reference FROM telegram_messages WHERE chat_id = ? ORDER BY message_id DESC")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;

        statement.bind((1, chat_id)).map_err(|e| DbError {
            message: format!("Failed to bind chat_id: {}", e),
        })?;

        let mut messages = Vec::new();
        while let Ok(SqliteState::Row) = statement.next() {
            messages.push(TelegramMessage {
                message_id: statement.read::<i64, usize>(0).unwrap_or(0) as i32,
                chat_id: statement.read::<i64, usize>(1).unwrap_or(chat_id),
                category: statement.read::<String, usize>(2).unwrap_or_else(|_| "Documents".to_string()),
                filename: statement.read::<Option<String>, usize>(3).unwrap_or(None),
                extension: statement.read::<Option<String>, usize>(4).unwrap_or(None),
                mime_type: statement.read::<Option<String>, usize>(5).unwrap_or(None),
                timestamp: statement.read::<String, usize>(6).unwrap_or_default(),
                size: statement.read::<Option<i64>, usize>(7).unwrap_or(None),
                text: statement.read::<Option<String>, usize>(8).unwrap_or(None),
                thumbnail: statement.read::<Option<String>, usize>(9).unwrap_or(None),
                file_reference: statement.read::<String, usize>(10).unwrap_or_default(),
            });
        }

        Ok(messages)
    }

    pub fn count_all_indexed_messages(&self, chat_id: i64) -> Result<i64, DbError> {
        let conn = self.0.lock().unwrap();

        let mut statement = conn
            .prepare("SELECT COUNT(*) FROM telegram_messages WHERE chat_id = ?")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;

        statement.bind((1, chat_id)).map_err(|e| DbError {
            message: format!("Failed to bind chat_id: {}", e),
        })?;

        match statement.next() {
            Ok(SqliteState::Row) => {
                let count: i64 = statement.read::<i64, usize>(0).unwrap_or(0);
                Ok(count)
            }
            Ok(SqliteState::Done) => Ok(0),
            Err(e) => Err(DbError {
                message: format!("Failed to count indexed messages: {}", e),
            }),
        }
    }

    pub fn get_last_indexed_message_id(&self, chat_id: i64) -> Result<i32, DbError> {
        let conn = self.0.lock().unwrap();
        
        let mut statement = conn.prepare("SELECT MAX(message_id) FROM telegram_messages WHERE chat_id = ?")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;
        
        statement.bind((1, chat_id)).map_err(|e| DbError {
            message: format!("Failed to bind chat_id: {}", e),
        })?;

        match statement.next() {
            Ok(SqliteState::Row) => {
                let id: i64 = statement.read::<Option<i64>, usize>(0).unwrap_or(Some(0)).unwrap_or(0);
                Ok(id as i32)
            }
            _ => Ok(0),
        }
    }

    pub fn get_oldest_indexed_message_id(&self, chat_id: i64) -> Result<i32, DbError> {
        let conn = self.0.lock().unwrap();

        let mut statement = conn.prepare("SELECT MIN(message_id) FROM telegram_messages WHERE chat_id = ?")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;

        statement.bind((1, chat_id)).map_err(|e| DbError {
            message: format!("Failed to bind chat_id: {}", e),
        })?;

        match statement.next() {
            Ok(SqliteState::Row) => {
                let id: i64 = statement.read::<Option<i64>, usize>(0).unwrap_or(Some(0)).unwrap_or(0);
                Ok(id as i32)
            }
            _ => Ok(0),
        }
    }

    pub fn upsert_telegram_saved_item(&self, item: &TelegramSavedItem) -> Result<(), DbError> {
        let conn = self.0.lock().unwrap();

        let mut statement = conn.prepare(
            "INSERT OR REPLACE INTO telegram_saved_items (
                file_unique_id,
                chat_id,
                message_id,
                thumbnail,
                file_type,
                file_size,
                file_name,
                file_caption,
                file_path,
                modified_date,
                owner_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).map_err(|e| DbError {
            message: format!("Failed to prepare statement: {}", e),
        })?;

        statement.bind((1, item.file_unique_id.as_str())).map_err(|e| DbError {
            message: format!("Failed to bind file_unique_id: {}", e),
        })?;
        statement.bind((2, item.chat_id)).map_err(|e| DbError {
            message: format!("Failed to bind chat_id: {}", e),
        })?;
        statement.bind((3, item.message_id as i64)).map_err(|e| DbError {
            message: format!("Failed to bind message_id: {}", e),
        })?;
        statement.bind((4, item.thumbnail.as_deref())).map_err(|e| DbError {
            message: format!("Failed to bind thumbnail: {}", e),
        })?;
        statement.bind((5, item.file_type.as_str())).map_err(|e| DbError {
            message: format!("Failed to bind file_type: {}", e),
        })?;
        statement.bind((6, item.file_size)).map_err(|e| DbError {
            message: format!("Failed to bind file_size: {}", e),
        })?;
        statement.bind((7, item.file_name.as_str())).map_err(|e| DbError {
            message: format!("Failed to bind file_name: {}", e),
        })?;
        statement.bind((8, item.file_caption.as_deref())).map_err(|e| DbError {
            message: format!("Failed to bind file_caption: {}", e),
        })?;
        statement.bind((9, item.file_path.as_str())).map_err(|e| DbError {
            message: format!("Failed to bind file_path: {}", e),
        })?;
        statement.bind((10, item.modified_date.as_str())).map_err(|e| DbError {
            message: format!("Failed to bind modified_date: {}", e),
        })?;
        statement.bind((11, item.owner_id.as_str())).map_err(|e| DbError {
            message: format!("Failed to bind owner_id: {}", e),
        })?;

        statement.next().map_err(|e| DbError {
            message: format!("Failed to execute statement: {}", e),
        })?;

        Ok(())
    }

    pub fn get_telegram_saved_items_by_path(&self, owner_id: &str, file_path: &str) -> Result<Vec<TelegramSavedItem>, DbError> {
        let conn = self.0.lock().unwrap();

        let mut statement = conn.prepare(
            "SELECT
                chat_id,
                message_id,
                thumbnail,
                file_type,
                file_unique_id,
                file_size,
                file_name,
                file_caption,
                file_path,
                modified_date,
                owner_id
             FROM telegram_saved_items
             WHERE owner_id = ? AND file_path = ?
             ORDER BY
                CASE WHEN file_type = 'folder' THEN 0 ELSE 1 END,
                CASE WHEN file_type = 'folder' THEN LOWER(file_name) ELSE '' END,
                CASE WHEN file_type = 'folder' THEN 0 ELSE message_id END DESC,
                LOWER(file_name) ASC",
        ).map_err(|e| DbError {
            message: format!("Failed to prepare statement: {}", e),
        })?;

        statement.bind((1, owner_id)).map_err(|e| DbError {
            message: format!("Failed to bind owner_id: {}", e),
        })?;
        statement.bind((2, file_path)).map_err(|e| DbError {
            message: format!("Failed to bind file_path: {}", e),
        })?;

        let mut items = Vec::new();
        while let Ok(SqliteState::Row) = statement.next() {
            items.push(TelegramSavedItem {
                chat_id: statement.read::<i64, usize>(0).unwrap_or(0),
                message_id: statement.read::<i64, usize>(1).unwrap_or(0) as i32,
                thumbnail: statement.read::<Option<String>, usize>(2).unwrap_or(None),
                file_type: statement.read::<String, usize>(3).unwrap_or_else(|_| "file".to_string()),
                file_unique_id: statement.read::<String, usize>(4).unwrap_or_default(),
                file_size: statement.read::<i64, usize>(5).unwrap_or(0),
                file_name: statement.read::<String, usize>(6).unwrap_or_default(),
                file_caption: statement.read::<Option<String>, usize>(7).unwrap_or(None),
                file_path: statement.read::<String, usize>(8).unwrap_or_default(),
                modified_date: statement.read::<String, usize>(9).unwrap_or_default(),
                owner_id: statement.read::<String, usize>(10).unwrap_or_default(),
            });
        }

        Ok(items)
    }

    pub fn count_telegram_saved_non_folder_items(&self, owner_id: &str) -> Result<i64, DbError> {
        let conn = self.0.lock().unwrap();

        let mut statement = conn
            .prepare("SELECT COUNT(*) FROM telegram_saved_items WHERE owner_id = ? AND file_type != 'folder'")
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;

        statement.bind((1, owner_id)).map_err(|e| DbError {
            message: format!("Failed to bind owner_id: {}", e),
        })?;

        match statement.next() {
            Ok(SqliteState::Row) => {
                let count: i64 = statement.read::<i64, usize>(0).unwrap_or(0);
                Ok(count)
            }
            Ok(SqliteState::Done) => Ok(0),
            Err(e) => Err(DbError {
                message: format!("Failed to count saved items: {}", e),
            }),
        }
    }

    pub fn count_telegram_saved_items_with_empty_name(&self, owner_id: &str) -> Result<i64, DbError> {
        let conn = self.0.lock().unwrap();

        let mut statement = conn
            .prepare(
                "SELECT COUNT(*)
                 FROM telegram_saved_items
                 WHERE owner_id = ?
                   AND file_type != 'folder'
                   AND (file_name IS NULL OR TRIM(file_name) = '')",
            )
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;

        statement.bind((1, owner_id)).map_err(|e| DbError {
            message: format!("Failed to bind owner_id: {}", e),
        })?;

        match statement.next() {
            Ok(SqliteState::Row) => {
                let count: i64 = statement.read::<i64, usize>(0).unwrap_or(0);
                Ok(count)
            }
            Ok(SqliteState::Done) => Ok(0),
            Err(e) => Err(DbError {
                message: format!("Failed to count unnamed saved items: {}", e),
            }),
        }
    }

    pub fn count_telegram_generated_names_missing_extension(&self, owner_id: &str) -> Result<i64, DbError> {
        let conn = self.0.lock().unwrap();

        let mut statement = conn
            .prepare(
                "SELECT COUNT(*)
                 FROM telegram_saved_items
                 WHERE owner_id = ?
                   AND file_type != 'folder'
                   AND file_name IS NOT NULL
                   AND TRIM(file_name) != ''
                   AND file_name NOT LIKE '%.%'
                   AND (
                     (file_type = 'image' AND LOWER(file_name) LIKE 'image_%')
                     OR (file_type = 'video' AND LOWER(file_name) LIKE 'video_%')
                     OR (file_type = 'audio' AND LOWER(file_name) LIKE 'audio_%')
                     OR (file_type = 'text' AND LOWER(file_name) LIKE 'text_%')
                     OR (file_type = 'document' AND LOWER(file_name) LIKE 'document_%')
                   )",
            )
            .map_err(|e| DbError {
                message: format!("Failed to prepare statement: {}", e),
            })?;

        statement.bind((1, owner_id)).map_err(|e| DbError {
            message: format!("Failed to bind owner_id: {}", e),
        })?;

        match statement.next() {
            Ok(SqliteState::Row) => {
                let count: i64 = statement.read::<i64, usize>(0).unwrap_or(0);
                Ok(count)
            }
            Ok(SqliteState::Done) => Ok(0),
            Err(e) => Err(DbError {
                message: format!("Failed to count generated names without extension: {}", e),
            }),
        }
    }

    pub fn get_telegram_saved_items_by_path_paginated(
        &self,
        owner_id: &str,
        file_path: &str,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<TelegramSavedItem>, DbError> {
        let conn = self.0.lock().unwrap();

        let mut statement = conn.prepare(
            "SELECT
                chat_id,
                message_id,
                thumbnail,
                file_type,
                file_unique_id,
                file_size,
                file_name,
                file_caption,
                file_path,
                modified_date,
                owner_id
             FROM telegram_saved_items
             WHERE owner_id = ? AND file_path = ?
             ORDER BY
                CASE WHEN file_type = 'folder' THEN 0 ELSE 1 END,
                CASE WHEN file_type = 'folder' THEN LOWER(file_name) ELSE '' END,
                CASE WHEN file_type = 'folder' THEN 0 ELSE message_id END DESC,
                LOWER(file_name) ASC
             LIMIT ? OFFSET ?",
        ).map_err(|e| DbError {
            message: format!("Failed to prepare statement: {}", e),
        })?;

        statement.bind((1, owner_id)).map_err(|e| DbError {
            message: format!("Failed to bind owner_id: {}", e),
        })?;
        statement.bind((2, file_path)).map_err(|e| DbError {
            message: format!("Failed to bind file_path: {}", e),
        })?;
        statement.bind((3, limit)).map_err(|e| DbError {
            message: format!("Failed to bind limit: {}", e),
        })?;
        statement.bind((4, offset)).map_err(|e| DbError {
            message: format!("Failed to bind offset: {}", e),
        })?;

        let mut items = Vec::new();
        while let Ok(SqliteState::Row) = statement.next() {
            items.push(TelegramSavedItem {
                chat_id: statement.read::<i64, usize>(0).unwrap_or(0),
                message_id: statement.read::<i64, usize>(1).unwrap_or(0) as i32,
                thumbnail: statement.read::<Option<String>, usize>(2).unwrap_or(None),
                file_type: statement.read::<String, usize>(3).unwrap_or_else(|_| "file".to_string()),
                file_unique_id: statement.read::<String, usize>(4).unwrap_or_default(),
                file_size: statement.read::<i64, usize>(5).unwrap_or(0),
                file_name: statement.read::<String, usize>(6).unwrap_or_default(),
                file_caption: statement.read::<Option<String>, usize>(7).unwrap_or(None),
                file_path: statement.read::<String, usize>(8).unwrap_or_default(),
                modified_date: statement.read::<String, usize>(9).unwrap_or_default(),
                owner_id: statement.read::<String, usize>(10).unwrap_or_default(),
            });
        }

        Ok(items)
    }

    pub fn ensure_telegram_saved_folders(&self, owner_id: &str) -> Result<(), DbError> {
        let now = chrono::Utc::now().to_rfc3339();
        let root = "/Home";
        let folders = ["Images", "Videos", "Audios", "Documents", "Notes"];

        for folder_name in folders {
            let item = TelegramSavedItem {
                chat_id: 0,
                message_id: 0,
                thumbnail: None,
                file_type: "folder".to_string(),
                file_unique_id: format!("folder_{}_{}", owner_id, folder_name.to_lowercase()),
                file_size: 0,
                file_name: folder_name.to_string(),
                file_caption: Some(folder_name.to_string()),
                file_path: root.to_string(),
                modified_date: now.clone(),
                owner_id: owner_id.to_string(),
            };

            self.upsert_telegram_saved_item(&item)?;
        }

        Ok(())
    }
}

#[tauri::command]
pub async fn db_get_setting(state: State<'_, Database>, key: String) -> Result<Option<String>, DbError> {
    state.get_setting(&key)
}

#[tauri::command]
pub async fn db_set_setting(state: State<'_, Database>, key: String, value: String) -> Result<(), DbError> {
    state.set_setting(&key, &value)
}

#[tauri::command]
pub async fn db_get_recent_paths(state: State<'_, Database>, limit: i32) -> Result<Vec<RecentPath>, DbError> {
    state.get_recent_paths(limit)
}

#[tauri::command]
pub async fn db_add_recent_path(state: State<'_, Database>, path: String) -> Result<(), DbError> {
    state.add_recent_path(&path)
}

#[tauri::command]
pub async fn db_get_favorites(state: State<'_, Database>) -> Result<Vec<Favorite>, DbError> {
    state.get_favorites()
}

#[tauri::command]
pub async fn db_add_favorite(state: State<'_, Database>, path: String, label: String) -> Result<i32, DbError> {
    state.add_favorite(&path, &label)
}

#[tauri::command]
pub async fn db_remove_favorite(state: State<'_, Database>, id: i32) -> Result<(), DbError> {
    state.remove_favorite(id)
}

#[tauri::command]
pub async fn db_get_session(state: State<'_, Database>) -> Result<Option<Session>, DbError> {
    state.get_session()
}

#[tauri::command]
pub async fn db_create_session(
    state: State<'_, Database>, 
    phone: String, 
    session_data: Option<String>, 
    profile_photo: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
    username: Option<String>,
) -> Result<i32, DbError> {
    state.create_session(
        &phone, 
        session_data.as_deref(), 
        profile_photo.as_deref(),
        first_name.as_deref(),
        last_name.as_deref(),
        username.as_deref(),
    )
}

#[tauri::command]
pub async fn db_update_session_profile_photo(state: State<'_, Database>, profile_photo: String) -> Result<(), DbError> {
    state.update_session_profile_photo(&profile_photo)
}

#[tauri::command]
pub async fn db_update_session_user_info(
    state: State<'_, Database>, 
    first_name: Option<String>, 
    last_name: Option<String>, 
    username: Option<String>
) -> Result<(), DbError> {
    state.update_session_user_info(first_name.as_deref(), last_name.as_deref(), username.as_deref())
}

#[tauri::command]
pub async fn db_clear_session(state: State<'_, Database>) -> Result<(), DbError> {
    state.clear_session()
}
