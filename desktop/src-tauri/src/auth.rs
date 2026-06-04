use serde::{Deserialize, Serialize};
use tauri::State;
use crate::AppState;

#[derive(Serialize, Deserialize)]
pub struct LoginResult {
    pub user: serde_json::Value,
    pub access_token: String,
    pub mek_salt: String,
}

#[tauri::command]
pub async fn login(
    state: State<'_, AppState>,
    server: String,
    identifier: String,
    password: String,
) -> Result<LoginResult, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/auth/login", server))
        .json(&serde_json::json!({
            "identifier": identifier,
            "password": password,
        }))
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    if !resp.status().is_success() {
        let msg = resp.text().await.unwrap_or_default();
        return Err(format!("Login failed ({})", msg));
    }

    let result: LoginResult = resp.json().await.map_err(|e| e.to_string())?;

    *state.server_url.lock().unwrap() = server;
    *state.access_token.lock().unwrap() = Some(result.access_token.clone());

    // Store token in OS keychain for persistence
    let _ = keyring::Entry::new("tgpan-desktop", &identifier)
        .and_then(|e| e.set_password(&result.access_token));

    Ok(result)
}
