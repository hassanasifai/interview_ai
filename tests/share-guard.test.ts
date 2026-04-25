import {
  applyShareGuardProtection,
  detectKnownMeetingApplication,
  evaluateShareGuard,
  getRecommendedPrivacySetup,
  isLikelyFullScreenShare,
  type ShareMode,
} from '../src/lib/runtime/shareGuard';

describe('share guard', () => {
  it('blocks visible overlay use when full-screen sharing is active and auto-hide is enabled', () => {
    const result = evaluateShareGuard({
      shareMode: 'entire-screen',
      autoHideOnFullScreenShare: true,
      preferSecondScreen: true,
      hasSecondScreen: false,
      isFullScreenShareActive: true,
    });

    expect(result.overlayShouldHide).toBe(true);
    expect(result.riskLevel).toBe('high');
    expect(result.statusLabel).toContain('Overlay hidden');
    expect(result.protectionReason).toBe('fullscreen-sharing');
  });

  it.each<ShareMode>(['window-only', 'browser-tab', 'second-screen', 'mobile-companion'])(
    'allows overlay use for %s privacy setup',
    (shareMode) => {
      const result = evaluateShareGuard({
        shareMode,
        autoHideOnFullScreenShare: true,
        preferSecondScreen: true,
        hasSecondScreen: shareMode === 'second-screen',
        monitorCount: shareMode === 'second-screen' ? 2 : 1,
        assistantDisplay: shareMode === 'second-screen' ? 'non-primary' : 'primary',
      });

      expect(result.overlayShouldHide).toBe(false);
      expect(result.riskLevel).not.toBe('high');
    },
  );

  it('recommends second screen before window-only sharing when available', () => {
    expect(getRecommendedPrivacySetup(true)).toBe('second-screen');
    expect(getRecommendedPrivacySetup(false)).toBe('window-only');
  });

  it('detects known meeting applications from active process names', () => {
    expect(detectKnownMeetingApplication('Zoom.exe')).toEqual({
      isKnownMeetingApp: true,
      platform: 'Zoom',
    });
    expect(detectKnownMeetingApplication('ms-teams.exe')).toEqual({
      isKnownMeetingApp: true,
      platform: 'Microsoft Teams',
    });
    expect(detectKnownMeetingApplication('Code.exe')).toEqual({
      isKnownMeetingApp: false,
      platform: 'Unknown',
    });
    expect(detectKnownMeetingApplication('chrome.exe', 'Weekly sync - Google Meet')).toEqual({
      isKnownMeetingApp: true,
      platform: 'Google Meet',
    });
    expect(detectKnownMeetingApplication('chrome.exe', 'Quarterly plan')).toEqual({
      isKnownMeetingApp: false,
      platform: 'Unknown',
    });
  });

  it('treats known meeting apps with full-screen sharing as high risk', () => {
    const result = evaluateShareGuard({
      shareMode: 'window-only',
      autoHideOnFullScreenShare: true,
      preferSecondScreen: true,
      hasSecondScreen: false,
      activeWindowProcessName: 'Zoom.exe',
      isFullScreenShareActive: true,
    });

    expect(result.overlayShouldHide).toBe(true);
    expect(result.riskLevel).toBe('high');
    expect(result.protectionReason).toBe('meeting-app-fullscreen');
  });

  it('reduces risk when the assistant is on a non-primary second display', () => {
    const result = evaluateShareGuard({
      shareMode: 'entire-screen',
      autoHideOnFullScreenShare: true,
      preferSecondScreen: true,
      hasSecondScreen: true,
      monitorCount: 2,
      assistantDisplay: 'non-primary',
      isFullScreenShareActive: true,
    });

    expect(result.overlayShouldHide).toBe(false);
    expect(result.riskLevel).toBe('low');
    expect(result.safeDisplayMode).toBe(true);
  });

  it('persists auto-hidden state until sharing risk clears', () => {
    const hidden = applyShareGuardProtection({
      previousAutoHidden: false,
      result: evaluateShareGuard({
        shareMode: 'entire-screen',
        autoHideOnFullScreenShare: true,
        preferSecondScreen: true,
        hasSecondScreen: false,
        isFullScreenShareActive: true,
      }),
    });

    expect(hidden.autoHidden).toBe(true);
    expect(hidden.shouldDispatchHideEvent).toBe(true);
    expect(hidden.toastMessage).toBe(
      'AI assistant was automatically hidden due to screen sharing.',
    );

    const restored = applyShareGuardProtection({
      previousAutoHidden: hidden.autoHidden,
      result: evaluateShareGuard({
        shareMode: 'not-sharing',
        autoHideOnFullScreenShare: true,
        preferSecondScreen: true,
        hasSecondScreen: false,
        isFullScreenShareActive: false,
      }),
    });

    expect(restored.autoHidden).toBe(false);
    expect(restored.shouldDispatchRestoreEvent).toBe(true);
  });

  it('detects full-screen sharing only when bounds closely match a monitor', () => {
    expect(
      isLikelyFullScreenShare({
        windowBounds: { x: 0, y: 0, width: 1920, height: 1080 },
        monitorBounds: [{ x: 0, y: 0, width: 1920, height: 1080 }],
      }),
    ).toBe(true);

    expect(
      isLikelyFullScreenShare({
        windowBounds: { x: 120, y: 90, width: 1700, height: 900 },
        monitorBounds: [{ x: 0, y: 0, width: 1920, height: 1080 }],
      }),
    ).toBe(false);
  });
});
