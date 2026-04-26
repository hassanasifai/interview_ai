import type { AIProvider } from '../providers/aiProvider';
import { tryParseJson } from './jsonRepair';

export type SystemDesignAnswer = {
  requirements: string[];
  highLevelComponents: string[];
  dataFlow: string;
  scalingConsiderations: string[];
  tradeoffs: string[];
  techStack: string[];
  estimations: string;
};

const SYSTEM_PROMPT = `You are a senior distributed systems engineer with 10+ years at top tech companies.
Given a system design question, provide a concise but comprehensive answer.
Return ONLY a JSON object with keys:
requirements (string[]), highLevelComponents (string[]), dataFlow (string),
scalingConsiderations (string[]), tradeoffs (string[]), techStack (string[]),
estimations (string — rough numbers for scale).
Be opinionated. Keep each array to 3-5 items.`;

export async function composeSystemDesign(
  question: string,
  provider: AIProvider,
): Promise<SystemDesignAnswer> {
  const userPrompt = `System design question: ${question}`;

  try {
    const response = await provider.complete({ systemPrompt: SYSTEM_PROMPT, userPrompt });
    const parsed =
      tryParseJson<Partial<SystemDesignAnswer>>(response) ?? ({} as Partial<SystemDesignAnswer>);
    return {
      requirements: Array.isArray(parsed.requirements) ? parsed.requirements : [],
      highLevelComponents: Array.isArray(parsed.highLevelComponents)
        ? parsed.highLevelComponents
        : [],
      dataFlow: parsed.dataFlow ?? 'Client → Load Balancer → App Servers → Database',
      scalingConsiderations: Array.isArray(parsed.scalingConsiderations)
        ? parsed.scalingConsiderations
        : [],
      tradeoffs: Array.isArray(parsed.tradeoffs) ? parsed.tradeoffs : [],
      techStack: Array.isArray(parsed.techStack) ? parsed.techStack : [],
      estimations: parsed.estimations ?? 'Depends on scale requirements.',
    };
  } catch {
    return {
      requirements: ['High availability', 'Low latency reads', 'Horizontal scalability'],
      highLevelComponents: ['CDN', 'Load Balancer', 'App Cluster', 'Cache Layer', 'Database'],
      dataFlow: 'Client → CDN → Load Balancer → App Servers → Cache → DB',
      scalingConsiderations: [
        'Horizontal scaling via stateless services',
        'Read replicas for DB',
        'Caching hot data with Redis/Memcached',
        'Async processing with message queues',
      ],
      tradeoffs: [
        'Consistency vs. availability (CAP theorem)',
        'SQL vs. NoSQL for read/write patterns',
        'Sync vs. async fan-out',
      ],
      techStack: ['PostgreSQL', 'Redis', 'Kafka', 'Kubernetes', 'Nginx'],
      estimations: '~10K RPS, 99.9% uptime, <100ms p99 latency',
    };
  }
}
