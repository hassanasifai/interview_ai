import { logger } from './logger';

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionSummary = {
  id: string;
  customerName: string;
  title: string;
  durationMinutes: number;
  summary: string;
};

type TranscriptSpeaker = 'customer' | 'user' | 'system';

type TranscriptItem = {
  id: string;
  speaker: TranscriptSpeaker;
  text: string;
  timestamp: number;
};

type AuditEvent = {
  id: string;
  type: string;
  timestamp: string;
  details: Record<string, string | number | boolean>;
};

type AudioPipelineStatus = {
  isActive: boolean;
  sampleRateHz: number;
  channels: number;
  lastError: string | null;
};

type ScreenCaptureResult = {
  mimeType: string;
  imageBase64: string;
  note: string;
};

type OcrResult = {
  text: string;
  confidence: number;
  note: string;
};

type ActiveWindowInfo = {
  processName: string | null;
  title: string | null;
};

type MonitorBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ShareGuardRuntimeSnapshot = {
  activeWindowProcessName: string | null;
  activeWindowTitle: string | null;
  assistantDisplay: 'primary' | 'non-primary' | 'unknown';
  monitorCount: number;
  windowBounds: MonitorBounds | null;
  monitorBounds: MonitorBounds[];
};

type KnowledgePassage = {
  id: string;
  title: string;
  passage: string;
  score: number;
};

type LlmResponse = {
  requestId: string;
  text: string;
};

type LlmChunkPayload = {
  requestId: string;
  chunk: string;
};

type NativeAudioChunk = {
  source: string;
  sampleRateHz: number;
  channels: number;
  pcmBase64: string;
  timestampMs: number;
};

type TranscriptSegment = {
  text: string;
  source: string;
  timestampMs: number;
  confidence: number;
};

export type ProviderName = 'groq' | 'openai' | 'anthropic';

// ── Storage keys ──────────────────────────────────────────────────────────────

const SESSION_STORAGE_KEY = 'meetingmind-session-summaries';
const TRANSCRIPT_STORAGE_KEY = 'meetingmind-native-transcript-items';
const AUDIT_STORAGE_KEY = 'meetingmind-native-audit-events';

// ── Runtime detection ─────────────────────────────────────────────────────────

async function canUseTauriInvoke() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// ── Session persistence ───────────────────────────────────────────────────────

export async function persistSessionSummary(session: SessionSummary) {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('upsert_session_summary', { session });
    return;
  }
  const existing = await readPersistedSessions();
  const next = [...existing.filter((s) => s.id !== session.id), session];
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
}

export async function readPersistedSessions(): Promise<SessionSummary[]> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<SessionSummary[]>('list_session_summaries');
  }
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as SessionSummary[]) : [];
}

export async function persistTranscriptItem(sessionId: string, item: TranscriptItem) {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('upsert_transcript_item', { sessionId, item });
    return;
  }
  const existing = readTranscriptFallback();
  const sessionItems = existing[sessionId] ?? [];
  existing[sessionId] = [...sessionItems.filter((e) => e.id !== item.id), item];
  localStorage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify(existing));
}

export async function readPersistedTranscriptItems(sessionId: string): Promise<TranscriptItem[]> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<TranscriptItem[]>('list_transcript_items', { sessionId });
  }
  return readTranscriptFallback()[sessionId] ?? [];
}

export async function persistAuditEvent(event: AuditEvent) {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('append_audit_event', { event });
    return;
  }
  const existing = await readPersistedAuditEvents();
  const next = [...existing.filter((e) => e.id !== event.id), event].slice(-500);
  localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(next));
}

export async function readPersistedAuditEvents(): Promise<AuditEvent[]> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AuditEvent[]>('list_audit_events');
  }
  const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as AuditEvent[]) : [];
}

export async function clearPersistedAuditEvents() {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('clear_audit_events');
    return;
  }
  localStorage.removeItem(AUDIT_STORAGE_KEY);
}

function readTranscriptFallback(): Record<string, TranscriptItem[]> {
  const raw = localStorage.getItem(TRANSCRIPT_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, TranscriptItem[]>) : {};
}

// ── Native audio pipeline ─────────────────────────────────────────────────────

export async function startNativeAudioPipeline(
  sampleRateHz = 16_000,
  channels = 1,
): Promise<AudioPipelineStatus> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AudioPipelineStatus>('start_native_audio_pipeline', { sampleRateHz, channels });
  }
  return { isActive: false, sampleRateHz, channels, lastError: 'Native runtime unavailable.' };
}

export async function stopNativeAudioPipeline(): Promise<AudioPipelineStatus> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AudioPipelineStatus>('stop_native_audio_pipeline');
  }
  return { isActive: false, sampleRateHz: 16_000, channels: 1, lastError: null };
}

export async function getNativeAudioPipelineStatus(): Promise<AudioPipelineStatus> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AudioPipelineStatus>('get_native_audio_pipeline_status');
  }
  return { isActive: false, sampleRateHz: 16_000, channels: 1, lastError: 'Unavailable.' };
}

/** Listen for raw PCM audio chunks emitted by WASAPI loopback capture. */
export async function listenNativeAudioChunk(
  callback: (chunk: NativeAudioChunk) => void,
): Promise<() => void> {
  if (await canUseTauriInvoke()) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<NativeAudioChunk>('native_audio_chunk', (e) => callback(e.payload));
  }
  return () => {};
}

/** Transcribe a base64-encoded PCM chunk via Whisper STT (Rust path). */
export async function transcribeAudioChunk(
  pcmBase64: string,
  sampleRateHz: number,
  source: string,
  language?: string,
  apiKey?: string,
): Promise<TranscriptSegment> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<TranscriptSegment>('transcribe_audio_chunk', {
      pcmBase64,
      sampleRateHz,
      source,
      language,
      apiKey: apiKey ?? '',
    });
  }
  return { text: '', source, timestampMs: Date.now(), confidence: 0 };
}

// ── Screen capture & OCR ──────────────────────────────────────────────────────

export async function captureScreenRegion(
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<ScreenCaptureResult> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<ScreenCaptureResult>('capture_screen_region', { x, y, width, height });
  }
  return { mimeType: 'image/png', imageBase64: '', note: 'Browser mode.' };
}

export async function runOcrOnImage(imageBase64: string): Promise<OcrResult> {
  const normalizedImage = imageBase64.trim();
  if (!normalizedImage) {
    return { text: '', confidence: 0, note: 'No image content.' };
  }

  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<OcrResult>('run_ocr_on_image', { imageBase64 });
  }

  try {
    const { recognize } = await import('tesseract.js');
    const result = await recognize(`data:image/png;base64,${normalizedImage}`, 'eng');
    return {
      text: result.data.text?.trim() ?? '',
      confidence: Number(((result.data.confidence ?? 0) / 100).toFixed(3)),
      note: 'OCR via browser Tesseract.js',
    };
  } catch (e) {
    logger.warn('tauri', 'browser OCR failed', { err: String(e) });
    return { text: '', confidence: 0, note: 'OCR failed in browser mode.' };
  }
}

// ── Active window ─────────────────────────────────────────────────────────────

export async function getActiveWindowInfo(): Promise<ActiveWindowInfo> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<ActiveWindowInfo>('get_active_window_info');
  }
  return { processName: null, title: typeof document !== 'undefined' ? document.title : null };
}

export async function getShareGuardRuntimeSnapshot(): Promise<ShareGuardRuntimeSnapshot> {
  const activeWindow = await getActiveWindowInfo();

  if (!(await canUseTauriInvoke())) {
    return {
      activeWindowProcessName: activeWindow.processName,
      activeWindowTitle: activeWindow.title,
      assistantDisplay: 'unknown',
      monitorCount: typeof window !== 'undefined' && window.screen ? 1 : 0,
      windowBounds: null,
      monitorBounds: [],
    };
  }

  try {
    const { availableMonitors, getCurrentWindow, primaryMonitor } =
      await import('@tauri-apps/api/window');
    const currentWindow = getCurrentWindow();
    const [monitors, primary, position, size] = await Promise.all([
      availableMonitors(),
      primaryMonitor(),
      currentWindow.outerPosition(),
      currentWindow.outerSize(),
    ]);
    const currentMonitor = monitors.find((m) => {
      const left = m.position.x;
      const top = m.position.y;
      const right = left + m.size.width;
      const bottom = top + m.size.height;
      return position.x >= left && position.x < right && position.y >= top && position.y < bottom;
    });
    const assistantDisplay =
      currentMonitor && primary && currentMonitor.name !== primary.name
        ? 'non-primary'
        : currentMonitor
          ? 'primary'
          : 'unknown';

    return {
      activeWindowProcessName: activeWindow.processName,
      activeWindowTitle: activeWindow.title,
      assistantDisplay,
      monitorCount: monitors.length,
      windowBounds: { x: position.x, y: position.y, width: size.width, height: size.height },
      monitorBounds: monitors.map((m) => ({
        x: m.position.x,
        y: m.position.y,
        width: m.size.width,
        height: m.size.height,
      })),
    };
  } catch (e) {
    logger.warn('tauri', 'shareGuard snapshot failed', { err: String(e) });
    return {
      activeWindowProcessName: activeWindow.processName,
      activeWindowTitle: activeWindow.title,
      assistantDisplay: 'unknown',
      monitorCount: 1,
      windowBounds: null,
      monitorBounds: [],
    };
  }
}

// ── Knowledge base ────────────────────────────────────────────────────────────

export async function searchKnowledgeBase(query: string): Promise<KnowledgePassage[]> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<KnowledgePassage[]>('search_knowledge_base', { query });
  }
  return [];
}

// ── LLM (multi-provider, streaming) ──────────────────────────────────────────

export async function callLlm(
  prompt: string,
  options: {
    context?: string[];
    provider?: ProviderName;
    model?: string;
    systemPrompt?: string;
    onChunk?: (chunk: string) => void;
  } = {},
): Promise<string> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');
    let requestId: string | null = null;

    const unlisten = await listen<LlmChunkPayload>('llm_chunk', (event) => {
      if (!requestId || event.payload.requestId === requestId) {
        options.onChunk?.(event.payload.chunk);
      }
    });

    try {
      const response = await invoke<LlmResponse>('call_llm', {
        prompt,
        context: options.context ?? [],
        provider: options.provider ?? 'groq',
        model: options.model,
        systemPrompt: options.systemPrompt,
      });
      requestId = response.requestId;
      return response.text;
    } finally {
      unlisten();
    }
  }

  return 'Native LLM runtime unavailable in browser mode.';
}

export async function callLlmWithKnowledgeContext(
  prompt: string,
  options: { onChunk?: (chunk: string) => void; provider?: ProviderName; model?: string } = {},
): Promise<string> {
  const kbQuery = prompt.trim().startsWith('#kb') ? prompt.replace(/^#kb\s*/i, '').trim() : '';
  const context = kbQuery
    ? (await searchKnowledgeBase(kbQuery)).map((p) => `${p.title}: ${p.passage}`)
    : [];
  const normalizedPrompt = kbQuery || prompt;

  if (kbQuery) {
    const { logSensitiveKnowledgeBaseQuery } = await import('./auditLogger');
    await logSensitiveKnowledgeBaseQuery(kbQuery);
  }

  return callLlm(normalizedPrompt, { context, ...options });
}

// ── OS Keychain ───────────────────────────────────────────────────────────────

export async function storeApiKey(provider: string, apiKey: string): Promise<void> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('store_api_key', { provider, apiKey });
    return;
  }
  localStorage.setItem(`mm_key_${provider}`, apiKey);
}

export async function retrieveApiKey(provider: string): Promise<string | null> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string | null>('retrieve_api_key', { provider });
  }
  return localStorage.getItem(`mm_key_${provider}`);
}

export async function deleteApiKey(provider: string): Promise<void> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('delete_api_key', { provider });
    return;
  }
  localStorage.removeItem(`mm_key_${provider}`);
}

// ── Click-through overlay ─────────────────────────────────────────────────────

export async function setClickThrough(windowLabel: string, enabled: boolean): Promise<void> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_click_through', { windowLabel, enabled });
  }
}

// ── Meeting daemon ────────────────────────────────────────────────────────────

export async function startMeetingDaemon(): Promise<void> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('start_meeting_daemon');
  }
}

export async function stopMeetingDaemon(): Promise<void> {
  if (await canUseTauriInvoke()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('stop_meeting_daemon');
  }
}

// ── Tauri event helpers ───────────────────────────────────────────────────────

export async function listenTauriEvent<T>(
  event: string,
  callback: (payload: T) => void,
): Promise<() => void> {
  if (await canUseTauriInvoke()) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<T>(event, (e) => callback(e.payload));
  }
  return () => {};
}

// ── Re-exports ────────────────────────────────────────────────────────────────

export type {
  ActiveWindowInfo,
  AuditEvent,
  AudioPipelineStatus,
  KnowledgePassage,
  LlmResponse,
  NativeAudioChunk,
  OcrResult,
  ScreenCaptureResult,
  SessionSummary,
  ShareGuardRuntimeSnapshot,
  TranscriptItem,
  TranscriptSegment,
};
