import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { logger } from '../../lib/logger';

export type DraggablePosition = { x: number; y: number };

export interface UseDraggableOptions {
  /** Initial position when Tauri native drag is not available. */
  initialPosition?: DraggablePosition;
  /** If true, skip calling `setPosition` — the caller manages it (useful when Tauri is driving). */
  disableFallback?: boolean;
}

export interface UseDraggableReturn {
  position: DraggablePosition;
  setPosition: (p: DraggablePosition) => void;
  /**
   * Attach to the element you want to use as a drag handle (e.g. the titlebar).
   * It'll prefer `await getCurrentWindow().startDragging()` (Tauri) and fall back
   * to pointer-based CSS translate drag for web/dev contexts.
   */
  onPointerDownHandle: (event: ReactMouseEvent<HTMLElement>) => void;
  /** Whether the last detected drag surface is Tauri-native (read-only). */
  isNativeDrag: boolean;
}

/**
 * Shared helper for dragging floating overlay cards.
 *
 * Tauri v2 exposes `getCurrentWindow().startDragging()` which is frame-perfect
 * and respects OS window semantics. In non-Tauri environments (Vite dev, tests)
 * we fall back to a pointermove-based CSS translate drag on the passed ref.
 */
export function useDraggable(
  shellRef: RefObject<HTMLElement | null>,
  options: UseDraggableOptions = {},
): UseDraggableReturn {
  const { initialPosition = { x: 0, y: 0 }, disableFallback = false } = options;
  const [position, setPosition] = useState<DraggablePosition>(initialPosition);
  const [isNativeDrag, setIsNativeDrag] = useState(false);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const handleMove = useCallback((event: MouseEvent) => {
    const state = dragStateRef.current;
    if (!state) return;
    setPosition({
      x: state.originX + event.clientX - state.startX,
      y: state.originY + event.clientY - state.startY,
    });
  }, []);

  // mouseup uses { once: true } so it self-removes; we only need to cleanup
  // the mousemove listener here. This avoids handleUp self-reference.
  const handleUp = useCallback(() => {
    dragStateRef.current = null;
    window.removeEventListener('mousemove', handleMove);
  }, [handleMove]);

  useEffect(
    () => () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    },
    [handleMove, handleUp],
  );

  const onPointerDownHandle = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      // Don't start a drag if the user clicked an interactive control inside the handle.
      const target = event.target as HTMLElement | null;
      if (target && target.closest('button, a, input, textarea, [role="tab"], [data-no-drag]')) {
        return;
      }

      // Preferred path: Tauri native drag.
      (async () => {
        try {
          const mod = await import('@tauri-apps/api/window');
          if (typeof mod.getCurrentWindow === 'function') {
            const win = mod.getCurrentWindow();
            await win.startDragging();
            setIsNativeDrag(true);
            return;
          }
        } catch (err) {
          logger.warn('use-draggable', 'native drag unavailable; using CSS fallback', {
            err: String(err),
          });
        }

        if (disableFallback) return;

        setIsNativeDrag(false);
        dragStateRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          originX: position.x,
          originY: position.y,
        };
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp, { once: true });
      })().catch((err) => {
        logger.warn('use-draggable', 'drag handler IIFE failed', { err: String(err) });
      });

      // Prevent text selection while dragging.
      if (shellRef.current) {
        event.preventDefault();
      }
    },
    [disableFallback, handleMove, handleUp, position.x, position.y, shellRef],
  );

  return {
    position,
    setPosition,
    onPointerDownHandle,
    isNativeDrag,
  };
}
