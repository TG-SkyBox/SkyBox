use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct FsError {
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_file: bool,
    pub modified: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_file: bool,
    pub size: Option<u64>,
}

#[tauri::command]
pub async fn read_directory(path: String) -> Result<Vec<DirEntry>, FsError> {
    let entries = fs::read_dir(&path).map_err(|e| FsError {
        message: format!("Failed to read directory {}: {}", path, e),
    })?;

    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| FsError {
            message: format!("Failed to read entry: {}", e),
        })?;

        let metadata = entry.metadata().map_err(|e| FsError {
            message: format!("Failed to get metadata: {}", e),
        })?;

        let file_type = metadata.file_type();
        let file_path = entry.path();

        result.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: file_path.to_string_lossy().to_string(),
            is_dir: file_type.is_dir(),
            is_file: file_type.is_file(),
            size: if file_type.is_file() {
                Some(metadata.len())
            } else {
                None
            },
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, FsError> {
    let content = fs::read_to_string(&path).map_err(|e| FsError {
        message: format!("Failed to read file {}: {}", path, e),
    })?;

    Ok(content)
}

#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), FsError> {
    fs::write(&path, content).map_err(|e| FsError {
        message: format!("Failed to write file {}: {}", path, e),
    })?;

    Ok(())
}

#[tauri::command]
pub async fn create_directory(path: String) -> Result<(), FsError> {
    fs::create_dir_all(&path).map_err(|e| FsError {
        message: format!("Failed to create directory {}: {}", path, e),
    })?;

    Ok(())
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), FsError> {
    if Path::new(&path).is_dir() {
        fs::remove_dir_all(&path).map_err(|e| FsError {
            message: format!("Failed to delete directory {}: {}", path, e),
        })?;
    } else {
        fs::remove_file(&path).map_err(|e| FsError {
            message: format!("Failed to delete file {}: {}", path, e),
        })?;
    }

    Ok(())
}

#[tauri::command]
pub async fn rename_file(old_path: String, new_path: String) -> Result<(), FsError> {
    fs::rename(&old_path, &new_path).map_err(|e| FsError {
        message: format!("Failed to rename {} to {}: {}", old_path, new_path, e),
    })?;

    Ok(())
}

#[tauri::command]
pub async fn copy_file(source: String, destination: String) -> Result<(), FsError> {
    fs::copy(&source, &destination).map_err(|e| FsError {
        message: format!("Failed to copy {} to {}: {}", source, destination, e),
    })?;

    Ok(())
}

#[tauri::command]
pub async fn move_file(source: String, destination: String) -> Result<(), FsError> {
    fs::rename(&source, &destination).map_err(|e| FsError {
        message: format!("Failed to move {} to {}: {}", source, destination, e),
    })?;

    Ok(())
}

#[tauri::command]
pub async fn get_file_info(path: String) -> Result<FileInfo, FsError> {
    let metadata = fs::metadata(&path).map_err(|e| FsError {
        message: format!("Failed to get metadata for {}: {}", path, e),
    })?;

    let file_name = Path::new(&path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    Ok(FileInfo {
        name: file_name,
        path: path.clone(),
        size: metadata.len(),
        is_dir: metadata.is_dir(),
        is_file: metadata.is_file(),
        modified: metadata.modified().ok().map(|t| format!("{:?}", t)),
    })
}

#[tauri::command]
pub async fn search_files(directory: String, pattern: String) -> Result<Vec<String>, FsError> {
    let mut results = Vec::new();

    let entries = walkdir::WalkDir::new(&directory)
        .into_iter()
        .filter_map(|entry| entry.ok());

    for entry in entries {
        let file_path = entry.path();
        if let Some(file_name) = file_path.file_name() {
            let file_name_str = file_name.to_string_lossy();
            if file_name_str.contains(&pattern) {
                results.push(file_path.to_string_lossy().to_string());
            }
        }
    }

    Ok(results)
}
