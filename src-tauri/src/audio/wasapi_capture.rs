//! WASAPI loopback audio capture for Windows.
//! Captures system audio (what plays through speakers) without requiring
//! a virtual audio driver, using the Windows WASAPI loopback API.
//! Audio is chunked at ~1500ms intervals and emitted as Tauri events
//! containing base64-encoded 16kHz mono PCM i16-LE samples.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioChunk {
    pub source: String,
    pub sample_rate_hz: i32,
    pub channels: i32,
    pub pcm_base64: String,
    pub timestamp_ms: i64,
}

pub struct WasapiLoopbackCapture {
    stop_flag: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl WasapiLoopbackCapture {
    #[cfg(target_os = "windows")]
    pub fn start(app: AppHandle) -> Result<Self, String> {
        use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

        let stop_flag = Arc::new(AtomicBool::new(false));
        let flag = stop_flag.clone();

        // RAII guard so CoUninitialize is called when the capture thread
        // exits via any path (success, error, or panic). Without this the
        // COM apartment leaks on every restart.
        struct ComGuard;
        impl Drop for ComGuard {
            fn drop(&mut self) {
                unsafe { CoUninitialize() };
            }
        }

        let thread = std::thread::spawn(move || {
            // COM must be initialized per-thread.
            let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            let _com_guard = ComGuard;

            // G29: signal successful (re)start so the UI can clear any
            // "system audio device lost" banner from a prior session.
            let _ = app.emit("system_audio_device_restored", serde_json::json!({}));

            match Self::run_capture_loop(&app, &flag) {
                Err(e) => {
                    log::error!("WASAPI capture loop error: {e}");
                    let _ = app.emit("native_audio_error", e.clone());
                    // G29: classify WASAPI device-loss errors and emit a
                    // dedicated event the UI can surface.
                    let reason_lower = e.to_lowercase();
                    let device_lost = reason_lower.contains("0x88890004")
                        || reason_lower.contains("device_invalidated")
                        || reason_lower.contains("audclnt_e_device_invalidated")
                        || reason_lower.contains("not found")
                        || reason_lower.contains("no such device");
                    if device_lost {
                        let _ = app.emit(
                            "system_audio_device_lost",
                            serde_json::json!({ "reason": e }),
                        );
                    }
                }
                Ok(()) => {
                    // G29: loop exited without an explicit stop request.
                    // Treat as device loss so the UI can prompt a restart.
                    if !flag.load(Ordering::Relaxed) {
                        let _ = app.emit(
                            "system_audio_device_lost",
                            serde_json::json!({ "reason": "capture thread exited unexpectedly" }),
                        );
                    }
                }
            }
        });

        Ok(Self {
            stop_flag,
            thread: Some(thread),
        })
    }

    #[cfg(target_os = "windows")]
    fn run_capture_loop(app: &AppHandle, stop_flag: &Arc<AtomicBool>) -> Result<(), String> {
        use base64::Engine;
        use windows::Win32::Media::Audio::{
            IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
            AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX,
            eConsole, eRender,
        };
        use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
        // WAVE_FORMAT_PCM = 1 (from mmreg.h)
        const WAVE_FORMAT_PCM: u16 = 1;
        use std::time::{SystemTime, UNIX_EPOCH};

        let target_sample_rate: u32 = 16_000;
        let target_channels: u16 = 1;
        let chunk_duration_ms: u64 = 1500;

        unsafe {
            // Create device enumerator
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("CoCreateInstance IMMDeviceEnumerator: {e}"))?;

            // Get default render endpoint (loopback captures what the speakers play)
            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| format!("GetDefaultAudioEndpoint: {e}"))?;

            // Activate IAudioClient
            let audio_client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("Activate IAudioClient: {e}"))?;

            // Build WAVEFORMATEX for 16kHz mono 16-bit PCM
            let mut fmt = WAVEFORMATEX {
                wFormatTag: WAVE_FORMAT_PCM,
                nChannels: target_channels,
                nSamplesPerSec: target_sample_rate,
                nAvgBytesPerSec: target_sample_rate * target_channels as u32 * 2,
                nBlockAlign: target_channels * 2,
                wBitsPerSample: 16,
                cbSize: 0,
            };

            // 100ns units; 500ms buffer
            let buffer_duration: i64 = 5_000_000;

            let init_result = audio_client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK,
                buffer_duration,
                0,
                &fmt as *const _,
                None,
            );

            if init_result.is_err() {
                // Fall back to native mix format if device rejects 16kHz
                let mix_fmt_ptr = audio_client
                    .GetMixFormat()
                    .map_err(|e| format!("GetMixFormat: {e}"))?;
                let native_rate = (*mix_fmt_ptr).nSamplesPerSec;
                let native_channels = (*mix_fmt_ptr).nChannels;

                audio_client
                    .Initialize(
                        AUDCLNT_SHAREMODE_SHARED,
                        AUDCLNT_STREAMFLAGS_LOOPBACK,
                        buffer_duration,
                        0,
                        mix_fmt_ptr,
                        None,
                    )
                    .map_err(|e| format!("Initialize (native format): {e}"))?;

                // Capture at native rate, resample to 16kHz in loop below
                fmt.nSamplesPerSec = native_rate;
                fmt.nChannels = native_channels;
                fmt.nBlockAlign = native_channels * (fmt.wBitsPerSample / 8);
                fmt.nAvgBytesPerSec = native_rate * fmt.nBlockAlign as u32;
            }

            let capture_client: IAudioCaptureClient = audio_client
                .GetService()
                .map_err(|e| format!("GetService IAudioCaptureClient: {e}"))?;

            audio_client.Start().map_err(|e| format!("Start: {e}"))?;

            let samples_per_chunk =
                (fmt.nSamplesPerSec as u64 * chunk_duration_ms / 1000) as usize;
            let mut chunk_buf: Vec<i16> = Vec::with_capacity(samples_per_chunk * 2);
            // VAD hangover: emit up to N chunks past last speech detection so trailing words aren't cut.
            let mut hangover_chunks: u8 = 0;

            while !stop_flag.load(Ordering::Relaxed) {
                // Sleep to avoid busy-waiting; WASAPI fills the buffer periodically
                std::thread::sleep(std::time::Duration::from_millis(10));

                let frames_available = match capture_client.GetNextPacketSize() {
                    Ok(n) => n,
                    Err(_) => break,
                };

                let mut frames_available = frames_available;
                while frames_available > 0 {
                    let mut data_ptr: *mut u8 = std::ptr::null_mut();
                    let mut num_frames: u32 = 0;
                    let mut flags: u32 = 0;
                    let mut device_position: u64 = 0;
                    let mut qpc_position: u64 = 0;

                    if capture_client
                        .GetBuffer(
                            &mut data_ptr,
                            &mut num_frames,
                            &mut flags,
                            Some(&mut device_position),
                            Some(&mut qpc_position),
                        )
                        .is_err()
                    {
                        break;
                    }

                    if num_frames > 0 && !data_ptr.is_null() {
                        let bytes_per_frame = fmt.nBlockAlign as usize;
                        let total_bytes = num_frames as usize * bytes_per_frame;
                        let raw_slice =
                            std::slice::from_raw_parts(data_ptr as *const u8, total_bytes);

                        // Convert to i16 mono samples, resampling if needed
                        let samples = convert_to_mono_i16(
                            raw_slice,
                            fmt.nChannels as usize,
                            fmt.wBitsPerSample,
                        );

                        let resampled = if fmt.nSamplesPerSec != target_sample_rate {
                            resample(&samples, fmt.nSamplesPerSec, target_sample_rate)
                        } else {
                            samples
                        };

                        chunk_buf.extend_from_slice(&resampled);
                    }

                    if let Err(release_err) = capture_client.ReleaseBuffer(num_frames) {
                        log::warn!("WASAPI ReleaseBuffer failed: {release_err}");
                    }

                    if chunk_buf.len() >= samples_per_chunk {
                        // VAD gate — only emit if speech is detected, with a hangover window
                        // so that trailing syllables aren't truncated when energy drops.
                        let speech = crate::audio::vad::is_speech_default(&chunk_buf);
                        let should_emit = if speech {
                            hangover_chunks = 2;
                            true
                        } else if hangover_chunks > 0 {
                            hangover_chunks -= 1;
                            true
                        } else {
                            false
                        };

                        if should_emit {
                            // Encode chunk as base64 raw PCM bytes (i16 LE)
                            let byte_slice = std::slice::from_raw_parts(
                                chunk_buf.as_ptr() as *const u8,
                                chunk_buf.len() * 2,
                            );
                            let pcm_base64 = base64::engine::general_purpose::STANDARD
                                .encode(byte_slice);
                            let timestamp_ms = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .map(|d| d.as_millis() as i64)
                                .unwrap_or(0);

                            let _ = app.emit(
                                "native_audio_chunk",
                                NativeAudioChunk {
                                    source: "system".to_string(),
                                    sample_rate_hz: target_sample_rate as i32,
                                    channels: 1,
                                    pcm_base64,
                                    timestamp_ms,
                                },
                            );
                        }
                        chunk_buf.clear();
                    }

                    frames_available = match capture_client.GetNextPacketSize() {
                        Ok(n) => n,
                        Err(_) => break,
                    };
                }
            }

            let _ = audio_client.Stop();
        }

        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    pub fn start(_app: AppHandle) -> Result<Self, String> {
        Err("WASAPI loopback capture is Windows-only. Use browser getDisplayMedia on other platforms.".to_string())
    }

    pub fn stop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for WasapiLoopbackCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Convert raw PCM bytes to mono i16 samples.
#[cfg(target_os = "windows")]
fn convert_to_mono_i16(raw: &[u8], channels: usize, bits_per_sample: u16) -> Vec<i16> {
    // WASAPI in error/transition states can momentarily report nChannels=0;
    // guard before dividing or using as a stride to avoid div-by-zero panic.
    if channels == 0 {
        return Vec::new();
    }
    match bits_per_sample {
        16 => {
            let samples_per_channel = raw.len() / (channels * 2);
            let mut out = Vec::with_capacity(samples_per_channel);
            for frame in 0..samples_per_channel {
                let mut sum: i32 = 0;
                for ch in 0..channels {
                    let offset = (frame * channels + ch) * 2;
                    if offset + 1 < raw.len() {
                        let s = i16::from_le_bytes([raw[offset], raw[offset + 1]]);
                        sum += s as i32;
                    }
                }
                out.push((sum / channels as i32) as i16);
            }
            out
        }
        32 => {
            // 32-bit float PCM (common WASAPI shared mode format)
            let samples_per_channel = raw.len() / (channels * 4);
            let mut out = Vec::with_capacity(samples_per_channel);
            for frame in 0..samples_per_channel {
                let mut sum: f32 = 0.0;
                for ch in 0..channels {
                    let offset = (frame * channels + ch) * 4;
                    if offset + 3 < raw.len() {
                        let f = f32::from_le_bytes([
                            raw[offset],
                            raw[offset + 1],
                            raw[offset + 2],
                            raw[offset + 3],
                        ]);
                        sum += f;
                    }
                }
                let mono = sum / channels as f32;
                out.push((mono.clamp(-1.0, 1.0) * 32767.0) as i16);
            }
            out
        }
        _ => Vec::new(),
    }
}

/// Anti-aliased resampling from `source_rate` to `target_rate`.
///
/// AUDIT §24/A2 fix: replaces the prior linear-interpolation path. When we
/// down-sample (e.g. 48 kHz → 16 kHz) without low-pass filtering first, any
/// content above the Nyquist of the target rate (8 kHz here) folds back into
/// the audible band as aliasing — corrupting Whisper transcription quality.
///
/// This implementation runs a windowed-sinc FIR low-pass with a Hann window
/// and a 31-tap kernel before linear interpolation. The cost is ~30 mul-adds
/// per output sample, which is well under our ~1.5s buffering budget per
/// chunk on the WASAPI thread.
#[cfg(target_os = "windows")]
fn resample(samples: &[i16], source_rate: u32, target_rate: u32) -> Vec<i16> {
    if source_rate == target_rate || samples.is_empty() {
        return samples.to_vec();
    }
    // Only filter when down-sampling (target < source). Up-sampling does not
    // alias — linear interpolation is acceptable.
    let need_lowpass = target_rate < source_rate;

    // Convert to f32 for the filter pass.
    let mut staged: Vec<f32> = samples.iter().map(|&s| s as f32).collect();

    if need_lowpass {
        // Cutoff at 0.45 × Nyquist of the *target* rate, normalised to source.
        let cutoff = 0.45f32 * (target_rate as f32) / (source_rate as f32);
        let kernel = build_lowpass_kernel(31, cutoff);
        staged = convolve(&staged, &kernel);
    }

    // Now decimate with linear interpolation on the filtered signal.
    let ratio = source_rate as f64 / target_rate as f64;
    let out_len = ((staged.len() as f64) / ratio).ceil() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_idx = i as f64 * ratio;
        let lo = src_idx.floor() as usize;
        let hi = (lo + 1).min(staged.len().saturating_sub(1));
        if lo >= staged.len() {
            break;
        }
        let frac = (src_idx - lo as f64) as f32;
        let interpolated = staged[lo] * (1.0 - frac) + staged[hi] * frac;
        out.push(interpolated.clamp(-32768.0, 32767.0).round() as i16);
    }
    out
}

/// Hann-windowed sinc low-pass filter kernel. `cutoff` is normalised to the
/// source sample rate (0.0..=0.5).
#[cfg(target_os = "windows")]
fn build_lowpass_kernel(taps: usize, cutoff: f32) -> Vec<f32> {
    use std::f32::consts::PI;
    let mut k = vec![0f32; taps];
    let m = (taps - 1) as f32;
    let c = cutoff.clamp(0.001, 0.499);
    let mut sum = 0f32;
    for (i, slot) in k.iter_mut().enumerate() {
        let n = i as f32 - m / 2.0;
        let sinc = if n.abs() < 1e-9 {
            2.0 * c
        } else {
            (2.0 * PI * c * n).sin() / (PI * n)
        };
        let hann = 0.5 - 0.5 * (2.0 * PI * (i as f32) / m).cos();
        *slot = sinc * hann;
        sum += *slot;
    }
    // Normalise so DC gain == 1.
    if sum.abs() > 1e-9 {
        for v in &mut k {
            *v /= sum;
        }
    }
    k
}

/// Direct-form FIR convolution. Input length is preserved (zero-pads at edges).
#[cfg(target_os = "windows")]
fn convolve(input: &[f32], kernel: &[f32]) -> Vec<f32> {
    if kernel.is_empty() {
        return input.to_vec();
    }
    let n = input.len();
    let half = kernel.len() / 2;
    let mut out = vec![0f32; n];
    for (i, slot) in out.iter_mut().enumerate() {
        let mut acc = 0f32;
        for (j, &coeff) in kernel.iter().enumerate() {
            let src_idx = i as isize + j as isize - half as isize;
            if src_idx >= 0 && (src_idx as usize) < n {
                acc += input[src_idx as usize] * coeff;
            }
        }
        *slot = acc;
    }
    out
}
