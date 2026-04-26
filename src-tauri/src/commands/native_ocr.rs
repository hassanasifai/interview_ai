//! Native OCR backend.
//!
//! Windows: `Windows.Media.Ocr` (built into Windows 10+, no extra runtime).
//! macOS:   currently falls through to the renderer's tesseract.js worker
//!          (Vision.framework integration is plumbed via objc2 in a follow-up
//!          but the WinRT path covers the largest install base today).
//! Other:   returns a "use renderer fallback" note.
//!
//! Exposed via the existing `run_ocr_on_image` Tauri command.

use crate::models::OcrResult;

#[cfg(target_os = "windows")]
pub fn run_native_ocr(image_base64: &str) -> Result<OcrResult, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use windows::core::{Interface, HSTRING};
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::BitmapDecoder;
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

    let bytes = STANDARD
        .decode(image_base64.trim())
        .map_err(|e| format!("base64 decode: {e}"))?;
    if bytes.is_empty() {
        return Ok(OcrResult {
            text: String::new(),
            confidence: 0.0,
            note: "Empty image".to_string(),
        });
    }

    // Stage the bytes in a WinRT memory stream the imaging API understands.
    let stream = InMemoryRandomAccessStream::new()
        .map_err(|e| format!("InMemoryRandomAccessStream::new: {e}"))?;
    {
        let writer = DataWriter::CreateDataWriter(&stream)
            .map_err(|e| format!("DataWriter::CreateDataWriter: {e}"))?;
        writer
            .WriteBytes(&bytes)
            .map_err(|e| format!("WriteBytes: {e}"))?;
        writer
            .StoreAsync()
            .map_err(|e| format!("StoreAsync: {e}"))?
            .get()
            .map_err(|e| format!("StoreAsync.get: {e}"))?;
        writer
            .FlushAsync()
            .map_err(|e| format!("FlushAsync: {e}"))?
            .get()
            .map_err(|e| format!("FlushAsync.get: {e}"))?;
        // Detach the underlying stream so the writer's drop doesn't close it.
        let _ = writer.DetachStream();
    }
    use windows::Storage::Streams::IRandomAccessStream;
    let ras: IRandomAccessStream = stream.cast().map_err(|e| format!("cast IRAS: {e}"))?;
    ras.Seek(0).map_err(|e| format!("seek: {e}"))?;

    let decoder = BitmapDecoder::CreateAsync(&ras)
        .map_err(|e| format!("BitmapDecoder::CreateAsync: {e}"))?
        .get()
        .map_err(|e| format!("decoder get: {e}"))?;
    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|e| format!("GetSoftwareBitmapAsync: {e}"))?
        .get()
        .map_err(|e| format!("software bitmap get: {e}"))?;

    // Try English first, then user-default locale.
    let lang_en = Language::CreateLanguage(&HSTRING::from("en-US"));
    let engine = match lang_en.and_then(|l| OcrEngine::TryCreateFromLanguage(&l)) {
        Ok(eng) => eng,
        Err(_) => OcrEngine::TryCreateFromUserProfileLanguages()
            .map_err(|e| format!("OcrEngine fallback: {e}"))?,
    };

    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| format!("RecognizeAsync: {e}"))?
        .get()
        .map_err(|e| format!("recognize get: {e}"))?;

    let text = result
        .Text()
        .map_err(|e| format!("Text(): {e}"))?
        .to_string_lossy();

    Ok(OcrResult {
        text,
        confidence: 0.85,
        note: "Native Windows.Media.Ocr".to_string(),
    })
}

#[cfg(not(target_os = "windows"))]
pub fn run_native_ocr(_image_base64: &str) -> Result<OcrResult, String> {
    Ok(OcrResult {
        text: String::new(),
        confidence: 0.0,
        note: "Native OCR not implemented on this platform; renderer tesseract.js handles it.".to_string(),
    })
}
