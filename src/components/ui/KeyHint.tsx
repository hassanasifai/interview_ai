import { Fragment } from 'react';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface KeyHintProps extends HTMLAttributes<HTMLSpanElement> {
  keys: string[];
}

export function KeyHint({ keys, className, ...rest }: KeyHintProps) {
  return (
    <span className={cn('ui-key-hint', className)} {...rest}>
      {keys.map((key, i) => (
        <Fragment key={`${key}-${i}`}>
          {i > 0 ? <span className="ui-key-hint__sep">+</span> : null}
          <kbd className="ui-key-hint__key">{key}</kbd>
        </Fragment>
      ))}
    </span>
  );
}
