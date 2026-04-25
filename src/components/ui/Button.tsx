import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    leadingIcon,
    trailingIcon,
    className,
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const spinnerSize = size === 'lg' ? 'sm' : 'xs';
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      className={cn('ui-button', `ui-button--${variant}`, `ui-button--${size}`, className)}
      {...rest}
    >
      {loading ? (
        <span className="ui-button__spinner">
          <Spinner size={spinnerSize} />
        </span>
      ) : leadingIcon ? (
        <span className="ui-button__icon ui-button__icon--leading">{leadingIcon}</span>
      ) : null}
      {children}
      {!loading && trailingIcon ? (
        <span className="ui-button__icon ui-button__icon--trailing">{trailingIcon}</span>
      ) : null}
    </button>
  );
});
