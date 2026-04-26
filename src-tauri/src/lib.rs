pub mod audio;
pub mod commands;
mod db;
mod models;
pub mod window_manager;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use log::{debug, warn};

use commands::{
    append_audit_event, call_llm, capture_screen_region, clear_audit_events,
    delete_api_key, get_active_window_info, get_capture_exclusion_support,
    get_monitors, get_native_audio_pipeline_status, get_vad_threshold, list_audit_events,
    list_mic_devices, list_session_summaries, list_transcript_items,
    reapply_capture_exclusion_all, retrieve_api_key, run_ocr_on_image, search_knowledge_base,
    set_capture_excluded, set_click_through, set_overlay_monitor, set_vad_threshold,
    start_meeting_daemon, start_mic_capture, start_native_audio_pipeline, stop_meeting_daemon,
    stop_mic_capture, stop_native_audio_pipeline, store_api_key, transcribe_audio_chunk,
    upsert_session_summary, upsert_transcript_item, upsert_transcript_items_batch,
    validate_remote_url, MeetingDaemonState, MicCaptureState, NativeRuntime, NativeRuntimeState,
    WasapiState,
};
use db::Database;
use window_manager::{create_overlay, destroy_overlay, toggle_overlay};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Auto-update plugin: production builds can self-update from a
        // signed release feed. Without an `updater` block in tauri.conf.json
        // the plugin compiles but does nothing until configured.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let database = Database::initialize(app.handle())?;
            app.manage(Mutex::new(database));
            app.manage(NativeRuntimeState::new(NativeRuntime::default()));
            app.manage(WasapiState::new(None));
            app.manage(MeetingDaemonState::new(None));
            app.manage(MicCaptureState::default());
            setup_tray(app.handle())?;
            setup_global_shortcuts(app.handle())?;
            setup_display_change_reapply(app.handle());

            // macOS: register NSWindowDidChangeScreenNotification observer so
            // sharingType = .none is re-applied after monitor hotplug / display
            // settings changes. (macOS-only code path.)
            #[cfg(target_os = "macos")]
            crate::commands::capture_exclusion::register_macos_screen_change_observer(
                app.handle(),
            );

            app.handle().plugin(build_log_plugin())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Persistence
            upsert_session_summary,
            list_session_summaries,
            upsert_transcript_item,
            upsert_transcript_items_batch,
            list_transcript_items,
            append_audit_event,
            list_audit_events,
            clear_audit_events,
            // Audio
            start_native_audio_pipeline,
            stop_native_audio_pipeline,
            get_native_audio_pipeline_status,
            transcribe_audio_chunk,
            // Screen / OCR
            capture_screen_region,
            run_ocr_on_image,
            // Window info
            get_active_window_info,
            // Knowledge base
            search_knowledge_base,
            // LLM (multi-provider, streaming)
            call_llm,
            // Capture exclusion
            set_capture_excluded,
            get_capture_exclusion_support,
            reapply_capture_exclusion_all,
            // Click-through overlay
            set_click_through,
            // Overlay window management
            create_overlay,
            toggle_overlay,
            destroy_overlay,
            // OS keychain
            store_api_key,
            retrieve_api_key,
            delete_api_key,
            // Meeting auto-detection daemon
            start_meeting_daemon,
            stop_meeting_daemon,
            // Microphone capture
            start_mic_capture,
            stop_mic_capture,
            list_mic_devices,
            // VAD
            get_vad_threshold,
            set_vad_threshold,
            // Monitor info
            get_monitors,
            set_overlay_monitor,
            // Local Whisper STT (Gap 1)
            crate::audio::local_stt::transcribe_chunk_local,
            crate::audio::local_stt::check_local_stt_available,
            crate::audio::local_stt::download_whisper_model,
            // URL allowlist validation (LOW 26)
            validate_remote_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_hide = CheckMenuItem::with_id(
        app,
        "toggle_assistant",
        "Show/Hide AI Assistant",
        true,
        false,
        None::<&str>,
    )?;
    let dashboard = MenuItem::with_id(
        app,
        "share_guard_dashboard",
        "Share Guard Dashboard",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_hide, &dashboard, &quit])?;
    let show_hide_for_event = show_hide.clone();

    let tray_builder = TrayIconBuilder::with_id("meetingmind-tray")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle_assistant" => {
                let is_visible = toggle_assistant_window(app);
                let _ = show_hide_for_event.set_checked(is_visible);
            }
            "share_guard_dashboard" => {
                show_share_guard_dashboard(app);
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        tray_builder.icon(icon.clone()).build(app)?;
    } else {
        tray_builder.build(app)?;
    }

    Ok(())
}

/// Register a global shortcut that emits `event_name` to all windows when
/// pressed. If the underlying register call fails (e.g. because the combo is
/// already held by another application or previously registered) we log a
/// warning rather than aborting setup.
fn register_emit_shortcut(app: &AppHandle, shortcut: Shortcut, event_name: &'static str) {
    let label = format!("{shortcut:?}");
    let res = app
        .global_shortcut()
        .on_shortcut(shortcut, move |app, _, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = app.emit(event_name, ());
            }
        });
    match res {
        Ok(()) => debug!(target: "meetingmind::hotkey", "registered shortcut {label} -> {event_name}"),
        Err(e) => {
            warn!(
                target: "meetingmind::hotkey",
                "failed to register shortcut {label} -> {event_name}: {e}"
            );
            // LOW 21 fix: surface the failure so the UI can prompt the user
            // to remap the chord. Previously this was a silent log-only path
            // and users had no way to know why their hotkey did nothing.
            let _ = app.emit(
                "hotkey_register_failed",
                serde_json::json!({
                    "chord": label.clone(),
                    "event": event_name,
                    "reason": e.to_string(),
                }),
            );
        }
    }
}

/// Register a global shortcut whose handler only fires when the overlay window
/// currently has focus. Used for the un-modified `Escape` dismiss hotkey so it
/// doesn't interfere with Escape handling in other applications.
fn register_overlay_only_shortcut(
    app: &AppHandle,
    shortcut: Shortcut,
    event_name: &'static str,
) {
    let label = format!("{shortcut:?}");
    let res = app
        .global_shortcut()
        .on_shortcut(shortcut, move |app, _, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if let Some(overlay) = app.get_webview_window("overlay") {
                if overlay.is_focused().unwrap_or(false) {
                    let _ = app.emit(event_name, ());
                }
            }
        });
    match res {
        Ok(()) => debug!(
            target: "meetingmind::hotkey",
            "registered overlay-only shortcut {label} -> {event_name}"
        ),
        Err(e) => {
            warn!(
                target: "meetingmind::hotkey",
                "failed to register shortcut {label} -> {event_name}: {e}"
            );
            let _ = app.emit(
                "hotkey_register_failed",
                serde_json::json!({
                    "chord": label.clone(),
                    "event": event_name,
                    "reason": e.to_string(),
                }),
            );
        }
    }
}

fn setup_global_shortcuts(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    const CTRL_SHIFT: Modifiers = Modifiers::CONTROL.union(Modifiers::SHIFT);

    // Existing hotkeys ---------------------------------------------------
    register_emit_shortcut(
        app,
        Shortcut::new(Some(CTRL_SHIFT), Code::KeyH),
        "share_guard_toggle_shortcut",
    );
    register_emit_shortcut(
        app,
        Shortcut::new(Some(CTRL_SHIFT), Code::KeyS),
        "hotkey_screenshot_solve",
    );
    register_emit_shortcut(
        app,
        Shortcut::new(Some(CTRL_SHIFT), Code::KeyC),
        "hotkey_copy_answer",
    );
    register_emit_shortcut(
        app,
        Shortcut::new(Some(CTRL_SHIFT), Code::ArrowUp),
        "hotkey_scroll_up",
    );
    register_emit_shortcut(
        app,
        Shortcut::new(Some(CTRL_SHIFT), Code::ArrowDown),
        "hotkey_scroll_down",
    );
    register_emit_shortcut(
        app,
        Shortcut::new(Some(CTRL_SHIFT), Code::KeyT),
        "hotkey_toggle_click_through",
    );

    // Phase 1A additions -------------------------------------------------
    register_emit_shortcut(
        app,
        Shortcut::new(Some(CTRL_SHIFT), Code::Enter),
        "hotkey_generate_answer",
    );
    register_emit_shortcut(
        app,
        Shortcut::new(Some(CTRL_SHIFT), Code::KeyN),
        "hotkey_next_suggestion",
    );
    register_emit_shortcut(
        app,
        Shortcut::new(Some(CTRL_SHIFT), Code::KeyG),
        "hotkey_provider_groq",
    );
    register_emit_shortcut(
        app,
        Shortcut::new(Some(CTRL_SHIFT), Code::KeyO),
        "hotkey_provider_openai",
    );
    register_emit_shortcut(
        app,
        Shortcut::new(Some(CTRL_SHIFT), Code::KeyA),
        "hotkey_provider_anthropic",
    );

    // Escape with no modifiers — only forwarded when the overlay window is
    // focused, so we don't hijack Escape globally.
    register_overlay_only_shortcut(
        app,
        Shortcut::new(None, Code::Escape),
        "hotkey_dismiss",
    );

    Ok(())
}

fn toggle_assistant_window(app: &AppHandle) -> bool {
    let window = app
        .get_webview_window("overlay")
        .or_else(|| app.get_webview_window("main"));

    if let Some(window) = window {
        let is_visible = window.is_visible().unwrap_or(false);
        if is_visible {
            let _ = window.hide();
            false
        } else {
            let _ = window.show();
            let _ = window.set_focus();
            true
        }
    } else {
        false
    }
}

fn show_share_guard_dashboard(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("open_share_guard_dashboard", ());
    }
}

/// Spawn a background thread that creates a message-only Win32 window and
/// re-applies WDA_EXCLUDEFROMCAPTURE (+ WS_EX_TOOLWINDOW on overlay/companion)
/// whenever WM_DISPLAYCHANGE or WM_SETTINGCHANGE is received.  This ensures
/// the affinity survives monitor hotplug and display-settings changes.
///
/// On non-Windows targets this is an intentional no-op.
fn setup_display_change_reapply(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, PostQuitMessage,
            RegisterClassExW, CW_USEDEFAULT, HWND_MESSAGE, MSG, WM_DESTROY, WM_DISPLAYCHANGE,
            WM_SETTINGCHANGE, WNDCLASSEXW, WS_OVERLAPPEDWINDOW,
        };
        use windows::core::PCWSTR;

        let app_handle = app.clone();

        std::thread::spawn(move || {
            unsafe extern "system" fn wnd_proc(
                hwnd: HWND,
                msg: u32,
                wparam: WPARAM,
                lparam: LPARAM,
            ) -> LRESULT {
                // The AppHandle is stored as a Box<AppHandle> in the window's
                // GWLP_USERDATA.  We retrieve it, call reapply, then put it
                // back so it is not dropped.
                use windows::Win32::UI::WindowsAndMessaging::{
                    GetWindowLongPtrW, GWLP_USERDATA,
                };
                match msg {
                    WM_DISPLAYCHANGE | WM_SETTINGCHANGE => {
                        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA);
                        if ptr != 0 {
                            let app_ref =
                                &*(ptr as *const tauri::AppHandle);
                            let handle = app_ref.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ =
                                    crate::commands::reapply_capture_exclusion_all(handle)
                                        .await;
                            });
                        }
                        LRESULT(0)
                    }
                    WM_DESTROY => {
                        PostQuitMessage(0);
                        LRESULT(0)
                    }
                    _ => DefWindowProcW(hwnd, msg, wparam, lparam),
                }
            }

            unsafe {
                let hinstance = match GetModuleHandleW(PCWSTR::null()) {
                    Ok(h) => h,
                    Err(_) => return,
                };

                let class_name: Vec<u16> = "MeetingMindMsgWnd\0"
                    .encode_utf16()
                    .collect();

                let wc = WNDCLASSEXW {
                    cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                    lpfnWndProc: Some(wnd_proc),
                    hInstance: hinstance.into(),
                    lpszClassName: PCWSTR(class_name.as_ptr()),
                    ..Default::default()
                };
                RegisterClassExW(&wc);

                let window_name: Vec<u16> = "MeetingMindMsg\0".encode_utf16().collect();

                let hwnd = match CreateWindowExW(
                    Default::default(),
                    PCWSTR(class_name.as_ptr()),
                    PCWSTR(window_name.as_ptr()),
                    WS_OVERLAPPEDWINDOW,
                    CW_USEDEFAULT,
                    CW_USEDEFAULT,
                    CW_USEDEFAULT,
                    CW_USEDEFAULT,
                    Some(HWND_MESSAGE), // message-only; invisible
                    None,
                    Some(hinstance.into()),
                    None,
                ) {
                    Ok(h) => h,
                    Err(_) => return,
                };

                // Store the AppHandle in GWLP_USERDATA so wnd_proc can access it.
                use windows::Win32::UI::WindowsAndMessaging::{
                    SetWindowLongPtrW, GWLP_USERDATA,
                };
                let boxed = Box::new(app_handle);
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, Box::into_raw(boxed) as isize);

                // Message pump for the message-only window.
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, Some(hwnd), 0, 0).as_bool() {
                    DispatchMessageW(&msg);
                }
            }
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
    }
}

// -----------------------------------------------------------------------------
// Logging (G7 / G8 / G11) — JSON-formatted, file+stdout, with per-minute
// de-duplication for noisy Warn/Error messages so identical failures don't
// flood the log.
// -----------------------------------------------------------------------------

struct SampleState {
    count: u32,
    suppressed: u32,
    window_start: std::time::Instant,
    last_summary: std::time::Instant,
}

static LOG_SAMPLE_STATE: OnceLock<Mutex<HashMap<u64, SampleState>>> = OnceLock::new();

fn log_sample_state() -> &'static Mutex<HashMap<u64, SampleState>> {
    LOG_SAMPLE_STATE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Returns `Some(formatted_line)` if the record should be emitted, or `None`
/// if it is being suppressed by the 60-second sampler. When emitting after
/// suppression we append a "(N similar suppressed)" summary.
fn apply_sampling(level: log::Level, target: &str, msg: &str) -> Option<String> {
    if level > log::Level::Warn {
        // `log::Level` ordering: Error(1) < Warn(2) < Info(3). ">Warn" means
        // Info/Debug/Trace, which we never sample.
        return Some(msg.to_string());
    }

    let key: u64 = {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut h = DefaultHasher::new();
        target.hash(&mut h);
        let head: String = msg.chars().take(80).collect();
        head.hash(&mut h);
        h.finish()
    };

    let now = std::time::Instant::now();
    let window = std::time::Duration::from_secs(60);
    let mut map = match log_sample_state().lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };

    let entry = map.entry(key).or_insert(SampleState {
        count: 0,
        suppressed: 0,
        window_start: now,
        last_summary: now,
    });

    // Reset window if expired.
    if now.duration_since(entry.window_start) >= window {
        // Emit a trailing summary if we suppressed any messages in the
        // previous window.
        let out = if entry.suppressed > 0 {
            let n = entry.suppressed;
            Some(format!("{msg} ... ({n} similar suppressed)"))
        } else {
            Some(msg.to_string())
        };
        entry.count = 1;
        entry.suppressed = 0;
        entry.window_start = now;
        entry.last_summary = now;
        return out;
    }

    entry.count += 1;
    if entry.count <= 5 {
        return Some(msg.to_string());
    }

    // Over the threshold: suppress, but emit a periodic summary every 60s.
    entry.suppressed += 1;
    if now.duration_since(entry.last_summary) >= window {
        let n = entry.suppressed;
        entry.last_summary = now;
        entry.suppressed = 0;
        return Some(format!("{msg} ... ({n} similar suppressed)"));
    }
    None
}

fn build_log_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

    let level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    let mut targets: Vec<Target> = Vec::new();
    targets.push(Target::new(TargetKind::LogDir {
        file_name: Some("meetingmind".into()),
    }));
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }

    tauri_plugin_log::Builder::default()
        .clear_targets()
        .targets(targets)
        .level(level)
        .max_file_size(5 * 1024 * 1024)
        .rotation_strategy(RotationStrategy::KeepSome(10))
        .format(|out, message, record| {
            let raw = message.to_string();
            let level = record.level();
            let target = record.target();
            let Some(final_msg) = apply_sampling(level, target, &raw) else {
                // Suppressed — write an empty line so fern doesn't choke, but
                // keep it parseable as JSON with a "suppressed" marker.
                let payload = serde_json::json!({
                    "ts": chrono_like_timestamp(),
                    "level": level.as_str(),
                    "target": target,
                    "msg": "",
                    "suppressed": true,
                });
                out.finish(format_args!("{payload}"));
                return;
            };
            let payload = serde_json::json!({
                "ts": chrono_like_timestamp(),
                "level": level.as_str(),
                "target": target,
                "msg": final_msg,
            });
            out.finish(format_args!("{payload}"));
        })
        .build()
}

/// Produce an RFC-3339 UTC timestamp without pulling in a new dependency.
/// Uses `SystemTime` + a small civil-time calculation so we do not require
/// `chrono` or a direct dependency on `time`.
fn chrono_like_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    let subsec_ms = dur.subsec_millis();

    // Days since the Unix epoch.
    let days = (secs / 86_400) as i64;
    let sod = secs % 86_400;
    let hour = (sod / 3600) as u32;
    let minute = ((sod % 3600) / 60) as u32;
    let second = (sod % 60) as u32;

    // Howard Hinnant's days_from_civil inverse. See
    // https://howardhinnant.github.io/date_algorithms.html
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!(
        "{year:04}-{m:02}-{d:02}T{hour:02}:{minute:02}:{second:02}.{subsec_ms:03}Z"
    )
}
