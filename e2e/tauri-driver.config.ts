/**
 * Playwright config for native Tauri E2E via tauri-driver.
 *
 * This is a separate config from `playwright.config.ts` (which targets the
 * Vite dev webview at localhost:1420). The native config drives a real
 * release-built Tauri binary through tauri-driver's WebDriver bridge so
 * IPC commands, system tray, native hotkeys, and capture-exclusion can all
 * be validated end-to-end.
 *
 * Prerequisites:
 *   1. `cargo tauri build` to produce the release binary
 *   2. `cargo install tauri-driver`
 *   3. Platform-specific WebDriver:
 *        Windows: edgedriver (matching your Edge version)
 *        Linux:   webkit2gtk-driver
 *        macOS:   not currently supported by tauri-driver upstream
 *   4. Set TAURI_DRIVER_BINARY to the absolute path of the release binary,
 *      or rely on the convention `src-tauri/target/release/app(.exe)`.
 *
 * Run:
 *   npx playwright test --config=e2e/tauri-driver.config.ts
 */
import { defineConfig } from '@playwright/test';

const isWindows = process.platform === 'win32';
const binaryPath =
  process.env.TAURI_DRIVER_BINARY ??
  (isWindows ? 'src-tauri/target/release/app.exe' : 'src-tauri/target/release/app');

export default defineConfig({
  testDir: './native',
  testMatch: /.*\.native\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    // tauri-driver speaks WebDriver over an HTTP port (default 4444). The
    // tests connect via the standard webdriver client; the `baseURL` here is
    // only used for path joins when a test uses page.goto('/').
    baseURL: 'http://localhost:1420',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    // tauri-driver itself is the "server" — it spawns the binary, exposes
    // a WebDriver endpoint, and shuts down on close.
    command: `tauri-driver --port 4444 --native-driver-args "--binary ${binaryPath}"`,
    port: 4444,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
});
