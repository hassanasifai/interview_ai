import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div className={cn('ui-empty', className)} {...rest}>
      {icon ? <div className="ui-empty__icon">{icon}</div> : null}
      <h3 className="ui-empty__title">{title}</h3>
      {description ? <p className="ui-empty__description">{description}</p> : null}
      {action ? <div className="ui-empty__action">{action}</div> : null}
    </div>
  );
}
