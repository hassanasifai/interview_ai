import type { TranscriptItem } from '../../store/sessionStore';
import { extractMeetingMemory } from './memoryExtractor';

type SummarizeArgs = {
  customerName: string;
  transcript: TranscriptItem[];
  durationMinutes: number;
  userName: string;
  userRole: string;
};

export function summarizeMeeting({
  customerName,
  transcript,
  durationMinutes,
  userName,
  userRole,
}: SummarizeArgs) {
  const memory = extractMeetingMemory(transcript);

  return {
    executiveSummary: `${userName} (${userRole}) held a ${durationMinutes}-minute call with ${customerName} covering pricing, security, and follow-up planning.`,
    keyDiscussionPoints: memory.keyTopics,
    actionItems: memory.actionItems.map((item) => ({
      text: item.text,
      owner: item.owner,
      priority: 'medium' as const,
    })),
    customerConcerns: memory.customerObjections,
    agreedNextSteps: memory.openQuestions,
    followUpRequired: memory.actionItems.length > 0,
    overallSentiment: memory.customerSentiment,
  };
}
