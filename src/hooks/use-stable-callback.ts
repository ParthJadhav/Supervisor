import { useRef } from "react";

/**
 * Returns a stable function reference that always calls the latest version.
 * Prevents child re-renders caused by unstable callback references.
 *
 * Unlike useCallback, the returned reference never changes — but it always
 * invokes the most recent version of the passed function.
 */
export function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef<{ fn: T; stable?: T }>({ fn });
  ref.current.fn = fn;

  if (!ref.current.stable) {
    ref.current.stable = ((...args: any[]) =>
      ref.current.fn(...args)) as T;
  }

  return ref.current.stable;
}
