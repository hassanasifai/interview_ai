//! Whisper STT client that transcribes raw PCM audio via the Groq API.
//! Wraps PCM bytes in a minimal WAV container and POSTs to
//! the /audio/transcriptions endpoint, returning a transcript segment.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub text: String,
    pub source: String,
    pub timestamp_ms: i64,
    pub confidence: f64,
}

pub struct WhisperSttClient {
    api_key: String,
    model: String,
    http: reqwest::Client,
}

impl WhisperSttClient {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            model: "whisper-large-v3".to_string(),
            http: reqwest::Client::new(),
        }
    }

    pub fn with_model(api_key: String, model: String) -> Self {
        Self {
            api_key,
            model,
            http: reqwest::Client::new(),
        }
    }

    /// Transcribe raw i16 LE PCM audio bytes.
    pub async fn transcribe_pcm(
        &self,
        pcm_i16_le: &[u8],
        sample_rate: u32,
        source: &str,
        language: Option<&str>,
    ) -> Result<TranscriptSegment, String> {
        if pcm_i16_le.is_empty() {
            return Ok(TranscriptSegment {
                text: String::new(),
                source: source.to_string(),
                timestamp_ms: now_ms(),
                confidence: 0.0,
            });
        }

        let wav_bytes = wrap_in_wav(pcm_i16_le, sample_rate, 1, 16);

        let mut form = reqwest::multipart::Form::new()
            .text("model", self.model.clone())
            .text("response_format", "json")
            .part(
                "file",
                reqwest::multipart::Part::bytes(wav_bytes)
                    .file_name("audio.wav")
                    .mime_str("audio/wav")
                    .map_err(|e| e.to_string())?,
            );

        if let Some(lang) = language {
            form = form.text("language", lang.to_string());
        }

        let response = self
            .http
            .post("https://api.groq.com/openai/v1/audio/transcriptions")
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Whisper request failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Whisper API error: {e}"))?;

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Whisper response: {e}"))?;

        let text = json
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        Ok(TranscriptSegment {
            text,
            source: source.to_string(),
            timestamp_ms: now_ms(),
            confidence: 0.9,
        })
    }
}

/// Wrap raw PCM bytes in a minimal RIFF/WAV container header.
fn wrap_in_wav(pcm: &[u8], sample_rate: u32, channels: u16, bits_per_sample: u16) -> Vec<u8> {
    let byte_rate = sample_rate * channels as u32 * bits_per_sample as u32 / 8;
    let block_align = channels * bits_per_sample / 8;
    let data_len = pcm.len() as u32;
    let chunk_size = 36 + data_len;

    let mut wav = Vec::with_capacity(44 + pcm.len());

    // RIFF header
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&chunk_size.to_le_bytes());
    wav.extend_from_slice(b"WAVE");

    // fmt sub-chunk
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes()); // sub-chunk size
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM format
    wav.extend_from_slice(&channels.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&bits_per_sample.to_le_bytes());

    // data sub-chunk
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    wav.extend_from_slice(pcm);

    wav
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
