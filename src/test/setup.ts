import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

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
