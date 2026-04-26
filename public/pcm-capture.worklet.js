// AudioWorkletProcessor for PCM capture with on-thread RMS computation.
//
// AUDIT §24/A1: replaces the deprecated ScriptProcessorNode path used by the
// RMS VAD fallback in liveCaptureOrchestrator.ts. The worklet runs on the
// audio render thread (separate from the main thread), so we never block
// the renderer with audio buffer copies.
//
// Posted message shape: { rms: number, samples: Float32Array }
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    // Compute RMS for VAD gating (cheap, one pass).
    let energy = 0;
    for (let i = 0; i < channel.length; i++) {
      energy += channel[i] * channel[i];
    }
    const rms = Math.sqrt(energy / channel.length);

    // Copy into a transferable buffer so the main thread can take ownership
    // without a structured-clone hop.
    const copy = new Float32Array(channel.length);
    copy.set(channel);
    this.port.postMessage({ rms, samples: copy }, [copy.buffer]);
    return true;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
