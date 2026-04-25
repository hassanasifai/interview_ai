import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { IconButton } from './IconButton';
import { toastStore } from './useToast';
import type { ToastRecord } from './useToast';

export interface ToastViewportProps {
  className?: string;
}

export function ToastViewport({ className }: ToastViewportProps) {
  const snap = useSyncExternalStore(
    toastStore.subscribe,
    toastStore.getSnapshot,
    toastStore.getSnapshot,
  );
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      className={cn('ui-toast-viewport', className)}
    >
      {snap.toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  );
}

interface ToastItemProps {
  toast: ToastRecord;
}

function ToastItem({ toast }: ToastItemProps) {
  return (
    <div
      role="status"
      data-state={toast.state}
      className={cn('ui-toast', `ui-toast--${toast.variant}`)}
    >
      <div className="ui-toast__body">
        <span className="ui-toast__title">{toast.title}</span>
        {toast.description ? (
          <span className="ui-toast__description">{toast.description}</span>
        ) : null}
      </div>
      <IconButton
        aria-label="Dismiss notification"
        variant="ghost"
        size="sm"
        className="ui-toast__close"
        onClick={() => toastStore.dismiss(toast.id)}
      >
        <X size={14} aria-hidden />
      </IconButton>
    </div>
  );
}
