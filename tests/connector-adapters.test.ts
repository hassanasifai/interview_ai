import { getConnectorAdapters } from '../src/lib/integrations/connectorAdapters';
import { vi } from 'vitest';

describe('connector adapters', () => {
  it('returns not-configured health when tokens are not provided', async () => {
    const adapters = getConnectorAdapters();
    const health = await Promise.all(adapters.map((adapter) => adapter.getHealth()));

    expect(health).toHaveLength(2);
    expect(health.some((item) => item.platform === 'zoom')).toBe(true);
    expect(health.some((item) => item.platform === 'google-meet')).toBe(true);
    expect(health.every((item) => item.mode === 'not-configured')).toBe(true);
  });

  it('returns configured health when upstream probes succeed', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
    );

    const adapters = getConnectorAdapters({
      zoomAccessToken: 'zoom-token',
      googleAccessToken: 'google-token',
      fetcher,
    });
    const health = await Promise.all(adapters.map((adapter) => adapter.getHealth()));

    expect(health.every((item) => item.mode === 'configured')).toBe(true);
    expect(fetcher).toHaveBeenCalled();
  });
});
