import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  value: T;
  onChange: (next: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
  'aria-label'?: string;
}

export function SegmentedControl<T extends string = string>({
  value,
  onChange,
  options,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('ui-segmented', className)}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={opt.disabled}
            data-active={active}
            className="ui-segmented-option"
            onClick={() => !opt.disabled && onChange(opt.value)}
          >
            {opt.icon ? <span aria-hidden>{opt.icon}</span> : null}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
