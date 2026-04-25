import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
}

export function Spinner({ size = 'md', className, ...rest }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('ui-spinner', `ui-spinner--${size}`, className)}
      {...rest}
    />
  );
}
