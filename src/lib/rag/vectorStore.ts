import { logger } from '../logger';

const VECTOR_KEY = 'meetingmind-kb-vectors';
const CACHE_SIZE = 16;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5min idle => terminate worker
const vectorCache = new Map<string, number[]>();

// Lazy worker initialization
let _worker: Worker | null = null;
const _pendingRequests = new Map<
  string,
  { resolve: (v: number[][]) => void; reject: (e: Error) => void }
>();
let _idleTimer: ReturnType<typeof setTimeout> | null = null;

function resetIdleTimer() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(disposeWorker, IDLE_TIMEOUT_MS);
}

export function disposeWorker() {
  if (_idleTimer) {
    clearTimeout(_idleTimer);
    _idleTimer = null;
  }
  if (_worker) {
    _worker.terminate();
    _worker = null;
    _pendingRequests.forEach(({ reject }) => reject(new Error('Worker disposed')));
    _pendingRequests.clear();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', disposeWorker);
}

function getWorker(): Worker {
  if (!_worker) {
    _worker = new Worker(new URL('./embeddingWorker.ts', import.meta.url), { type: 'module' });
    _worker.onmessage = (e) => {
      const { id, vectors, error } = e.data;
      const pending = _pendingRequests.get(id);
      if (!pending) return;
      _pendingRequests.delete(id);
      if (error) pending.reject(new Error(error));
      else pending.resolve(vectors);
    };
  }
  return _worker;
}

function embed(texts: string[]): Promise<number[][]> {
  resetIdleTimer();
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    _pendingRequests.set(id, { resolve, reject });
    getWorker().postMessage({ id, texts });
  });
}

function cosineSim(a: number[], b: number[]): number {
  // Both vectors are L2-normalized by MiniLM, so dot product == cosine similarity
  return a.reduce((sum, ai, i) => sum + ai * (b[i] ?? 0), 0);
}

type StoredVectors = Record<string, number[]>; // chunkKey -> vector

// I20: in-memory mirror of localStorage to avoid JSON parse on every search
let _vectorCache: StoredVectors | null = null;

function readVectors(): StoredVectors {
  if (_vectorCache) return _vectorCache;
  try {
    _vectorCache = JSON.parse(localStorage.getItem(VECTOR_KEY) ?? '{}') as StoredVectors;
    return _vectorCache;
  } catch (err) {
    logger.warn('vectorStore', 'failed to parse stored vectors, resetting cache', {
      err: String(err),
    });
    _vectorCache = {};
    return _vectorCache;
  }
}

function writeVectors(v: StoredVectors) {
  _vectorCache = v;
  try {
    localStorage.setItem(VECTOR_KEY, JSON.stringify(v));
  } catch (err) {
    // quota exceeded — keep memory copy so the session still works
    logger.warn(
      'vectorStore',
      'localStorage write failed (likely quota), keeping in-memory cache',
      { err: String(err) },
    );
  }
}

export async function embedAndStore(docId: string, chunks: string[]): Promise<void> {
  if (chunks.length === 0) return;
  const vectors = await embed(chunks);
  const stored = readVectors();
  chunks.forEach((_chunk, i) => {
    stored[`${docId}::${i}`] = vectors[i] ?? [];
  });
  writeVectors(stored);
}

export async function semanticSearch(
  query: string,
  chunks: Array<{ documentId: string; chunk: string; documentName: string }>,
  topK = 5,
): Promise<Array<{ documentId: string; documentName: string; chunk: string; score: number }>> {
  if (chunks.length === 0) return [];

  // Check query cache
  let queryVec = vectorCache.get(query);
  if (!queryVec) {
    const [vec] = await embed([query]);
    queryVec = vec ?? [];
    if (vectorCache.size >= CACHE_SIZE) vectorCache.delete(vectorCache.keys().next().value!);
    vectorCache.set(query, queryVec);
  }

  const stored = readVectors();

  const scored = chunks.map((c, i) => {
    const key = `${c.documentId}::${i}`;
    const vec = stored[key] ?? [];
    const score = vec.length > 0 ? cosineSim(queryVec!, vec) : 0;
    return { ...c, score };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

export function removeDocVectors(docId: string): void {
  const stored = readVectors();
  Object.keys(stored)
    .filter((k) => k.startsWith(`${docId}::`))
    .forEach((k) => delete stored[k]);
  writeVectors(stored);
}
