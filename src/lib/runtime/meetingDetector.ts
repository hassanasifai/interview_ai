export type MeetingDetectionResult = {
  isMeetingCandidate: boolean;
  platform:
    | 'zoom'
    | 'google-meet'
    | 'microsoft-teams'
    | 'webex'
    | 'hackerrank'
    | 'leetcode'
    | 'discord'
    | 'slack'
    | 'jitsi'
    | 'whereby'
    | 'bluejeans'
    | 'unknown';
  confidence: number;
  reason: string;
};

const platformRules: Array<{
  platform: MeetingDetectionResult['platform'];
  patterns: RegExp[];
}> = [
  { platform: 'zoom', patterns: [/zoom/i] },
  { platform: 'google-meet', patterns: [/google\s*meet/i, /meet\.google/i] },
  { platform: 'microsoft-teams', patterns: [/teams/i, /microsoft\s*teams/i] },
  { platform: 'webex', patterns: [/webex/i, /cisco\s*webex/i] },
  { platform: 'hackerrank', patterns: [/hackerrank/i] },
  { platform: 'leetcode', patterns: [/leetcode/i] },
  { platform: 'discord', patterns: [/discord/i] },
  { platform: 'slack', patterns: [/slack/i] },
  { platform: 'jitsi', patterns: [/jitsi/i, /meet\.jit\.si/i] },
  { platform: 'whereby', patterns: [/whereby/i] },
  { platform: 'bluejeans', patterns: [/bluejeans/i, /blue\s*jeans/i] },
];

const processRules: Record<MeetingDetectionResult['platform'], RegExp[]> = {
  zoom: [/zoom(opener|\.exe)?/i],
  'google-meet': [/chrome/i],
  'microsoft-teams': [/teams(\.exe)?/i, /ms-teams/i],
  webex: [/webexmta/i, /ciscowebex/i],
  hackerrank: [/chrome/i, /node/i],
  leetcode: [/chrome/i],
  discord: [/discord(\.exe)?/i],
  slack: [/slack(\.exe)?/i],
  jitsi: [/chrome/i, /jitsi(\.exe)?/i],
  whereby: [/chrome/i, /whereby(\.exe)?/i],
  bluejeans: [/bluejeans(\.exe)?/i, /chrome/i],
  unknown: [],
};

export function detectMeetingCandidate(
  windowTitle: string,
  processName?: string | null,
): MeetingDetectionResult {
  const normalized = windowTitle.trim();

  if (normalized.length === 0 && !processName) {
    return {
      isMeetingCandidate: false,
      platform: 'unknown',
      confidence: 0,
      reason: 'No window title provided.',
    };
  }

  for (const rule of platformRules) {
    const titleMatches = normalized.length > 0 && rule.patterns.some((p) => p.test(normalized));
    const procPatterns = processRules[rule.platform];
    const processMatches =
      !!processName && procPatterns.length > 0 && procPatterns.some((p) => p.test(processName));

    if (titleMatches && processMatches) {
      return {
        isMeetingCandidate: true,
        platform: rule.platform,
        confidence: 0.95,
        reason: `Detected ${rule.platform} signature in both window title and process name.`,
      };
    }
    if (titleMatches) {
      return {
        isMeetingCandidate: true,
        platform: rule.platform,
        confidence: 0.9,
        reason: `Detected ${rule.platform} signature in active window title.`,
      };
    }
    if (processMatches) {
      return {
        isMeetingCandidate: true,
        platform: rule.platform,
        confidence: 0.7,
        reason: `Detected ${rule.platform} signature in process name.`,
      };
    }
  }

  return {
    isMeetingCandidate: false,
    platform: 'unknown',
    confidence: 0.2,
    reason: 'No supported meeting platform signature matched.',
  };
}
