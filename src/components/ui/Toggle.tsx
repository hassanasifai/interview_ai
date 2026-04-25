import { useId } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type ToggleSize = 'sm' | 'md';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  size?: ToggleSize;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  size = 'md',
  disabled = false,
  className,
  id,
  'aria-label': ariaLabel,
}: ToggleProps) {
  const reactId = useId();
  const toggleId = id ?? reactId;

  function handleKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange(!checked);
    }
  }

  return (
    <label
      htmlFor={toggleId}
      className={cn('ui-toggle', disabled && 'ui-toggle--disabled', className)}
    >
      <button
        type="button"
        id={toggleId}
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        data-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        onKeyDown={handleKey}
        className={cn('ui-toggle-track', `ui-toggle-track--${size}`)}
      >
        <span className="ui-toggle-thumb" />
      </button>
      {(label || hint) && (
        <span className="ui-toggle-text">
          {label ? <span className="ui-toggle-text__label">{label}</span> : null}
          {hint ? <span className="ui-toggle-text__hint">{hint}</span> : null}
        </span>
      )}
    </label>
  );
}
