/**
 * The draft-event broadcaster: per-league sets of SSE writers. Draft
 * mutations publish the refreshed draft view; every connected client — web or
 * mobile — receives the same server truth within one tick.
 */
export type SseClient = (event: string, data: unknown) => void;

export class Broadcaster {
  private readonly clients = new Map<string, Set<SseClient>>();

  /** Registers a writer for a league; returns the unsubscribe function. */
  subscribe(leagueId: string, client: SseClient): () => void {
    const set = this.clients.get(leagueId) ?? new Set<SseClient>();
    set.add(client);
    this.clients.set(leagueId, set);
    return () => {
      set.delete(client);
      if (set.size === 0) this.clients.delete(leagueId);
    };
  }

  publish(leagueId: string, event: string, data: unknown): void {
    for (const client of this.clients.get(leagueId) ?? []) {
      client(event, data);
    }
  }

  /** Publishes to every league with subscribers — the ticker's clock ticks. */
  publishAll(event: string, data: unknown): void {
    for (const leagueId of this.clients.keys()) {
      this.publish(leagueId, event, data);
    }
  }

  /** True when at least one client is watching the league. */
  hasSubscribers(leagueId: string): boolean {
    return (this.clients.get(leagueId)?.size ?? 0) > 0;
  }
}
