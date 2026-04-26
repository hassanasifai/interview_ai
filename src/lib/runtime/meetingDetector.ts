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

// Specific (high-signal) process patterns: matching one of these alone
// is enough to fire detection. Generic browser/runtime processes
// (chrome.exe, msedge.exe, electron, node) are intentionally excluded —
// they can run a million things, and matching them solo was the source
// of bug M1 ("chrome.exe alone triggers 70% confidence").
const specificProcessRules: Record<MeetingDetectionResult['platform'], RegExp[]> = {
  zoom: [/^zoom(opener|\.exe)?$/i, /^zoommeetings?$/i],
  'google-meet': [],
  'microsoft-teams': [/^teams(\.exe)?$/i, /^ms-teams(\.exe)?$/i, /^msteams(\.exe)?$/i],
  webex: [/^webexmta(\.exe)?$/i, /^ciscowebex(\.exe)?$/i, /^webex(\.exe)?$/i],
  hackerrank: [],
  leetcode: [],
  discord: [/^discord(\.exe)?$/i],
  slack: [/^slack(\.exe)?$/i],
  jitsi: [/^jitsi(\.exe)?$/i],
  whereby: [/^whereby(\.exe)?$/i],
  bluejeans: [/^bluejeans(\.exe)?$/i],
  unknown: [],
};

// Generic browser/runtime processes that are NOT load-bearing on their own.
// We use these only to *strengthen* a title match (title says "Google Meet"
// AND process is chrome → very high confidence) but never to fire detection
// without a corroborating title.
const browserHosts = /^(chrome|msedge|firefox|brave|opera|safari|electron|node)(\.exe)?$/i;

export function detectMeetingCandidate(
  windowTitle: string,
  processName?: string | null,
): MeetingDetectionResult {
  const normalized = windowTitle.trim();
  const proc = processName?.trim() ?? '';

  if (normalized.length === 0 && proc.length === 0) {
    return {
      isMeetingCandidate: false,
      platform: 'unknown',
      confidence: 0,
      reason: 'No window title provided.',
    };
  }

  for (const rule of platformRules) {
    const titleMatches = normalized.length > 0 && rule.patterns.some((p) => p.test(normalized));
    const specifics = specificProcessRules[rule.platform];
    const specificProcessMatches =
      proc.length > 0 && specifics.length > 0 && specifics.some((p) => p.test(proc));
    const isHostedInBrowser = proc.length > 0 && browserHosts.test(proc);

    if (titleMatches && specificProcessMatches) {
      return {
        isMeetingCandidate: true,
        platform: rule.platform,
        confidence: 0.97,
        reason: `Detected ${rule.platform} in window title and a specific process.`,
      };
    }
    if (titleMatches && isHostedInBrowser) {
      // Title is the load-bearing signal; the browser process just confirms
      // the host. Slightly higher than title-alone because we know the URL
      // bar is in a browser tab the user is actively viewing.
      return {
        isMeetingCandidate: true,
        platform: rule.platform,
        confidence: 0.92,
        reason: `Detected ${rule.platform} in title (hosted in ${proc}).`,
      };
    }
    if (titleMatches) {
      return {
        isMeetingCandidate: true,
        platform: rule.platform,
        confidence: 0.9,
        reason: `Detected ${rule.platform} in active window title.`,
      };
    }
    if (specificProcessMatches) {
      return {
        isMeetingCandidate: true,
        platform: rule.platform,
        confidence: 0.78,
        reason: `Detected ${rule.platform} via specific process name.`,
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

// ── Active screen-share detection ────────────────────────────────────────────
// Detect whether the user is currently sharing their screen via the active
// window title. Each meeting app appends a share-mode marker to its title bar
// when sharing starts; the markers below are observed across recent versions
// (some are localised — we match the English ones, which is the common case).

const SHARE_MODE_MARKERS: RegExp[] = [
  /\bis sharing\b/i,
  /\bsharing screen\b/i,
  /\bsharing your screen\b/i,
  /\bscreen sharing\b/i,
  /\bpresenting\b/i,
  /\[sharing\]/i,
  /\(sharing\)/i,
];

/**
 * True if the window title (or process name) suggests the user is currently
 * presenting / screen-sharing in a meeting. Used to auto-pick a non-shared
 * monitor for the overlay so it stays invisible to other participants.
 */
export function isScreenShareActive(
  windowTitle: string | null | undefined,
  processName?: string | null,
): boolean {
  const haystack = `${windowTitle ?? ''} ${processName ?? ''}`.toLowerCase();
  if (haystack.trim().length === 0) return false;
  return SHARE_MODE_MARKERS.some((re) => re.test(haystack));
}
