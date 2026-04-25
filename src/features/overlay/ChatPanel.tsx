/**
 * ChatPanel — redesigned streaming chat panel for the overlay.
 * Features: token-by-token reveal, inline code-block copy, STAR-mode badge,
 * question echo strip, aria-live streaming region.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { KeyboardEvent } from 'react';
import { Copy, Send } from 'lucide-react';
import { Badge, IconButton, Spinner, Textarea, Tooltip } from '../../components/ui';
import type { BadgeVariant } from '../../components/ui';
import { cn } from '../../lib/cn';
import { logger } from '../../lib/logger';
import type { AIChatOverlayHandle } from './AIChatOverlay';

// Re-export the handle type so OverlayWindow can ref this panel too
export type { AIChatOverlayHandle };

type QuestionType =
  | 'factual'
  | 'pricing'
  | 'technical'
  | 'objection'
  | 'behavioral'
  | 'system-design'
  | 'coding'
  | 'hr'
  | 'other'
  | null;

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
};

type Props = {
  question: string | null;
  questionType: QuestionType;
  onSend?: (prompt: string, opts?: { onChunk?: (c: string) => void }) => Promise<string>;
};

// STAR-mode display map
const MODE_BADGE: Record<string, { variant: BadgeVariant; label: string }> = {
  behavioral: { variant: 'violet', label: 'Behavioral (STAR)' },
  'system-design': { variant: 'blue', label: 'System Design' },
  technical: { variant: 'ok', label: 'Coding' },
  factual: { variant: 'gold', label: 'Factual' },
  pricing: { variant: 'gold', label: 'Pricing' },
  objection: { variant: 'warn', label: 'Objection' },
  other: { variant: 'neutral', label: 'General' },
};

function createId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function defaultSend(
  prompt: string,
  opts?: { onChunk?: (c: string) => void },
): Promise<string> {
  const { callLlmWithKnowledgeContext } = await import('../../lib/tauri');
  return callLlmWithKnowledgeContext(prompt, opts);
}

/**
 * Very lightweight inline markdown renderer.
 * Handles: code blocks, inline code, bold, links.
 * Each text token gets .chat-token-reveal for the fade-in animation
 * giving a token-by-token streaming appearance.
 */
function renderMarkdown(text: string, streaming?: boolean): React.ReactNode[] {
  // Split on fenced code blocks first
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      const firstNewline = part.indexOf('\n');
      const lang = firstNewline > 3 ? part.slice(3, firstNewline).trim() : '';
      const code = firstNewline > 0 ? part.slice(firstNewline + 1, -3) : part.slice(3, -3);
      return <CodeBlock key={i} lang={lang} code={code} />;
    }
    // Inline formatting: bold, inline-code
    const inlineNodes: React.ReactNode[] = [];
    let remaining = part;
    let key = 0;
    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.*?)\*\*/);
      const codeMatch = remaining.match(/`([^`]+)`/);
      const candidates = [boldMatch, codeMatch]
        .filter(Boolean)
        .sort((a, b) => (a!.index ?? Infinity) - (b!.index ?? Infinity));
      const first = candidates[0];
      if (!first) {
        // For streaming messages, each word gets a reveal animation
        if (streaming) {
          const words = remaining.split(/(\s+)/);
          words.forEach((word, wi) => {
            inlineNodes.push(
              <span
                key={`${key++}-w${wi}`}
                className={word.trim() ? 'chat-token-reveal' : undefined}
              >
                {word}
              </span>,
            );
          });
        } else {
          inlineNodes.push(<span key={key++}>{remaining}</span>);
        }
        break;
      }
      const idx = first.index!;
      if (idx > 0) {
        inlineNodes.push(<span key={key++}>{remaining.slice(0, idx)}</span>);
      }
      if (first === boldMatch) {
        inlineNodes.push(<strong key={key++}>{first[1]}</strong>);
      } else {
        inlineNodes.push(
          <code
            key={key++}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.88em',
              background: 'var(--surface-2)',
              padding: '1px 4px',
              borderRadius: 3,
            }}
          >
            {first[1]}
          </code>,
        );
      }
      remaining = remaining.slice(idx + first[0].length);
    }
    return <span key={i}>{inlineNodes}</span>;
  });
}

/**
 * Memoized rendered markdown for an assistant bubble.
 * Memoizing here avoids re-running the regex/split pipeline for unchanged
 * messages when sibling streaming bubbles update on every token. For the
 * actively streaming bubble, content changes per token but useMemo still
 * skips work driven by parent re-renders unrelated to content.
 */
function MarkdownBubble({ content, streaming }: { content: string; streaming?: boolean }) {
  const rendered = useMemo(() => renderMarkdown(content, streaming), [content, streaming]);
  return <>{rendered}</>;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
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

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      /* silent */
    }
  }
  return (
    <div className="chat-code-block">
      <Tooltip content={copied ? 'Copied!' : 'Copy code'}>
        <div className="chat-code-block__copy">
          <IconButton aria-label="Copy code block" size="sm" onClick={() => void handleCopy()}>
            <Copy size={12} aria-hidden />
          </IconButton>
        </div>
      </Tooltip>
      <pre>
        {lang ? (
          <span
            style={{
              fontSize: '10px',
              color: 'var(--text-muted)',
              display: 'block',
              marginBottom: 4,
            }}
          >
            {lang}
          </span>
        ) : null}
        <code>{code}</code>
      </pre>
    </div>
  );
}

export const ChatPanel = forwardRef<AIChatOverlayHandle, Props>(function ChatPanel(
  { question, questionType, onSend = defaultSend },
  ref,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focusInput: () => textareaRef.current?.focus(),
  }));

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = conversationRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || isSending) return;
    setDraft('');

    const userMsg: ChatMessage = { id: createId(), role: 'user', content: text };
    const assistantId = createId();
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
    setIsSending(true);

    try {
      let accumulated = '';
      await onSend(text, {
        onChunk: (chunk) => {
          accumulated += chunk;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: accumulated } : m)),
          );
        },
      });
      // Mark streaming complete
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
      );
    } catch (err) {
      logger.warn('chat-panel', 'send failed', { err: String(err) });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: 'Something went wrong. Please try again.', streaming: false }
            : m,
        ),
      );
    } finally {
      setIsSending(false);
    }
  }, [draft, isSending, onSend]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend().catch((err) => {
        logger.warn('chat-panel', 'handleSend (key) failed', { err: String(err) });
      });
    }
  }

  const modeMeta = questionType ? (MODE_BADGE[questionType] ?? MODE_BADGE.other) : null;

  return (
    <div className="chat-panel">
      {/* STAR-mode badge row */}
      {modeMeta ? (
        <div className="chat-mode-badge-row" aria-label="Question mode">
          <span className="chat-mode-badge-row__label">Mode</span>
          <Badge variant={modeMeta.variant} size="sm">
            {modeMeta.label}
          </Badge>
        </div>
      ) : null}

      {/* Question echo strip */}
      {question ? (
        <div className="chat-question-echo" title={question}>
          <strong>Q:</strong> {question}
        </div>
      ) : null}

      {/* Conversation */}
      <div
        ref={conversationRef}
        className={cn('chat-conversation', messages.length === 0 && 'chat-conversation--empty')}
        aria-live="polite"
        aria-label="AI conversation"
        role="log"
      >
        {messages.length === 0 ? (
          <p className="chat-empty">Ask the coach anything about this question…</p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={cn('chat-message', `chat-message--${msg.role}`)}>
              <div className={cn('chat-avatar', `chat-avatar--${msg.role}`)}>
                {msg.role === 'user' ? 'Y' : 'AI'}
              </div>
              <div
                className={cn(
                  'chat-bubble',
                  msg.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-assistant',
                  msg.streaming && 'chat-bubble--streaming',
                )}
              >
                {msg.role === 'assistant' ? (
                  <MarkdownBubble
                    content={msg.content}
                    {...(msg.streaming !== undefined ? { streaming: msg.streaming } : {})}
                  />
                ) : (
                  msg.content
                )}
                {msg.streaming && msg.content === '' ? (
                  <span className="typing-dots" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </span>
                ) : null}
              </div>
            </div>
          ))
        )}
        {isSending && messages[messages.length - 1]?.role !== 'assistant' ? (
          <div className="chat-message chat-message--assistant">
            <div className="chat-avatar chat-avatar--assistant">AI</div>
            <div className="chat-bubble chat-bubble-assistant">
              <span className="typing-dots" aria-hidden>
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Input area */}
      <div className="chat-input-area">
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the coach… (Enter to send)"
          disabled={isSending}
          aria-label="Chat message input"
          rows={1}
        />
        <Tooltip content="Send (Enter)">
          <IconButton
            aria-label="Send message"
            size="sm"
            onClick={() => void handleSend()}
            disabled={!draft.trim() || isSending}
          >
            {isSending ? <Spinner size="xs" /> : <Send size={14} aria-hidden />}
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
});
