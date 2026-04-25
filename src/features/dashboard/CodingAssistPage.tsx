import { useEffect, useRef, useState } from 'react';
import { Code2, Copy, RotateCcw, Terminal, Zap, ScanSearch } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  KeyHint,
  SegmentedControl,
  Select,
  Tag,
  Textarea,
  Tooltip,
  useToast,
} from '../../components/ui';
import { solveCodingProblem } from '../../lib/copilot/codingSolver';
import { logger } from '../../lib/logger';
import { createLiveAnswerProvider } from '../../lib/providers/providerFactory';
import { captureAndOcrScreenRegion } from '../../lib/runtime/screenCapture';
import { extractProblemFromScreenshot } from '../../lib/copilot/visionSolver';
import { useSettingsStore } from '../../store/settingsStore';
import type { CodingSolution } from '../../store/overlayStore';
import './coding.css';

type SolveMode = 'explain' | 'solve' | 'optimize' | 'debug';

const LANGUAGE_OPTIONS = [
  { value: 'python', label: 'Python' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C++' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
];

const MODE_PROMPTS: Record<SolveMode, string> = {
  explain: 'Explain',
  solve: 'Solve',
  optimize: 'Optimize',
  debug: 'Debug',
};

/** Very lightweight regex-based syntax highlighting for the code block. */
function highlight(code: string, lang: string): string {
  const kwMap: Record<string, string[]> = {
    python: [
      'def',
      'class',
      'return',
      'if',
      'else',
      'elif',
      'for',
      'while',
      'import',
      'from',
      'in',
      'not',
      'and',
      'or',
      'True',
      'False',
      'None',
      'lambda',
      'with',
      'as',
      'pass',
      'break',
      'continue',
      'yield',
      'raise',
      'try',
      'except',
      'finally',
    ],
    typescript: [
      'function',
      'const',
      'let',
      'var',
      'return',
      'if',
      'else',
      'for',
      'while',
      'class',
      'interface',
      'type',
      'import',
      'export',
      'from',
      'new',
      'null',
      'undefined',
      'true',
      'false',
      'async',
      'await',
      'of',
      'in',
    ],
    javascript: [
      'function',
      'const',
      'let',
      'var',
      'return',
      'if',
      'else',
      'for',
      'while',
      'class',
      'import',
      'export',
      'from',
      'new',
      'null',
      'undefined',
      'true',
      'false',
      'async',
      'await',
    ],
    java: [
      'public',
      'private',
      'class',
      'interface',
      'return',
      'if',
      'else',
      'for',
      'while',
      'new',
      'import',
      'static',
      'void',
      'int',
      'boolean',
      'null',
      'true',
      'false',
    ],
    cpp: [
      'int',
      'bool',
      'void',
      'class',
      'struct',
      'return',
      'if',
      'else',
      'for',
      'while',
      'new',
      'delete',
      'include',
      'auto',
      'nullptr',
      'true',
      'false',
      'const',
      'using',
      'namespace',
    ],
    go: [
      'func',
      'var',
      'const',
      'return',
      'if',
      'else',
      'for',
      'range',
      'import',
      'package',
      'struct',
      'interface',
      'nil',
      'true',
      'false',
      'defer',
      'go',
      'chan',
      'select',
    ],
    rust: [
      'fn',
      'let',
      'mut',
      'const',
      'return',
      'if',
      'else',
      'for',
      'while',
      'use',
      'mod',
      'struct',
      'impl',
      'trait',
      'match',
      'Some',
      'None',
      'Ok',
      'Err',
      'true',
      'false',
      'pub',
      'self',
      'async',
      'await',
    ],
  };
  const kws = kwMap[lang] ?? kwMap['python'];
  let escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // strings
  escaped = escaped.replace(
    /(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g,
    '<span class="tok-str">$&</span>',
  );
  // line comments
  escaped = escaped.replace(/(\/\/[^\n]*|#[^\n]*)/g, '<span class="tok-cmt">$1</span>');
  // numbers
  escaped = escaped.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>');
  // keywords
  const kwPattern = new RegExp(`\\b(${kws.join('|')})\\b`, 'g');
  escaped = escaped.replace(kwPattern, '<span class="tok-kw">$1</span>');
  return escaped;
}

export function CodingAssistPage() {
  const toast = useToast();
  const [promptText, setPromptText] = useState('');
  const [ocrNote, setOcrNote] = useState('');
  const [solution, setSolution] = useState<CodingSolution | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preferredLang, setPreferredLang] = useState('python');
  const [mode, setMode] = useState<SolveMode>('solve');
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    },
    [],
  );

  // Selector hooks (I21/I22) — narrow reads to minimise re-renders.
  const selectedProvider = useSettingsStore((s) => s.selectedProvider);
  const groqApiKey = useSettingsStore((s) => s.groqApiKey);
  const openAiApiKey = useSettingsStore((s) => s.openAiApiKey);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  const providerModel = useSettingsStore((s) => s.providerModel);
  const hasAnyKey = !!(groqApiKey?.trim() || openAiApiKey?.trim() || anthropicApiKey?.trim());

  // Prefer Groq (free, fast) for coding; fall back to whatever is configured
  function getBestProvider() {
    if (groqApiKey?.trim()) return createLiveAnswerProvider('groq', groqApiKey, providerModel);
    const apiKey =
      selectedProvider === 'openai'
        ? openAiApiKey
        : selectedProvider === 'anthropic'
          ? anthropicApiKey
          : groqApiKey;
    return createLiveAnswerProvider(selectedProvider, apiKey, providerModel);
  }

  async function handleSolve() {
    if (!promptText.trim()) return;
    setIsSolving(true);
    setError(null);
    setSolution(null);
    try {
      const provider = getBestProvider();
      const modePrefix = MODE_PROMPTS[mode];
      const augmented = mode === 'solve' ? promptText : `[${modePrefix}] ${promptText}`;
      const result = await solveCodingProblem(augmented, provider, preferredLang);
      setSolution(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Solve failed');
    } finally {
      setIsSolving(false);
    }
  }

  async function handleOcr() {
    setOcrNote('Select the window showing your coding problem…');
    const ocr = await captureAndOcrScreenRegion();
    setOcrNote(ocr.note);
    if (ocr.text.trim().length > 0) {
      // Replace instead of append — avoids mixing old UI garbage with new capture
      setPromptText(ocr.text.trim());
    }
  }

  async function handleScreenshotSolve() {
    try {
      const result = await invoke<{ imageBase64: string; mimeType: string }>(
        'capture_screen_region',
        { x: 0, y: 0, width: 0, height: 0 },
      );
      const openAiKey = useSettingsStore.getState().openAiApiKey;
      const problem = await extractProblemFromScreenshot(result.imageBase64, openAiKey);
      setPromptText(problem.description || problem.title);
      if (problem.type !== 'unknown') setMode(problem.type === 'coding' ? 'solve' : 'explain');
    } catch (e) {
      logger.error('coding-assist', 'screenshot solve failed', { err: String(e) });
    }
  }

  async function handleCopyCode() {
    if (!solution) return;
    await navigator.clipboard.writeText(solution.code);
    setCopied(true);
    toast.show({ title: 'Code copied', variant: 'success' });
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => {
      setCopied(false);
      copyTimerRef.current = null;
    }, 2000);
  }

  const highlightedCode = solution ? highlight(solution.code, solution.language) : '';

  return (
    <div className="coding-root">
      <header className="coding-head">
        <span className="coding-head__eyebrow">Engineering Copilot</span>
        <h2 className="coding-head__title">Coding Mode</h2>
        <p className="coding-head__sub">
          Paste a problem or capture the screen. The AI will explain, solve, optimize, or debug in
          the language you choose.
        </p>
      </header>

      <div className="coding-layout">
        {/* ── Left: problem input ───────────────────────────────── */}
        <div className="coding-input">
          <Card padding="md">
            <div className="coding-input__row">
              <Select
                label="Language"
                value={preferredLang}
                onChange={(e) => setPreferredLang(e.target.value)}
                options={LANGUAGE_OPTIONS}
              />
              <div className="coding-input__mode">
                <span className="coding-input__mode-label">Mode</span>
                <SegmentedControl<SolveMode>
                  value={mode}
                  onChange={setMode}
                  aria-label="Solve mode"
                  options={[
                    { value: 'explain', label: 'Explain' },
                    { value: 'solve', label: 'Solve' },
                    { value: 'optimize', label: 'Optimize' },
                    { value: 'debug', label: 'Debug' },
                  ]}
                />
              </div>
            </div>
          </Card>

          {!hasAnyKey && (
            <div className="coding-error" role="alert" style={{ marginBottom: 8 }}>
              No API key configured — running in demo mode. Add a free <strong>Groq</strong> key in{' '}
              <a href="#/settings" style={{ color: 'inherit', textDecoration: 'underline' }}>
                Settings → API Keys
              </a>{' '}
              (get one free at <strong>console.groq.com</strong>).
            </div>
          )}

          <Card padding="md">
            <Textarea
              label="Problem text"
              placeholder="Paste the coding problem here, or capture it from screen…"
              rows={12}
              autoResize
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
            />
            {ocrNote ? <p className="coding-ocr-note">{ocrNote}</p> : null}
            {error ? (
              <div className="coding-error" role="alert">
                {error}
              </div>
            ) : null}
            <div className="coding-input__actions">
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Terminal size={14} aria-hidden />}
                onClick={() => void handleOcr()}
              >
                Capture &amp; OCR
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<ScanSearch size={14} aria-hidden />}
                onClick={() => void handleScreenshotSolve()}
              >
                Solve from Screenshot
                <KeyHint keys={['Ctrl', 'Shift', 'S']} />
              </Button>
              <Button
                variant="primary"
                disabled={isSolving || !promptText.trim()}
                loading={isSolving}
                leadingIcon={<Zap size={14} aria-hidden />}
                onClick={() => void handleSolve()}
              >
                {isSolving ? 'Solving…' : 'Solve with AI'}
              </Button>
            </div>
          </Card>
        </div>

        {/* ── Right: solution output ───────────────────────────── */}
        <div className="coding-output">
          {solution ? (
            <>
              <Card padding="md">
                <div className="coding-solution-hero">
                  <div className="coding-solution-hero__main">
                    <h3 className="coding-solution-hero__title">{solution.approach}</h3>
                    <div className="coding-solution-hero__chips">
                      <Tag>Time: {solution.timeComplexity}</Tag>
                      <Tag>Space: {solution.spaceComplexity}</Tag>
                      <Tag>{solution.language}</Tag>
                    </div>
                  </div>
                  <div className="coding-solution-hero__actions">
                    <Tooltip content="Clear solution">
                      <IconButton
                        aria-label="Clear solution"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSolution(null)}
                      >
                        <RotateCcw size={14} aria-hidden />
                      </IconButton>
                    </Tooltip>
                  </div>
                </div>
              </Card>

              <div className="coding-stats">
                <div className="coding-stat">
                  <div className="coding-stat__label">Time complexity</div>
                  <div className="coding-stat__value">{solution.timeComplexity}</div>
                </div>
                <div className="coding-stat">
                  <div className="coding-stat__label">Space complexity</div>
                  <div className="coding-stat__value">{solution.spaceComplexity}</div>
                </div>
              </div>

              {solution.keyInsights.length > 0 && (
                <Card padding="md">
                  <span className="coding-section-label">Key insights</span>
                  <ul className="coding-insight-list">
                    {solution.keyInsights.map((insight) => (
                      <li key={insight}>{insight}</li>
                    ))}
                  </ul>
                </Card>
              )}

              {solution.pseudocode.length > 0 && (
                <Card padding="md">
                  <span className="coding-section-label">Steps</span>
                  <ol className="coding-edge-list">
                    {solution.pseudocode.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </Card>
              )}

              <Card padding="none">
                <div className="coding-code-wrap">
                  <div className="coding-copy-overlay">
                    <Tooltip content={copied ? 'Copied!' : 'Copy code'}>
                      <IconButton
                        aria-label="Copy code"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleCopyCode()}
                      >
                        <Copy size={14} aria-hidden />
                      </IconButton>
                    </Tooltip>
                  </div>
                  <pre
                    className="coding-code"
                    // highlightedCode is produced by the local highlight() helper, which
                    // HTML-escapes the input (& < >) before wrapping tokens in static
                    // <span> tags — no user-controlled HTML can reach the DOM here.
                    dangerouslySetInnerHTML={{ __html: highlightedCode }}
                  />
                </div>
              </Card>

              <div className="coding-run-row">
                <EmptyState
                  icon={<Code2 size={20} aria-hidden />}
                  title="No runner configured"
                  description="Sample-case execution is not yet wired to a runner."
                />
              </div>
            </>
          ) : (
            <Card padding="lg">
              <div className="coding-empty">
                <div className="coding-empty__orb">
                  <Code2 size={32} aria-hidden />
                </div>
                <p>
                  Enter a coding problem and press <strong>Solve with AI</strong>.
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
