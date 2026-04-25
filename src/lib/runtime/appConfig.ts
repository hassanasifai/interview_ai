import { z } from 'zod';
import { logger } from '../logger';

const configSchema = z.object({
  appName: z.string().trim().min(1),
  environment: z.enum(['development', 'production', 'test']),
  providerTimeoutMs: z.number().int().min(1000).max(120000),
  maxAnswerBullets: z.number().int().min(1).max(5),
  auditRetentionDays: z.number().int().min(1).max(365),
});

type AppConfig = z.infer<typeof configSchema>;

type AppConfigHealth = {
  ok: boolean;
  errors: string[];
};

const defaultConfig: AppConfig = {
  appName: 'MeetingMind',
  environment: import.meta.env.PROD
    ? 'production'
    : import.meta.env.MODE === 'test'
      ? 'test'
      : 'development',
  providerTimeoutMs: 20000,
  maxAnswerBullets: 3,
  auditRetentionDays: 30,
};

const STORAGE_KEY = 'meetingmind-runtime-config';

function readStoredConfig(): Partial<AppConfig> {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Partial<AppConfig>;
  } catch (e) {
    logger.warn('appConfig', 'corrupt runtime config; resetting', { err: String(e) });
    localStorage.removeItem(STORAGE_KEY);
    return {};
  }
}

export function writeRuntimeConfig(config: Partial<AppConfig>) {
  const merged = {
    ...readStoredConfig(),
    ...config,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
}

export function getRuntimeConfig(): AppConfig {
  const merged = {
    ...defaultConfig,
    ...readStoredConfig(),
  };

  const parsed = configSchema.safeParse(merged);

  if (!parsed.success) {
    return defaultConfig;
  }

  return parsed.data;
}

export function getRuntimeConfigHealth(): AppConfigHealth {
  const merged = {
    ...defaultConfig,
    ...readStoredConfig(),
  };
  const parsed = configSchema.safeParse(merged);

  if (parsed.success) {
    return {
      ok: true,
      errors: [],
    };
  }

  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  };
}

export type { AppConfig };
