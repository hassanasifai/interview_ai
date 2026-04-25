import { createTranscriptSimulator } from '../src/lib/providers/transcriptSimulator';
import { useSessionStore } from '../src/store/sessionStore';

describe('transcriptSimulator', () => {
  beforeEach(() => {
    useSessionStore.setState({
      isActive: false,
      transcript: [],
      rollingWindow: [],
    });
  });

  it('replays transcript events in order', () => {
    const seen: string[] = [];
    const simulator = createTranscriptSimulator([
      { id: '1', speaker: 'customer', text: 'First', timestamp: 1 },
      { id: '2', speaker: 'user', text: 'Second', timestamp: 2 },
    ]);

    simulator.flush((item) => {
      seen.push(item.id);
    });

    expect(seen).toEqual(['1', '2']);
  });

  it('can push transcript items into the session rolling window', async () => {
    const simulator = createTranscriptSimulator([
      { id: '1', speaker: 'customer', text: 'First', timestamp: 1 },
      { id: '2', speaker: 'user', text: 'Second', timestamp: 2 },
      { id: '3', speaker: 'customer', text: 'Third', timestamp: 3 },
      { id: '4', speaker: 'user', text: 'Fourth', timestamp: 4 },
    ]);

    simulator.flush((item) => {
      useSessionStore.getState().appendTranscript(item);
    });

    // appendTranscript is rAF-batched; wait for the next frame so the store flushes.
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 32);
      }
    });

    expect(useSessionStore.getState().rollingWindow.map((item) => item.id)).toEqual([
      '2',
      '3',
      '4',
    ]);
  });
});
