use tauri::{command, AppHandle, Manager, Runtime, WebviewWindow};

/// Set or clear click-through mode on a window.
/// When enabled, mouse events pass through to the window underneath —
/// the overlay remains visible but the user's cursor never leaves the
/// application being assisted.
#[command]
pub async fn set_click_through<R: Runtime>(
    app: AppHandle<R>,
    window_label: String,
    enabled: bool,
) -> Result<(), String> {
    let window = app
        .get_webview_window(&window_label)
        .ok_or_else(|| format!("Window '{}' not found", window_label))?;

    set_click_through_impl(&window, enabled)
}

#[cfg(target_os = "windows")]
fn set_click_through_impl<R: Runtime>(
    window: &WebviewWindow<R>,
    enabled: bool,
) -> Result<(), String> {
    use raw_window_handle::HasWindowHandle;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
    };

    let handle = window
        .window_handle()
        .map_err(|e| format!("Failed to get window handle: {e}"))?;

    let hwnd = match handle.as_raw() {
        raw_window_handle::RawWindowHandle::Win32(h) => {
            HWND(h.hwnd.get() as *mut _)
        }
        _ => return Err("Not a Win32 window".to_string()),
    };

    unsafe {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let new_style = if enabled {
            ex_style | WS_EX_TRANSPARENT.0 as isize | WS_EX_LAYERED.0 as isize
        } else {
            ex_style & !(WS_EX_TRANSPARENT.0 as isize) & !(WS_EX_LAYERED.0 as isize)
        };
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn set_click_through_impl<R: Runtime>(
    window: &WebviewWindow<R>,
    enabled: bool,
) -> Result<(), String> {
    use objc2::msg_send;
    use objc2_app_kit::NSWindow;
    use raw_window_handle::HasWindowHandle;

    let handle = window
        .window_handle()
        .map_err(|e| format!("Failed to get window handle: {e}"))?;

    let ns_window = match handle.as_raw() {
        raw_window_handle::RawWindowHandle::AppKit(h) => {
            h.ns_window.as_ptr() as *mut NSWindow
        }
        _ => return Err("Not an AppKit window".to_string()),
    };

    // SAFETY: pointer comes from an active Tauri window's native handle.
    unsafe {
        let _: () = msg_send![&*ns_window, setIgnoresMouseEvents: enabled];
    }

    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn set_click_through_impl<R: Runtime>(
    _window: &WebviewWindow<R>,
    _enabled: bool,
) -> Result<(), String> {
    Err("Click-through is not supported on this platform.".to_string())
}
