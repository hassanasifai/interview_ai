import { render, screen } from '@testing-library/react';
import App from '../src/App';

describe('App shell', () => {
  it('renders the dashboard layout when the window role is dashboard', () => {
    render(<App windowRole="dashboard" />);

    expect(screen.getByTestId('dashboard-window')).toBeInTheDocument();
  });

  it('renders the overlay layout when the window role is overlay', () => {
    render(<App windowRole="overlay" />);

    expect(screen.getByTestId('overlay-window')).toBeInTheDocument();
  });

  it('renders the companion display when the window role is companion', () => {
    render(<App windowRole="companion" />);

    expect(screen.getByTestId('companion-window')).toBeInTheDocument();
  });
});
