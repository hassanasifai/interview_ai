use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: u32,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

#[tauri::command]
pub fn get_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let primary = app.primary_monitor().ok().flatten();
    Ok(monitors
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            let pos = m.position();
            let size = m.size();
            MonitorInfo {
                id: i as u32,
                name: m.name().map_or("Unknown", |v| v.as_str()).to_string(),
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                scale_factor: m.scale_factor(),
                is_primary: primary
                    .as_ref()
                    .map(|p| p.name() == m.name())
                    .unwrap_or(false),
            }
        })
        .collect())
}

#[tauri::command]
pub fn set_overlay_monitor(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    _height: u32,
) -> Result<(), String> {
    // Move overlay and companion windows to the right side of the specified monitor
    let target_x = x + width as i32 - 460;
    let target_y = y + 40;
    for label in ["overlay", "companion", "capture-excluded-overlay"] {
        match app.get_webview_window(label) {
            Some(win) => {
                if let Err(e) = win.set_position(tauri::PhysicalPosition::new(target_x, target_y))
                {
                    eprintln!(
                        "[set_overlay_monitor] failed to reposition window '{label}': {e}"
                    );
                }
            }
            None => {
                eprintln!(
                    "[set_overlay_monitor] window '{label}' not found; skipping"
                );
            }
        }
    }
    Ok(())
}
