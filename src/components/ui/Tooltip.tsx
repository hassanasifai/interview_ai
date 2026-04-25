import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: ReactNode;
  side?: TooltipSide;
  children: ReactNode;
  className?: string;
}

export function Tooltip({ content, side = 'top', children, className }: TooltipProps) {
  return (
    <span className={cn('ui-tooltip-wrap', className)}>
      {children}
      <span role="tooltip" className={cn('ui-tooltip', `ui-tooltip--${side}`)}>
        {content}
      </span>
    </span>
  );
}
