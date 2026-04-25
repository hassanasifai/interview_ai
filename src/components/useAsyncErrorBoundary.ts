import { useState } from 'react';

/**
 * G3: bridge async/promise errors into the nearest React error boundary.
 *
 * Usage:
 *   const throwAsync = useAsyncErrorBoundary()
 *   try { await foo() } catch (e) { throwAsync(e) }
 */
export function useAsyncErrorBoundary() {
  const [error, setError] = useState<Error | null>(null);
  if (error) {
    throw error;
  }
  return (e: unknown) => {
    setError(e instanceof Error ? e : new Error(String(e)));
  };
}
