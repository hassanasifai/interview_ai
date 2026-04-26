//! WASAPI microphone capture for Windows.
//! Captures input from the default communications microphone (eCapture endpoint).
//! Audio is chunked at ~1500ms intervals and emitted as Tauri events
//! containing base64-encoded 16kHz mono PCM i16-LE samples.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicAudioChunk {
    pub pcm_base64: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub timestamp_ms: i64,
}

pub struct MicCapture {
    pub(crate) stop_flag: Arc<AtomicBool>,
    pub(crate) thread: Option<std::thread::JoinHandle<()>>,
}

#[cfg(target_os = "windows")]
impl MicCapture {
    pub fn start(app: AppHandle) -> Result<Self, String> {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

        let stop_flag = Arc::new(AtomicBool::new(false));
        let flag = stop_flag.clone();

        let thread = std::thread::spawn(move || {
            let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };

            // G29: signal successful (re)start so the UI can clear any
            // "device lost" banner shown from a prior session.
            let _ = app.emit("mic_device_restored", serde_json::json!({}));

            match Self::run_capture_loop(&app, &flag) {
                Err(e) => {
                    log::error!("Mic capture loop error: {e}");
                    let _ = app.emit("mic_audio_error", e.clone());
                    // G29: classify WASAPI device-loss errors and emit a
                    // dedicated event the UI can surface as a reconnect toast.
                    let reason_lower = e.to_lowercase();
                    let device_lost = reason_lower.contains("0x88890004")
                        || reason_lower.contains("device_invalidated")
                        || reason_lower.contains("audclnt_e_device_invalidated")
                        || reason_lower.contains("not found")
                        || reason_lower.contains("no such device");
                    if device_lost {
                        let _ = app.emit(
                            "mic_device_lost",
                            serde_json::json!({ "reason": e }),
                        );
                    }
                }
                Ok(()) => {
                    // G29: loop exited without an explicit stop request.
                    // Treat as device loss so the UI can prompt a restart.
                    if !flag.load(Ordering::Relaxed) {
                        let _ = app.emit(
                            "mic_device_lost",
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

    fn run_capture_loop(app: &AppHandle, stop_flag: &Arc<AtomicBool>) -> Result<(), String> {
        use base64::Engine;
        use windows::Win32::Media::Audio::{
            IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
            AUDCLNT_SHAREMODE_SHARED, WAVEFORMATEX, eCommunications, eCapture,
        };
        use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
        const WAVE_FORMAT_PCM: u16 = 1;
        use std::time::{SystemTime, UNIX_EPOCH};

        let target_sample_rate: u32 = 16_000;
        let target_channels: u16 = 1;
        let chunk_duration_ms: u64 = 1500;

        unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("CoCreateInstance IMMDeviceEnumerator: {e}"))?;

            // eCapture for microphone input (not eRender/loopback)
            let device = enumerator
                .GetDefaultAudioEndpoint(eCapture, eCommunications)
                .map_err(|e| format!("GetDefaultAudioEndpoint (mic): {e}"))?;

            let audio_client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("Activate IAudioClient (mic): {e}"))?;

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

            // Capture mode: no AUDCLNT_STREAMFLAGS_LOOPBACK flag (0 = capture)
            let init_result = audio_client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                0, // capture, not loopback
                buffer_duration,
                0,
                &fmt as *const _,
                None,
            );

            if init_result.is_err() {
                // Fall back to native mix format
                let mix_fmt_ptr = audio_client
                    .GetMixFormat()
                    .map_err(|e| format!("GetMixFormat (mic): {e}"))?;
                let native_rate = (*mix_fmt_ptr).nSamplesPerSec;
                let native_channels = (*mix_fmt_ptr).nChannels;

                audio_client
                    .Initialize(
                        AUDCLNT_SHAREMODE_SHARED,
                        0,
                        buffer_duration,
                        0,
                        mix_fmt_ptr,
                        None,
                    )
                    .map_err(|e| format!("Initialize mic (native format): {e}"))?;

                fmt.nSamplesPerSec = native_rate;
                fmt.nChannels = native_channels;
                fmt.nBlockAlign = native_channels * (fmt.wBitsPerSample / 8);
                fmt.nAvgBytesPerSec = native_rate * fmt.nBlockAlign as u32;
            }

            let capture_client: IAudioCaptureClient = audio_client
                .GetService()
                .map_err(|e| format!("GetService IAudioCaptureClient (mic): {e}"))?;

            audio_client.Start().map_err(|e| format!("Start mic: {e}"))?;

            let samples_per_chunk =
                (fmt.nSamplesPerSec as u64 * chunk_duration_ms / 1000) as usize;
            let mut chunk_buf: Vec<i16> = Vec::with_capacity(samples_per_chunk * 2);
            // VAD hangover: emit up to N chunks past last speech detection so trailing words aren't cut.
            let mut hangover_chunks: u8 = 0;

            while !stop_flag.load(Ordering::Relaxed) {
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

                    let _ = capture_client.ReleaseBuffer(num_frames);

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
                                "mic_audio_chunk",
                                MicAudioChunk {
                                    pcm_base64,
                                    sample_rate: target_sample_rate,
                                    channels: 1,
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

    pub fn stop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

#[cfg(not(target_os = "windows"))]
impl MicCapture {
    pub fn start(_app: AppHandle) -> Result<Self, String> {
        Err("Mic capture not supported on this platform".to_string())
    }

    pub fn stop(&mut self) {}
}

impl Drop for MicCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Convert raw PCM bytes to mono i16 samples.
fn convert_to_mono_i16(raw: &[u8], channels: usize, bits_per_sample: u16) -> Vec<i16> {
    // Microphone format negotiation can report nChannels=0 in error/transition
    // states; guard before dividing or using as a stride to avoid panic.
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

/// Linear resampling from source_rate to target_rate.
fn resample(samples: &[i16], source_rate: u32, target_rate: u32) -> Vec<i16> {
    if source_rate == target_rate || samples.is_empty() {
        return samples.to_vec();
    }

    let ratio = source_rate as f64 / target_rate as f64;
    let out_len = ((samples.len() as f64) / ratio).ceil() as usize;
    let mut out = Vec::with_capacity(out_len);

    for i in 0..out_len {
        let src_idx = i as f64 * ratio;
        let lo = src_idx.floor() as usize;
        let hi = (lo + 1).min(samples.len() - 1);
        let frac = src_idx - lo as f64;
        let interpolated =
            samples[lo] as f64 * (1.0 - frac) + samples[hi] as f64 * frac;
        out.push(interpolated.round() as i16);
    }

    out
}
