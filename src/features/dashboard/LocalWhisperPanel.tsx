import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '../../components/ui';
import { logger } from '../../lib/logger';

type Status = 'idle' | 'checking' | 'present' | 'missing' | 'downloading' | 'error';

/**
 * Settings → Audio → Local Whisper status & download (Gap 1 UI).
 *
 * Shows whether the native whisper.cpp model is present and lets the user
 * trigger a one-time download to `app_data_dir/models/whisper/ggml-base.en.bin`.
 * Subscribes to `stt_model_download_progress` events for the progress bar.
 */
export function LocalWhisperPanel() {
  const [status, setStatus] = useState<Status>('idle');
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Probe availability on mount (and again when the user clicks "Recheck").
  const recheck = async () => {
    setStatus('checking');
    try {
      const ok = await invoke<boolean>('check_local_stt_available', {
        model: 'base.en',
      });
      setStatus(ok ? 'present' : 'missing');
    } catch (err) {
      logger.warn('LocalWhisperPanel', 'check_local_stt_available failed', {
        err: String(err),
      });
      setStatus('error');
      setErrorMessage(String(err));
    }
  };

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      // Initial probe (kept inside the async IIFE so the effect body itself
      // doesn't synchronously call setState — that triggered the
      // react-hooks/set-state-in-effect lint).
      try {
        const ok = await invoke<boolean>('check_local_stt_available', {
          model: 'base.en',
        });
        if (!cancelled) setStatus(ok ? 'present' : 'missing');
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setErrorMessage(String(err));
        }
      }
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<{
        downloadedBytes: number;
        totalBytes: number;
        completed?: boolean;
      }>('stt_model_download_progress', (e) => {
        if (cancelled) return;
        setDownloaded(e.payload.downloadedBytes ?? 0);
        setTotal(e.payload.totalBytes ?? 0);
        if (e.payload.completed) {
          setStatus('present');
        }
      });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const startDownload = async () => {
    setStatus('downloading');
    setDownloaded(0);
    setTotal(0);
    setErrorMessage(null);
    try {
      await invoke<string>('download_whisper_model', { model: 'base.en' });
      setStatus('present');
    } catch (err) {
      logger.warn('LocalWhisperPanel', 'download_whisper_model failed', {
        err: String(err),
      });
      setStatus('error');
      setErrorMessage(String(err));
    }
  };

  const fmtMb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
  const pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;

  return (
    <div className="settings-local-whisper" style={panelStyle}>
      <div style={headerRow}>
        <span style={{ fontWeight: 600 }}>Local Whisper model</span>
        <span style={badgeFor(status)}>{statusLabel(status, pct)}</span>
      </div>

      {status === 'downloading' && (
        <div style={progressOuter} aria-label="Whisper model download progress">
          <div style={{ ...progressInner, width: `${pct}%` }} />
          <div style={progressMeta}>
            {fmtMb(downloaded)} / {total > 0 ? fmtMb(total) : '— MB'}
          </div>
        </div>
      )}

      {status === 'missing' && (
        <p style={hintStyle}>
          The native whisper.cpp model isn&apos;t installed yet. Downloading ggml-base.en.bin (~141
          MB) enables fully offline transcription with zero cloud round-trip.
        </p>
      )}

      {status === 'present' && (
        <p style={hintStyle}>
          ggml-base.en.bin is installed. Selecting Native or Auto routes transcription on-device
          with no cloud calls.
        </p>
      )}

      {status === 'error' && (
        <p style={{ ...hintStyle, color: 'var(--danger, #ff6b6b)' }}>
          {errorMessage ?? 'Unknown error.'}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button
          variant={status === 'missing' ? 'primary' : 'secondary'}
          onClick={() => {
            void startDownload();
          }}
          disabled={status === 'downloading' || status === 'checking'}
        >
          {status === 'present' ? 'Reinstall model' : 'Download model'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            void recheck();
          }}
          disabled={status === 'downloading'}
        >
          Recheck
        </Button>
      </div>

      <p style={{ ...hintStyle, marginTop: 10, fontSize: 'var(--fs-xs)' }}>
        Builds without the <code>local-whisper</code> Cargo feature will detect an available model
        file but fall back to cloud STT — recompile the Rust binary with that feature to actually
        run inference locally.
      </p>
    </div>
  );
}

function statusLabel(status: Status, pct: number): string {
  switch (status) {
    case 'present':
      return 'Installed';
    case 'missing':
      return 'Not installed';
    case 'checking':
      return 'Checking…';
    case 'downloading':
      return `Downloading ${pct}%`;
    case 'error':
      return 'Error';
    default:
      return '—';
  }
}

function badgeFor(status: Status): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 'var(--fs-xs)',
    padding: '2px 8px',
    borderRadius: 999,
    border: '1px solid var(--border-default)',
  };
  switch (status) {
    case 'present':
      return { ...base, color: 'var(--success, #44d17b)', borderColor: 'var(--success, #44d17b)' };
    case 'missing':
      return { ...base, color: 'var(--warn, #f4b46c)', borderColor: 'var(--warn, #f4b46c)' };
    case 'error':
      return { ...base, color: 'var(--danger, #ff6b6b)', borderColor: 'var(--danger, #ff6b6b)' };
    default:
      return base;
  }
}

const panelStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md, 10px)',
  background: 'var(--surface-raised, rgba(255,255,255,0.02))',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const headerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--fg-secondary, #aaa)',
};

const progressOuter: React.CSSProperties = {
  position: 'relative',
  height: 22,
  borderRadius: 6,
  background: 'var(--surface-input, #1a1a1f)',
  border: '1px solid var(--border-subtle)',
  overflow: 'hidden',
};

const progressInner: React.CSSProperties = {
  height: '100%',
  background: 'linear-gradient(90deg, var(--accent), var(--accent-strong, var(--accent)))',
  transition: 'width 100ms linear',
};

const progressMeta: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 'var(--fs-xs)',
  fontVariantNumeric: 'tabular-nums',
};
