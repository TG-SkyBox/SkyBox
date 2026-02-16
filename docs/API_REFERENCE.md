# SkyBox API Reference

This document describes the Tauri commands available in SkyBox.

## File System Commands

### `fs_list_dir(path: String)`
Lists the contents of a directory.

**Parameters:**
- `path`: Path to the directory to list

**Returns:** `Vec<FileEntry>`

### `fs_open_path(path: String)`
Opens a file or directory in the system's default application.

**Parameters:**
- `path`: Path to the file or directory to open

**Returns:** `Result<(), FsError>`

### `fs_create_dir(path: String)`
Creates a new directory.

**Parameters:**
- `path`: Path where the directory should be created

**Returns:** `Result<(), FsError>`

### `fs_rename(old_path: String, new_path: String)`
Renames a file or directory.

**Parameters:**
- `old_path`: Current path of the file or directory
- `new_path`: New path for the file or directory

**Returns:** `Result<(), FsError>`

### `fs_delete(path: String)`
Deletes a file or directory.

**Parameters:**
- `path`: Path of the file or directory to delete

**Returns:** `Result<(), FsError>`

### `fs_copy(src: String, dst: String)`
Copies a file or directory to a new location.

**Parameters:**
- `src`: Source path
- `dst`: Destination path

**Returns:** `Result<(), FsError>`

### `fs_move(src: String, dst: String)`
Moves a file or directory to a new location.

**Parameters:**
- `src`: Source path
- `dst`: Destination path

**Returns:** `Result<(), FsError>`

## Database Commands

### `db_get_setting(key: String)`
Retrieves a setting value by key.

**Parameters:**
- `key`: Key of the setting to retrieve

**Returns:** `Result<Option<String>, DbError>`

### `db_set_setting(key: String, value: String)`
Sets a setting value by key.

**Parameters:**
- `key`: Key of the setting to set
- `value`: Value to set

**Returns:** `Result<(), DbError>`

### `db_get_recent_paths(limit: i32)`
Retrieves recent paths.

**Parameters:**
- `limit`: Maximum number of paths to return

**Returns:** `Result<Vec<RecentPath>, DbError>`

### `db_add_recent_path(path: String)`
Adds a path to recent paths.

**Parameters:**
- `path`: Path to add to recent paths

**Returns:** `Result<(), DbError>`

### `db_get_favorites()`
Retrieves all favorite paths.

**Returns:** `Result<Vec<Favorite>, DbError>`

### `db_add_favorite(path: String, label: String)`
Adds a path to favorites.

**Parameters:**
- `path`: Path to add to favorites
- `label`: Label for the favorite

**Returns:** `Result<i32, DbError>`

### `db_remove_favorite(id: i32)`
Removes a favorite by ID.

**Parameters:**
- `id`: ID of the favorite to remove

**Returns:** `Result<(), DbError>`

### `db_get_session()`
Retrieves the current user session.

**Returns:** `Result<Option<Session>, DbError>`

### `db_create_session(phone: String)`
Creates a new user session.

**Parameters:**
- `phone`: Phone number associated with the session

**Returns:** `Result<i32, DbError>`

### `db_clear_session()`
Clears the current user session.

**Returns:** `Result<(), DbError>`

## Telegram Commands

### `tg_upload_file_to_saved_messages(file_name: String, file_bytes: Vec<u8>)`
Uploads a dropped file to Telegram Saved Messages and stores its indexed metadata locally.

**Parameters:**
- `file_name`: Original file name
- `file_bytes`: Raw file bytes from drag-and-drop payload

**Returns:** `Result<TelegramMessage, TelegramError>`
