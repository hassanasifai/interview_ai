use std::sync::Mutex;

use futures_util::StreamExt;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

pub mod capture_exclusion;
pub mod click_through;
pub mod keychain;
pub mod meeting_daemon;
pub mod monitor_info;
pub mod native_ocr;

pub use capture_exclusion::{
    get_capture_exclusion_support, reapply_capture_exclusion_all, set_capture_excluded,
};
pub use click_through::set_click_through;
pub use keychain::{delete_api_key, retrieve_api_key, store_api_key};
pub use meeting_daemon::{start_meeting_daemon, stop_meeting_daemon};
pub type MeetingDaemonState = Mutex<Option<meeting_daemon::MeetingDaemon>>;
pub use monitor_info::{get_monitors, set_overlay_monitor};

use crate::{
    audio::{
        wasapi_capture::WasapiLoopbackCapture,
        whisper_stt::WhisperSttClient,
    },
    db::Database,
    models::{
        ActiveWindowInfo, AudioPipelineStatus, AuditEvent, KnowledgePassage, LlmChunkPayload,
        LlmResponse, OcrResult, ScreenCaptureResult, SessionSummary, TranscriptItem,
    },
};

pub type DatabaseState = Mutex<Database>;
pub type NativeRuntimeState = Mutex<NativeRuntime>;
pub type WasapiState = Mutex<Option<WasapiLoopbackCapture>>;
pub type MicCaptureState = Mutex<Option<crate::audio::mic_capture::MicCapture>>;

#[derive(Debug, Clone)]
pub struct NativeRuntime {
    pub is_active: bool,
    pub sample_rate_hz: i64,
    pub channels: i64,
    pub last_error: Option<String>,
}

impl Default for NativeRuntime {
    fn default() -> Self {
        Self {
            is_active: false,
            sample_rate_hz: 16_000,
            channels: 1,
            last_error: None,
        }
    }
}

// ── URL allowlist (G14) ───────────────────────────────────────────────────────

const URL_ALLOWLIST: &[&str] = &[
    "https://drive.google.com/",
    "https://docs.google.com/",
    "https://api.zoom.us/",
    "https://zoom.us/",
    "https://teams.microsoft.com/",
    "https://meet.google.com/",
    "https://api.atlassian.com/",
    "https://api.notion.com/",
    "https://api.linear.app/",
    "https://api.github.com/",
];

// LOW 26 fix: now registered in lib.rs invoke_handler.
#[tauri::command]
pub fn validate_remote_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only HTTPS URLs are permitted".into());
    }
    if URL_ALLOWLIST.iter().any(|prefix| url.starts_with(prefix)) {
        Ok(())
    } else {
        Err(format!("URL host not in allowlist: {url}"))
    }
}

// ── Session persistence ───────────────────────────────────────────────────────

#[tauri::command]
pub fn upsert_session_summary(
    state: State<'_, DatabaseState>,
    session: SessionSummary,
) -> Result<(), String> {
    let database = state.lock().map_err(|e| e.to_string())?;
    database.upsert_session_summary(&session)
}

#[tauri::command]
pub fn list_session_summaries(
    state: State<'_, DatabaseState>,
) -> Result<Vec<SessionSummary>, String> {
    let database = state.lock().map_err(|e| e.to_string())?;
    database.list_session_summaries()
}

#[tauri::command]
pub fn upsert_transcript_item(
    state: State<'_, DatabaseState>,
    session_id: String,
    item: TranscriptItem,
) -> Result<(), String> {
    let database = state.lock().map_err(|e| e.to_string())?;
    database.upsert_transcript_item(&session_id, &item)
}

#[tauri::command]
pub fn upsert_transcript_items_batch(
    state: State<'_, DatabaseState>,
    session_id: String,
    items: Vec<TranscriptItem>,
) -> Result<(), String> {
    let mut database = state.lock().map_err(|e| e.to_string())?;
    database.upsert_transcript_items(&session_id, &items)
}

#[tauri::command]
pub fn list_transcript_items(
    state: State<'_, DatabaseState>,
    session_id: String,
) -> Result<Vec<TranscriptItem>, String> {
    let database = state.lock().map_err(|e| e.to_string())?;
    database.list_transcript_items(&session_id)
}

#[tauri::command]
pub fn append_audit_event(
    state: State<'_, DatabaseState>,
    event: AuditEvent,
) -> Result<(), String> {
    let database = state.lock().map_err(|e| e.to_string())?;
    database.append_audit_event(&event)
}

#[tauri::command]
pub fn list_audit_events(state: State<'_, DatabaseState>) -> Result<Vec<AuditEvent>, String> {
    let database = state.lock().map_err(|e| e.to_string())?;
    database.list_audit_events()
}

#[tauri::command]
pub fn clear_audit_events(state: State<'_, DatabaseState>) -> Result<(), String> {
    let database = state.lock().map_err(|e| e.to_string())?;
    database.clear_audit_events()
}

// ── Native audio pipeline ─────────────────────────────────────────────────────

#[tauri::command]
pub fn start_native_audio_pipeline(
    app: AppHandle,
    state: State<'_, NativeRuntimeState>,
    wasapi: State<'_, WasapiState>,
    sample_rate_hz: i64,
    channels: i64,
) -> Result<AudioPipelineStatus, String> {
    let mut runtime = state.lock().map_err(|e| e.to_string())?;

    // Start WASAPI loopback on Windows; no-op on other platforms (browser fallback)
    #[cfg(target_os = "windows")]
    {
        let mut wasapi_guard = wasapi.lock().map_err(|e| e.to_string())?;
        if wasapi_guard.is_none() {
            match WasapiLoopbackCapture::start(app) {
                Ok(capture) => {
                    *wasapi_guard = Some(capture);
                }
                Err(e) => {
                    runtime.last_error = Some(e.clone());
                    return Ok(AudioPipelineStatus {
                        is_active: false,
                        sample_rate_hz,
                        channels,
                        last_error: Some(e),
                    });
                }
            }
        }
    }

    runtime.is_active = true;
    runtime.sample_rate_hz = sample_rate_hz;
    runtime.channels = channels;
    runtime.last_error = None;

    Ok(AudioPipelineStatus {
        is_active: runtime.is_active,
        sample_rate_hz: runtime.sample_rate_hz,
        channels: runtime.channels,
        last_error: runtime.last_error.clone(),
    })
}

#[tauri::command]
pub fn stop_native_audio_pipeline(
    state: State<'_, NativeRuntimeState>,
    wasapi: State<'_, WasapiState>,
) -> Result<AudioPipelineStatus, String> {
    let mut runtime = state.lock().map_err(|e| e.to_string())?;
    runtime.is_active = false;

    // Stop WASAPI capture thread
    let mut wasapi_guard = wasapi.lock().map_err(|e| e.to_string())?;
    if let Some(mut capture) = wasapi_guard.take() {
        capture.stop();
    }

    Ok(AudioPipelineStatus {
        is_active: runtime.is_active,
        sample_rate_hz: runtime.sample_rate_hz,
        channels: runtime.channels,
        last_error: runtime.last_error.clone(),
    })
}

#[tauri::command]
pub fn get_native_audio_pipeline_status(
    state: State<'_, NativeRuntimeState>,
) -> Result<AudioPipelineStatus, String> {
    let runtime = state.lock().map_err(|e| e.to_string())?;
    Ok(AudioPipelineStatus {
        is_active: runtime.is_active,
        sample_rate_hz: runtime.sample_rate_hz,
        channels: runtime.channels,
        last_error: runtime.last_error.clone(),
    })
}

// ── Whisper STT (native path for WASAPI chunks) ────────────────────────────────

#[tauri::command]
pub async fn transcribe_audio_chunk(
    pcm_base64: String,
    sample_rate_hz: u32,
    source: String,
    language: Option<String>,
    api_key: String,
) -> Result<crate::audio::whisper_stt::TranscriptSegment, String> {
    use base64::Engine;

    let pcm_bytes = base64::engine::general_purpose::STANDARD
        .decode(&pcm_base64)
        .map_err(|e| format!("Base64 decode error: {e}"))?;

    let client = WhisperSttClient::new(api_key);
    client
        .transcribe_pcm(
            &pcm_bytes,
            sample_rate_hz,
            &source,
            language.as_deref(),
        )
        .await
}

// ── Screen capture ────────────────────────────────────────────────────────────

/// Inspect a screenshot-crate error string and decide if it represents a
/// permission revoke (DXGI_ERROR_ACCESS_DENIED on Windows, TCC denial on
/// macOS, the "no displays" path on locked Linux sessions). Used by
/// capture_screen_region to emit `screen_capture_lost` so the UI can
/// surface a "re-grant capture permission" toast (S2 fix).
fn is_screen_capture_revoked(err: &str) -> bool {
    let l = err.to_ascii_lowercase();
    l.contains("0x887a0004")
        || l.contains("dxgi_error_access_denied")
        || l.contains("access is denied")
        || l.contains("permission denied")
        || l.contains("not allowed")
        || l.contains("tcc")
        || l.contains("declined")
}

#[tauri::command]
pub fn capture_screen_region(
    app: AppHandle,
    x: i64,
    y: i64,
    width: i64,
    height: i64,
) -> Result<ScreenCaptureResult, String> {
    use base64::Engine;
    use screenshots::Screen;

    let screens = Screen::all().map_err(|e| {
        let msg = format!("Screen::all failed: {e}");
        if is_screen_capture_revoked(&msg) {
            let _ = app.emit("screen_capture_lost", serde_json::json!({ "reason": msg.clone() }));
        }
        msg
    })?;
    let screen = screens.first().ok_or_else(|| {
        let msg = "No screens found".to_string();
        let _ = app.emit("screen_capture_lost", serde_json::json!({ "reason": msg.clone() }));
        msg
    })?;
    let screen_w = screen.display_info.width as i64;
    let screen_h = screen.display_info.height as i64;

    if width > 0
        && height > 0
        && (x < 0 || y < 0 || x + width > screen_w || y + height > screen_h)
    {
        return Err(format!(
            "Capture region ({x},{y},{width}x{height}) exceeds screen bounds ({screen_w}x{screen_h})"
        ));
    }

    let capture_result = if width > 0 && height > 0 {
        screen
            .capture_area(x as i32, y as i32, width as u32, height as u32)
            .map_err(|e| format!("capture_area failed: {e}"))
    } else {
        screen.capture().map_err(|e| format!("capture failed: {e}"))
    };
    let image = match capture_result {
        Ok(img) => img,
        Err(msg) => {
            // S2 fix: emit screen_capture_lost so the renderer can prompt
            // for re-grant. The UI listens for this on the dashboard.
            if is_screen_capture_revoked(&msg) {
                let _ = app.emit(
                    "screen_capture_lost",
                    serde_json::json!({ "reason": msg.clone() }),
                );
            }
            return Err(msg);
        }
    };

    // Encode RgbaImage to PNG bytes using the image crate's write_to method
    let mut png_bytes: Vec<u8> = Vec::new();
    image
        .write_to(
            &mut std::io::Cursor::new(&mut png_bytes),
            screenshots::image::ImageFormat::Png,
        )
        .map_err(|e| format!("PNG encode failed: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);

    Ok(ScreenCaptureResult {
        mime_type: "image/png".to_string(),
        image_base64: b64,
        note: String::new(),
    })
}

// ── OCR ───────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn run_ocr_on_image(image_base64: String) -> Result<OcrResult, String> {
    // Native OCR (Windows.Media.Ocr on Win10+; renderer tesseract.js fallback
    // for unsupported platforms or when WinRT initialisation fails).
    match native_ocr::run_native_ocr(&image_base64) {
        Ok(result) => Ok(result),
        Err(err) => Ok(OcrResult {
            text: String::new(),
            confidence: 0.0,
            note: format!("Native OCR failed ({err}); falling back to renderer worker."),
        }),
    }
}

// ── Active window info ────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_active_window_info() -> Result<ActiveWindowInfo, String> {
    platform_active_window_info()
}

// ── Knowledge base ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn search_knowledge_base(
    app: AppHandle,
    query: String,
) -> Result<Vec<KnowledgePassage>, String> {
    let normalized_query = query.trim().to_lowercase();

    if normalized_query.is_empty() {
        return Ok(Vec::new());
    }

    let content = read_knowledge_base_file(&app)?;
    let json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let items = json
        .as_array()
        .ok_or("knowledge_base.json must contain an array of entries.")?;
    let query_terms = tokenize(&normalized_query);

    let mut passages = items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            let id = item
                .get("id")
                .and_then(|v| v.as_str())
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("kb-{index}"));
            let title = item
                .get("title")
                .or_else(|| item.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("Untitled")
                .to_string();
            let passage = item
                .get("passage")
                .or_else(|| item.get("content"))
                .or_else(|| item.get("text"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            if passage.trim().is_empty() {
                return None;
            }

            let haystack = format!("{} {}", title.to_lowercase(), passage.to_lowercase());
            let score = query_terms
                .iter()
                .filter(|term| haystack.contains(term.as_str()))
                .count() as f64
                / query_terms.len().max(1) as f64;

            (score > 0.0).then_some(KnowledgePassage {
                id,
                title,
                passage,
                score,
            })
        })
        .collect::<Vec<_>>();

    passages.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    passages.truncate(5);

    Ok(passages)
}

// ── LLM streaming (multi-provider) ───────────────────────────────────────────

#[tauri::command]
pub async fn call_llm(
    app: AppHandle,
    prompt: String,
    context: Option<Vec<String>>,
    provider: Option<String>,
    model: Option<String>,
    system_prompt: Option<String>,
) -> Result<LlmResponse, String> {
    let provider_name = provider.as_deref().unwrap_or("groq");

    // Resolve API key: prefer keychain, fall back to env var
    let api_key = resolve_api_key(provider_name)?;
    let (endpoint, model_id) = resolve_provider_endpoint(provider_name, model.as_deref());

    let request_id = uuid::Uuid::new_v4().to_string();
    let context_text = context.unwrap_or_default().join("\n\n");
    let user_content = if context_text.trim().is_empty() {
        prompt
    } else {
        format!(
            "Use the following internal context only when relevant:\n\n{context_text}\n\nUser request:\n{prompt}"
        )
    };

    let default_system = "You are an AI interview and meeting copilot. Respond concisely and accurately.".to_string();
    let sys = system_prompt.unwrap_or(default_system);

    if provider_name == "anthropic" {
        return call_anthropic_llm(&app, api_key, model_id, sys, user_content, request_id).await;
    }

    let body = json!({
        "model": model_id,
        "stream": true,
        "messages": [
            { "role": "system", "content": sys },
            { "role": "user",   "content": user_content }
        ]
    });

    let response = reqwest::Client::new()
        .post(&endpoint)
        .bearer_auth(&api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full_text = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if let Some(content) = parse_openai_stream_line(&line) {
                full_text.push_str(&content);
                app.emit(
                    "llm_chunk",
                    LlmChunkPayload {
                        request_id: request_id.clone(),
                        chunk: content,
                    },
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    app.emit(
        "llm_complete",
        LlmResponse {
            request_id: request_id.clone(),
            text: full_text.clone(),
        },
    )
    .map_err(|e| e.to_string())?;

    Ok(LlmResponse {
        request_id,
        text: full_text,
    })
}

async fn call_anthropic_llm(
    app: &AppHandle,
    api_key: String,
    model: String,
    system: String,
    user_content: String,
    request_id: String,
) -> Result<LlmResponse, String> {
    let body = json!({
        "model": model,
        "max_tokens": 2048,
        "stream": true,
        "system": system,
        "messages": [{ "role": "user", "content": user_content }]
    });

    let response = reqwest::Client::new()
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full_text = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if let Some(content) = parse_anthropic_stream_line(&line) {
                full_text.push_str(&content);
                app.emit(
                    "llm_chunk",
                    LlmChunkPayload {
                        request_id: request_id.clone(),
                        chunk: content,
                    },
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    app.emit(
        "llm_complete",
        LlmResponse {
            request_id: request_id.clone(),
            text: full_text.clone(),
        },
    )
    .map_err(|e| e.to_string())?;

    Ok(LlmResponse {
        request_id,
        text: full_text,
    })
}

// ── Microphone capture ────────────────────────────────────────────────────────

#[tauri::command]
pub fn start_mic_capture(
    app: AppHandle,
    state: State<'_, MicCaptureState>,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(crate::audio::mic_capture::MicCapture::start(app)?);
    }
    Ok(())
}

#[tauri::command]
pub fn stop_mic_capture(state: State<'_, MicCaptureState>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(mut cap) = guard.take() {
        cap.stop();
    }
    Ok(())
}

#[tauri::command]
pub fn list_mic_devices() -> Result<Vec<serde_json::Value>, String> {
    Ok(vec![serde_json::json!({"id": "default", "name": "Default Microphone", "isDefault": true})])
}

// VAD threshold stored as a global Atomic so it can be updated at runtime.
static VAD_THRESHOLD: std::sync::atomic::AtomicI16 = std::sync::atomic::AtomicI16::new(120);

pub(crate) fn get_vad_threshold_internal() -> i16 {
    VAD_THRESHOLD.load(std::sync::atomic::Ordering::Relaxed)
}

#[tauri::command]
pub fn get_vad_threshold() -> i16 {
    VAD_THRESHOLD.load(std::sync::atomic::Ordering::Relaxed)
}

#[tauri::command]
pub fn set_vad_threshold(threshold: i16) {
    VAD_THRESHOLD.store(threshold.max(0), std::sync::atomic::Ordering::Relaxed);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

fn resolve_api_key(provider: &str) -> Result<String, String> {
    // Try keychain first
    if let Ok(Some(key)) = keychain::retrieve_api_key_inner(provider) {
        if !key.trim().is_empty() {
            return Ok(key);
        }
    }
    // Fall back to environment variables — check provider-specific first, then generic
    let candidates: &[&str] = match provider {
        "openai" => &["OPENAI_API_KEY"],
        "anthropic" => &["ANTHROPIC_API_KEY"],
        _ => &["GROQ_API_KEY", "LLM_API_KEY"],
    };
    for var in candidates {
        if let Ok(val) = std::env::var(var) {
            if !val.trim().is_empty() {
                return Ok(val);
            }
        }
    }
    Err(format!("No API key found for provider '{provider}'. Set {candidates:?} in .env or store via Settings."))
}

fn resolve_provider_endpoint(provider: &str, model_override: Option<&str>) -> (String, String) {
    match provider {
        "openai" => (
            "https://api.openai.com/v1/chat/completions".to_string(),
            model_override.unwrap_or("gpt-4o").to_string(),
        ),
        "anthropic" => (
            "https://api.anthropic.com/v1/messages".to_string(),
            model_override.unwrap_or("claude-opus-4-5").to_string(),
        ),
        _ => {
            // Groq (default)
            let url = std::env::var("LLM_API_URL")
                .unwrap_or_else(|_| "https://api.groq.com/openai/v1".to_string());
            let endpoint = normalize_llm_endpoint(&url);
            (
                endpoint,
                model_override
                    .unwrap_or("llama-3.3-70b-versatile")
                    .to_string(),
            )
        }
    }
}

fn read_knowledge_base_file(app: &AppHandle) -> Result<String, String> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("knowledge_base.json"));
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("knowledge_base.json"));
        candidates.push(current_dir.join("..").join("knowledge_base.json"));
    }

    let path = candidates
        .into_iter()
        .find(|p| p.exists())
        .ok_or("knowledge_base.json not found.")?;

    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

fn tokenize(input: &str) -> Vec<String> {
    input
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() > 2)
        .map(ToString::to_string)
        .collect()
}

fn normalize_llm_endpoint(api_url: &str) -> String {
    let trimmed = api_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

fn parse_openai_stream_line(line: &str) -> Option<String> {
    let data = line.strip_prefix("data: ")?;
    if data == "[DONE]" {
        return None;
    }
    let json: serde_json::Value = serde_json::from_str(data).ok()?;
    json.get("choices")?
        .get(0)?
        .get("delta")?
        .get("content")?
        .as_str()
        .map(ToString::to_string)
}

fn parse_anthropic_stream_line(line: &str) -> Option<String> {
    let data = line.strip_prefix("data: ")?;
    let json: serde_json::Value = serde_json::from_str(data).ok()?;
    if json.get("type")?.as_str()? != "content_block_delta" {
        return None;
    }
    json.get("delta")?
        .get("text")?
        .as_str()
        .map(ToString::to_string)
}

pub(crate) fn platform_active_window_info() -> Result<ActiveWindowInfo, String> {
    platform_active_window_info_impl()
}

#[cfg(not(target_os = "windows"))]
fn platform_active_window_info_impl() -> Result<ActiveWindowInfo, String> {
    Ok(ActiveWindowInfo {
        process_name: None,
        title: None,
    })
}

#[cfg(target_os = "windows")]
fn platform_active_window_info_impl() -> Result<ActiveWindowInfo, String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HWND};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd: HWND = GetForegroundWindow();

        if hwnd.0.is_null() {
            return Ok(ActiveWindowInfo {
                process_name: None,
                title: None,
            });
        }

        let title_len = GetWindowTextLengthW(hwnd);
        let title = if title_len > 0 {
            let mut buf = vec![0u16; title_len as usize + 1];
            let copied = GetWindowTextW(hwnd, &mut buf);
            Some(String::from_utf16_lossy(&buf[..copied as usize]))
        } else {
            None
        };

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));

        if pid == 0 {
            return Ok(ActiveWindowInfo {
                process_name: None,
                title,
            });
        }

        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
            .map_err(|e| e.to_string())?;
        let mut img_buf = vec![0u16; 32_768];
        let mut img_len = img_buf.len() as u32;
        let process_name = if QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_FORMAT(0),
            PWSTR(img_buf.as_mut_ptr()),
            &mut img_len,
        )
        .is_ok()
        {
            std::path::PathBuf::from(String::from_utf16_lossy(&img_buf[..img_len as usize]))
                .file_name()
                .and_then(|n| n.to_str())
                .map(ToString::to_string)
        } else {
            None
        };

        let _ = CloseHandle(process);

        Ok(ActiveWindowInfo {
            process_name,
            title,
        })
    }
}
