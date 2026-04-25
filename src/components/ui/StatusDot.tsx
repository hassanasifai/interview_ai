import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type StatusDotStatus = 'ok' | 'warn' | 'danger' | 'neutral' | 'info';

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  status: StatusDotStatus;
  label?: string;
}

export function StatusDot({ status, label, className, ...rest }: StatusDotProps) {
  return (
    <span className={cn('ui-status', `ui-status--${status}`, className)} {...rest}>
      <span className="ui-status__dot" aria-hidden />
      {label ? <span>{label}</span> : null}
    </span>
  );
}
