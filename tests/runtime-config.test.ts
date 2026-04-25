import {
  getRuntimeConfig,
  getRuntimeConfigHealth,
  writeRuntimeConfig,
} from '../src/lib/runtime/appConfig';

describe('runtime config', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns default config when no override is present', () => {
    const config = getRuntimeConfig();

    expect(config.appName).toBe('MeetingMind');
    expect(config.maxAnswerBullets).toBe(3);
  });

  it('reports invalid override as unhealthy', () => {
    writeRuntimeConfig({
      maxAnswerBullets: 99,
    });

    const health = getRuntimeConfigHealth();

    expect(health.ok).toBe(false);
    expect(health.errors.length).toBeGreaterThan(0);
  });
});
