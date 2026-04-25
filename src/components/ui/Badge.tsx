import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type BadgeVariant = 'neutral' | 'gold' | 'blue' | 'violet' | 'ok' | 'warn' | 'danger';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
}

export function Badge({
  variant = 'neutral',
  size = 'sm',
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn('ui-badge', `ui-badge--${variant}`, `ui-badge--${size}`, className)}
      {...rest}
    >
      {children}
    </span>
  );
}
