//! Simple energy-based Voice Activity Detection (VAD).
//! No external dependencies — pure std arithmetic on i16 PCM samples.

/// Returns true if samples contain speech above the energy threshold.
/// Uses RMS (root mean square) amplitude as the energy measure.
pub fn is_speech(samples: &[i16], threshold: i16) -> bool {
    if samples.is_empty() {
        return false;
    }
    let sum_sq: f64 = samples.iter().map(|&s| (s as f64).powi(2)).sum();
    let rms = (sum_sq / samples.len() as f64).sqrt();
    rms > (threshold.max(1) as f64)
}

/// Convenience wrapper that reads the global VAD threshold from `commands.rs`.
pub fn is_speech_default(samples: &[i16]) -> bool {
    is_speech(samples, crate::commands::get_vad_threshold_internal())
}

/// Zero-crossing rate: fraction of consecutive sample pairs that cross zero.
/// Returns a value in [0.0, 1.0]. Higher values suggest unvoiced or noise signals.
pub fn zero_crossing_rate(samples: &[i16]) -> f32 {
    if samples.len() < 2 {
        return 0.0;
    }
    let crossings = samples
        .windows(2)
        .filter(|w| (w[0] >= 0) != (w[1] >= 0))
        .count();
    crossings as f32 / (samples.len() - 1) as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_is_not_speech() {
        let silence = vec![0i16; 1600];
        assert!(!is_speech(&silence, 300));
    }

    #[test]
    fn loud_tone_is_speech() {
        // 1kHz sine at 16kHz sr, amplitude ~10000
        let samples: Vec<i16> = (0..1600)
            .map(|i| (10000.0 * (2.0 * std::f64::consts::PI * i as f64 / 16.0).sin()) as i16)
            .collect();
        assert!(is_speech(&samples, 300));
    }

    #[test]
    fn empty_samples_not_speech() {
        assert!(!is_speech(&[], 300));
    }

    #[test]
    fn zcr_empty_returns_zero() {
        assert_eq!(zero_crossing_rate(&[]), 0.0);
    }

    #[test]
    fn zcr_alternating_sign() {
        let samples = vec![1i16, -1, 1, -1, 1, -1];
        let zcr = zero_crossing_rate(&samples);
        assert!(zcr > 0.9, "expected high ZCR, got {zcr}");
    }
}
