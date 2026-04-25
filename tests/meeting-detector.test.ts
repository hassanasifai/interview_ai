import { detectMeetingCandidate } from '../src/lib/runtime/meetingDetector';

describe('meeting detector', () => {
  it('detects supported meeting platforms from window titles', () => {
    const result = detectMeetingCandidate('Zoom Meeting - Product Call');

    expect(result.isMeetingCandidate).toBe(true);
    expect(result.platform).toBe('zoom');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('returns unknown for unrelated window titles', () => {
    const result = detectMeetingCandidate('Visual Studio Code - workspace');

    expect(result.isMeetingCandidate).toBe(false);
    expect(result.platform).toBe('unknown');
  });
});
