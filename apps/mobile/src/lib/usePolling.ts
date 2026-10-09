import { useEffect } from 'react';

/**
 * Small polling hook for reads that have no SSE stream yet (ledger, league
 * list). Runs `refresh` immediately and then on an interval while mounted —
 * no overlap: a slow response never stacks a second request.
 */
export function usePolling(refresh: () => void, intervalMs: number): void {
  useEffect(() => {
    refresh();
    let running = true;

    const tick = () => {
      if (running) refresh();
    };

    const timer = setInterval(tick, intervalMs);
    return () => {
      running = false;
      clearInterval(timer);
    };
    // The caller owns freshness; the interval is set once per mount.
  }, [intervalMs]);
}
