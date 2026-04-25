import { chunkDocument } from '../src/lib/rag/chunkDocument';
import { createKnowledgeRepository } from '../src/lib/rag/knowledgeRepository';

describe('chunkDocument', () => {
  it('splits a document into stable chunks', () => {
    const chunks = chunkDocument(
      'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau.',
      { chunkSize: 5, overlap: 1 },
    );

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]).toContain('Alpha beta gamma');
  });
});

describe('knowledgeRepository', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores document metadata and chunks', () => {
    const repository = createKnowledgeRepository();
    repository.saveDocument({
      id: 'pricing-guide',
      name: 'Pricing guide',
      content: 'Enterprise pricing includes onboarding and premium support.',
      kind: 'pricing',
    });

    const documents = repository.listDocuments();

    expect(documents).toHaveLength(1);
    expect(documents[0].name).toBe('Pricing guide');
    expect(documents[0].chunkCount).toBeGreaterThan(0);
  });

  it('returns ranked relevant chunks for a query', async () => {
    const repository = createKnowledgeRepository();
    repository.saveDocument({
      id: 'pricing-guide',
      name: 'Pricing guide',
      content: 'Enterprise pricing includes onboarding, support tiers, and seat bands.',
      kind: 'pricing',
    });
    repository.saveDocument({
      id: 'security-guide',
      name: 'Security guide',
      content: 'Security review includes control mapping and architecture details.',
      kind: 'security',
    });

    const matches = await repository.searchRelevant('pricing and onboarding', 2);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.documentName).toBe('Pricing guide');
  });
});
