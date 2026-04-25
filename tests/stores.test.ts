import { act } from '@testing-library/react';
import { useIntegrationStore } from '../src/store/integrationStore';
import { useOverlayStore } from '../src/store/overlayStore';
import { useSessionStore } from '../src/store/sessionStore';
import { useSettingsStore } from '../src/store/settingsStore';

describe('settingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      profile: {
        userName: '',
        userRole: '',
        companyName: '',
      },
      groqApiKey: '',
      providerModel: 'llama-3.3-70b-versatile',
      extraInstructions: '',
      enableResumeGrounding: true,
      autoHideOnFullScreenShare: true,
      preferSecondScreen: true,
      consentAccepted: false,
    });
  });

  it('hydrates saved settings from localStorage', () => {
    localStorage.setItem(
      'meetingmind-settings',
      JSON.stringify({
        profile: {
          userName: 'Hassan',
          userRole: 'Sales Engineer',
          companyName: 'MeetingMind',
        },
        groqApiKey: 'gsk_test',
        providerModel: 'llama-3.1-8b-instant',
        extraInstructions: 'Lead with concise answers.',
        enableResumeGrounding: false,
        autoHideOnFullScreenShare: false,
        preferSecondScreen: false,
        consentAccepted: true,
      }),
    );

    act(() => {
      useSettingsStore.getState().hydrate();
    });

    expect(useSettingsStore.getState().profile.userName).toBe('Hassan');
    expect(useSettingsStore.getState().groqApiKey).toBe('gsk_test');
    expect(useSettingsStore.getState().providerModel).toBe('llama-3.1-8b-instant');
    expect(useSettingsStore.getState().enableResumeGrounding).toBe(false);
    expect(useSettingsStore.getState().preferSecondScreen).toBe(false);
    expect(useSettingsStore.getState().consentAccepted).toBe(true);
  });
});

describe('integrationStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useIntegrationStore.setState({
      zoomAccessToken: '',
      googleAccessToken: '',
    });
  });

  it('hydrates saved integration credentials', async () => {
    localStorage.setItem(
      'meetingmind-integrations',
      JSON.stringify({
        zoomAccessToken: 'zoom_token',
        googleAccessToken: 'google_token',
      }),
    );

    await act(async () => {
      useIntegrationStore.getState().hydrate();
      // hydrate fires-and-forgets a chain of async ops through saveTokens +
      // loadTokens which both go through the (mocked) invoke. Flush enough
      // microtasks for the keychain round-trip to settle before asserting.
      for (let i = 0; i < 16; i++) {
        await Promise.resolve();
      }
    });

    expect(useIntegrationStore.getState().zoomAccessToken).toBe('zoom_token');
    expect(useIntegrationStore.getState().googleAccessToken).toBe('google_token');
  });
});

describe('overlayStore', () => {
  beforeEach(() => {
    useOverlayStore.setState({
      isVisible: true,
      isPinned: false,
      currentSuggestion: null,
      statusLabel: 'Ready for session',
    });
  });

  it('toggles overlay visibility', () => {
    act(() => {
      useOverlayStore.getState().toggleVisibility();
    });

    expect(useOverlayStore.getState().isVisible).toBe(false);
  });
});

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({
      isActive: false,
      mode: 'stopped',
      researchMode: false,
      providerStatus: 'ready',
      lastError: null,
      transcript: [],
      rollingWindow: [],
      report: null,
    });
  });

  it('appends transcript items and keeps a rolling window', async () => {
    act(() => {
      useSessionStore.getState().appendTranscript({
        id: '1',
        speaker: 'customer',
        text: 'What changes for enterprise pricing?',
        timestamp: 1,
      });
      useSessionStore.getState().appendTranscript({
        id: '2',
        speaker: 'user',
        text: 'Pricing changes based on seats and support.',
        timestamp: 2,
      });
      useSessionStore.getState().appendTranscript({
        id: '3',
        speaker: 'customer',
        text: 'Do you include onboarding?',
        timestamp: 3,
      });
      useSessionStore.getState().appendTranscript({
        id: '4',
        speaker: 'user',
        text: 'Yes, onboarding is included in enterprise plans.',
        timestamp: 4,
      });
    });

    // appendTranscript is rAF-batched; wait for the next frame so the store flushes.
    await act(async () => {
      await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(() => resolve());
        } else {
          setTimeout(resolve, 32);
        }
      });
    });

    expect(useSessionStore.getState().transcript).toHaveLength(4);
    expect(useSessionStore.getState().rollingWindow).toHaveLength(3);
    expect(useSessionStore.getState().rollingWindow[0].id).toBe('2');
  });
});
