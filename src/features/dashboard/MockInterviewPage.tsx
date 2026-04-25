import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { composeAnswer } from '../../lib/copilot/answerComposer';
import { detectQuestion } from '../../lib/copilot/questionDetector';
import {
  categoryLabels,
  questionBank,
  type QuestionCategory,
} from '../../lib/interview/questionBank';
import { createLiveAnswerProvider } from '../../lib/providers/providerFactory';
import { getTTSProvider } from '../../lib/providers/ttsProvider';
import { scoreAnswer as scoreLLM } from '../../lib/copilot/answerScorer';
import { logger } from '../../lib/logger';
import { useSettingsStore } from '../../store/settingsStore';
import {
  Badge,
  Button,
  IconButton,
  KeyHint,
  SegmentedControl,
  Spinner,
  StatusDot,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tag,
  Textarea,
  Tooltip,
} from '../../components/ui';
import './mockInterview.css';

const TIMER_SECONDS = 120;

type Step = 'setup' | 'live' | 'review';

type ScoreDimension = { name: string; score: number; comment?: string };

type ReviewEntry = {
  question: string;
  category: QuestionCategory;
  userAnswer: string;
  aiAnswer: string;
  bullets: string[];
  score: number;
  scoreDimensions?: ScoreDimension[];
  scoreImprovements?: string[];
  scoreFeedback?: string;
};

const SENIORITY_OPTIONS = [
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
  { value: 'staff', label: 'Staff+' },
];

const FOCUS_OPTIONS: { value: QuestionCategory; label: string }[] = [
  { value: 'behavioral', label: 'Behavioral' },
  { value: 'system-design', label: 'System Design' },
  { value: 'coding', label: 'Coding' },
  { value: 'hr', label: 'Mixed / HR' },
];

const STAR_LABELS = ['Situation', 'Task', 'Action', 'Result'];

function scoreAnswerFallback(answer: string): number {
  if (!answer.trim()) return 0;
  const words = answer.trim().split(/\s+/).length;
  if (words < 20) return 35;
  if (words < 60) return 60;
  if (words < 120) return 78;
  return Math.min(95, 70 + Math.floor(words / 20));
}

function ScoreGauge({ score }: { score: number }) {
  const pct = Math.round(score);
  const color = pct >= 80 ? 'var(--ok)' : pct >= 55 ? 'var(--warn)' : 'var(--danger)';
  return (
    <div
      className="mi-gauge"
      style={{ '--gauge-pct': `${pct}`, '--gauge-color': color } as React.CSSProperties}
    >
      <div className="mi-gauge-inner">
        <span className="mi-gauge-value">{pct}</span>
        <span className="mi-gauge-unit">/ 100</span>
      </div>
    </div>
  );
}

export function MockInterviewPage() {
  const [step, setStep] = useState<Step>('setup');
  const [seniority, setSeniority] = useState('mid');
  const [focus, setFocus] = useState<QuestionCategory>('behavioral');
  const [index, setIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIMER_SECONDS);
  const [timerActive, setTimerActive] = useState(false);
  const [userAnswer, setUserAnswer] = useState('');
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiBullets, setAiBullets] = useState<string[]>([]);
  const [loadingAnswer, setLoadingAnswer] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [reviewEntries, setReviewEntries] = useState<ReviewEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Selector hooks (I21/I22) — read individual fields so unrelated settings
  // changes don't re-render this large practice screen.
  const selectedProvider = useSettingsStore((s) => s.selectedProvider);
  const groqApiKey = useSettingsStore((s) => s.groqApiKey);
  const openAiApiKey = useSettingsStore((s) => s.openAiApiKey);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  const providerModel = useSettingsStore((s) => s.providerModel);
  const profile = useSettingsStore((s) => s.profile);

  const questions = questionBank[focus];
  const currentQuestion = questions[index] ?? '';
  const totalQuestions = questions.length;

  const activeKey =
    selectedProvider === 'openai'
      ? openAiApiKey
      : selectedProvider === 'anthropic'
        ? anthropicApiKey
        : groqApiKey;

  const urgency = timeLeft > 60 ? 'ok' : timeLeft > 30 ? 'warn' : 'danger';
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const timerLabel = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const pct = Math.round((timeLeft / TIMER_SECONDS) * 100);

  useEffect(() => {
    // I11/I14: always clear any pre-existing timer before creating a new one so
    // a rapid toggle of timerActive cannot leak two intervals onto the heap.
    if (timerRef.current) clearInterval(timerRef.current);
    if (timerActive && timeLeft > 0) {
      timerRef.current = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    } else if (timeLeft === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- countdown driven by setInterval; auto-stops at zero
      setTimerActive(false);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerActive, timeLeft]);

  // Ctrl+Enter submit
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (step === 'live' && e.ctrlKey && e.key === 'Enter' && !submitted) {
        e.preventDefault();
        handleSubmit().catch((err) => {
          logger.warn('mock-interview', 'handleSubmit (keybind) failed', { err: String(err) });
        });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function resetQuestion() {
    setTimeLeft(TIMER_SECONDS);
    setTimerActive(false);
    setUserAnswer('');
    setAiAnswer(null);
    setAiBullets([]);
    setLoadingAnswer(false);
    setSubmitted(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function startInterview() {
    setIndex(0);
    setReviewEntries([]);
    resetQuestion();
    setStep('live');
    setTimeout(() => textareaRef.current?.focus(), 100);
  }

  const getAiAnswer = useCallback(async (): Promise<{ answer: string; bullets: string[] }> => {
    const provider = createLiveAnswerProvider(selectedProvider, activeKey, providerModel);
    const fakeTranscript = [
      { id: '1', speaker: 'customer' as const, text: currentQuestion, timestamp: Date.now() },
    ];
    const detection = detectQuestion(fakeTranscript);
    const result = await composeAnswer({
      provider,
      question: detection.isQuestion
        ? detection
        : {
            isQuestion: true,
            questionText: currentQuestion,
            questionType: 'behavioral',
            confidence: 0.9,
            isFollowUp: false,
          },
      conversationWindow: fakeTranscript,
      ragChunks: [],
      profile,
    });
    return { answer: result.answer, bullets: result.bullets };
  }, [currentQuestion, selectedProvider, activeKey, providerModel, profile]);

  async function handleSubmit() {
    if (submitted) return;
    setSubmitted(true);
    setLoadingAnswer(true);
    try {
      const { answer, bullets } = await getAiAnswer();
      setAiAnswer(answer);
      setAiBullets(bullets);
      const groqKey = useSettingsStore.getState().groqApiKey;
      let scoreResult: {
        overall: number;
        dimensions?: ScoreDimension[];
        improvements?: string[];
        feedback?: string;
      } = { overall: scoreAnswerFallback(userAnswer) };
      try {
        const llmScore = await scoreLLM(currentQuestion, userAnswer, focus, groqKey);
        scoreResult = {
          overall: llmScore.overall,
          dimensions: llmScore.dimensions,
          improvements: llmScore.improvements,
          feedback: llmScore.feedback,
        };
      } catch (err) {
        logger.warn('mock-interview', 'LLM scoring failed; using fallback', { err: String(err) });
      }
      const entry: ReviewEntry = {
        question: currentQuestion,
        category: focus,
        userAnswer,
        aiAnswer: answer,
        bullets,
        score: scoreResult.overall,
        ...(scoreResult.dimensions ? { scoreDimensions: scoreResult.dimensions } : {}),
        ...(scoreResult.improvements ? { scoreImprovements: scoreResult.improvements } : {}),
        ...(scoreResult.feedback !== undefined ? { scoreFeedback: scoreResult.feedback } : {}),
      };
      setReviewEntries((prev) => [...prev, entry]);
    } catch (err) {
      logger.warn('mock-interview', 'submit failed', { err: String(err) });
      setAiAnswer('Could not generate answer. Check your API key in settings.');
      setAiBullets([]);
    } finally {
      setLoadingAnswer(false);
    }
  }

  function nextQuestion() {
    if (index + 1 >= totalQuestions) {
      setStep('review');
      return;
    }
    setIndex((i) => i + 1);
    resetQuestion();
  }

  function prevQuestion() {
    if (index === 0) return;
    setIndex((i) => i - 1);
    resetQuestion();
  }

  const overallScore = reviewEntries.length
    ? Math.round(reviewEntries.reduce((s, e) => s + e.score, 0) / reviewEntries.length)
    : 0;

  // ── SETUP ────────────────────────────────────────────────────────────────
  if (step === 'setup') {
    return (
      <div className="mi-page">
        <div className="mi-hero">
          <h1 className="mi-hero-title">Mock Interview</h1>
          <p className="mi-hero-subtitle">
            Practice with AI-generated answers and real-time feedback. Choose your role focus and
            hit Start when you're ready.
          </p>
          <div className="mi-hero-form">
            <div>
              <p className="mi-field-label">Seniority</p>
              <SegmentedControl
                value={seniority}
                onChange={setSeniority}
                options={SENIORITY_OPTIONS}
                aria-label="Seniority level"
              />
            </div>
            <div>
              <p className="mi-field-label">Interview Focus</p>
              <Tabs value={focus} onValueChange={(v) => setFocus(v as QuestionCategory)}>
                <TabsList aria-label="Interview focus">
                  {FOCUS_OPTIONS.map((o) => (
                    <TabsTrigger key={o.value} value={o.value}>
                      {o.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {FOCUS_OPTIONS.map((o) => (
                  <TabsContent key={o.value} value={o.value}>
                    {null}
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          </div>
          <div className="mi-hero-cta">
            <Button size="lg" onClick={startInterview}>
              Start Interview
            </Button>
            <Badge variant="neutral">
              {totalQuestions} questions · {Math.ceil((totalQuestions * TIMER_SECONDS) / 60)} min
            </Badge>
          </div>
        </div>

        {/* Preview cards */}
        <div className="mi-preview-grid">
          {questions.slice(0, 3).map((q, i) => (
            <div key={i} className="mi-preview-card">
              <Tag>{categoryLabels[focus]}</Tag>
              <p className="mi-preview-q">{q}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── REVIEW ───────────────────────────────────────────────────────────────
  if (step === 'review') {
    return (
      <div className="mi-page">
        <div className="mi-completion-hero">
          <h1 className="mi-completion-title">Session Complete</h1>
          <p className="mi-completion-sub">
            {reviewEntries.length} of {totalQuestions} questions answered
          </p>
          <div className="mi-completion-gauge-row">
            <ScoreGauge score={overallScore} />
            <div className="mi-completion-stats">
              <div className="mi-stat">
                <p className="mi-stat-label">Questions</p>
                <p className="mi-stat-value">{reviewEntries.length}</p>
              </div>
              <div className="mi-stat">
                <p className="mi-stat-label">Avg Score</p>
                <p className="mi-stat-value">{overallScore}</p>
              </div>
              <div className="mi-stat">
                <p className="mi-stat-label">Focus</p>
                <p className="mi-stat-value">{categoryLabels[focus]}</p>
              </div>
            </div>
          </div>
          <Button variant="secondary" onClick={() => setStep('setup')}>
            New Session
          </Button>
        </div>

        <div className="mi-review-list">
          {reviewEntries.map((entry, i) => (
            <div key={i} className="mi-scorecard">
              <div className="mi-scorecard-head">
                <div className="mi-scorecard-meta">
                  <Badge variant={entry.score >= 80 ? 'ok' : entry.score >= 55 ? 'warn' : 'danger'}>
                    {entry.score >= 80 ? 'Strong' : 'Needs Work'}
                  </Badge>
                  <Tag>{categoryLabels[entry.category]}</Tag>
                </div>
                <ScoreGauge score={entry.score} />
              </div>
              <p className="mi-scorecard-q">
                Q{i + 1}: {entry.question}
              </p>

              {entry.scoreFeedback && (
                <p className="mi-scorecard-feedback">
                  <em>{entry.scoreFeedback}</em>
                </p>
              )}

              {entry.scoreDimensions && entry.scoreDimensions.length > 0 && (
                <div className="mi-scorecard-dimensions">
                  <p className="mi-eyebrow">Score Breakdown</p>
                  {entry.scoreDimensions.map((dim, di) => (
                    <div key={di} className="mi-score-dim">
                      <span className="mi-score-dim__label">{dim.name}</span>
                      <div className="mi-score-dim__bar-track">
                        <div
                          className="mi-score-dim__bar-fill"
                          style={{ width: `${(dim.score / 25) * 100}%` }}
                        />
                      </div>
                      <span className="mi-score-dim__value">{dim.score}/25</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="mi-scorecard-star">
                {STAR_LABELS.map((label, si) => (
                  <Tag key={si}>{label}</Tag>
                ))}
              </div>

              {entry.userAnswer.trim() && (
                <div className="mi-scorecard-answer">
                  <p className="mi-eyebrow">Your Answer</p>
                  <p className="mi-scorecard-text">{entry.userAnswer}</p>
                </div>
              )}

              {(entry.scoreImprovements && entry.scoreImprovements.length > 0
                ? entry.scoreImprovements
                : entry.bullets
              ).length > 0 && (
                <div className="mi-scorecard-improve">
                  <p className="mi-eyebrow">Improvement Points</p>
                  <ul className="mi-answer-bullets">
                    {(entry.scoreImprovements && entry.scoreImprovements.length > 0
                      ? entry.scoreImprovements
                      : entry.bullets
                    ).map((b, bi) => (
                      <li key={bi}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── LIVE ─────────────────────────────────────────────────────────────────
  return (
    <div className="mi-page">
      {/* Top bar */}
      <div className="mi-top-bar">
        <div className="mi-top-bar-meta">
          <span className="mi-top-bar-label">Question</span>
          <span className="mi-top-bar-value">
            {index + 1} / {totalQuestions}
          </span>
        </div>
        <div className="mi-progress-bar">
          <div
            className="mi-progress-bar-fill"
            style={{ width: `${((index + 1) / totalQuestions) * 100}%` }}
          />
        </div>
        {/* Dots */}
        <div className="mi-dots">
          {questions.map((_, i) => (
            <span
              key={i}
              className={`mi-dot${i === index ? ' mi-dot--active' : i < index ? ' mi-dot--done' : ''}`}
            />
          ))}
        </div>
        <Tooltip content={timerActive ? 'Pause timer' : 'Start timer'}>
          <span
            className="mi-timer-pill"
            data-urgency={urgency}
            style={{ '--pct': pct } as React.CSSProperties}
          >
            {timerLabel}
          </span>
        </Tooltip>
        <div className="mi-timer-btns">
          <IconButton
            aria-label={timerActive ? 'Pause' : 'Start timer'}
            size="sm"
            onClick={() => setTimerActive((a) => !a)}
          >
            {timerActive ? <Pause size={14} /> : <Play size={14} />}
          </IconButton>
          <IconButton
            aria-label="Reset timer"
            size="sm"
            onClick={() => {
              setTimeLeft(TIMER_SECONDS);
              setTimerActive(false);
            }}
          >
            <RotateCcw size={14} />
          </IconButton>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setStep('setup')}>
          Exit
        </Button>
      </div>

      {/* Main split */}
      <div className="mi-live-grid">
        {/* Left: AI interviewer */}
        <div className="mi-question-card">
          <div className="mi-question-meta">
            <StatusDot status="ok" />
            <Tag>{categoryLabels[focus]}</Tag>
            <Badge variant="neutral">{seniority}</Badge>
          </div>
          <div className="mi-question-head">
            <h2 className="mi-question-text">{currentQuestion}</h2>
            <Tooltip content="Play question (TTS)">
              <IconButton
                aria-label="Play question via text-to-speech"
                size="sm"
                variant="secondary"
                onClick={() => {
                  void getTTSProvider().speak(currentQuestion);
                }}
              >
                <Volume2 size={16} />
              </IconButton>
            </Tooltip>
          </div>

          {submitted && loadingAnswer && (
            <div className="mi-hint-block">
              <Spinner size="xs" /> Generating AI answer…
            </div>
          )}

          {submitted && aiAnswer && !loadingAnswer && (
            <div className="mi-answer-card">
              <p className="mi-eyebrow">AI Model Answer</p>
              <p className="mi-answer-body">{aiAnswer}</p>
              {aiBullets.length > 0 && (
                <ul className="mi-answer-bullets">
                  {aiBullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Right: user answer */}
        <div className="mi-notes-card">
          <div className="mi-notes-header">
            <p className="mi-eyebrow">Your Answer</p>
            {submitted && (
              <Badge variant={scoreAnswerFallback(userAnswer) >= 80 ? 'ok' : 'warn'}>
                Score {scoreAnswerFallback(userAnswer)}
              </Badge>
            )}
          </div>
          <Textarea
            ref={textareaRef}
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value)}
            placeholder="Type your answer here… use STAR: Situation → Task → Action → Result"
            rows={8}
            disabled={submitted}
          />
          {!submitted && (
            <div className="mi-action-row">
              <Button
                onClick={() => void handleSubmit()}
                disabled={loadingAnswer || !userAnswer.trim()}
                loading={loadingAnswer}
              >
                {loadingAnswer ? 'Evaluating…' : 'Submit Answer'}
              </Button>
              <KeyHint keys={['Ctrl', 'Enter']} />
            </div>
          )}
          {submitted && (
            <div className="mi-action-row">
              <CheckCircle2 size={16} className="mi-check-icon" />
              <span className="mi-submitted-label">Submitted</span>
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <div className="mi-nav-row">
        <Button
          variant="secondary"
          onClick={prevQuestion}
          disabled={index === 0}
          leadingIcon={<ChevronLeft size={16} />}
        >
          Previous
        </Button>
        <Button onClick={nextQuestion} trailingIcon={<ChevronRight size={16} />}>
          {index + 1 >= totalQuestions ? 'Finish & Review' : 'Next Question'}
        </Button>
      </div>
    </div>
  );
}
