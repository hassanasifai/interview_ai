import { useRef, useState } from 'react';
import { Upload, Sparkles, BookmarkPlus, Trash2, BarChart2 } from 'lucide-react';
import { analyzeJobDescription } from '../../lib/copilot/jdMatcher';
import { logger } from '../../lib/logger';
import { createLiveAnswerProvider } from '../../lib/providers/providerFactory';
import { useSettingsStore } from '../../store/settingsStore';
import {
  Button,
  Divider,
  EmptyState,
  IconButton,
  ScrollArea,
  Skeleton,
  Spinner,
  Tag,
  Textarea,
  Tooltip,
  useToast,
} from '../../components/ui';
import './jobDescription.css';
import './jd.css';

type SavedPreset = { id: string; name: string; jd: string; skills: string[] };

function matchScore(skills: string[], resumeText: string): number {
  if (!skills.length || !resumeText.trim()) return 0;
  const lower = resumeText.toLowerCase();
  const matched = skills.filter((s) => lower.includes(s.toLowerCase()));
  return Math.round((matched.length / skills.length) * 100);
}

function BarRow({
  label,
  pct,
  variant,
}: {
  label: string;
  pct: number;
  variant: 'gold' | 'blue' | 'ok';
}) {
  return (
    <div className="jd-bar-row">
      <span className="jd-bar-label">{label}</span>
      <div className="jd-bar-track">
        <div className={`jd-bar-fill jd-bar-fill--${variant}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="jd-bar-pct">{pct}%</span>
    </div>
  );
}

export function JobDescriptionPage() {
  const [analyzing, setAnalyzing] = useState(false);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [coverLetter, setCoverLetter] = useState('');
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>([]);
  const [activeSaveId, setActiveSaveId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { show: toast } = useToast();

  // Selector hooks (I21/I22) — read individual fields rather than the whole
  // store so unrelated settings changes don't re-render the JD page.
  const jobDescription = useSettingsStore((s) => s.jobDescription);
  const jdAnalysis = useSettingsStore((s) => s.jdAnalysis);
  const selectedProvider = useSettingsStore((s) => s.selectedProvider);
  const groqApiKey = useSettingsStore((s) => s.groqApiKey);
  const openAiApiKey = useSettingsStore((s) => s.openAiApiKey);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  const providerModel = useSettingsStore((s) => s.providerModel);
  const profile = useSettingsStore((s) => s.profile);
  const patch = useSettingsStore((s) => s.patch);

  const activeKey =
    selectedProvider === 'openai'
      ? openAiApiKey
      : selectedProvider === 'anthropic'
        ? anthropicApiKey
        : groqApiKey;

  const score = jdAnalysis ? matchScore(jdAnalysis.requiredSkills, profile.resumeText ?? '') : 0;

  const niceScore = jdAnalysis
    ? matchScore(jdAnalysis.niceToHaveSkills, profile.resumeText ?? '')
    : 0;

  async function handleAnalyze() {
    if (!jobDescription.trim()) return;
    setAnalyzing(true);
    try {
      const provider = createLiveAnswerProvider(selectedProvider, activeKey, providerModel);
      const analysis = await analyzeJobDescription(jobDescription, provider);
      patch({ jdAnalysis: analysis });
      setCoverLetter('');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleGenerateCover() {
    if (!jdAnalysis || !jobDescription.trim()) return;
    setGeneratingCover(true);
    setCoverLetter('');
    try {
      const provider = createLiveAnswerProvider(selectedProvider, activeKey, providerModel);
      const prompt = [
        `Write a professional cover letter for this job description.`,
        `Candidate: ${profile.userName || 'the candidate'}, role: ${profile.userRole || 'professional'}.`,
        `Required skills: ${jdAnalysis.requiredSkills.join(', ')}.`,
        `Job description:\n${jobDescription.slice(0, 1200)}`,
      ].join('\n');
      const result = await provider.complete({
        systemPrompt:
          'You are an expert career coach. Write a concise, compelling cover letter in 3 paragraphs. Return plain text only.',
        userPrompt: prompt,
      });
      setCoverLetter(result);
    } catch (err) {
      logger.warn('jd', 'cover letter generation failed', { err: String(err) });
      setCoverLetter('Could not generate cover letter. Check your API key in settings.');
    } finally {
      setGeneratingCover(false);
    }
  }

  function handleSave() {
    if (!jdAnalysis) return;
    const name = `JD ${new Date().toLocaleDateString()} – ${jdAnalysis.requiredSkills[0] ?? 'Role'}`;
    const preset: SavedPreset = {
      id: crypto.randomUUID(),
      name,
      jd: jobDescription,
      skills: jdAnalysis.requiredSkills,
    };
    setSavedPresets((prev) => [preset, ...prev]);
    setActiveSaveId(preset.id);
    toast({ title: 'Saved', description: `"${name}" added to presets.`, variant: 'success' });
  }

  function loadPreset(preset: SavedPreset) {
    patch({ jobDescription: preset.jd, jdAnalysis: null });
    setActiveSaveId(preset.id);
    setCoverLetter('');
  }

  function deletePreset(id: string) {
    setSavedPresets((prev) => prev.filter((p) => p.id !== id));
    if (activeSaveId === id) setActiveSaveId(null);
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === 'string') {
        patch({ jobDescription: text, jdAnalysis: null });
      }
    };
    reader.readAsText(file);
  }

  const scoreColor = score >= 70 ? 'var(--ok)' : score >= 40 ? 'var(--warn)' : 'var(--danger)';
  const scoreLabel = score >= 70 ? 'Strong Match' : score >= 40 ? 'Partial Match' : 'Low Match';

  return (
    <div className="jd-page">
      <div className="jd-header">
        <h1 className="jd-title">Job Description</h1>
        <p className="jd-subtitle">
          Paste or upload a JD — we'll extract skills, score your profile fit, and generate a
          tailored cover letter.
        </p>
      </div>

      <div className="jd-layout">
        {/* ── Left column: input ── */}
        <div className="jd-input-col">
          <div className="jd-card">
            <div className="jd-card-header">
              <p className="jd-card-eyebrow">Job Description</p>
              <Tooltip content="Upload .txt file">
                <IconButton
                  aria-label="Upload job description file"
                  size="sm"
                  variant="secondary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={15} />
                </IconButton>
              </Tooltip>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.doc,.docx"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
            </div>
            <Textarea
              value={jobDescription}
              onChange={(e) => patch({ jobDescription: e.target.value, jdAnalysis: null })}
              placeholder="Paste the full job description here…"
              rows={14}
            />
            <p className="jd-scrape-note">
              {jobDescription.trim().split(/\s+/).filter(Boolean).length} words
            </p>
            <div className="jd-analyze-row">
              <Button
                onClick={() => void handleAnalyze()}
                disabled={analyzing || !jobDescription.trim()}
                loading={analyzing}
                leadingIcon={<Sparkles size={15} />}
              >
                {analyzing ? 'Analyzing…' : 'Extract Skills & Keywords'}
              </Button>
              {jdAnalysis && (
                <Tooltip content="Save as named preset">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleSave}
                    leadingIcon={<BookmarkPlus size={14} />}
                  >
                    Save JD
                  </Button>
                </Tooltip>
              )}
              {jdAnalysis && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => patch({ jdAnalysis: null, jobDescription: '' })}
                  leadingIcon={<Trash2 size={14} />}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          {/* Presets */}
          {savedPresets.length > 0 && (
            <div className="jd-card">
              <p className="jd-card-eyebrow">Saved Presets</p>
              <ul className="jd-preset-list">
                {savedPresets.map((p) => (
                  <li
                    key={p.id}
                    className={`jd-preset-item${activeSaveId === p.id ? ' jd-preset-item--active' : ''}`}
                  >
                    <button className="jd-preset-btn" onClick={() => loadPreset(p)}>
                      <span className="jd-preset-name">{p.name}</span>
                      <div className="jd-preset-tags">
                        {p.skills.slice(0, 3).map((s) => (
                          <Tag key={s}>{s}</Tag>
                        ))}
                      </div>
                    </button>
                    <IconButton
                      aria-label="Delete preset"
                      size="sm"
                      variant="ghost"
                      onClick={() => deletePreset(p.id)}
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── Right column: results ── */}
        <div className="jd-output-col">
          {!jdAnalysis && !analyzing && (
            <div className="jd-empty-right">
              <EmptyState
                icon={<BarChart2 size={32} />}
                title="No analysis yet"
                description="Paste a job description and click Extract to see skill tags, match score, and cover letter generation."
              />
            </div>
          )}

          {analyzing && (
            <div className="jd-card">
              <Skeleton variant="text" />
              <Skeleton variant="text" />
              <Skeleton variant="text" style={{ width: '60%' }} />
            </div>
          )}

          {jdAnalysis && !analyzing && (
            <>
              {/* Fit score hero */}
              <div
                className="jd-fit-hero"
                style={{ '--fit-color': scoreColor, '--fit-pct': score } as React.CSSProperties}
              >
                <div className="jd-fit-circle">
                  <div className="jd-fit-circle-label">
                    <div className="jd-fit-pct">{score}</div>
                    <div className="jd-fit-suffix">/ 100</div>
                  </div>
                </div>
                <div className="jd-fit-body">
                  <h3 className="jd-fit-verdict">{scoreLabel}</h3>
                  <p className="jd-fit-rationale">
                    {profile.resumeText
                      ? `Your profile matches ${score}% of required skills.`
                      : 'Add resume text in Settings › Profile to compute your real match score.'}
                  </p>
                  <div className="jd-fit-bars">
                    <BarRow label="Required skills" pct={score} variant="gold" />
                    <BarRow label="Nice-to-have" pct={niceScore} variant="blue" />
                  </div>
                </div>
              </div>

              {/* Skills */}
              <div className="jd-card">
                <p className="jd-card-eyebrow">Required Skills</p>
                <div className="jd-tag-list">
                  {jdAnalysis.requiredSkills.map((s) => (
                    <span key={s} className="jd-tag-chip jd-tag-chip--required">
                      {s}
                    </span>
                  ))}
                </div>

                {jdAnalysis.niceToHaveSkills.length > 0 && (
                  <>
                    <Divider />
                    <p className="jd-card-eyebrow">Nice-to-Have</p>
                    <div className="jd-tag-list">
                      {jdAnalysis.niceToHaveSkills.map((s) => (
                        <span key={s} className="jd-tag-chip jd-tag-chip--nice">
                          {s}
                        </span>
                      ))}
                    </div>
                  </>
                )}

                {jdAnalysis.keywords.length > 0 && (
                  <>
                    <Divider />
                    <p className="jd-card-eyebrow">Keywords</p>
                    <div className="jd-keyword-cloud">
                      {jdAnalysis.keywords.map((k, i) => (
                        <span
                          key={k}
                          className="jd-keyword"
                          style={
                            {
                              '--weight':
                                (jdAnalysis.keywords.length - i) / jdAnalysis.keywords.length,
                            } as React.CSSProperties
                          }
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Cover letter */}
              <div className="jd-card">
                <div className="jd-card-header">
                  <p className="jd-card-eyebrow">Tailored Cover Letter</p>
                  {generatingCover && <Spinner size="xs" />}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleGenerateCover()}
                  disabled={generatingCover}
                  loading={generatingCover}
                  leadingIcon={<Sparkles size={14} />}
                >
                  {generatingCover ? 'Generating…' : 'Generate Cover Letter'}
                </Button>
                {coverLetter && (
                  <ScrollArea style={{ maxHeight: 320 }}>
                    <Textarea
                      value={coverLetter}
                      onChange={(e) => setCoverLetter(e.target.value)}
                      rows={12}
                    />
                  </ScrollArea>
                )}
              </div>

              <p className="jd-active-hint">
                Skills active — AI answers will align to this role during your session.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
