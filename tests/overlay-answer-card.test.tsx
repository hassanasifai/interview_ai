import { render, screen } from '@testing-library/react';
import { QuestionCard } from '../src/features/overlay/QuestionCard';
import { OverlayWindow } from '../src/features/overlay/OverlayWindow';
import { useOverlayStore } from '../src/store/overlayStore';
import { useSessionStore } from '../src/store/sessionStore';
import { useSettingsStore } from '../src/store/settingsStore';

describe('QuestionCard', () => {
  it('renders the detected question and answer bullets', () => {
    render(
      <QuestionCard
        bullets={[
          'Pricing scales with team size.',
          'Support tier affects the final quote.',
          'Onboarding can be scoped separately.',
        ]}
        confidence={0.9}
        oneLiner="Pricing is based on seats and rollout scope."
        question="Can you explain enterprise pricing?"
        redFlags={[]}
        suggestedFollowup="Would you like the seat-band matrix after the call?"
        supportSnippets={['Pricing Guide.md: seat bands and onboarding options.']}
      />,
    );

    expect(screen.getByText('Can you explain enterprise pricing?')).toBeInTheDocument();
    expect(screen.getByText('Pricing scales with team size.')).toBeInTheDocument();
  });
});

describe('OverlayWindow Share Guard', () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionStore.setState({
      isActive: true,
      mode: 'running',
      researchMode: false,
      providerStatus: 'ready',
      lastError: null,
      transcript: [],
      rollingWindow: [],
      report: null,
    });
    useOverlayStore.setState({
      isVisible: true,
      isPinned: false,
      statusLabel: 'Suggestion ready',
      currentSuggestion: {
        question: {
          text: 'Can you explain enterprise pricing?',
          type: 'pricing',
        },
        oneLiner: 'Pricing depends on seats and support tier.',
        answerBullets: ['Pricing scales with seats.'],
        confidence: 0.9,
        supportSnippets: [],
        suggestedFollowup: '',
        redFlags: [],
      },
    });
  });

  it('does not render sensitive answer content when full-screen share guard auto-hides the overlay', async () => {
    useSettingsStore.setState({
      autoHideOnFullScreenShare: true,
      preferSecondScreen: true,
      shareMode: 'entire-screen',
      hasSecondScreen: false,
    });

    render(<OverlayWindow />);

    // The OverlayWindow auto-hides into a cloak pill when share guard fires;
    // no answer content (sensitive question text) is rendered while hidden.
    expect(
      await screen.findByRole('button', { name: /share guard activated/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Can you explain enterprise pricing?')).not.toBeInTheDocument();
  });
});
