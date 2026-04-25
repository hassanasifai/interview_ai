import type { CSSProperties, HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type SkeletonVariant = 'text' | 'box';

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  width?: number | string;
  height?: number | string;
  rounded?: boolean | string;
  variant?: SkeletonVariant;
}

function toSize(v: number | string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'number' ? `${v}px` : v;
}

export function Skeleton({
  width,
  height,
  rounded,
  variant = 'box',
  className,
  style,
  ...rest
}: SkeletonProps) {
  const resolvedRadius =
    rounded === true ? 'var(--radius-pill)' : typeof rounded === 'string' ? rounded : undefined;
  const mergedStyle: CSSProperties = {
    width: toSize(width),
    height: toSize(height),
    borderRadius: resolvedRadius,
    ...style,
  };
  return (
    <span
      aria-hidden
      className={cn('ui-skeleton', `ui-skeleton--${variant}`, className)}
      style={mergedStyle}
      {...rest}
    />
  );
}
