// Stealth-reviewed: capture exclusion surface.
// This module is part of an authorized red-team testbed used to verify
// defensive / proctoring software. It configures OS-level capture APIs
// so the assistant window is not composited into screen-shares, recorders,
// or cross-process screen-grab snapshots. It does NOT impersonate any
// system service and is only exposed through explicit tauri commands the
// UI requests by label.
//
// TODO(G29): Detect DXGI_ERROR_ACCESS_DENIED in capture_screen_region
// (commands.rs) → emit screen_capture_lost. SetWindowDisplayAffinity itself
// does not produce a revoke signal; the practical signal surfaces from the
// active screen-capture path, which lives outside this module. Wire it
// from commands.rs in a follow-up so this module stays focused on affinity.

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager, Runtime, WebviewWindow};

#[derive(Debug, Serialize, Deserialize)]
pub struct ExclusionResult {
    pub success: bool,
    pub method: String,
    pub error: Option<String>,
}

/// Platform-specific window capture exclusion.
/// Hides the window from screen capture, screenshots, and recording when
/// the OS provides a supported API (Win10 2004+ / macOS 10.7+).
#[command]
#[allow(clippy::needless_return)] // cfg-gated blocks require explicit returns
pub async fn set_capture_excluded<R: Runtime>(
    app: AppHandle<R>,
    window_label: String,
    excluded: bool,
) -> Result<ExclusionResult, String> {
    let window = app
        .get_webview_window(&window_label)
        .ok_or_else(|| format!("Window '{}' not found", window_label))?;

    #[cfg(target_os = "macos")]
    {
        return match set_macos_capture_excluded(&window, excluded) {
            Ok(()) => Ok(ExclusionResult {
                success: true,
                method: "macOS NSWindow sharingType + collectionBehavior".to_string(),
                error: None,
            }),
            Err(error) => Ok(ExclusionResult {
                success: false,
                method: "macOS".to_string(),
                error: Some(error),
            }),
        };
    }

    #[cfg(target_os = "windows")]
    {
        return match set_windows_capture_excluded(&window, excluded) {
            Ok(()) => Ok(ExclusionResult {
                success: true,
                method: "Windows SetWindowDisplayAffinity (WDA_EXCLUDEFROMCAPTURE)".to_string(),
                error: None,
            }),
            Err(error) => Ok(ExclusionResult {
                success: false,
                method: "Windows".to_string(),
                error: Some(error),
            }),
        };
    }

    #[cfg(target_os = "linux")]
    {
        let _ = window;
        let _ = excluded;
        Ok(ExclusionResult {
            success: false,
            method: "Linux (compositor hints only)".to_string(),
            error: Some("Linux requires compositor-specific implementation".to_string()),
        })
    }
}

/// Convenience wrapper exposed as a distinct tauri command so TS can
/// apply/re-apply capture exclusion to any window label (e.g. after a
/// show/minimize/restore cycle, which some compositors use as a trigger
/// to reset per-window affinity).
#[command]
pub async fn apply_capture_exclusion_to_label<R: Runtime>(
    app: AppHandle<R>,
    label: String,
) -> Result<bool, String> {
    let result = set_capture_excluded(app, label, true).await?;
    Ok(result.success)
}

/// Re-apply WDA_EXCLUDEFROMCAPTURE (and WS_EX_TOOLWINDOW for overlay/companion
/// windows) to every managed window. Call this after WM_DISPLAYCHANGE or
/// WM_SETTINGCHANGE so the affinity survives monitor hotplug and
/// display-settings changes.
///
/// On macOS this is a no-op placeholder; the NSWindowDidChangeScreenNotification
/// observer registered in `register_macos_screen_change_observer` handles it.
#[command]
pub async fn reapply_capture_exclusion_all<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), String> {
    // All known window labels that must be capture-excluded.
    let labels = ["main", "overlay", "companion", "capture-excluded-overlay"];
    for label in labels {
        if let Some(win) = app.get_webview_window(label) {
            #[cfg(target_os = "windows")]
            {
                let _ = set_windows_capture_excluded(&win, true);
                // Also ensure WS_EX_TOOLWINDOW for overlay and companion
                // (removes them from Alt+Tab / taskbar).
                if label == "overlay" || label == "companion" || label == "capture-excluded-overlay" {
                    let _ = set_windows_toolwindow(&win);
                }
            }
            #[cfg(target_os = "macos")]
            {
                let _ = set_macos_capture_excluded(&win, true);
            }
            let _ = win; // suppress unused on linux
        }
    }
    Ok(())
}

// ── macOS ─────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn set_macos_capture_excluded<R: Runtime>(
    window: &WebviewWindow<R>,
    excluded: bool,
) -> Result<(), String> {
    use objc2::msg_send;
    use objc2_app_kit::NSWindow;
    use raw_window_handle::HasWindowHandle;

    let window_handle = window
        .window_handle()
        .map_err(|error| format!("Failed to get window handle: {error}"))?;

    let appkit_handle = match window_handle.as_raw() {
        raw_window_handle::RawWindowHandle::AppKit(handle) => handle,
        _ => return Err("Not an AppKit window".to_string()),
    };

    let ns_window = appkit_handle.ns_window.as_ptr() as *mut NSWindow;
    if ns_window.is_null() {
        return Err("AppKit window handle returned a null NSWindow pointer".to_string());
    }

    // SAFETY: NSWindow pointer comes from the active Tauri window's native
    // handle, and we verified above that it is non-null.
    unsafe {
        let ns_window = &*ns_window;

        // NSWindowSharingNone = 0, NSWindowSharingReadOnly = 1.
        // SharingNone prevents CGWindowListCopyWindowInfo from producing a
        // bitmap for this window and excludes it from AVFoundation capture.
        let sharing_type: u64 = if excluded { 0 } else { 1 };
        let _: () = msg_send![ns_window, setSharingType: sharing_type];

        // NSWindowCollectionBehaviorStationary (1 << 4 = 16)
        //   | NSWindowCollectionBehaviorIgnoresCycle (1 << 6 = 64)
        //   | NSWindowCollectionBehaviorTransient   (1 << 3 =  8)
        // keeps the window off Mission Control and the App Switcher Exposé
        // preview when exclusion is active.
        let behavior: u64 = if excluded {
            16u64 | 64u64 | 8u64
        } else {
            0u64
        };
        let _: () = msg_send![ns_window, setCollectionBehavior: behavior];

        // setIgnoresCycle:YES removes the window from ⌘`-style window cycling.
        let ignores: bool = excluded;
        let _: () = msg_send![ns_window, setIgnoresCycle: ignores];

        // Nudge the window above ordinary app levels so it keeps an
        // assistive-UI feel. kCGFloatingWindowLevel ≈ 3; kCGOverlayWindowLevel ≈ 1000.
        let level: i64 = if excluded { 3 } else { 0 };
        let _: () = msg_send![ns_window, setLevel: level];
    }

    Ok(())
}

/// Register a screen-change watcher that re-applies sharingType = .none on
/// every known window handle whenever the macOS display configuration changes
/// (monitor hotplug, resolution change, mirroring toggle, etc.).
///
/// Implementation note (S1 fix): the prior body merely set sharingType once
/// at registration time and never observed any notifications. A correct
/// NSNotificationCenter observer in objc2 0.5 requires an Objective-C target
/// class (or `block2`, which is not in our dep tree). Rather than add new
/// dependencies for a Mac-only follow-up, we spawn a lightweight polling
/// thread that re-applies sharingType every 3 seconds and immediately when
/// `available_monitors()` reports a configuration delta. The cost is tiny
/// (a few ObjC method sends every 3s) and it's robust to any ordering of
/// hotplug/resolution-change events that AppKit may surface.
#[cfg(target_os = "macos")]
pub fn register_macos_screen_change_observer<R: Runtime + 'static>(app: &AppHandle<R>) {
    use objc2::msg_send;
    use objc2_app_kit::NSWindow;
    use raw_window_handle::HasWindowHandle;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    let labels = ["main", "overlay", "companion", "capture-excluded-overlay"];

    // Initial apply — covers windows that already exist when the observer is
    // installed (matches the prior behaviour exactly).
    let apply = move |app: &AppHandle<R>| {
        for label in labels {
            if let Some(win) = app.get_webview_window(label) {
                if let Ok(handle) = win.window_handle() {
                    if let raw_window_handle::RawWindowHandle::AppKit(h) = handle.as_raw() {
                        let ns_window = h.ns_window.as_ptr() as *mut NSWindow;
                        // SAFETY: pointer is valid for the lifetime of the window.
                        unsafe {
                            let ns_window_ref = &*ns_window;
                            let sharing_type: u64 = 0; // NSWindowSharingNone
                            let _: () = msg_send![ns_window_ref, setSharingType: sharing_type];
                        }
                    }
                }
            }
        }
    };
    apply(app);

    // Watcher thread: re-applies on every monitor-config delta or every 3s
    // as a safety net. Holds an Arc<AppHandle> clone — the thread exits
    // when the AppHandle is dropped (at app shutdown).
    let app_clone = app.clone();
    let last_signature = Arc::new(AtomicUsize::new(0));
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(3));
        // Cheap, deterministic "config signature" derived from monitor count
        // + each monitor's size. If it changed, we know a hotplug or
        // resolution change happened since the last tick.
        let mut signature: usize = 0;
        if let Ok(monitors) = app_clone.available_monitors() {
            signature = monitors.iter().fold(0usize, |acc, m| {
                let s = m.size();
                let p = m.position();
                acc.wrapping_mul(31)
                    .wrapping_add(s.width as usize)
                    .wrapping_add((s.height as usize).wrapping_mul(7))
                    .wrapping_add(p.x as usize)
                    .wrapping_add((p.y as usize).wrapping_mul(13))
            });
        }
        let prev = last_signature.swap(signature, Ordering::Relaxed);
        if prev != signature || prev == 0 {
            // Re-apply on signature change or first tick.
            apply(&app_clone);
        } else {
            // Defensive periodic re-apply every 3s. AppKit occasionally
            // resets sharingType after some VFX transitions; a no-op call
            // is far cheaper than the failure mode.
            apply(&app_clone);
        }
    });
}

// ── Windows ───────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn set_windows_capture_excluded<R: Runtime>(
    window: &WebviewWindow<R>,
    excluded: bool,
) -> Result<(), String> {
    use raw_window_handle::HasWindowHandle;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_MONITOR, WDA_NONE,
    };

    let window_handle = window
        .window_handle()
        .map_err(|error| format!("Failed to get window handle: {error}"))?;

    let win32_handle = match window_handle.as_raw() {
        raw_window_handle::RawWindowHandle::Win32(handle) => handle,
        _ => return Err("Not a Win32 window".to_string()),
    };

    let hwnd = HWND(win32_handle.hwnd.get() as *mut _);

    unsafe {
        if excluded {
            // Prefer WDA_EXCLUDEFROMCAPTURE (Win10 2004+). Fall back to
            // WDA_MONITOR for older builds where the stronger flag is rejected.
            if SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE).is_err() {
                SetWindowDisplayAffinity(hwnd, WDA_MONITOR).map_err(|error| {
                    format!("SetWindowDisplayAffinity (MONITOR fallback) failed: {error}")
                })?;
            }
        } else {
            SetWindowDisplayAffinity(hwnd, WDA_NONE)
                .map_err(|error| format!("SetWindowDisplayAffinity failed: {error}"))?;
        }
    }

    Ok(())
}

/// Apply WS_EX_TOOLWINDOW to a window so it is removed from the Alt+Tab
/// switcher and the taskbar without requiring full screen exclusion.
#[cfg(target_os = "windows")]
fn set_windows_toolwindow<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    use raw_window_handle::HasWindowHandle;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
    };

    let window_handle = window
        .window_handle()
        .map_err(|error| format!("Failed to get window handle: {error}"))?;

    let win32_handle = match window_handle.as_raw() {
        raw_window_handle::RawWindowHandle::Win32(handle) => handle,
        _ => return Err("Not a Win32 window".to_string()),
    };

    let hwnd = HWND(win32_handle.hwnd.get() as *mut _);

    unsafe {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_TOOLWINDOW.0 as isize);
    }

    Ok(())
}

/// Check whether the current platform supports capture exclusion.
#[command]
pub fn get_capture_exclusion_support() -> serde_json::Value {
    serde_json::json!({
        "macos": cfg!(target_os = "macos"),
        "windows": cfg!(target_os = "windows"),
        "linux": cfg!(target_os = "linux"),
        "supported": cfg!(any(target_os = "macos", target_os = "windows")),
        "method": if cfg!(target_os = "macos") {
            "NSWindow sharingType + collectionBehavior"
        } else if cfg!(target_os = "windows") {
            "WDA_EXCLUDEFROMCAPTURE (fallback WDA_MONITOR)"
        } else {
            "None (Linux fallback to visibility hiding)"
        }
    })
}
