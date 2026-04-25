import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent, ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface CommandItem {
  id: string;
  label: string;
  hint?: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  group?: string;
  keywords?: string[];
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
  placeholder?: string;
  emptyMessage?: ReactNode;
  className?: string;
}

interface FlatEntry {
  type: 'group' | 'item';
  group?: string;
  item?: CommandItem;
}

function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  // substring fast path
  if (t.includes(q)) return true;
  // character-sequence fallback
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    while (ti < t.length && t[ti] !== c) ti++;
    if (ti >= t.length) return false;
    ti++;
  }
  return true;
}

export function CommandPalette({
  open,
  onClose,
  items,
  placeholder = 'Type a command or search…',
  emptyMessage = 'No results.',
  className,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Filter + group
  const { filtered, flat, itemEntries } = useMemo(() => {
    const matches = items.filter((it) => {
      const haystack = [it.label, it.group ?? '', ...(it.keywords ?? [])].join(' ');
      return fuzzyMatch(query, haystack);
    });
    const groupsMap = new Map<string, CommandItem[]>();
    for (const m of matches) {
      const g = m.group ?? '';
      const arr = groupsMap.get(g) ?? [];
      arr.push(m);
      groupsMap.set(g, arr);
    }
    const flatList: FlatEntry[] = [];
    for (const [g, list] of groupsMap) {
      if (g) flatList.push({ type: 'group', group: g });
      for (const it of list) flatList.push({ type: 'item', item: it });
    }
    const onlyItems: CommandItem[] = flatList
      .filter(
        (e): e is FlatEntry & { type: 'item'; item: CommandItem } =>
          e.type === 'item' && e.item !== undefined,
      )
      .map((e) => e.item);
    return { filtered: matches, flat: flatList, itemEntries: onlyItems };
  }, [items, query]);

  // Reset on open
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- legitimate side effect: reset query/index AND apply DOM focus + scroll-lock when palette opens
      setQuery('');
      setActiveIndex(0);
      document.body.classList.add('ui-scroll-lock');
      const frame = requestAnimationFrame(() => inputRef.current?.focus());
      return () => {
        cancelAnimationFrame(frame);
        document.body.classList.remove('ui-scroll-lock');
      };
    }
    return;
  }, [open]);

  // Clamp activeIndex when filter narrows the list below the cursor.
  // Use a derived value at read sites instead of a setState-in-effect.
  const clampedActiveIndex = Math.min(activeIndex, Math.max(0, itemEntries.length - 1));

  const select = useCallback(
    (item: CommandItem) => {
      item.onSelect();
      onClose();
    },
    [onClose],
  );

  const onInputKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (itemEntries.length === 0 ? 0 : (i + 1) % itemEntries.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) =>
          itemEntries.length === 0 ? 0 : (i - 1 + itemEntries.length) % itemEntries.length,
        );
      } else if (e.key === 'Home') {
        e.preventDefault();
        setActiveIndex(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setActiveIndex(Math.max(0, itemEntries.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const target = itemEntries[clampedActiveIndex];
        if (target) select(target);
      }
    },
    [clampedActiveIndex, itemEntries, onClose, select],
  );

  // Scroll active into view
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${clampedActiveIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [clampedActiveIndex, open]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  let itemIdx = -1;

  return createPortal(
    <div className="ui-dialog-backdrop" role="presentation" onMouseDown={handleBackdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className={cn('ui-cmd', className)}
      >
        <div className="ui-cmd-input-wrap">
          <Search size={16} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="ui-cmd-listbox"
            aria-activedescendant={
              itemEntries[clampedActiveIndex]
                ? `ui-cmd-item-${itemEntries[clampedActiveIndex].id}`
                : undefined
            }
            value={query}
            placeholder={placeholder}
            className="ui-cmd-input"
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onInputKey}
          />
        </div>
        <div ref={listRef} id="ui-cmd-listbox" role="listbox" className="ui-cmd-list">
          {filtered.length === 0 ? (
            <div className="ui-cmd-empty">{emptyMessage}</div>
          ) : (
            flat.map((entry, i) => {
              if (entry.type === 'group') {
                return (
                  <div key={`g-${entry.group ?? ''}-${i}`} className="ui-cmd-group__label">
                    {entry.group}
                  </div>
                );
              }
              const item = entry.item;
              if (!item) return null;
              itemIdx += 1;
              const isActive = itemIdx === clampedActiveIndex;
              const thisIdx = itemIdx;
              return (
                <div
                  key={item.id}
                  id={`ui-cmd-item-${item.id}`}
                  role="option"
                  aria-selected={isActive}
                  data-index={thisIdx}
                  className="ui-cmd-item"
                  onMouseEnter={() => setActiveIndex(thisIdx)}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    select(item);
                  }}
                >
                  {item.icon ? <span className="ui-cmd-item__icon">{item.icon}</span> : null}
                  <span className="ui-cmd-item__label">{item.label}</span>
                  {item.hint ? <span className="ui-cmd-item__hint">{item.hint}</span> : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
