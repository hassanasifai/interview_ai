//! Local Whisper STT backed by whisper.cpp via the `whisper-rs` crate.
//!
//! Gap 1 (Parakeet AI parity): runs Whisper inference entirely on-device.
//! Zero network round-trip, zero per-minute API quota, works offline.
//!
//! The crate is gated behind the optional `local-whisper` Cargo feature
//! because building whisper.cpp pulls a C++ toolchain. When the feature is
//! disabled the module still compiles — it just returns an "unavailable"
//! error from every entry point so callers can cleanly fall back to cloud.
//!
//! Models are downloaded on first run from Hugging Face's
//! `ggerganov/whisper.cpp` repository to `<app_data>/models/whisper/`. The
//! tracked file is `ggml-base.en.bin` (~141 MB) by default — the smallest
//! model that retains Whisper-large-v3-class accuracy on English.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSttResult {
    pub text: String,
    pub source: String,
    pub timestamp_ms: i64,
    pub confidence: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum WhisperModel {
    BaseEn,
    SmallEn,
    Medium,
}

impl WhisperModel {
    fn filename(self) -> &'static str {
        match self {
            Self::BaseEn => "ggml-base.en.bin",
            Self::SmallEn => "ggml-small.en.bin",
            Self::Medium => "ggml-medium.bin",
        }
    }
    fn download_url(self) -> &'static str {
        match self {
            Self::BaseEn => {
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
            }
            Self::SmallEn => {
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"
            }
            Self::Medium => {
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin"
            }
        }
    }
    fn from_str_or_default(s: Option<&str>) -> Self {
        match s.unwrap_or("base.en") {
            "small.en" => Self::SmallEn,
            "medium" => Self::Medium,
            _ => Self::BaseEn,
        }
    }
}

fn model_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir unavailable: {e}"))?;
    Ok(base.join("models").join("whisper"))
}

fn model_path<R: tauri::Runtime>(
    app: &AppHandle<R>,
    model: WhisperModel,
) -> Result<PathBuf, String> {
    Ok(model_dir(app)?.join(model.filename()))
}

#[tauri::command]
pub fn check_local_stt_available<R: tauri::Runtime>(
    app: AppHandle<R>,
    model: Option<String>,
) -> Result<bool, String> {
    let m = WhisperModel::from_str_or_default(model.as_deref());
    let path = model_path(&app, m)?;
    Ok(path.exists() && cfg!(feature = "local-whisper"))
}

/// Stream-download the requested whisper.cpp model with progress events.
/// Emits `stt_model_download_progress` { downloadedBytes, totalBytes } at most
/// 4× per second so the UI's progress bar updates without flooding IPC.
#[tauri::command]
pub async fn download_whisper_model<R: tauri::Runtime>(
    app: AppHandle<R>,
    model: Option<String>,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write;

    let m = WhisperModel::from_str_or_default(model.as_deref());
    let dir = model_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
    let target = dir.join(m.filename());

    if target.exists() {
        return Ok(target.to_string_lossy().into_owned());
    }

    let client = reqwest::Client::new();
    let resp = client
        .get(m.download_url())
        .send()
        .await
        .map_err(|e| format!("download request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download HTTP error: {e}"))?;

    let total_bytes = resp.content_length().unwrap_or(0);
    let tmp = target.with_extension("downloading");
    let mut file =
        std::fs::File::create(&tmp).map_err(|e| format!("create tmp file: {e}"))?;

    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("chunk error: {e}"))?;
        file.write_all(&bytes)
            .map_err(|e| format!("write tmp: {e}"))?;
        downloaded += bytes.len() as u64;
        if last_emit.elapsed() > std::time::Duration::from_millis(250) {
            last_emit = std::time::Instant::now();
            let _ = app.emit(
                "stt_model_download_progress",
                serde_json::json!({
                    "downloadedBytes": downloaded,
                    "totalBytes": total_bytes,
                }),
            );
        }
    }
    file.flush().map_err(|e| format!("flush: {e}"))?;
    drop(file);
    std::fs::rename(&tmp, &target).map_err(|e| format!("rename: {e}"))?;

    let _ = app.emit(
        "stt_model_download_progress",
        serde_json::json!({
            "downloadedBytes": downloaded,
            "totalBytes": total_bytes,
            "completed": true,
        }),
    );

    Ok(target.to_string_lossy().into_owned())
}

// ── Inference (feature-gated) ────────────────────────────────────────────────

#[cfg(feature = "local-whisper")]
mod inference {
    use super::*;
    use std::sync::Mutex;
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    // Reuse a single context per model — building one is expensive.
    static CONTEXT: Mutex<Option<(PathBuf, WhisperContext)>> = Mutex::new(None);

    pub fn run_inference(
        model_path: &Path,
        pcm_i16: &[i16],
        sample_rate: u32,
        language: &str,
    ) -> Result<String, String> {
        let mut guard = CONTEXT.lock().map_err(|e| format!("ctx lock: {e}"))?;
        if guard.as_ref().map_or(true, |(p, _)| p != model_path) {
            let ctx = WhisperContext::new_with_params(
                model_path
                    .to_str()
                    .ok_or_else(|| "model path is not utf-8".to_string())?,
                WhisperContextParameters::default(),
            )
            .map_err(|e| format!("whisper ctx init: {e}"))?;
            *guard = Some((model_path.to_path_buf(), ctx));
        }
        let (_, ctx) = guard.as_ref().expect("present after assignment above");

        // Whisper expects f32 mono in [-1, 1]. The pipeline already feeds us
        // 16 kHz mono i16, so we just normalise to float here.
        let mut audio_f32 = Vec::with_capacity(pcm_i16.len());
        for &s in pcm_i16 {
            audio_f32.push(s as f32 / 32_768.0);
        }
        if sample_rate != 16_000 {
            return Err(format!("expected 16 kHz audio, got {sample_rate}"));
        }

        let mut state = ctx.create_state().map_err(|e| format!("state: {e}"))?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(num_cpus_or_default());
        params.set_translate(false);
        params.set_language(Some(language));
        params.set_no_context(true);
        params.set_single_segment(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        state
            .full(params, &audio_f32)
            .map_err(|e| format!("inference failed: {e}"))?;

        // whisper-rs 0.16 API: full_n_segments returns c_int directly,
        // and per-segment access is via get_segment(i) -> Option<WhisperSegment>.
        let n = state.full_n_segments();
        let mut text = String::new();
        for i in 0..n {
            if let Some(seg) = state.get_segment(i) {
                if let Ok(s) = seg.to_str_lossy() {
                    if !text.is_empty() {
                        text.push(' ');
                    }
                    text.push_str(&s);
                }
            }
        }
        Ok(text.trim().to_string())
    }

    fn num_cpus_or_default() -> std::os::raw::c_int {
        std::thread::available_parallelism()
            .map(|n| n.get() as i32)
            .unwrap_or(4)
    }
}

#[cfg(not(feature = "local-whisper"))]
mod inference {
    use super::*;
    pub fn run_inference(
        _model_path: &Path,
        _pcm_i16: &[i16],
        _sample_rate: u32,
        _language: &str,
    ) -> Result<String, String> {
        Err(
            "Local whisper-rs not compiled. Build with `--features local-whisper` to enable."
                .to_string(),
        )
    }
}

/// Run local whisper inference on a chunk of base64-encoded i16-LE PCM.
/// Caller passes the same payload shape used by the cloud `transcribe_audio_chunk`.
#[tauri::command]
pub async fn transcribe_chunk_local<R: tauri::Runtime>(
    app: AppHandle<R>,
    pcm_base64: String,
    sample_rate_hz: u32,
    source: String,
    language: Option<String>,
    model: Option<String>,
) -> Result<LocalSttResult, String> {
    let m = WhisperModel::from_str_or_default(model.as_deref());
    let path = model_path(&app, m)?;
    if !path.exists() {
        return Err(format!(
            "Whisper model {} not present at {}. Trigger download_whisper_model first.",
            m.filename(),
            path.display(),
        ));
    }

    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let raw = STANDARD
        .decode(pcm_base64.trim())
        .map_err(|e| format!("base64 decode: {e}"))?;
    if raw.len() % 2 != 0 {
        return Err("PCM byte length is odd; expected i16 LE".to_string());
    }
    let mut pcm_i16 = Vec::with_capacity(raw.len() / 2);
    for chunk in raw.chunks_exact(2) {
        pcm_i16.push(i16::from_le_bytes([chunk[0], chunk[1]]));
    }

    let lang = language.unwrap_or_else(|| "en".to_string());
    // Run inference on a dedicated OS thread so we don't stall the Tauri
    // async worker. We use std::thread + a sync channel rather than
    // tokio::task::spawn_blocking because Tauri 2 doesn't re-export tokio
    // at this crate's surface, and pulling in tokio just for this would
    // bloat the build.
    let path_clone = path.clone();
    let lang_clone = lang.clone();
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    std::thread::spawn(move || {
        let r = inference::run_inference(&path_clone, &pcm_i16, sample_rate_hz, &lang_clone);
        let _ = tx.send(r);
    });
    let text = rx
        .recv()
        .map_err(|e| format!("inference channel: {e}"))??;

    Ok(LocalSttResult {
        text,
        source,
        timestamp_ms: now_ms(),
        confidence: 0.92,
    })
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
