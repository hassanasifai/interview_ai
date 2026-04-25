import { listenTauriEvent, startMeetingDaemon, stopMeetingDaemon } from '../tauri';
import type { ActiveWindowInfo } from '../tauri';
import { detectMeetingCandidate } from './meetingDetector';

export type MeetingDetectedPayload = {
  platform: string;
  title: string;
};

/**
 * Start the background meeting-detection daemon (polls active window every 2s).
 * Returns a cleanup function that stops the daemon and removes the event listener.
 */
export async function startMeetingDetectionDaemon(
  onDetected: (payload: MeetingDetectedPayload) => void,
): Promise<() => void> {
  await startMeetingDaemon();

  let cancelled = false;
  let unlisten: (() => void) | null = null;

  // Cancel-token pattern: if teardown runs before listen() resolves, we
  // immediately invoke the resulting unlisten fn to avoid leaking a listener.
  try {
    unlisten = await listenTauriEvent<ActiveWindowInfo>('meeting_daemon_tick', (info) => {
      if (cancelled) return;
      const title = info.title ?? '';
      const result = detectMeetingCandidate(title);
      if (result.isMeetingCandidate) {
        onDetected({ platform: result.platform, title });
      }
    });
  } catch (err) {
    // If listen() fails, ensure the native daemon is also stopped so we
    // don't leak the polling task on the Rust side.
    await stopMeetingDaemon().catch(() => {
      // best-effort
    });
    throw err;
  }

  return () => {
    cancelled = true;
    unlisten?.();
    unlisten = null;
    stopMeetingDaemon().catch(() => {
      // Safe default: if the stop command fails, swallow so callers that
      // also tear down listeners don't propagate the error.
    });
  };
}
