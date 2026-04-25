import { useRef, useState } from 'react';
import { GripVertical, Plus, Trash2, Wand2, Zap, Scissors, FileDown, Copy } from 'lucide-react';
import {
  generateResumeSection,
  improveResumeBullet,
  type ResumeSection,
  type WorkEntry,
} from '../../lib/copilot/resumeBuilder';
import { logger } from '../../lib/logger';
import { createLiveAnswerProvider } from '../../lib/providers/providerFactory';
import { useSettingsStore } from '../../store/settingsStore';
import {
  Button,
  IconButton,
  Input,
  Spinner,
  Textarea,
  Tooltip,
  useToast,
} from '../../components/ui';
import './resumeBuilder.css';
import './resume.css';

const emptyEntry = (): WorkEntry => ({
  company: '',
  role: '',
  startDate: '',
  endDate: 'Present',
  bullets: [''],
});

type SectionTab = 'experience' | 'summary' | 'education' | 'skills' | 'projects';

const SECTION_TABS: { value: SectionTab; label: string }[] = [
  { value: 'experience', label: 'Experience' },
  { value: 'summary', label: 'Summary' },
  { value: 'education', label: 'Education' },
  { value: 'skills', label: 'Skills' },
  { value: 'projects', label: 'Projects' },
];

function PreviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rb-preview-section">
      <div className="rb-preview-section-title">{title}</div>
      {children}
    </div>
  );
}

export function ResumeBuilderPage() {
  const [activeTab, setActiveTab] = useState<SectionTab>('experience');
  const [entries, setEntries] = useState<WorkEntry[]>([emptyEntry()]);
  const [summary, setSummary] = useState('');
  const [education, setEducation] = useState('');
  const [skills, setSkills] = useState('');
  const [projects, setProjects] = useState('');
  const [sections, setSections] = useState<ResumeSection[]>([]);
  const [generating, setGenerating] = useState(false);
  const [improveTarget, setImproveTarget] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const dragOver = useRef<number | null>(null);

  const { show: toast } = useToast();
  // Selector hooks (I21/I22) — narrow reads to avoid re-rendering on unrelated
  // settings changes (e.g. consent toggles).
  const selectedProvider = useSettingsStore((s) => s.selectedProvider);
  const groqApiKey = useSettingsStore((s) => s.groqApiKey);
  const openAiApiKey = useSettingsStore((s) => s.openAiApiKey);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  const providerModel = useSettingsStore((s) => s.providerModel);
  const jdAnalysis = useSettingsStore((s) => s.jdAnalysis);
  const profile = useSettingsStore((s) => s.profile);

  const activeKey =
    selectedProvider === 'openai'
      ? openAiApiKey
      : selectedProvider === 'anthropic'
        ? anthropicApiKey
        : groqApiKey;

  const targetRole = jdAnalysis?.requiredSkills.slice(0, 3).join(', ');

  // Entry CRUD
  function updateEntry(i: number, field: keyof WorkEntry, value: string | string[]) {
    setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)));
  }

  function updateBullet(entryIdx: number, bulletIdx: number, value: string) {
    setEntries((prev) =>
      prev.map((e, i) =>
        i === entryIdx
          ? { ...e, bullets: e.bullets.map((b, j) => (j === bulletIdx ? value : b)) }
          : e,
      ),
    );
  }

  function addBullet(entryIdx: number) {
    setEntries((prev) =>
      prev.map((e, i) => (i === entryIdx ? { ...e, bullets: [...e.bullets, ''] } : e)),
    );
  }

  function removeBullet(entryIdx: number, bulletIdx: number) {
    setEntries((prev) =>
      prev.map((e, i) =>
        i === entryIdx ? { ...e, bullets: e.bullets.filter((_, j) => j !== bulletIdx) } : e,
      ),
    );
  }

  // Drag reorder
  function onDragStart(idx: number) {
    setDragIdx(idx);
  }
  function onDragEnter(idx: number) {
    dragOver.current = idx;
  }
  function onDragEnd() {
    if (dragIdx === null || dragOver.current === null || dragIdx === dragOver.current) {
      setDragIdx(null);
      return;
    }
    const next = [...entries];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(dragOver.current, 0, moved);
    setEntries(next);
    setDragIdx(null);
    dragOver.current = null;
  }

  // AI actions
  async function generateAll() {
    setGenerating(true);
    try {
      const provider = createLiveAnswerProvider(selectedProvider, activeKey, providerModel);
      const results = await Promise.all(
        entries.map((entry) => generateResumeSection(entry, provider, targetRole)),
      );
      setSections(results);
      toast({ title: 'Generated', description: 'Resume sections ready.', variant: 'success' });
    } finally {
      setGenerating(false);
    }
  }

  async function handleImproveBullet(entryIdx: number, bulletIdx: number) {
    const bullet = entries[entryIdx]?.bullets[bulletIdx];
    if (!bullet?.trim()) return;
    const key = `${entryIdx}-${bulletIdx}`;
    setImproveTarget(key);
    try {
      const provider = createLiveAnswerProvider(selectedProvider, activeKey, providerModel);
      const improved = await improveResumeBullet(bullet, provider);
      updateBullet(entryIdx, bulletIdx, improved);
    } finally {
      setImproveTarget(null);
    }
  }

  async function handleQuantify(entryIdx: number, bulletIdx: number) {
    const bullet = entries[entryIdx]?.bullets[bulletIdx];
    if (!bullet?.trim()) return;
    const key = `q-${entryIdx}-${bulletIdx}`;
    setImproveTarget(key);
    try {
      const provider = createLiveAnswerProvider(selectedProvider, activeKey, providerModel);
      const result = await provider.complete({
        systemPrompt:
          'Add specific metrics and quantified impact to this resume bullet. Return only the improved bullet.',
        userPrompt: bullet,
      });
      updateBullet(entryIdx, bulletIdx, result.trim());
    } finally {
      setImproveTarget(null);
    }
  }

  async function handleShorten(entryIdx: number, bulletIdx: number) {
    const bullet = entries[entryIdx]?.bullets[bulletIdx];
    if (!bullet?.trim()) return;
    const key = `s-${entryIdx}-${bulletIdx}`;
    setImproveTarget(key);
    try {
      const provider = createLiveAnswerProvider(selectedProvider, activeKey, providerModel);
      const result = await provider.complete({
        systemPrompt:
          'Shorten this resume bullet to under 15 words while keeping the key impact. Return only the shortened bullet.',
        userPrompt: bullet,
      });
      updateBullet(entryIdx, bulletIdx, result.trim());
    } finally {
      setImproveTarget(null);
    }
  }

  function handleExportPdf() {
    toast({
      title: 'PDF export coming soon',
      description: 'Downloading JSON instead.',
      variant: 'info',
    });
    const data = { entries, summary, education, skills, projects, sections };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resume.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyAll() {
    const text = sections.map((s) => `${s.heading}\n${s.content}`).join('\n\n');
    navigator.clipboard.writeText(text).catch((err) => {
      logger.warn('resume-builder', 'clipboard write failed', { err: String(err) });
    });
    toast({ title: 'Copied to clipboard', variant: 'success' });
  }

  return (
    <div className="rb-page">
      <div className="rb-header">
        <h1 className="rb-title">Resume Builder</h1>
        <p className="rb-subtitle">
          Edit structured sections on the left, see the live preview on the right. AI can improve,
          quantify, or shorten any bullet.
          {targetRole ? ` Tailoring to: ${targetRole}.` : ''}
        </p>
      </div>

      <div className="rb-layout">
        {/* ── Form column ── */}
        <div className="rb-form-col">
          {/* Section tabs */}
          <div className="rb-section-tabs">
            {SECTION_TABS.map((t) => (
              <button
                key={t.value}
                className={`rb-section-tab${activeTab === t.value ? ' rb-section-tab--active' : ''}`}
                onClick={() => setActiveTab(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Experience */}
          {activeTab === 'experience' && (
            <div className="rb-section-card">
              <div className="rb-section-header">
                <h3 className="rb-section-title">Work Experience</h3>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setEntries((p) => [...p, emptyEntry()])}
                  leadingIcon={<Plus size={14} />}
                >
                  Add Entry
                </Button>
              </div>

              {entries.map((entry, eIdx) => (
                <div
                  key={eIdx}
                  className={`rb-entry-card${dragIdx === eIdx ? ' rb-entry-card--dragging' : ''}`}
                  draggable
                  onDragStart={() => onDragStart(eIdx)}
                  onDragEnter={() => onDragEnter(eIdx)}
                  onDragEnd={onDragEnd}
                  onDragOver={(e) => e.preventDefault()}
                >
                  <div className="rb-entry-header">
                    <span className="rb-drag-handle" aria-hidden>
                      <GripVertical size={16} />
                    </span>
                    <span className="rb-entry-title">
                      {entry.role || 'New Entry'}
                      {entry.company ? ` @ ${entry.company}` : ''}
                    </span>
                    {entries.length > 1 && (
                      <IconButton
                        aria-label="Remove entry"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEntries((prev) => prev.filter((_, i) => i !== eIdx))}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    )}
                  </div>

                  <div className="rb-grid-4">
                    <Input
                      label="Company"
                      value={entry.company}
                      onChange={(e) => updateEntry(eIdx, 'company', e.target.value)}
                      placeholder="Acme Corp"
                    />
                    <Input
                      label="Role"
                      value={entry.role}
                      onChange={(e) => updateEntry(eIdx, 'role', e.target.value)}
                      placeholder="Senior Engineer"
                    />
                    <Input
                      label="From"
                      value={entry.startDate}
                      onChange={(e) => updateEntry(eIdx, 'startDate', e.target.value)}
                      placeholder="Jan 2022"
                    />
                    <Input
                      label="To"
                      value={entry.endDate}
                      onChange={(e) => updateEntry(eIdx, 'endDate', e.target.value)}
                      placeholder="Present"
                    />
                  </div>

                  <p className="rb-field-label">Responsibilities / Achievements</p>
                  {entry.bullets.map((bullet, bIdx) => {
                    const baseKey = `${eIdx}-${bIdx}`;
                    const isBusy =
                      improveTarget === baseKey ||
                      improveTarget === `q-${baseKey}` ||
                      improveTarget === `s-${baseKey}`;
                    return (
                      <div key={bIdx} className="rb-bullet-row">
                        <div className="rb-bullet-row-main">
                          <Input
                            value={bullet}
                            onChange={(e) => updateBullet(eIdx, bIdx, e.target.value)}
                            placeholder="Describe what you did and the impact…"
                          />
                        </div>
                        <div className="rb-bullet-actions">
                          {isBusy ? (
                            <Spinner size="xs" />
                          ) : (
                            <>
                              <Tooltip content="Improve bullet">
                                <IconButton
                                  aria-label="Improve bullet"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void handleImproveBullet(eIdx, bIdx)}
                                  disabled={!!improveTarget}
                                >
                                  <Wand2 size={13} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip content="Quantify impact">
                                <IconButton
                                  aria-label="Quantify impact"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void handleQuantify(eIdx, bIdx)}
                                  disabled={!!improveTarget}
                                >
                                  <Zap size={13} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip content="Shorten">
                                <IconButton
                                  aria-label="Shorten bullet"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void handleShorten(eIdx, bIdx)}
                                  disabled={!!improveTarget}
                                >
                                  <Scissors size={13} />
                                </IconButton>
                              </Tooltip>
                              {entry.bullets.length > 1 && (
                                <IconButton
                                  aria-label="Remove bullet"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => removeBullet(eIdx, bIdx)}
                                >
                                  <Trash2 size={13} />
                                </IconButton>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => addBullet(eIdx)}
                    leadingIcon={<Plus size={13} />}
                  >
                    Add bullet
                  </Button>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'summary' && (
            <div className="rb-section-card">
              <h3 className="rb-section-title">Professional Summary</h3>
              <Textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="2–3 sentences summarising your experience and value proposition…"
                rows={5}
              />
            </div>
          )}

          {activeTab === 'education' && (
            <div className="rb-section-card">
              <h3 className="rb-section-title">Education</h3>
              <Textarea
                value={education}
                onChange={(e) => setEducation(e.target.value)}
                placeholder="Degree, institution, year — one entry per line"
                rows={5}
              />
            </div>
          )}

          {activeTab === 'skills' && (
            <div className="rb-section-card">
              <h3 className="rb-section-title">Skills</h3>
              <Textarea
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                placeholder="Comma-separated or one per line: TypeScript, React, Node.js…"
                rows={5}
              />
            </div>
          )}

          {activeTab === 'projects' && (
            <div className="rb-section-card">
              <h3 className="rb-section-title">Projects</h3>
              <Textarea
                value={projects}
                onChange={(e) => setProjects(e.target.value)}
                placeholder="Project name — description — technologies"
                rows={6}
              />
            </div>
          )}

          {/* Actions */}
          <div className="rb-actions-row">
            <Button
              onClick={() => void generateAll()}
              disabled={generating}
              loading={generating}
              leadingIcon={<Wand2 size={15} />}
            >
              {generating ? 'Generating…' : 'Generate Resume Sections'}
            </Button>
            <Button
              variant="secondary"
              onClick={handleExportPdf}
              leadingIcon={<FileDown size={15} />}
            >
              Export PDF
            </Button>
          </div>
        </div>

        {/* ── Preview column ── */}
        <div className="rb-preview-col">
          <div className="rb-preview-actions">
            {sections.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={copyAll}
                leadingIcon={<Copy size={14} />}
              >
                Copy All
              </Button>
            )}
          </div>

          <div className="rb-preview-paper">
            {/* Header */}
            <div className="rb-preview-header">
              <h2 className="rb-preview-name">{profile.userName || 'Your Name'}</h2>
              <p className="rb-preview-contact">
                {profile.userRole || 'Your Role'}{' '}
                {profile.companyName ? `· ${profile.companyName}` : ''}
              </p>
            </div>

            {/* Summary */}
            {summary.trim() && (
              <PreviewSection title="Summary">
                <p className="rb-preview-summary">{summary}</p>
              </PreviewSection>
            )}

            {/* Experience — generated or raw */}
            {(sections.length > 0 || entries.some((e) => e.company || e.role)) && (
              <PreviewSection title="Experience">
                {sections.length > 0
                  ? sections.map((s, i) => (
                      <div key={i} className="rb-preview-entry">
                        <div className="rb-preview-entry-head">
                          <span className="rb-preview-entry-role">
                            {entries[i]?.role || s.heading}
                          </span>
                          <span className="rb-preview-entry-dates">
                            {entries[i]?.startDate}{' '}
                            {entries[i]?.endDate ? `– ${entries[i]?.endDate}` : ''}
                          </span>
                        </div>
                        <div className="rb-preview-entry-company">{entries[i]?.company}</div>
                        <ul>
                          {s.content
                            .split('\n')
                            .filter(Boolean)
                            .map((b, bi) => (
                              <li key={bi}>{b.replace(/^[-•*]\s*/, '')}</li>
                            ))}
                        </ul>
                      </div>
                    ))
                  : entries.map((e, i) => (
                      <div key={i} className="rb-preview-entry">
                        <div className="rb-preview-entry-head">
                          <span className="rb-preview-entry-role">
                            {e.role || <span className="rb-preview-placeholder">Role</span>}
                          </span>
                          <span className="rb-preview-entry-dates">
                            {e.startDate}
                            {e.endDate ? ` – ${e.endDate}` : ''}
                          </span>
                        </div>
                        <div className="rb-preview-entry-company">{e.company}</div>
                        {e.bullets.filter(Boolean).length > 0 && (
                          <ul>
                            {e.bullets.filter(Boolean).map((b, bi) => (
                              <li key={bi}>{b}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
              </PreviewSection>
            )}

            {/* Education */}
            {education.trim() && (
              <PreviewSection title="Education">
                <p className="rb-preview-summary">{education}</p>
              </PreviewSection>
            )}

            {/* Skills */}
            {skills.trim() && (
              <PreviewSection title="Skills">
                <div className="rb-preview-skills">
                  {skills
                    .split(/[,\n]+/)
                    .filter(Boolean)
                    .map((s) => (
                      <span key={s} className="rb-preview-skill">
                        {s.trim()}
                      </span>
                    ))}
                </div>
              </PreviewSection>
            )}

            {/* Projects */}
            {projects.trim() && (
              <PreviewSection title="Projects">
                <p className="rb-preview-summary">{projects}</p>
              </PreviewSection>
            )}

            {!summary && !entries.some((e) => e.company || e.role) && !skills && (
              <p className="rb-preview-placeholder">
                Fill in the form to see your resume preview here.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
