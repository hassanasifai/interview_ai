use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Debug, Deserialize, Serialize)]
pub struct OverlayConfig {
    pub label: String,
    pub title: String,
    pub width: f64,
    pub height: f64,
    pub x: f64,
    pub y: f64,
    pub always_on_top: bool,
    pub skip_taskbar: bool,
    pub decorations: bool,
    pub transparent: bool,
    pub resizable: bool,
    pub visible: bool,
}

impl Default for OverlayConfig {
    fn default() -> Self {
        Self {
            label: "capture-excluded-overlay".to_string(),
            title: "MeetingMind - Private Assistant".to_string(),
            width: 400.0,
            height: 600.0,
            x: 100.0,
            y: 100.0,
            always_on_top: true,
            skip_taskbar: true,
            decorations: false,
            transparent: true,
            resizable: false,
            visible: false,
        }
    }
}

/// Create a capture-excluded overlay window.
/// This window can be hidden from supported OS-level capture APIs.
fn create_capture_excluded_overlay<R: Runtime>(
    app: &AppHandle<R>,
    config: OverlayConfig,
) -> Result<WebviewWindow<R>, String> {
    let window = WebviewWindowBuilder::new(
        app,
        &config.label,
        WebviewUrl::App("/?window=capture-excluded-overlay".into()),
    )
        .title(&config.title)
        .inner_size(config.width, config.height)
        .position(config.x, config.y)
        .always_on_top(config.always_on_top)
        .skip_taskbar(config.skip_taskbar)
        .decorations(config.decorations)
        .transparent(config.transparent)
        .resizable(config.resizable)
        .visible(false)
        .build()
        .map_err(|error| format!("Failed to create overlay window: {error}"))?;

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let _ = tauri::async_runtime::block_on(crate::commands::set_capture_excluded(
            app.clone(),
            config.label.clone(),
            true,
        ));
    }

    // WS_EX_TOOLWINDOW removes the window from Alt+Tab and the taskbar without
    // requiring full screen exclusion.  Applied to overlay and companion windows
    // on Windows; on macOS NSWindowCollectionBehaviorIgnoresCycle already handles
    // the equivalent.
    #[cfg(target_os = "windows")]
    apply_toolwindow_style(&window);

    if config.visible {
        let _ = window.show();
    }

    Ok(window)
}

#[cfg(target_os = "windows")]
fn apply_toolwindow_style<R: Runtime>(window: &WebviewWindow<R>) {
    use raw_window_handle::HasWindowHandle;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
    };

    if let Ok(handle) = window.window_handle() {
        if let raw_window_handle::RawWindowHandle::Win32(h) = handle.as_raw() {
            let hwnd = HWND(h.hwnd.get() as *mut _);
            unsafe {
                let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_TOOLWINDOW.0 as isize);
            }
        }
    }
}

/// Toggle overlay visibility while preserving capture exclusion state.
fn toggle_overlay_visibility<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    visible: bool,
) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("Window '{}' not found", label))?;

    if visible {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    } else {
        window.hide().map_err(|error| error.to_string())?;
    }

    Ok(())
}

/// Destroy overlay and cleanup.
fn destroy_overlay_window<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("Window '{}' not found", label))?;

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let _ = tauri::async_runtime::block_on(crate::commands::set_capture_excluded(
            app.clone(),
            label.to_string(),
            false,
        ));
    }

    window.close().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_overlay(app: AppHandle, config: Option<OverlayConfig>) -> Result<(), String> {
    let config = config.unwrap_or_default();
    let _ = create_capture_excluded_overlay(&app, config)?;
    Ok(())
}

#[tauri::command]
pub fn toggle_overlay(app: AppHandle, label: String, visible: bool) -> Result<(), String> {
    toggle_overlay_visibility(&app, &label, visible)
}

#[tauri::command]
pub fn destroy_overlay(app: AppHandle, label: String) -> Result<(), String> {
    destroy_overlay_window(&app, &label)
}
