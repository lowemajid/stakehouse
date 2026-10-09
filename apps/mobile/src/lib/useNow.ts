import { useEffect, useState } from 'react';

/**
 * Re-renders on an interval so countdowns recompute from the deadline. The
 * displayed value is always derived fresh from the server deadline — a
 * drifted interval can only make the display late, never wrong (spec:
 * the clock is server-owned; RN timers never accumulate elapsed time).
 */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
