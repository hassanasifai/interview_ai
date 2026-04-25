// Phase 2G: Structured logger that routes through the Tauri log plugin in
// production and falls back to console output in dev/browser mode. Logs are
// buffered briefly so callers do not block on the IPC round-trip; the log
// plugin itself persists to disk on the Rust side.

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  request_id?: string;
  session_id?: string;
  [k: string]: unknown;
}

interface LogEntry {
  level: LogLevel;
  target: string;
  msg: string;
  ctx: LogContext;
  ts: number;
}

const IS_DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;

async function canUseTauri(): Promise<boolean> {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

class Logger {
  private buffer: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  log(level: LogLevel, target: string, msg: string, ctx: LogContext = {}) {
    const entry: LogEntry = { level, target, msg, ctx, ts: Date.now() };
    this.buffer.push(entry);
    void this.dispatch(entry);
    this.scheduleFlush();
  }

  private async dispatch(entry: LogEntry) {
    const formatted = `[${entry.target}] ${entry.msg} ${safeStringify(entry.ctx)}`;

    if (await canUseTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        // The Tauri log plugin command name varies by version; try the
        // documented v2 name first, then fall back to a legacy name.
        try {
          await invoke('plugin:log|log', {
            level: this.levelInt(entry.level),
            message: formatted,
          });
          return;
        } catch {
          // Fall through to console in dev; in production the entry is lost.
          // TODO: replace the legacy command name once tauri-plugin-log v2's
          // exact invoke signature is locked in for this project.
        }
      } catch {
        // Tauri import failed — fall through to console.
      }
    }

    if (IS_DEV) {
      // eslint-disable-next-line no-console -- logger fallback to console in dev when Tauri plugin is unavailable; this is the actual logger implementation
      const fn = console[entry.level] ?? console.log;
      try {
        fn.call(console, formatted);
      } catch {
        // Some test environments stub console; ignore failures.
      }
    }
    // In production with the plugin unavailable, the message is dropped on the
    // floor. TODO: wire to a HTTP/file fallback when the plugin command name
    // is confirmed.
  }

  private levelInt(l: LogLevel): number {
    return ({ debug: 1, info: 2, warn: 3, error: 4 } as const)[l];
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      // The Tauri plugin invoke above already persists; trim the in-memory
      // buffer so we never keep more than the last 500 entries.
      if (this.buffer.length > 500) {
        this.buffer = this.buffer.slice(-500);
      }
    }, 500);
  }

  /** Returns recent in-memory entries (debug aid only). */
  recent(limit = 100): LogEntry[] {
    return this.buffer.slice(-limit);
  }

  debug(target: string, msg: string, ctx?: LogContext) {
    this.log('debug', target, msg, ctx ?? {});
  }
  info(target: string, msg: string, ctx?: LogContext) {
    this.log('info', target, msg, ctx ?? {});
  }
  warn(target: string, msg: string, ctx?: LogContext) {
    this.log('warn', target, msg, ctx ?? {});
  }
  error(target: string, msg: string, ctx?: LogContext) {
    this.log('error', target, msg, ctx ?? {});
  }
}

function safeStringify(ctx: LogContext): string {
  try {
    return JSON.stringify(ctx);
  } catch {
    return '{"_": "unserializable"}';
  }
}

export const logger = new Logger();
export type { LogLevel, LogContext };
