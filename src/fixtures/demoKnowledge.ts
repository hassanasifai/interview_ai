import { createKnowledgeRepository } from '../lib/rag/knowledgeRepository';

type DemoDoc = {
  id: string;
  name: string;
  kind: string;
  content: string;
};

const demoDocs: DemoDoc[] = [
  {
    id: 'demo-pricing',
    name: 'Pricing Guide.md',
    kind: 'pricing',
    content:
      'Enterprise pricing is based on seat bands, support tier, and rollout complexity. Standard onboarding covers kickoff and admin training. Custom onboarding is scoped separately.',
  },
  {
    id: 'demo-security',
    name: 'Security Overview.md',
    kind: 'security',
    content:
      'Security reviews include architecture overview, data handling details, and evidence package sharing. Customers can request control mapping during procurement.',
  },
  {
    id: 'demo-objections',
    name: 'Objection Patterns.md',
    kind: 'objection',
    content:
      'For pricing pushback, acknowledge budget pressure, clarify business goals, offer phased rollout, and confirm measurable outcomes with timeline options.',
  },
];

export function seedDemoKnowledgeBase() {
  const repository = createKnowledgeRepository();

  demoDocs.forEach((doc) => {
    repository.saveDocument(doc);
  });
}
