export type WindowRole = 'dashboard' | 'overlay' | 'companion' | 'capture-excluded-overlay';

export function detectWindowRole(): WindowRole {
  if (typeof window === 'undefined') {
    return 'dashboard';
  }

  const params = new URLSearchParams(window.location.search);
  const role = params.get('window');

  if (role === 'overlay' || role === 'companion' || role === 'capture-excluded-overlay') {
    return role;
  }

  return 'dashboard';
}
