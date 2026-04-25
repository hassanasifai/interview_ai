import { useSyncExternalStore } from 'react';

export type ToastVariant = 'info' | 'success' | 'warn' | 'danger';

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
}

export interface ToastRecord {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  durationMs: number;
  createdAt: number;
  state: 'enter' | 'exit';
}

interface ToastStore {
  toasts: ToastRecord[];
}

type Listener = () => void;

const DEFAULT_DURATION = 4000;
const EXIT_DURATION = 240;

let state: ToastStore = { toasts: [] };
const listeners = new Set<Listener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  for (const l of listeners) l();
}

function setState(next: ToastStore) {
  state = next;
  emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ToastStore {
  return state;
}

function makeId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function dismiss(id: string): void {
  const existing = state.toasts.find((t) => t.id === id);
  if (!existing) return;
  if (existing.state === 'exit') return;
  setState({
    toasts: state.toasts.map((t) => (t.id === id ? { ...t, state: 'exit' } : t)),
  });
  const removeTimer = setTimeout(() => {
    setState({ toasts: state.toasts.filter((t) => t.id !== id) });
    timers.delete(id);
  }, EXIT_DURATION);
  timers.set(id, removeTimer);
}

function show(input: ToastInput): string {
  const id = makeId();
  const record: ToastRecord = {
    id,
    title: input.title,
    ...(input.description !== undefined ? { description: input.description } : {}),
    variant: input.variant ?? 'info',
    durationMs: input.durationMs ?? DEFAULT_DURATION,
    createdAt: Date.now(),
    state: 'enter',
  };
  setState({ toasts: [...state.toasts, record] });
  if (record.durationMs > 0) {
    const t = setTimeout(() => dismiss(id), record.durationMs);
    timers.set(id, t);
  }
  return id;
}

export interface UseToastReturn {
  show: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  toasts: ToastRecord[];
}

export function useToast(): UseToastReturn {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { show, dismiss, toasts: snap.toasts };
}

// Exports for the viewport component
export const toastStore = {
  subscribe,
  getSnapshot,
  show,
  dismiss,
};
