use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use crate::AppState;

// ── Sync Engine State ──────────────────────────────────────────────────────

struct SyncEngine {
    server_url: String,
    access_token: String,
    watch_dir: PathBuf,
    /// Local path → last modified time
    local_state: HashMap<PathBuf, u64>,
    /// Remote file id → name
    remote_state: HashMap<String, String>,
}

#[derive(serde::Serialize, Clone)]
struct SyncEvent {
    event: String,
    path: Option<String>,
    name: Option<String>,
    message: String,
}

// ── Tauri Commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_sync(
    app: AppHandle,
    state: State<'_, AppState>,
    watch_dir: String,
) -> Result<(), String> {
    // Extract all data from state BEFORE any await — MutexGuard is not Send
    let (token, server_url) = {
        let mut running = state.sync_running.lock().map_err(|e| e.to_string())?;
        if *running {
            return Err("Sync already running".to_string());
        }
        *running = true;
        drop(running);

        let path = PathBuf::from(&watch_dir);
        if !path.exists() {
            let mut r = state.sync_running.lock().map_err(|e| e.to_string())?;
            *r = false;
            return Err(format!("Directory not found: {}", watch_dir));
        }

        let token = state.access_token.lock().map_err(|e| e.to_string())?
            .clone()
            .ok_or("Not authenticated")?;
        let server_url = state.server_url.lock().map_err(|e| e.to_string())?.clone();
        (token, server_url)
    };

    let engine = SyncEngine {
        server_url: server_url.clone(),
        access_token: token,
        watch_dir: PathBuf::from(&watch_dir),
        local_state: HashMap::new(),
        remote_state: HashMap::new(),
    };

    emit(&app, "sync", &format!("Starting sync for {}", watch_dir))?;

    // Pull remote changes (initial sync)
    if let Err(e) = engine.pull_changes(&app).await {
        emit(&app, "sync-error", &e)?;
    }

    // Clean up sync flag
    let mut r = state.sync_running.lock().map_err(|e| e.to_string())?;
    *r = false;

    Ok(())
}

#[tauri::command]
pub async fn stop_sync(state: State<'_, AppState>) -> Result<(), String> {
    let mut running = state.sync_running.lock().map_err(|e| e.to_string())?;
    *running = false;
    Ok(())
}

// ── Sync Engine Methods ───────────────────────────────────────────────────

impl SyncEngine {
    async fn pull_changes(&self, app: &AppHandle) -> Result<(), String> {
        let client = reqwest::Client::new();
        let resp = client
            .get(format!("{}/api/files/sync/diff?since=1970-01-01T00:00:00Z", self.server_url))
            .header("Authorization", format!("Bearer {}", self.access_token))
            .send()
            .await
            .map_err(|e| format!("Sync diff request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Sync diff HTTP {}", resp.status()));
        }

        let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

        let created = json["data"]["created"].as_array();
        let modified = json["data"]["modified"].as_array();
        let deleted = json["data"]["deleted"].as_array();

        let total_new = created.map(|a| a.len()).unwrap_or(0);
        let total_mod = modified.map(|a| a.len()).unwrap_or(0);
        let total_del = deleted.map(|a| a.len()).unwrap_or(0);

        if total_new + total_mod + total_del > 0 {
            let _ = emit(app, "sync", &format!(
                "Changes: +{} new, ~{} modified, -{} deleted",
                total_new, total_mod, total_del
            ));

            for item in created.into_iter().flatten().chain(modified.into_iter().flatten()) {
                let node_id = item["id"].as_str().unwrap_or("");
                let name = item["name"].as_str().unwrap_or("");
                let dest = self.watch_dir.join(name);
                if !dest.exists() {
                    if let Err(e) = self.download_file(node_id, &dest).await {
                        let _ = emit(app, "sync-error", &format!("Download {}: {}", name, e));
                    }
                }
            }

            for item in deleted.into_iter().flatten() {
                let name = item["name"].as_str().unwrap_or("");
                let _ = emit(app, "sync-remote-deleted", name);
            }
        } else {
            let _ = emit(app, "sync", "Already up to date");
        }

        Ok(())
    }

    async fn download_file(&self, node_id: &str, dest: &PathBuf) -> Result<(), String> {
        let client = reqwest::Client::new();
        let resp = client
            .get(format!("{}/api/files/download/{}", self.server_url, node_id))
            .header("Authorization", format!("Bearer {}", self.access_token))
            .send()
            .await
            .map_err(|e| format!("Download failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Download HTTP {}", resp.status()));
        }

        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        tokio::fs::write(dest, &bytes).await.map_err(|e| format!("Write failed: {}", e))?;
        Ok(())
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

fn emit(app: &AppHandle, event: &str, msg: &str) -> Result<(), String> {
    app.emit("sync-event", SyncEvent {
        event: event.to_string(),
        path: None,
        name: None,
        message: msg.to_string(),
    }).map_err(|e| e.to_string())
}
