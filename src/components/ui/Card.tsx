import { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type CardVariant = 'default' | 'elevated' | 'subtle';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
  header?: ReactNode;
  footer?: ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = 'default', padding = 'md', header, footer, className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={cn('ui-card', `ui-card--${variant}`, className)} {...rest}>
      {header ? <div className="ui-card__header">{header}</div> : null}
      <div className={cn('ui-card__body', `ui-card__body--${padding}`)}>{children}</div>
      {footer ? <div className="ui-card__footer">{footer}</div> : null}
    </div>
  );
});
