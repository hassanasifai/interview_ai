import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode, MouseEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { IconButton } from './IconButton';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    document.body.classList.add('ui-scroll-lock');

    // Focus first focusable child or the dialog
    const frame = requestAnimationFrame(() => {
      const el = dialogRef.current;
      if (!el) return;
      const focusables = el.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        el.focus();
      }
    });

    return () => {
      cancelAnimationFrame(frame);
      document.body.classList.remove('ui-scroll-lock');
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !closeOnEscape) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab') {
        const el = dialogRef.current;
        if (!el) return;
        const focusables = Array.from(
          el.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((n) => !n.hasAttribute('disabled'));
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [open, closeOnEscape, onClose]);

  const handleBackdropClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!closeOnBackdrop) return;
      if (e.target === e.currentTarget) onClose();
    },
    [closeOnBackdrop, onClose],
  );

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="ui-dialog-backdrop" onMouseDown={handleBackdropClick} role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cn('ui-dialog', className)}
      >
        <div className="ui-dialog__header">
          <div className="ui-dialog__titles">
            <h2 className="ui-dialog__title">{title}</h2>
            {description ? <p className="ui-dialog__description">{description}</p> : null}
          </div>
          {showCloseButton ? (
            <IconButton
              aria-label="Close dialog"
              variant="ghost"
              size="sm"
              className="ui-dialog__close"
              onClick={onClose}
            >
              <X size={16} aria-hidden />
            </IconButton>
          ) : null}
        </div>
        {children ? <div className="ui-dialog__body">{children}</div> : null}
        {footer ? <div className="ui-dialog__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
