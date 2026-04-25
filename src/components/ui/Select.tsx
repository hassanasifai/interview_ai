import { forwardRef, useId } from 'react';
import type { SelectHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  options: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, id, className, ...rest },
  ref,
) {
  const reactId = useId();
  const selectId = id ?? reactId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="ui-field">
      {label ? (
        <label htmlFor={selectId} className="ui-field__label">
          {label}
        </label>
      ) : null}
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn('ui-select', error ? 'ui-select--error' : null, className)}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
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
