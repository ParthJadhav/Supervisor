import { useRef } from "react";

/**
 * Returns a stable object reference whose properties are kept in sync
 * with the latest values. The returned object identity never changes,
 * so it won't trigger effect re-runs or child re-renders when used
 * as a dependency or prop.
 *
 * Useful inside useEffect / event listeners that need latest values
 * without re-subscribing.
 */
export function useStable<T extends Record<string, any>>(value: T): T {
  const ref = useRef<T>(value);
  // Intentionally mutating during render for performance. This is safe because:
  // 1. Object.assign is idempotent with the same values
  // 2. The ref is not read during the same render cycle
  // 3. This avoids the overhead of useEffect for hot-path stability wrappers
  Object.assign(ref.current, value);
  return ref.current;
}
