import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlignLeft, Copy, GitBranch, Play, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tag,
  Tooltip,
} from '../../components/ui';
import type { CodingSolution } from '../../store/overlayStore';

/**
 * CodingSolution may carry optional test cases in future pipeline iterations.
 */
type MaybeTestCase = {
  input?: string;
  expected?: string;
  output?: string;
  description?: string;
};

type Props = {
  solution: CodingSolution;
  onDismiss: () => void;
};

const KEYWORDS = new Set([
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'break',
  'continue',
  'const',
  'let',
  'var',
  'class',
  'new',
  'null',
  'undefined',
  'true',
  'false',
  'import',
  'export',
  'default',
  'from',
  'try',
  'catch',
  'finally',
  'throw',
  'async',
  'await',
  'yield',
  'switch',
  'case',
  'in',
  'of',
  'typeof',
  'instanceof',
  'def',
  'lambda',
  'self',
  'None',
  'True',
  'False',
  'elif',
  'pass',
  'raise',
  'with',
  'public',
  'private',
  'protected',
  'static',
  'void',
  'int',
  'string',
  'boolean',
  'this',
]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Lightweight regex-based syntax highlighter.
 */
function highlight(code: string): string {
  const escaped = escapeHtml(code);
  const stash: string[] = [];
  const shelve = (html: string): string => {
    const idx = stash.length;
    stash.push(html);
    return ` ${idx} `;
  };

  let out = escaped;
  out = out.replace(/\/\*[\s\S]*?\*\//g, (m) => shelve(`<span class="tok-cmt">${m}</span>`));
  out = out.replace(
    /(^|[^:])\/\/.*$/gm,
    (m, p1: string) => `${p1}${shelve(`<span class="tok-cmt">${m.slice(p1.length)}</span>`)}`,
  );
  out = out.replace(
    /(^|\s)#[^\n]*/g,
    (m, p1: string) => `${p1}${shelve(`<span class="tok-cmt">${m.slice(p1.length)}</span>`)}`,
  );
  out = out.replace(/(&quot;|&#39;|`)([^\n]*?)\1/g, (m) =>
    shelve(`<span class="tok-str">${m}</span>`),
  );
  out = out.replace(/\b\d+(\.\d+)?\b/g, (m) => `<span class="tok-num">${m}</span>`);
  out = out.replace(/\b([A-Za-z_][A-Za-z0-9_]*)(?=\s*\()/g, (m, name: string) =>
    KEYWORDS.has(name) ? m : `<span class="tok-fn">${name}</span>`,
  );
  out = out.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (m, name: string) =>
    KEYWORDS.has(name) ? `<span class="tok-kw">${name}</span>` : m,
  );
  out = out.replace(/ (\d+) /g, (_m, idx: string) => stash[Number(idx)] ?? '');
  return out;
}

/** Derive per-line explanations from pseudocode or code lines. */
function buildLineExplanations(
  code: string,
  pseudocode: string[],
): Array<{ line: string; desc: string }> {
  const codeLines = code
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(0, 12);
  return codeLines.map((line, i) => ({
    line: line.trim().slice(0, 40),
    desc: pseudocode[i] ?? `Step ${i + 1}: ${line.trim().slice(0, 60)}`,
  }));
}

/** Generate a simple alternative approach description from approach text. */
function buildAltApproach(approach: string, keyInsights: string[]): string {
  const alts: string[] = [
    'Consider a hash-map based approach for O(1) lookups instead.',
    'A two-pointer technique can reduce space complexity to O(1).',
    'Dynamic programming with memoization avoids redundant subproblem computation.',
    'Sorting the input first (O(n log n)) may simplify the core logic.',
    'A monotonic stack can linearize repeated min/max queries.',
  ];
  // Pick one that doesn't overlap with existing approach words
  const approachLower = (approach + keyInsights.join(' ')).toLowerCase();
  const chosen = alts.find((a) => !approachLower.includes(a.split(' ')[2] ?? ''));
  return chosen ?? alts[0];
}

export function SolutionCard({ solution, onDismiss }: Props) {
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'approach' | 'code' | 'tests'>('approach');
  const [showExplain, setShowExplain] = useState(false);
  const [showAlt, setShowAlt] = useState(false);
  const [isLoadingExplain, setIsLoadingExplain] = useState(false);

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
      if (explainTimerRef.current) {
        clearTimeout(explainTimerRef.current);
        explainTimerRef.current = null;
      }
    },
    [],
  );

  const highlightedCode = useMemo(() => highlight(solution.code), [solution.code]);

  const testCases = useMemo<MaybeTestCase[]>(() => {
    const maybe = (solution as unknown as { testCases?: unknown }).testCases;
    return Array.isArray(maybe) ? (maybe as MaybeTestCase[]) : [];
  }, [solution]);

  const lineExplanations = useMemo(
    () => buildLineExplanations(solution.code, solution.pseudocode),
    [solution.code, solution.pseudocode],
  );

  const altApproach = useMemo(
    () => buildAltApproach(solution.approach, solution.keyInsights),
    [solution.approach, solution.keyInsights],
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(solution.code);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      /* silent */
    }
  }

  const handleExplain = useCallback(() => {
    if (showExplain) {
      setShowExplain(false);
      return;
    }
    setIsLoadingExplain(true);
    // Simulate a brief render delay for perceived responsiveness
    if (explainTimerRef.current) clearTimeout(explainTimerRef.current);
    explainTimerRef.current = setTimeout(() => {
      setIsLoadingExplain(false);
      setShowExplain(true);
    }, 240);
  }, [showExplain]);

  const handleAltApproach = useCallback(() => {
    setShowAlt((v) => !v);
  }, []);

  return (
    <Card variant="elevated" padding="md" aria-label="Coding solution">
      {/* ── Header: language badge, complexity tags, dismiss ── */}
      <header className="solution-header">
        <Badge variant="ok" size="sm">
          {solution.language || 'code'}
        </Badge>
        <div className="solution-header__meta">
          <Tag>⏱ {solution.timeComplexity}</Tag>
          <Tag>💾 {solution.spaceComplexity}</Tag>
        </div>
        <div className="solution-header__actions">
          <Tooltip content="Dismiss solution">
            <IconButton aria-label="Dismiss solution" size="sm" onClick={onDismiss}>
              <X size={14} aria-hidden />
            </IconButton>
          </Tooltip>
        </div>
      </header>

      {/* ── Tabs: Approach / Code / Tests ── */}
      <Tabs
        className="solution-body-tabs"
        value={tab}
        onValueChange={(v) => setTab(v as 'approach' | 'code' | 'tests')}
      >
        <TabsList aria-label="Solution detail">
          <TabsTrigger value="approach">Approach</TabsTrigger>
          <TabsTrigger value="code">Code</TabsTrigger>
          <TabsTrigger value="tests">Tests</TabsTrigger>
        </TabsList>

        {/* ── Approach tab ── */}
        <TabsContent value="approach">
          <div className="solution-section">
            <h3 className="solution-section__title">{solution.approach}</h3>
            {solution.keyInsights.length > 0 ? (
              <ul>
                {solution.keyInsights.map((insight, i) => (
                  <li key={`insight-${i}`}>{insight}</li>
                ))}
              </ul>
            ) : null}
            {solution.pseudocode.length > 0 ? (
              <pre className="solution-pseudocode">
                <code>{solution.pseudocode.map((line, i) => `${i + 1}. ${line}`).join('\n')}</code>
              </pre>
            ) : null}

            {/* Alternative approach panel */}
            <div
              style={{
                marginTop: 'var(--space-2)',
                display: 'flex',
                gap: 'var(--space-2)',
                flexWrap: 'wrap',
              }}
            >
              <Button variant="ghost" size="sm" onClick={handleAltApproach}>
                <GitBranch size={13} style={{ marginRight: 5 }} aria-hidden />
                {showAlt ? 'Hide alternative' : 'Alternative approach'}
              </Button>
            </div>

            {showAlt ? (
              <div className="solution-alt-panel" role="region" aria-label="Alternative approach">
                <p className="solution-alt-panel__title">Alternative approach</p>
                <p className="solution-alt-panel__body">{altApproach}</p>
              </div>
            ) : null}
          </div>
        </TabsContent>

        {/* ── Code tab ── */}
        <TabsContent value="code">
          <div className="solution-code-wrap">
            <div className="solution-code-toolbar">
              <Tooltip content={copied ? 'Copied!' : 'Copy code'}>
                <IconButton aria-label="Copy code" size="sm" onClick={() => void handleCopy()}>
                  <Copy size={14} aria-hidden />
                </IconButton>
              </Tooltip>
              <Tooltip content="Run in playground (coming soon)">
                <IconButton aria-label="Run in playground" size="sm" disabled>
                  <Play size={14} aria-hidden />
                </IconButton>
              </Tooltip>
            </div>
            <pre className="solution-code" aria-label="Generated code">
              <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
            </pre>
          </div>

          {/* Action row: explain + alt */}
          <div
            style={{
              marginTop: 'var(--space-2)',
              display: 'flex',
              gap: 'var(--space-2)',
              flexWrap: 'wrap',
            }}
          >
            <Button variant="ghost" size="sm" onClick={handleExplain} disabled={isLoadingExplain}>
              {isLoadingExplain ? (
                <Spinner size="xs" />
              ) : (
                <AlignLeft size={13} style={{ marginRight: 5 }} aria-hidden />
              )}
              {showExplain ? 'Hide explanation' : 'Explain line-by-line'}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleAltApproach}>
              <GitBranch size={13} style={{ marginRight: 5 }} aria-hidden />
              {showAlt ? 'Hide alternative' : 'Alternative approach'}
            </Button>
          </div>

          {/* Line-by-line explanation panel */}
          {showExplain ? (
            <div
              className="solution-explain-panel"
              role="region"
              aria-label="Line-by-line explanation"
            >
              {lineExplanations.map((row, i) => (
                <div key={i} className="solution-explain-row">
                  <code className="solution-explain-row__line">{row.line}</code>
                  <span className="solution-explain-row__desc">{row.desc}</span>
                </div>
              ))}
            </div>
          ) : null}

          {/* Alt approach under code tab too */}
          {showAlt ? (
            <div className="solution-alt-panel" role="region" aria-label="Alternative approach">
              <p className="solution-alt-panel__title">Alternative approach</p>
              <p className="solution-alt-panel__body">{altApproach}</p>
            </div>
          ) : null}
        </TabsContent>

        {/* ── Tests tab ── */}
        <TabsContent value="tests">
          {testCases.length > 0 ? (
            <div>
              {testCases.map((tc, i) => (
                <div key={`tc-${i}`} className="solution-test-row">
                  {tc.description ? (
                    <>
                      <span className="solution-test-row__label">Case</span>
                      <span>{tc.description}</span>
                    </>
                  ) : null}
                  {tc.input !== undefined ? (
                    <>
                      <span className="solution-test-row__label">Input</span>
                      <code>{tc.input}</code>
                    </>
                  ) : null}
                  {tc.expected !== undefined ? (
                    <>
                      <span className="solution-test-row__label">Expected</span>
                      <code>{tc.expected}</code>
                    </>
                  ) : null}
                  {tc.output !== undefined ? (
                    <>
                      <span className="solution-test-row__label">Output</span>
                      <code>{tc.output}</code>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="solution-tests-empty">
              <EmptyState
                title="No test cases generated"
                description="Run the solver again or enable the test generator to populate this tab."
              />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}
