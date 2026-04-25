import type { TranscriptItem } from '../../store/sessionStore';

type ActionItem = {
  text: string;
  owner: 'user' | 'customer' | 'unknown';
};

export function extractMeetingMemory(transcript: TranscriptItem[]) {
  const actionItems: ActionItem[] = [];
  const openQuestions: string[] = [];

  transcript.forEach((item) => {
    const normalized = item.text.toLowerCase();

    if (item.speaker === 'user' && (normalized.includes('i will') || normalized.includes('send'))) {
      actionItems.push({
        text: item.text,
        owner: 'user',
      });
    }

    if (item.speaker === 'customer' && normalized.includes('please')) {
      openQuestions.push(item.text);
    }
  });

  return {
    actionItems,
    decisions: [] as string[],
    customerObjections: [] as string[],
    openQuestions,
    customerSentiment: 'neutral' as const,
    keyTopics: ['pricing', 'security', 'follow-up demo'],
  };
}
