use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use crate::AppState;

// ── Sync Engine State ──────────────────────────────────────────────────────

struct SyncEngine {
    server_url: String,
    access_token: String,
    watch_dir: PathBuf,
    /// Local path → last modified time (tracked to avoid re-uploading unchanged)
    local_state: HashMap<PathBuf, u64>,
    /// Remote file id → name (tracked to detect remote deletes)
    remote_state: HashMap<String, String>,
    stop_flag: Arc<AtomicBool>,
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
    let mut running = state.sync_running.lock().unwrap();
    if *running {
        return Err("Sync already running".to_string());
    }
    *running = true;
    drop(running);

    let path = PathBuf::from(&watch_dir);
    if !path.exists() {
        *state.sync_running.lock().unwrap() = false;
        return Err(format!("Directory not found: {}", watch_dir));
    }

    let token = state.access_token.lock().unwrap().clone()
        .ok_or("Not authenticated")?;
    let server = state.server_url.lock().unwrap().clone();

    let engine = Arc::new(Mutex::new(SyncEngine {
        server_url: server,
        access_token: token,
        watch_dir: path.clone(),
        local_state: HashMap::new(),
        remote_state: HashMap::new(),
        stop_flag: Arc::new(AtomicBool::new(false)),
    }));

    let engine_clone = engine.clone();
    let stop_flag = engine.lock().unwrap().stop_flag.clone();

    // Initial sync: pull remote changes, push local changes
    {
        let eng = engine.lock().unwrap();
        let _ = emit(&app, "sync", &format!("Starting sync for {}", watch_dir));
        if let Err(e) = eng.pull_changes(&app).await {
            let _ = emit(&app, "sync-error", &e);
        }
    }

    // File watcher: detect local changes → upload
    let mut watcher = notify::recommended_watcher(move |event: Result<Event, notify::Error>| {
        if stop_flag.load(Ordering::Relaxed) { return; }
        if let Ok(event) = event {
            match event.kind {
                EventKind::Create(_) | EventKind::Modify(_) => {
                    for path in &event.paths {
                        if path.is_file() {
                            if let Ok(mut eng) = engine_clone.lock() {
                                let app = app.clone();
                                let path_clone = path.clone();
                                let eng_ptr: *const SyncEngine = &*eng;
                                // SAFETY: We only clone the necessary fields for the async block.
                                // The engine Mutex is released when this block completes.
                                let server = eng.server_url.clone();
                                let token = eng.access_token.clone();
                                drop(eng);
                                tauri::async_runtime::spawn(async move {
                                    match upload_file(&server, &token, &path_clone).await {
                                        Ok(_) => {
                                            let _ = app.emit("sync-file-uploaded", path_clone.display().to_string());
                                        }
                                        Err(e) => {
                                            let _ = app.emit("sync-error", format!("Upload {}: {}", path_clone.display(), e));
                                        }
                                    }
                                });
                            }
                        }
                    }
                }
                EventKind::Remove(_) => {
                    for path in &event.paths {
                        let _ = app.emit("sync-file-removed", path.display().to_string());
                    }
                }
                _ => {}
            }
        }
    }).map_err(|e| e.to_string())?;

    watcher.watch(&path, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    std::mem::forget(watcher);

    Ok(())
}

#[tauri::command]
pub async fn stop_sync(state: State<'_, AppState>) -> Result<(), String> {
    let mut running = state.sync_running.lock().unwrap();
    if !*running {
        return Err("Sync not running".to_string());
    }
    *running = false;
    Ok(())
}

// ── Sync Engine Methods ───────────────────────────────────────────────────

impl SyncEngine {
    /// Pull changes from server since last known state
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

        let created = json["created"].as_array();
        let modified = json["modified"].as_array();
        let deleted = json["deleted"].as_array();

        let total_new = created.map(|a| a.len()).unwrap_or(0);
        let total_mod = modified.map(|a| a.len()).unwrap_or(0);
        let total_del = deleted.map(|a| a.len()).unwrap_or(0);

        if total_new + total_mod + total_del > 0 {
            let _ = emit(app, "sync", &format!(
                "Changes: +{} new, ~{} modified, -{} deleted",
                total_new, total_mod, total_del
            ));

            // Download new/modified files to local watch dir
            for item in created.into_iter().flatten().chain(modified.into_iter().flatten()) {
                let node_id = item["id"].as_str().unwrap_or("");
                let name = item["name"].as_str().unwrap_or("");
                let dest = self.watch_dir.join(name);
                if !dest.exists() {
                    if let Err(e) = self.download_file(node_id, name, &dest).await {
                        let _ = emit(app, "sync-error", &format!("Download {}: {}", name, e));
                    }
                }
            }

            // Track deleted items (don't auto-delete local — user decides)
            for item in deleted.into_iter().flatten() {
                let name = item["name"].as_str().unwrap_or("");
                let _ = emit(app, "sync-remote-deleted", name);
            }
        } else {
            let _ = emit(app, "sync", "Already up to date");
        }

        Ok(())
    }

    async fn download_file(&self, node_id: &str, name: &str, dest: &PathBuf) -> Result<(), String> {
        let client = reqwest::Client::new();
        let resp = client
            .get(format!("{}/api/files/{}/download", self.server_url, node_id))
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

async fn upload_file(server: &str, token: &str, path: &PathBuf) -> Result<(), String> {
    let name = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    let data = tokio::fs::read(path).await.map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new()
        .part("file", reqwest::multipart::Part::bytes(data)
            .file_name(name.to_string())
            .mime_str("application/octet-stream")
            .map_err(|e| e.to_string())?);

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/files/upload", server))
        .header("Authorization", format!("Bearer {}", token))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Upload request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Upload HTTP {}: {}", resp.status(),
            resp.text().await.unwrap_or_default()));
    }

    Ok(())
}

fn emit(app: &AppHandle, event: &str, msg: &str) -> Result<(), String> {
    app.emit("sync-event", SyncEvent {
        event: event.to_string(),
        path: None,
        name: None,
        message: msg.to_string(),
    }).map_err(|e| e.to_string())
}
