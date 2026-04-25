import { invoke } from '@tauri-apps/api/core';

export type ShareMode =
  | 'not-sharing'
  | 'entire-screen'
  | 'window-only'
  | 'browser-tab'
  | 'second-screen'
  | 'mobile-companion';

export type MeetingPlatform = 'Zoom' | 'Google Meet' | 'Microsoft Teams' | 'Unknown';

export type ScreenBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ShareGuardInput = {
  shareMode: ShareMode;
  autoHideOnFullScreenShare: boolean;
  preferSecondScreen: boolean;
  hasSecondScreen: boolean;
  activeWindowProcessName?: string | null;
  activeWindowTitle?: string | null;
  assistantDisplay?: 'primary' | 'non-primary' | 'unknown';
  isFullScreenShareActive?: boolean;
  monitorCount?: number;
};

export type ShareGuardResult = {
  overlayShouldHide: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  statusLabel: string;
  guidance: string[];
  detectedMeetingPlatform: MeetingPlatform;
  safeDisplayMode: boolean;
  protectionReason:
    | 'none'
    | 'fullscreen-sharing'
    | 'meeting-app-fullscreen'
    | 'high-risk-meeting-window';
};

export type MeetingApplicationDetection = {
  isKnownMeetingApp: boolean;
  platform: MeetingPlatform;
};

export type FullScreenDetectionInput = {
  windowBounds: ScreenBounds;
  monitorBounds: ScreenBounds[];
  tolerancePx?: number;
};

export type ShareGuardProtectionState = {
  autoHidden: boolean;
  shouldDispatchHideEvent: boolean;
  shouldDispatchRestoreEvent: boolean;
  toastMessage: string | null;
};

export type SharingState = 'none' | 'entire-screen' | 'window' | 'browser-tab';

export type GuardDecision = {
  action: 'show-excluded' | 'show-normal' | 'hide-fallback';
  reason: string;
  exclusionActive: boolean;
};

const KNOWN_MEETING_APPS: Array<{ platform: MeetingPlatform; patterns: RegExp[] }> = [
  {
    platform: 'Zoom',
    patterns: [/^zoom(\.exe)?$/i, /^zoom meetings?(\.exe)?$/i],
  },
  {
    platform: 'Google Meet',
    patterns: [/^googlemeet(\.exe)?$/i],
  },
  {
    platform: 'Microsoft Teams',
    patterns: [/^teams(\.exe)?$/i, /^ms-teams(\.exe)?$/i, /^msteams(\.exe)?$/i],
  },
];

export function getRecommendedPrivacySetup(hasSecondScreen: boolean): ShareMode {
  return hasSecondScreen ? 'second-screen' : 'window-only';
}

export function evaluateShareGuard(input: ShareGuardInput): ShareGuardResult {
  const meetingApp = detectKnownMeetingApplication(
    input.activeWindowProcessName,
    input.activeWindowTitle,
  );
  const monitorCount = input.monitorCount ?? (input.hasSecondScreen ? 2 : 1);
  const safeDisplayMode =
    input.hasSecondScreen && monitorCount > 1 && input.assistantDisplay === 'non-primary';

  if (safeDisplayMode) {
    return {
      overlayShouldHide: false,
      riskLevel: 'low',
      statusLabel: 'Second-screen safe mode',
      detectedMeetingPlatform: meetingApp.platform,
      safeDisplayMode,
      protectionReason: 'none',
      guidance: [
        'The assistant is on a non-primary display.',
        'Confirm the meeting platform is sharing only the primary screen or presentation window.',
        'Keep the assistant on the private display while presenting.',
      ],
    };
  }

  if (input.isFullScreenShareActive && meetingApp.isKnownMeetingApp) {
    return {
      overlayShouldHide: input.autoHideOnFullScreenShare,
      riskLevel: 'high',
      statusLabel: input.autoHideOnFullScreenShare
        ? 'Overlay hidden for meeting share'
        : 'High exposure risk',
      detectedMeetingPlatform: meetingApp.platform,
      safeDisplayMode,
      protectionReason: 'meeting-app-fullscreen',
      guidance: [
        `${meetingApp.platform} appears active while a full-screen share is likely.`,
        input.hasSecondScreen
          ? 'Move MeetingMind to the non-shared display.'
          : 'Switch to window-only or browser-tab sharing before showing sensitive content.',
        'Share Guard can automatically hide the assistant until the risk clears.',
      ],
    };
  }

  if (input.shareMode === 'entire-screen') {
    return {
      overlayShouldHide: input.autoHideOnFullScreenShare,
      riskLevel: 'high',
      statusLabel: input.autoHideOnFullScreenShare
        ? 'Overlay hidden for full-screen share'
        : 'High exposure risk',
      guidance: [
        'Avoid sharing the entire screen while the copilot is visible.',
        input.hasSecondScreen
          ? 'Move MeetingMind to the second screen before presenting.'
          : 'Share only the meeting app, browser tab, or presentation window.',
        'Use the overlay toggle before screen sharing if you must share the full desktop.',
      ],
      detectedMeetingPlatform: meetingApp.platform,
      safeDisplayMode,
      protectionReason: 'fullscreen-sharing',
    };
  }

  if (input.shareMode === 'not-sharing') {
    return {
      overlayShouldHide: false,
      riskLevel: 'low',
      statusLabel: 'Share Guard ready',
      detectedMeetingPlatform: meetingApp.platform,
      safeDisplayMode,
      protectionReason: 'none',
      guidance: [
        'MeetingMind is visible only on your local display until you start sharing.',
        'Before presenting, choose a private display plan in Share Guard.',
      ],
    };
  }

  if (input.shareMode === 'window-only' || input.shareMode === 'browser-tab') {
    return {
      overlayShouldHide: false,
      riskLevel: meetingApp.isKnownMeetingApp ? 'medium' : 'medium',
      statusLabel: meetingApp.isKnownMeetingApp
        ? `${meetingApp.platform} active: confirm shared surface`
        : 'Window-only sharing recommended',
      detectedMeetingPlatform: meetingApp.platform,
      safeDisplayMode,
      protectionReason: 'none',
      guidance: [
        'Share only the target app window or browser tab, not the whole screen.',
        'Keep MeetingMind outside the shared window.',
        'Confirm the meeting platform preview before presenting.',
      ],
    };
  }

  if (input.shareMode === 'mobile-companion') {
    return {
      overlayShouldHide: false,
      riskLevel: 'low',
      statusLabel: 'Mobile companion is private',
      detectedMeetingPlatform: meetingApp.platform,
      safeDisplayMode,
      protectionReason: 'none',
      guidance: [
        'Use the companion display for answer cards and meeting memory.',
        'Keep desktop sharing limited to the meeting or presentation window.',
      ],
    };
  }

  return {
    overlayShouldHide: false,
    riskLevel: 'low',
    statusLabel: input.preferSecondScreen
      ? 'Second-screen mode preferred'
      : 'Second-screen mode active',
    detectedMeetingPlatform: meetingApp.platform,
    safeDisplayMode,
    protectionReason: 'none',
    guidance: [
      'Place MeetingMind on the non-shared monitor.',
      'Share only the meeting or presentation window from the primary screen.',
      'Keep the overlay pinned to your private display.',
    ],
  };
}

export function detectKnownMeetingApplication(
  processName?: string | null,
  windowTitle?: string | null,
): MeetingApplicationDetection {
  const normalized = processName?.trim();

  if (!normalized) {
    return {
      isKnownMeetingApp: false,
      platform: 'Unknown',
    };
  }

  const match = KNOWN_MEETING_APPS.find((candidate) =>
    candidate.patterns.some((pattern) => pattern.test(normalized)),
  );

  if (!match && /^chrome(\.exe)?$|^msedge(\.exe)?$/i.test(normalized)) {
    const title = windowTitle?.trim() ?? '';
    const isGoogleMeet = /\bgoogle meet\b|meet\.google\.com/i.test(title);

    return {
      isKnownMeetingApp: isGoogleMeet,
      platform: isGoogleMeet ? 'Google Meet' : 'Unknown',
    };
  }

  return {
    isKnownMeetingApp: Boolean(match),
    platform: match?.platform ?? 'Unknown',
  };
}

export function isLikelyFullScreenShare({
  monitorBounds,
  tolerancePx = 8,
  windowBounds,
}: FullScreenDetectionInput): boolean {
  return monitorBounds.some((monitor) => {
    const xMatches = Math.abs(windowBounds.x - monitor.x) <= tolerancePx;
    const yMatches = Math.abs(windowBounds.y - monitor.y) <= tolerancePx;
    const widthMatches = Math.abs(windowBounds.width - monitor.width) <= tolerancePx;
    const heightMatches = Math.abs(windowBounds.height - monitor.height) <= tolerancePx;

    return xMatches && yMatches && widthMatches && heightMatches;
  });
}

export function applyShareGuardProtection({
  previousAutoHidden,
  result,
}: {
  previousAutoHidden: boolean;
  result: ShareGuardResult;
}): ShareGuardProtectionState {
  if (result.overlayShouldHide) {
    return {
      autoHidden: true,
      shouldDispatchHideEvent: !previousAutoHidden,
      shouldDispatchRestoreEvent: false,
      toastMessage: previousAutoHidden
        ? null
        : 'AI assistant was automatically hidden due to screen sharing.',
    };
  }

  return {
    autoHidden: false,
    shouldDispatchHideEvent: false,
    shouldDispatchRestoreEvent: previousAutoHidden,
    toastMessage: null,
  };
}

type CaptureExclusionResult = {
  success: boolean;
  method: string;
  error?: string | null;
};

export class ShareGuard {
  private currentState: SharingState = 'none';

  private exclusionActive = false;

  async evaluate(surface: SharingState): Promise<GuardDecision> {
    const previousState = this.currentState;
    this.currentState = surface;

    if (surface === 'entire-screen') {
      if (this.exclusionActive && previousState === 'entire-screen') {
        return {
          action: 'show-excluded',
          reason: 'Capture exclusion already active for entire-screen sharing.',
          exclusionActive: true,
        };
      }

      const exclusionResult = await invoke<CaptureExclusionResult>('set_capture_excluded', {
        windowLabel: 'capture-excluded-overlay',
        excluded: true,
      }).catch(
        (err): CaptureExclusionResult => ({
          success: false,
          method: 'invoke-failed',
          error: `set_capture_excluded threw: ${String(err)}`,
        }),
      );

      if (exclusionResult.success) {
        this.exclusionActive = true;

        return {
          action: 'show-excluded',
          reason: `Capture exclusion active via ${exclusionResult.method}. Overlay visible to presenter only.`,
          exclusionActive: true,
        };
      }

      // Safe default on failure: ensure overlay hidden, keep session running.
      await invoke('toggle_overlay', { label: 'capture-excluded-overlay', visible: false }).catch(
        () => {
          // Best-effort hide. If the toggle command fails, we still drop into
          // the fallback path below without showing the overlay to the user.
        },
      );
      this.exclusionActive = false;

      return {
        action: 'hide-fallback',
        reason: `Capture exclusion failed: ${exclusionResult.error ?? 'unknown error'}. Safety fallback activated.`,
        exclusionActive: false,
      };
    }

    if (surface === 'window' || surface === 'browser-tab') {
      this.exclusionActive = false;
      return {
        action: 'show-normal',
        reason: 'Window/tab sharing detected. Using standard visibility controls.',
        exclusionActive: false,
      };
    }

    this.exclusionActive = false;

    return {
      action: 'show-normal',
      reason: 'No active sharing detected.',
      exclusionActive: false,
    };
  }

  async onSessionEnd(): Promise<void> {
    await invoke('set_capture_excluded', {
      windowLabel: 'capture-excluded-overlay',
      excluded: false,
    }).catch(() => {
      // Safe default: even if reset fails, clear local state so subsequent
      // sessions re-evaluate from scratch. Session keeps running.
    });

    this.exclusionActive = false;
    this.currentState = 'none';
  }
}
