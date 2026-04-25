import {
  captureScreenRegion,
  getNativeAudioPipelineStatus,
  runOcrOnImage,
  startNativeAudioPipeline,
  stopNativeAudioPipeline,
} from '../src/lib/tauri';

describe('tauri native bridge fallbacks', () => {
  it('returns browser fallback statuses when tauri runtime is unavailable', async () => {
    const start = await startNativeAudioPipeline(16000, 1);
    const status = await getNativeAudioPipelineStatus();
    const stop = await stopNativeAudioPipeline();
    const capture = await captureScreenRegion(0, 0, 100, 100);
    const ocr = await runOcrOnImage('');

    expect(start.isActive).toBe(false);
    expect(status.isActive).toBe(false);
    expect(stop.isActive).toBe(false);
    expect(capture.imageBase64).toBe('');
    expect(ocr.text).toBe('');
  });
});
