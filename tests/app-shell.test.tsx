import { act, render, screen } from '@testing-library/react';
import App from '../src/App';

async function renderApp(role: 'dashboard' | 'overlay' | 'companion') {
  let renderResult!: ReturnType<typeof render>;
  await act(async () => {
    renderResult = render(<App windowRole={role} />);
  });
  // Flush any post-mount async effects (api-key hydration, store injection,
  // share-mode listener setup) before assertions so they don't trigger
  // unwrapped-state-update warnings during the test body.
  await act(async () => {
    await Promise.resolve();
  });
  return renderResult;
}

describe('App shell', () => {
  it('renders the dashboard layout when the window role is dashboard', async () => {
    await renderApp('dashboard');
    expect(screen.getByTestId('dashboard-window')).toBeInTheDocument();
  });

  it('renders the overlay layout when the window role is overlay', async () => {
    await renderApp('overlay');
    expect(screen.getByTestId('overlay-window')).toBeInTheDocument();
  });

  it('renders the companion display when the window role is companion', async () => {
    await renderApp('companion');
    expect(screen.getByTestId('companion-window')).toBeInTheDocument();
  });
});
