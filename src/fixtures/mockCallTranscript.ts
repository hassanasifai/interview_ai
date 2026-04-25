import type { TranscriptItem } from '../store/sessionStore';

export const mockCustomerCall: TranscriptItem[] = [
  {
    id: 'demo-1',
    speaker: 'customer',
    text: 'Can you explain pricing for 250 seats with onboarding?',
    timestamp: 1,
  },
  {
    id: 'demo-2',
    speaker: 'user',
    text: 'Yes. Pricing depends on seats, support tier, and rollout scope.',
    timestamp: 2,
  },
  {
    id: 'demo-3',
    speaker: 'customer',
    text: 'What security standards do you support for enterprise buyers?',
    timestamp: 3,
  },
  {
    id: 'demo-4',
    speaker: 'user',
    text: 'We can provide a security packet and map controls to review requirements.',
    timestamp: 4,
  },
  {
    id: 'demo-5',
    speaker: 'customer',
    text: 'This seems expensive. Why should we not wait for next quarter?',
    timestamp: 5,
  },
  {
    id: 'demo-6',
    speaker: 'user',
    text: 'I can send a phased rollout option and ROI breakdown after the call.',
    timestamp: 6,
  },
];
