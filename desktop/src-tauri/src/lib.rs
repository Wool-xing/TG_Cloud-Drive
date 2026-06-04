use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

mod sync;
mod auth;

pub struct AppState {
    pub server_url: Mutex<String>,
    pub access_token: Mutex<Option<String>>,
    pub sync_running: Mutex<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FileInfo {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub mime_type: Option<String>,
    pub updated_at: String,
    pub is_private: bool,
}

#[derive(Serialize, Deserialize)]
pub struct SyncStatus {
    pub running: bool,
    pub synced_files: u64,
    pub pending_uploads: u64,
    pub pending_downloads: u64,
    pub last_error: Option<String>,
}

#[tauri::command]
fn set_server(state: State<AppState>, url: String) {
    *state.server_url.lock().unwrap() = url;
}

#[tauri::command]
fn set_token(state: State<AppState>, token: String) {
    *state.access_token.lock().unwrap() = Some(token);
}

#[tauri::command]
fn get_sync_status(state: State<AppState>) -> SyncStatus {
    let running = *state.sync_running.lock().unwrap();
    SyncStatus {
        running,
        synced_files: 0,
        pending_uploads: 0,
        pending_downloads: 0,
        last_error: None,
    }
}

#[tauri::command]
async fn list_remote_files(state: State<'_, AppState>) -> Result<Vec<FileInfo>, String> {
    let token = state.access_token.lock().unwrap().clone()
        .ok_or("Not authenticated".to_string())?;
    let server = state.server_url.lock().unwrap().clone();

    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/api/files", server))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    // API wraps in {ok: true, data: [...]}
    let data = json["data"].as_array()
        .or_else(|| json["nodes"].as_array())
        .ok_or("Invalid response".to_string())?;

    data.iter().map(|n| Ok(FileInfo {
        id: n["id"].as_str().unwrap_or("").to_string(),
        name: n["name"].as_str().unwrap_or("").to_string(),
        size: n["size"].as_u64().unwrap_or(0),
        mime_type: n["mimeType"].as_str().map(|s| s.to_string()),
        updated_at: n["updatedAt"].as_str().unwrap_or("").to_string(),
        is_private: n["isPrivate"].as_bool().unwrap_or(false),
    })).collect::<Result<Vec<_>, String>>()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            server_url: Mutex::new(String::new()),
            access_token: Mutex::new(None),
            sync_running: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            set_server,
            set_token,
            get_sync_status,
            list_remote_files,
            auth::login,
            sync::start_sync,
            sync::stop_sync,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
