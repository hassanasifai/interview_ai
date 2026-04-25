import { createContext, useCallback, useContext, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
  registerTrigger: (value: string, el: HTMLButtonElement | null) => void;
  focusByOffset: (currentValue: string, delta: number) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`${component} must be used within <Tabs>`);
  }
  return ctx;
}

export interface TabsProps {
  defaultValue?: string;
  value?: string;
  onValueChange?: (v: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({
  defaultValue,
  value: controlledValue,
  onValueChange,
  children,
  className,
}: TabsProps) {
  const [internalValue, setInternalValue] = useState<string>(defaultValue ?? '');
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;
  const baseId = useId();
  const triggersRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const orderRef = useRef<string[]>([]);

  const registerTrigger = useCallback((v: string, el: HTMLButtonElement | null) => {
    const map = triggersRef.current;
    if (!el) {
      map.delete(v);
      orderRef.current = orderRef.current.filter((x) => x !== v);
    } else {
      map.set(v, el);
      if (!orderRef.current.includes(v)) orderRef.current.push(v);
    }
  }, []);

  const setValue = useCallback(
    (v: string) => {
      if (!isControlled) setInternalValue(v);
      onValueChange?.(v);
    },
    [isControlled, onValueChange],
  );

  const focusByOffset = useCallback(
    (currentValue: string, delta: number) => {
      const order = orderRef.current;
      if (order.length === 0) return;
      const idx = order.indexOf(currentValue);
      if (idx === -1) return;
      const nextIdx = (idx + delta + order.length) % order.length;
      const nextVal = order[nextIdx];
      const el = triggersRef.current.get(nextVal);
      if (el) {
        el.focus();
        setValue(nextVal);
      }
    },
    [setValue],
  );

  const ctx = useMemo<TabsContextValue>(
    () => ({ value, setValue, baseId, registerTrigger, focusByOffset }),
    [value, setValue, baseId, registerTrigger, focusByOffset],
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div className={cn('ui-tabs', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps {
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}

export function TabsList({ children, className, 'aria-label': ariaLabel }: TabsListProps) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('ui-tabs-list', className)}>
      {children}
    </div>
  );
}

export interface TabsTriggerProps {
  value: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function TabsTrigger({ value, children, className, disabled }: TabsTriggerProps) {
  const ctx = useTabsContext('TabsTrigger');
  const isActive = ctx.value === value;

  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      ctx.focusByOffset(value, 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      ctx.focusByOffset(value, -1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      ctx.focusByOffset(value, -9999);
    } else if (e.key === 'End') {
      e.preventDefault();
      ctx.focusByOffset(value, 9999);
    }
  }

  return (
    <button
      ref={(el) => ctx.registerTrigger(value, el)}
      type="button"
      role="tab"
      id={`${ctx.baseId}-trigger-${value}`}
      aria-controls={`${ctx.baseId}-content-${value}`}
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      data-state={isActive ? 'active' : 'inactive'}
      disabled={disabled}
      className={cn('ui-tabs-trigger', className)}
      onClick={() => ctx.setValue(value)}
      onKeyDown={onKey}
    >
      {children}
    </button>
  );
}

export interface TabsContentProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabsContent({ value, children, className }: TabsContentProps) {
  const ctx = useTabsContext('TabsContent');
  const isActive = ctx.value === value;
  if (!isActive) return null;
  return (
    <div
      role="tabpanel"
      id={`${ctx.baseId}-content-${value}`}
      aria-labelledby={`${ctx.baseId}-trigger-${value}`}
      tabIndex={0}
      className={cn('ui-tabs-content', className)}
    >
      {children}
    </div>
  );
}
