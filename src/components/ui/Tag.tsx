import type { HTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  onRemove?: () => void;
  removeLabel?: string;
}

export function Tag({ onRemove, removeLabel = 'Remove', className, children, ...rest }: TagProps) {
  return (
    <span className={cn('ui-tag', !onRemove && 'ui-tag--no-remove', className)} {...rest}>
      <span>{children}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          className="ui-tag__remove"
          onClick={onRemove}
        >
          <X size={12} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
