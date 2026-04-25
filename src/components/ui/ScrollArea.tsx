import { forwardRef } from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  maxHeight?: string | number;
}

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  { maxHeight, className, style, children, ...rest },
  ref,
) {
  const mergedStyle: CSSProperties = {
    maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight,
    ...style,
  };
  return (
    <div ref={ref} className={cn('ui-scroll-area', className)} style={mergedStyle} {...rest}>
      {children}
    </div>
  );
});
