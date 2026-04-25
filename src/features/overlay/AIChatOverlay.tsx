import './aiChat.css';
import './chat.css';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { IconButton, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { logger } from '../../lib/logger';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type SendOptions = { onChunk?: (chunk: string) => void };

type AIChatOverlayProps = {
  onSend?: (prompt: string, options?: SendOptions) => Promise<string>;
  /** When true, renders at 100% width/height of its parent (no inner titlebar). */
  embedded?: boolean;
};

export type AIChatOverlayHandle = {
  focusInput: () => void;
};

function createMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function defaultSend(prompt: string, options?: SendOptions): Promise<string> {
  const { callLlmWithKnowledgeContext } = await import('../../lib/tauri');
  return callLlmWithKnowledgeContext(prompt, options);
}

export const AIChatOverlay = forwardRef<AIChatOverlayHandle, AIChatOverlayProps>(
  function AIChatOverlay({ onSend = defaultSend, embedded = false }, ref) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [draft, setDraft] = useState('');
    const [isSending, setIsSending] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const conversationRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      focusInput: () => {
        textareaRef.current?.focus();
      },
    }));

    // Auto-scroll to bottom on new message content.
    useEffect(() => {
      const node = conversationRef.current;
      if (!node) return;
      node.scrollTop = node.scrollHeight;
    }, [messages]);

    const handleSubmit = useCallback(async () => {
      const prompt = draft.trim();
      if (!prompt || isSending) return;

      setDraft('');
      setIsSending(true);
      setMessages((current) => [
        ...current,
        { id: createMessageId(), role: 'user', content: prompt },
      ]);

      try {
        const assistantId = createMessageId();
        setMessages((current) => [...current, { id: assistantId, role: 'assistant', content: '' }]);

        const response = await onSend(prompt, {
          onChunk: (chunk) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: `${message.content}${chunk}` }
                  : message,
              ),
            );
          },
        });

        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, content: message.content || response }
              : message,
          ),
        );
      } catch (err) {
        logger.warn('ai-chat-overlay', 'send failed', { err: String(err) });
        setMessages((current) => [
          ...current,
          {
            id: createMessageId(),
            role: 'assistant',
            content: 'The assistant could not reach the configured LLM endpoint.',
          },
        ]);
      } finally {
        setIsSending(false);
      }
    }, [draft, isSending, onSend]);

    function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        handleSubmit().catch((err) => {
          logger.warn('ai-chat-overlay', 'handleSubmit (key) failed', { err: String(err) });
        });
      }
    }

    return (
      <section
        className={cn('chat-wrap', embedded && 'chat-wrap--embedded')}
        aria-label="AI assistant"
      >
        {!embedded ? (
          <header className="chat-titlebar">
            <div>
              <p className="eyebrow">AI assistant</p>
              <h2>Meeting support</h2>
            </div>
            <span>{isSending ? 'Thinking' : 'Ready'}</span>
          </header>
        ) : null}

        <div
          ref={conversationRef}
          className={cn('chat-conversation', messages.length === 0 && 'chat-conversation--empty')}
          aria-live="polite"
        >
          {messages.length > 0 ? (
            messages.map((message) => (
              <article
                key={message.id}
                className={cn(
                  'chat-message',
                  message.role === 'user' ? 'chat-message--user' : 'chat-message--assistant',
                )}
                aria-label={message.role === 'user' ? 'You said' : 'Assistant said'}
              >
                <span
                  className={cn(
                    'chat-avatar',
                    message.role === 'user' ? 'chat-avatar--user' : 'chat-avatar--assistant',
                  )}
                  aria-hidden
                >
                  {message.role === 'user' ? 'YOU' : 'AI'}
                </span>
                {message.role === 'assistant' && !message.content && isSending ? (
                  <span className="chat-bubble chat-bubble-assistant">
                    <span className="typing-dots" aria-label="Assistant is typing">
                      <span />
                      <span />
                      <span />
                    </span>
                  </span>
                ) : (
                  <p
                    className={cn(
                      'chat-bubble',
                      message.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-assistant',
                    )}
                  >
                    {message.content}
                  </p>
                )}
              </article>
            ))
          ) : (
            <p className="chat-empty">
              Ask for help with meeting context. Prefix with <code>#kb</code> to search your
              knowledge base.
            </p>
          )}
        </div>

        <div className="chat-input-area">
          <Textarea
            ref={textareaRef}
            autoResize
            rows={1}
            placeholder="Ask anything… (Ctrl+Enter to send)"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Chat message"
          />
          <IconButton
            aria-label="Send message"
            variant="primary"
            onClick={() => {
              handleSubmit().catch((err) => {
                logger.warn('ai-chat-overlay', 'handleSubmit (click) failed', { err: String(err) });
              });
            }}
            disabled={isSending || !draft.trim()}
          >
            <Send size={14} aria-hidden />
          </IconButton>
        </div>
      </section>
    );
  },
);
