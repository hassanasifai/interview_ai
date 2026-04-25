import { chunkDocument } from './chunkDocument';
import { embedAndStore, semanticSearch } from './vectorStore';
import { logger } from '../logger';

const STORAGE_KEY = 'meetingmind-knowledge-base';

type KnowledgeDocumentInput = {
  id: string;
  name: string;
  content: string;
  kind: string;
};

type StoredKnowledgeDocument = {
  id: string;
  name: string;
  kind: string;
  chunkCount: number;
  enabled: boolean;
  addedAt: number;
};

type RepositoryState = {
  documents: StoredKnowledgeDocument[];
  chunks: Record<string, string[]>;
};

type RelevantChunk = {
  documentId: string;
  documentName: string;
  chunk: string;
  score: number;
};

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function readState(): RepositoryState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { documents: [], chunks: {} };
  return JSON.parse(raw) as RepositoryState;
}

function writeState(state: RepositoryState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function keywordSearch(
  query: string,
  allChunks: Array<{ documentId: string; documentName: string; chunk: string }>,
  topK: number,
): RelevantChunk[] {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return [];
  const matches: RelevantChunk[] = [];
  allChunks.forEach(({ documentId, documentName, chunk }) => {
    const chunkTokens = tokenize(chunk);
    let score = 0;
    chunkTokens.forEach((token) => {
      if (queryTokens.has(token)) score += 1;
    });
    if (score > 0) matches.push({ documentId, documentName, chunk, score });
  });
  return matches.sort((a, b) => b.score - a.score).slice(0, topK);
}

export function createKnowledgeRepository() {
  return {
    saveDocument(input: KnowledgeDocumentInput) {
      const state = readState();
      const chunks = chunkDocument(input.content, { chunkSize: 80, overlap: 12 });
      const document: StoredKnowledgeDocument = {
        id: input.id,
        name: input.name,
        kind: input.kind,
        chunkCount: chunks.length,
        enabled: true,
        addedAt: Date.now(),
      };
      writeState({
        documents: [...state.documents.filter((d) => d.id !== input.id), document],
        chunks: { ...state.chunks, [input.id]: chunks },
      });
      embedAndStore(input.id, chunks).catch(() => undefined); // fire-and-forget
    },

    listDocuments(): StoredKnowledgeDocument[] {
      return readState().documents;
    },

    listDocumentsByKind(kind: string) {
      return readState().documents.filter((d) => d.kind === kind);
    },

    toggleDocument(documentId: string) {
      const state = readState();
      writeState({
        ...state,
        documents: state.documents.map((d) =>
          d.id === documentId ? { ...d, enabled: !d.enabled } : d,
        ),
      });
    },

    getChunks(documentId: string) {
      return readState().chunks[documentId] ?? [];
    },

    deleteDocument(documentId: string) {
      const state = readState();
      const nextChunks = { ...state.chunks };
      delete nextChunks[documentId];
      writeState({
        documents: state.documents.filter((d) => d.id !== documentId),
        chunks: nextChunks,
      });
    },

    async searchRelevant(query: string, maxResults = 5): Promise<RelevantChunk[]> {
      const state = readState();
      const enabledDocs = state.documents.filter((d) => d.enabled !== false);

      // Build flat list of all enabled chunks
      const allChunks: Array<{ documentId: string; documentName: string; chunk: string }> = [];
      enabledDocs.forEach((doc) => {
        const docChunks = state.chunks[doc.id] ?? [];
        docChunks.forEach((chunk) =>
          allChunks.push({ documentId: doc.id, documentName: doc.name, chunk }),
        );
      });

      if (allChunks.length === 0) return [];

      // Try semantic search; fall back to keyword on error.
      // F6: surface errors via logger so failures are debuggable instead of silently swallowed.
      let results: RelevantChunk[];
      try {
        const semResults = await semanticSearch(query, allChunks, maxResults);
        results = semResults.map((r) => ({
          documentId: r.documentId,
          documentName: r.documentName,
          chunk: r.chunk,
          score: r.score,
        }));
      } catch (err) {
        logger.warn('knowledge', 'semantic search failed, falling back to keyword', {
          err: String(err),
        });
        results = keywordSearch(query, allChunks, maxResults);
      }

      return results;
    },
  };
}
