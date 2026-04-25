import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';

let embedder: FeatureExtractionPipeline | null = null;

interface EmbedRequest {
  id: string;
  texts: string[];
}

self.onmessage = async (event: MessageEvent<EmbedRequest>) => {
  const { id, texts } = event.data;
  try {
    if (!embedder) {
      embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    const output = await embedder(texts, { pooling: 'mean', normalize: true });
    // output.data is a Float32Array of shape [texts.length * 384]
    const dim = 384;
    const vectors: number[][] = texts.map((_, i) =>
      Array.from(output.data.slice(i * dim, (i + 1) * dim) as Float32Array),
    );
    self.postMessage({ id, vectors, error: null });
  } catch (err) {
    self.postMessage({ id, vectors: null, error: String(err) });
  }
};
