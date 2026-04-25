import { Mic, MicOff, Camera, X, Keyboard } from 'lucide-react';
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { logger } from '../../lib/logger';
import { evaluateShareGuard } from '../../lib/runtime/shareGuard';
import { useOverlayStore } from '../../store/overlayStore';
import { useSessionStore } from '../../store/sessionStore';
import { useSettingsStore } from '../../store/settingsStore';
import './companion.css';

// Inline hotkey rows that match the actual Phase 1A registrations.
// TODO: replace with `import { HOTKEY_ROWS } from '../../lib/hotkeyCatalog'`
// once Agent 2F's shared catalog ships.
const COMPANION_HOTKEYS: Array<{ keys: string; label: string }> = [
  { keys: 'Ctrl+Shift+H', label: 'Toggle overlay' },
  { keys: 'Ctrl+Shift+S', label: 'Screenshot + solve' },
  { keys: 'Ctrl+Shift+C', label: 'Copy answer' },
  { keys: 'Ctrl+Shift+T', label: 'Toggle click-through' },
  { keys: 'Ctrl+Shift+Enter', label: 'Generate answer' },
  { keys: 'Ctrl+Shift+N', label: 'Next suggestion' },
  { keys: 'Ctrl+Shift+↑/↓', label: 'Scroll answer' },
  { keys: 'Esc', label: 'Dismiss overlay' },
];

type ScreenshotResult = { imageBase64: string };

export function CompanionWindow() {
  const transcript = useSessionStore((state) => state.rollingWindow);
  const mode = useSessionStore((state) => state.mode);
  const suggestion = useOverlayStore((state) => state.currentSuggestion);
  const clearSuggestion = useOverlayStore((state) => state.clearSuggestion);
  const settings = useSettingsStore();

  const [muted, setMuted] = useState(false);
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [screenshotNote, setScreenshotNote] = useState<string | null>(null);

  async function handleCompanionScreenshot() {
    if (screenshotBusy) return;
    setScreenshotBusy(true);
    setScreenshotNote('Capturing…');
    try {
      const result = await invoke<ScreenshotResult>('capture_screen_region', {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      if (!result.imageBase64) {
        setScreenshotNote('Capture failed');
        return;
      }
      const apiKey = useSettingsStore.getState().openAiApiKey;
      if (!apiKey) {
        setScreenshotNote('Add OpenAI key in Settings to solve screenshots');
        return;
      }
      setScreenshotNote('Extracting…');
      const { extractProblemFromScreenshot } = await import('../../lib/copilot/visionSolver');
      const problem = await extractProblemFromScreenshot(result.imageBase64, apiKey);
      setScreenshotNote(problem.title ? `Captured: ${problem.title}` : 'Captured');
      window.dispatchEvent(new CustomEvent('companion:screenshot-problem', { detail: problem }));
    } catch (err) {
      logger.warn('companion', 'screenshot failed', { err: String(err) });
      setScreenshotNote('Screenshot failed');
    } finally {
      setScreenshotBusy(false);
    }
  }

  const shareGuard = evaluateShareGuard({
    shareMode: 'mobile-companion',
    autoHideOnFullScreenShare: settings.autoHideOnFullScreenShare,
    preferSecondScreen: settings.preferSecondScreen,
    hasSecondScreen: settings.hasSecondScreen,
  });

  const riskColor =
    shareGuard.riskLevel === 'low'
      ? 'var(--ok)'
      : shareGuard.riskLevel === 'medium'
        ? 'var(--warn)'
        : 'var(--danger)';

  return (
    <div className="cw-compact" data-testid="companion-window">
      {/* Drag region top strip */}
      <div className="cw-drag-bar" data-tauri-drag-region>
        <div className="cw-drag-brand" data-tauri-drag-region>
          <span className="cw-drag-mark" data-tauri-drag-region>
            M
          </span>
          <span className="cw-drag-name" data-tauri-drag-region>
            MeetingMind
          </span>
        </div>
        <div className="cw-drag-status" data-tauri-drag-region>
          <span
            className="cw-status-dot"
            style={{ background: riskColor, boxShadow: `0 0 6px ${riskColor}` }}
          />
          <span className="cw-mode-label">{mode}</span>
        </div>
      </div>

      {/* Current question card */}
      <div className="cw-question-zone">
        <p className="cw-zone-eyebrow">Current Question</p>
        {suggestion ? (
          <p className="cw-question-text">{suggestion.question.text}</p>
        ) : (
          <p className="cw-question-empty">Listening for questions…</p>
        )}
      </div>

      {/* Answer streaming card */}
      <div className="cw-answer-zone">
        <p className="cw-zone-eyebrow">Answer</p>
        {suggestion ? (
          <>
            <p className="cw-one-liner">{suggestion.oneLiner}</p>
            <ul className="cw-bullets">
              {suggestion.answerBullets.map((b, i) => (
                <li key={i} className="cw-bullet" style={{ animationDelay: `${i * 60}ms` }}>
                  {b}
                </li>
              ))}
            </ul>
            {suggestion.suggestedFollowup && (
              <p className="cw-followup">
                <span className="cw-followup-label">Follow-up: </span>
                {suggestion.suggestedFollowup}
              </p>
            )}
          </>
        ) : (
          <p className="cw-answer-empty">Answer will appear here when a question is detected.</p>
        )}
      </div>

      {/* Recent transcript */}
      {transcript.length > 0 && (
        <div className="cw-transcript-zone">
          <p className="cw-zone-eyebrow">Recent</p>
          <ul className="cw-transcript-list">
            {transcript.slice(-3).map((item, i) => (
              <li key={i} className="cw-transcript-item">
                <span className="cw-transcript-who" data-speaker={item.speaker}>
                  {item.speaker}
                </span>
                <span className="cw-transcript-line">{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Hotkey legend drawer */}
      {hotkeysOpen && (
        <div className="cw-hotkeys">
          <p className="cw-zone-eyebrow">Shortcuts</p>
          <ul className="cw-hotkey-list">
            {COMPANION_HOTKEYS.map((row) => (
              <li key={row.keys}>
                <kbd>{row.keys}</kbd> {row.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {screenshotNote ? (
        <div className="cw-screenshot-note" role="status" aria-live="polite">
          {screenshotNote}
        </div>
      ) : null}

      {/* Quick-actions row */}
      <div className="cw-actions-bar">
        <button
          className={`cw-action-btn${muted ? ' cw-action-btn--active' : ''}`}
          aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
          title={muted ? 'Unmute' : 'Mute'}
          onClick={() => setMuted((m) => !m)}
        >
          {muted ? <MicOff size={14} /> : <Mic size={14} />}
        </button>
        <button
          className="cw-action-btn"
          aria-label="Screenshot"
          title="Screenshot"
          onClick={() => {
            handleCompanionScreenshot().catch((err) => {
              logger.warn('companion', 'handleCompanionScreenshot (click) failed', {
                err: String(err),
              });
            });
          }}
          disabled={screenshotBusy}
        >
          <Camera size={14} />
        </button>
        <button
          className={`cw-action-btn${hotkeysOpen ? ' cw-action-btn--active' : ''}`}
          aria-label="Toggle hotkey legend"
          title="Hotkeys"
          onClick={() => setHotkeysOpen((o) => !o)}
        >
          <Keyboard size={14} />
        </button>
        <button
          className="cw-action-btn cw-action-btn--dismiss"
          aria-label="Dismiss suggestion"
          title="Dismiss"
          onClick={clearSuggestion}
          disabled={!suggestion}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
