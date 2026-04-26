import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// jsdom doesn't provide `Worker`. The vector-store embedding worker is the
// only consumer; we mock vectorStore directly below so the constructor never
// actually fires, but stubbing the global keeps any incidental `new Worker`
// calls from throwing during module evaluation.
if (typeof globalThis.Worker === 'undefined') {
  class NoopWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    postMessage(): void {}
    terminate(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
    dispatchEvent(): boolean {
      return true;
    }
  }
  vi.stubGlobal('Worker', NoopWorker);
}

// vectorStore would otherwise spawn a real Worker on first semanticSearch call
// (knowledge-base + session-runtime tests both exercise that path) and log a
// `Worker is not defined` warning. Mock semanticSearch to reject so callers
// fall through to their keyword-search fallback exactly as in production.
vi.mock('../lib/rag/vectorStore', () => ({
  embedAndStore: vi.fn(async () => undefined),
  semanticSearch: vi.fn(async () => {
    throw new Error('semanticSearch disabled in test environment');
  }),
  removeDocVectors: vi.fn(() => undefined),
}));

// Simple in-memory keychain so integrationStore migration round-trips.
const __testKeychain = new Map<string, string>();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'store_api_key') {
      const key = String((args as { provider?: string })?.provider ?? '');
      const value = String((args as { apiKey?: string })?.apiKey ?? '');
      __testKeychain.set(key, value);
      return undefined;
    }
    if (cmd === 'retrieve_api_key') {
      const key = String((args as { provider?: string })?.provider ?? '');
      return __testKeychain.has(key) ? __testKeychain.get(key) : null;
    }
    if (cmd === 'delete_api_key') {
      const key = String((args as { provider?: string })?.provider ?? '');
      __testKeychain.delete(key);
      return undefined;
    }
    return undefined;
  }),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => undefined),
  emit: vi.fn(async () => undefined),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: vi.fn(() => null) },
  getCurrentWebviewWindow: vi.fn(() => ({ label: 'main' })),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    label: 'main',
    setIgnoreCursorEvents: vi.fn(async () => undefined),
    setAlwaysOnTop: vi.fn(async () => undefined),
    setSize: vi.fn(async () => undefined),
    setPosition: vi.fn(async () => undefined),
    show: vi.fn(async () => undefined),
    hide: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    onResized: vi.fn(async () => () => undefined),
  })),
}));

vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  isRegistered: vi.fn(async () => false),
  register: vi.fn(async () => undefined),
  unregister: vi.fn(async () => undefined),
}));
