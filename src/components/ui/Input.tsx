import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type InputSize = 'sm' | 'md';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  size?: InputSize;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leadingIcon, trailingIcon, size = 'md', id, className, ...rest },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? reactId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="ui-field">
      {label ? (
        <label htmlFor={inputId} className="ui-field__label">
          {label}
        </label>
      ) : null}
      <div className="ui-input-wrap">
        {leadingIcon ? (
          <span className="ui-input__affix ui-input__affix--leading">{leadingIcon}</span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'ui-input',
            `ui-input--${size}`,
            leadingIcon ? 'ui-input--has-leading' : null,
            trailingIcon ? 'ui-input--has-trailing' : null,
            error ? 'ui-input--error' : null,
            className,
          )}
          {...rest}
        />
        {trailingIcon ? (
          <span className="ui-input__affix ui-input__affix--trailing">{trailingIcon}</span>
        ) : null}
      </div>
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
