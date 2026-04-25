import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { TextareaHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  autoResize?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, autoResize = false, id, className, rows = 4, onChange, value, ...rest },
  ref,
) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(ref, () => localRef.current as HTMLTextAreaElement, []);

  const reactId = `textarea-${Math.random().toString(36).slice(2, 9)}`;
  const textareaId = id ?? reactId;
  const hintId = hint ? `${textareaId}-hint` : undefined;
  const errorId = error ? `${textareaId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  useEffect(() => {
    if (!autoResize) return;
    const el = localRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [autoResize, value]);

  return (
    <div className="ui-field">
      {label ? (
        <label htmlFor={textareaId} className="ui-field__label">
          {label}
        </label>
      ) : null}
      <textarea
        ref={localRef}
        id={textareaId}
        rows={rows}
        value={value}
        onChange={(e) => {
          if (autoResize) {
            const t = e.currentTarget;
            t.style.height = 'auto';
            t.style.height = `${t.scrollHeight}px`;
          }
          onChange?.(e);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn('ui-textarea', error ? 'ui-textarea--error' : null, className)}
        {...rest}
      />
      {error ? (
        <span id={errorId} className="ui-field__error">
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className="ui-field__hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
});
