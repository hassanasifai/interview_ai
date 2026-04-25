import { act } from '@testing-library/react';
import { seedDemoKnowledgeBase } from '../src/fixtures/demoKnowledge';
import { useOverlayStore } from '../src/store/overlayStore';
import { useSessionStore } from '../src/store/sessionStore';
import { useSettingsStore } from '../src/store/settingsStore';

describe('session runtime orchestration', () => {
  beforeEach(() => {
    localStorage.clear();
    seedDemoKnowledgeBase();

    useOverlayStore.setState({
      isVisible: true,
      isPinned: false,
      currentSuggestion: null,
      statusLabel: 'Ready for session',
    });

    useSettingsStore.setState({
      profile: {
        userName: 'Host',
        userRole: 'Sales Engineer',
        companyName: 'MeetingMind',
      },
      groqApiKey: '',
      extraInstructions: '',
      autoHideOnFullScreenShare: true,
      preferSecondScreen: true,
      consentAccepted: true,
    });

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

  it('generates an overlay suggestion from a customer question', async () => {
    act(() => {
      useSessionStore.getState().startSession();
    });

    await act(async () => {
      await useSessionStore.getState().ingestTranscript({
        id: '1',
        speaker: 'customer',
        text: 'Can you explain enterprise pricing and onboarding?',
        timestamp: 1,
      });
    });

    const suggestion = useOverlayStore.getState().currentSuggestion;

    expect(suggestion).not.toBeNull();
    expect(suggestion?.question.type).toBe('pricing');
    expect(suggestion?.answerBullets.length).toBeGreaterThan(0);
  });

  it('blocks session start when consent is not accepted', () => {
    useSettingsStore.setState({
      consentAccepted: false,
    });

    act(() => {
      useSessionStore.getState().startSession();
    });

    expect(useSessionStore.getState().isActive).toBe(false);
    expect(useSessionStore.getState().lastError).toContain('Accept the consent reminder');
  });
});
