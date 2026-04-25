import type { TranscriptItem } from '../../store/sessionStore';

export function createTranscriptSimulator(seed: TranscriptItem[]) {
  return {
    flush(onEvent: (item: TranscriptItem) => void) {
      seed.forEach((item) => {
        onEvent(item);
      });
    },
  };
}
