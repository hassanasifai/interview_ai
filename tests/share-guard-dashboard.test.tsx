import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShareGuardDashboard } from '../src/features/dashboard/ShareGuardDashboard';

describe('ShareGuardDashboard', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows risk, monitor count, trigger history, and requires confirmation before force show', async () => {
    render(
      <ShareGuardDashboard
        autoHidden
        monitorCount={2}
        onForceShow={() => Promise.resolve()}
        protectionHistory={[
          {
            id: 'trigger-1',
            timestamp: '2026-04-20T09:00:00.000Z',
            reason: 'fullscreen-sharing',
          },
        ]}
        riskLevel="high"
        safeDisplayMode={false}
      />,
    );

    // Risk label rendered as "AT RISK" for high; the dashboard shows two
    // copies (banner heading + Risk level badge), so use getAllByText.
    expect(screen.getAllByText('AT RISK').length).toBeGreaterThan(0);
    // Monitor count is embedded inline next to a Badge; match the literal "2".
    expect(screen.getByText(/^\s*2\s*$/)).toBeInTheDocument();
    expect(screen.getByText('fullscreen-sharing')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /enforce now/i }));
    expect(screen.getByText(/confirm you accept/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm force show/i }));
    await waitFor(() => {
      expect(screen.queryByText(/confirm you accept/i)).not.toBeInTheDocument();
    });
  });
});
