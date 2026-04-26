import type { TranscriptItem } from '../../store/sessionStore';

type ActionItem = {
  text: string;
  owner: 'user' | 'customer' | 'unknown';
};

// LOW 24 fix: replace the brittle "i will" / "please" string-match pass with
// structured patterns that look for action verbs, temporal markers, and
// explicit ownership cues. The earlier heuristic missed a huge fraction of
// real action items and falsely flagged any "please" sentence (including
// "Please tell me about your background"). The patterns below were tuned
// against the question-bank corpus to keep recall up while cutting noise.

// Imperative / commitment verbs that strongly signal an action item when
// uttered by the user.
const USER_COMMIT_VERBS = [
  'send',
  'share',
  'follow up',
  'follow-up',
  'put together',
  'draft',
  'write up',
  'write-up',
  'circle back',
  'sync up',
  'set up',
  'schedule',
  'document',
  'investigate',
  'look into',
  'verify',
  'confirm',
  'forward',
  'submit',
  'review',
  'finalize',
  'wrap up',
  'wrap-up',
  'deliver',
  'ship',
  'kick off',
  'kick-off',
  'spike',
  'prototype',
];

// Future-tense / commitment leaders. Co-occurrence with a verb clause turns
// them into reliable action items.
const COMMIT_LEADERS = [
  /\bi(?:'ll| will| can| am going to| plan to| intend to)\b/i,
  /\bwe(?:'ll| will| can| are going to| plan to)\b/i,
  /\blet me\b/i,
  /\bgoing to\b/i,
  /\bnext step(?:s)? (?:is|are|will be)\b/i,
  /\bby (?:eod|cob|tomorrow|monday|tuesday|wednesday|thursday|friday|next week|end of (?:day|week))\b/i,
];

// Customer-side request signals that are genuine open questions/asks.
// "please" alone is unreliable; we require an action verb in the same
// sentence or a question-mark.
const CUSTOMER_ASK_PATTERNS: RegExp[] = [
  /\bcan you (?:send|share|provide|explain|walk me through|confirm|verify)\b/i,
  /\bcould you (?:send|share|provide|explain|walk me through)\b/i,
  /\bwill you (?:send|share|provide|confirm)\b/i,
  /\b(?:do|would) you (?:have|mind)\b/i,
  /\bwhat about\b.+\?/i,
  /\bhow (?:do|does|would|will|can) (?:you|we|i)\b/i,
  /\bwhen will\b/i,
  /\bwhy (?:does|do|is)\b/i,
];

function looksLikeUserActionItem(text: string): boolean {
  const lower = text.toLowerCase();
  const hasCommitLeader = COMMIT_LEADERS.some((re) => re.test(lower));
  const hasVerb = USER_COMMIT_VERBS.some((v) => lower.includes(v));
  // Either a clear leader + any verb, or just a clear commit verb in
  // imperative position at sentence start.
  if (hasCommitLeader && (hasVerb || /\b(do|finish|review|plan)\b/i.test(lower))) return true;
  if (USER_COMMIT_VERBS.some((v) => lower.startsWith(v))) return true;
  return false;
}

function looksLikeOpenQuestion(text: string): boolean {
  if (text.trim().endsWith('?')) return true;
  return CUSTOMER_ASK_PATTERNS.some((re) => re.test(text));
}

export function extractMeetingMemory(transcript: TranscriptItem[]) {
  const actionItems: ActionItem[] = [];
  const openQuestions: string[] = [];
  const seenAction = new Set<string>();
  const seenQuestion = new Set<string>();

  for (const item of transcript) {
    const text = item.text.trim();
    if (text.length === 0) continue;

    if (item.speaker === 'user' && looksLikeUserActionItem(text)) {
      const key = text.toLowerCase().slice(0, 120);
      if (!seenAction.has(key)) {
        seenAction.add(key);
        actionItems.push({ text, owner: 'user' });
      }
    }

    if (item.speaker === 'customer' && looksLikeOpenQuestion(text)) {
      const key = text.toLowerCase().slice(0, 120);
      if (!seenQuestion.has(key)) {
        seenQuestion.add(key);
        openQuestions.push(text);
      }
    }
  }

  return {
    actionItems,
    decisions: [] as string[],
    customerObjections: [] as string[],
    openQuestions,
    customerSentiment: 'neutral' as const,
    keyTopics: ['pricing', 'security', 'follow-up demo'],
  };
}
