export type DisclosureRegion = 'global' | 'eu' | 'us' | 'uk' | 'ca';

const templates: Record<DisclosureRegion, string> = {
  global:
    'I am using a local AI assistant to help me with note-taking and response drafting during this meeting.',
  eu: 'For transparency: I am using a local AI copilot for note-taking and draft responses in this meeting.',
  us: 'Disclosure: I am using a local AI copilot for assistance with meeting notes and response drafting.',
  uk: 'Disclosure notice: I am using a local AI meeting copilot for notes and response drafting support.',
  ca: 'Transparency note: I am using a local AI assistant to support note-taking and response drafting.',
};

export function getDisclosureTemplate(region: DisclosureRegion): string {
  return templates[region];
}

export function listDisclosureRegions(): DisclosureRegion[] {
  return Object.keys(templates) as DisclosureRegion[];
}
