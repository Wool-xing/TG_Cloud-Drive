use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use crate::AppState;

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

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_clone = stop_flag.clone();

    let mut watcher = notify::recommended_watcher(move |event: Result<Event, notify::Error>| {
        if stop_flag_clone.load(Ordering::Relaxed) { return; }
        if let Ok(event) = event {
            match event.kind {
                EventKind::Create(_) | EventKind::Modify(_) => {
                    for path in &event.paths {
                        if path.is_file() {
                            let _ = app.emit("sync-file-changed", path.display().to_string());
                        }
                    }
                }
                _ => {}
            }
        }
    }).map_err(|e| e.to_string())?;

    watcher.watch(&path, RecursiveMode::Recursive).map_err(|e| e.to_string())?;

    // Keep watcher alive by leaking it (sync runs until stop_sync called)
    // In production, store in app state to allow clean shutdown
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
