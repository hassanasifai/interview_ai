import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type DividerOrientation = 'horizontal' | 'vertical';

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: DividerOrientation;
}

export function Divider({ orientation = 'horizontal', className, ...rest }: DividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn('ui-divider', `ui-divider--${orientation}`, className)}
      {...rest}
    />
  );
}
