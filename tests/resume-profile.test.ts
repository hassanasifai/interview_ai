import { buildResumeProfileContext } from '../src/lib/copilot/resumeProfile';

describe('resume profile context', () => {
  it('extracts high-signal experience lines from resume chunks', () => {
    const context = buildResumeProfileContext([
      'Senior engineer with 8 years of experience building React and TypeScript products.',
      'Led migration of monolith services to Rust microservices and reduced incident volume.',
      'Enjoys mentoring teams and improving developer workflows.',
    ]);

    expect(context).toContain('8 years of experience');
    expect(context).toContain('React and TypeScript');
    expect(context).toContain('Rust microservices');
  });

  it('falls back to short chunk snippets when no keyword match exists', () => {
    const context = buildResumeProfileContext([
      'Curious operator focused on clarity and collaboration.',
      'Values thoughtful communication and steady execution.',
    ]);

    expect(context.length).toBeGreaterThan(0);
    expect(context).toContain('Curious operator');
  });
});
