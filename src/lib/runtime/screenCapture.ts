import { runOcrOnImage } from '../tauri';
import { logger } from '../logger';

export async function captureDisplayFrameAsBase64(): Promise<string> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });

  const videoTrack = stream.getVideoTracks()[0];
  const imageCaptureSupported = 'ImageCapture' in window;

  try {
    if (imageCaptureSupported) {
      const imageCapture = new ImageCapture(videoTrack);
      const bitmap = await imageCapture.grabFrame();
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');

      if (!context) {
        return '';
      }

      context.drawImage(bitmap, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      const [, base64] = dataUrl.split(',');
      return base64 ?? '';
    }

    return '';
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

/**
 * Capture just the coding platform window (not MeetingMind itself).
 * Uses getDisplayMedia so the user picks the specific window/tab to OCR.
 * This avoids reading MeetingMind's own sidebar and UI text.
 */
export async function captureAndOcrScreenRegion(): Promise<{
  text: string;
  confidence: number;
  note: string;
}> {
  try {
    // Ask user to pick the specific window (e.g. browser tab with LeetCode/HackerRank)
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'window' } as MediaTrackConstraints,
      audio: false,
    });

    const track = stream.getVideoTracks()[0];
    let base64 = '';

    try {
      if ('ImageCapture' in window) {
        const ic = new ImageCapture(track);
        const bitmap = await ic.grabFrame();
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        const [, b64] = canvas.toDataURL('image/png').split(',');
        base64 = b64 ?? '';
      }
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }

    if (base64) return runOcrOnImage(base64);
  } catch (e) {
    logger.info('screenCapture', 'capture cancelled or denied', { err: String(e) });
    // User cancelled picker or permission denied — fall through
  }

  return {
    text: '',
    confidence: 0,
    note: 'Screen capture cancelled or not supported. Paste the problem text manually.',
  };
}
