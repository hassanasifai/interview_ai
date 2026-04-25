type CodingAnalysis = {
  problemSummary: string;
  detectedTopics: string[];
  suggestedApproach: string[];
  edgeCases: string[];
  testPlan: string[];
};

const topicSignals: Array<{ topic: string; tokens: string[] }> = [
  { topic: 'arrays', tokens: ['array', 'subarray', 'two sum', 'prefix'] },
  { topic: 'strings', tokens: ['string', 'substring', 'palindrome'] },
  { topic: 'hash map', tokens: ['hash', 'map', 'dictionary', 'frequency'] },
  { topic: 'trees', tokens: ['tree', 'binary tree', 'bst', 'node'] },
  { topic: 'graph', tokens: ['graph', 'bfs', 'dfs', 'topological'] },
  { topic: 'dynamic programming', tokens: ['dp', 'dynamic programming', 'memoization'] },
  { topic: 'heap', tokens: ['heap', 'priority queue', 'kth'] },
];

function detectTopics(text: string) {
  const lower = text.toLowerCase();
  const matched = topicSignals
    .filter((entry) => entry.tokens.some((token) => lower.includes(token)))
    .map((entry) => entry.topic);

  return matched.length > 0 ? matched : ['general problem solving'];
}

export function analyzeCodingPrompt(rawPrompt: string): CodingAnalysis {
  const normalized = rawPrompt.trim();

  if (normalized.length === 0) {
    return {
      problemSummary: 'No coding prompt text provided yet.',
      detectedTopics: [],
      suggestedApproach: [],
      edgeCases: [],
      testPlan: [],
    };
  }

  const topics = detectTopics(normalized);
  const firstSentence =
    normalized
      .split(/[.!?\n]/)
      .map((item) => item.trim())
      .find(Boolean) ?? normalized;

  return {
    problemSummary: firstSentence,
    detectedTopics: topics,
    suggestedApproach: [
      'Restate the input/output contract and constraints first.',
      'Choose a baseline approach, then optimize for target complexity.',
      'Explain data structures before writing code to keep narration clear.',
    ],
    edgeCases: [
      'Empty input or single-element input.',
      'Maximum-size input and repeated values.',
      'Invalid or boundary values based on constraints.',
    ],
    testPlan: [
      'Happy-path example from the prompt.',
      'Small boundary case and large stress case.',
      'One adversarial case targeting the chosen data structure.',
    ],
  };
}

export type { CodingAnalysis };
