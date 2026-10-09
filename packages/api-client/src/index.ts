import { leagueConfigSchema } from '@stakehouse/domain';
import type { LeagueConfig, Position } from '@stakehouse/domain';
import { z } from 'zod';

/**
 * @stakehouse/api-client — the one typed client every Stakehouse frontend
 * (web and mobile) uses for server calls. It adds no server behavior: each
 * method's URL, method, body, and response shape mirrors apps/web/src/server,
 * and every response is zod-parsed before it reaches a screen.
 */

export type SessionInput = { displayName: string; email: string };

/** Same rules the server's sessionSchema applies (trim, 1..80 chars, email). */
export const sessionInputSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'display name is required')
    .max(80, 'display name is too long (max 80)'),
  email: z.string().trim().email('enter a valid email'),
});

export type ManagerView = {
  id: string;
  displayName: string;
  isAi: boolean;
  joinedAt: string;
};

const managerSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  isAi: z.boolean(),
  joinedAt: z.string(),
});

export type LeagueView = {
  id: string;
  name: string;
  createdAt: string;
  config: LeagueConfig;
  seatsFilled: number;
  poolCents: number;
  /** Who holds the commissioner's key — null when the league has none yet. */
  commissionerEmail: string | null;
  /** The instant the league was cancelled, if it was — the books stay readable. */
  cancelledAt: string | null;
};

const leagueViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  config: leagueConfigSchema,
  seatsFilled: z.number().int().nonnegative(),
  poolCents: z.number().int(),
  commissionerEmail: z.string().nullish(),
  cancelledAt: z.string().nullish(),
});

export type LedgerEntryView = {
  id: string;
  kind: string;
  managerId: string | null;
  amountCents: number;
  memo: string;
  at: string;
  /** The server-derived pool balance after this entry — absent on single-entry receipts. */
  balanceAfterCents?: number;
};

const ledgerEntrySchema = z.object({
  id: z.string(),
  kind: z.string(),
  managerId: z.string().nullable(),
  amountCents: z.number().int(),
  memo: z.string(),
  at: z.string(),
  balanceAfterCents: z.number().int().optional(),
});

/** A seat in the books: who it is and the net it holds in the pool. */
export type SeatView = { id: string; displayName: string; paidCents: number };

const seatSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  paidCents: z.number().int(),
});

export type PayBuyInResult = {
  simulated: true;
  entry: LedgerEntryView;
  poolCents: number;
};

/** Nullish wire fields arrive as one honest null — screens never see undefined. */
function toLeagueView(league: z.infer<typeof leagueViewSchema>): LeagueView {
  return {
    ...league,
    commissionerEmail: league.commissionerEmail ?? null,
    cancelledAt: league.cancelledAt ?? null,
  };
}

/**
 * The buy-in receipt must still admit the checkout is simulated — a server
 * that stops saying so fails at this boundary, before any UI can render it.
 */
const payBuyInResultSchema = z.object({
  simulated: z.literal(true),
  entry: ledgerEntrySchema,
  poolCents: z.number().int(),
});

export type CreditPoolInput = { amountCents: number; memo?: string };
export type CreditPoolResult = { entry: LedgerEntryView; poolCents: number };
export type RefundSeatResult = { entry: LedgerEntryView; poolCents: number };
export type CancelLeagueResult = {
  refunds: LedgerEntryView[];
  poolCents: number;
  cancelledAt: string;
};

const creditPoolInputSchema = z.object({
  amountCents: z.number().int().positive(),
  memo: z.string().max(200).optional(),
});

const moneyDeskResultSchema = z.object({ entry: ledgerEntrySchema, poolCents: z.number().int() });

const cancelLeagueResultSchema = z.object({
  refunds: z.array(ledgerEntrySchema),
  poolCents: z.number().int(),
  cancelledAt: z.string(),
});

export type DistributePayoutsResult = { entries: LedgerEntryView[]; poolCents: number };

const distributePayoutsResultSchema = z.object({
  entries: z.array(ledgerEntrySchema),
  poolCents: z.number().int(),
});

export type ApiErrorDetail = { path: string; message: string };

// ---------------------------------------------------------------------------
// Draft contract — every shape mirrors apps/web/src/server/draftView.ts and
// the draft routes, so one parser serves the board, the stream, and the
// mutation responses.
// ---------------------------------------------------------------------------

export type DraftStatus = 'pending' | 'live' | 'complete';

export type DraftPickView = {
  overall: number;
  managerId: string;
  playerId: string;
  at: string;
};

const draftPickSchema = z.object({
  overall: z.number().int(),
  managerId: z.string(),
  playerId: z.string(),
  at: z.string(),
});

/** A seat in the draft room — names the seat that is deciding, per spec. */
export type DraftSeatView = { id: string; displayName: string; isAi: boolean };

const draftSeatSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  isAi: z.boolean(),
});

export type BoardEntryView = {
  playerId: string;
  position: Position;
  name: string;
  projectedPoints: number;
};

const positionSchema = z.enum(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

const boardEntrySchema = z.object({
  playerId: z.string(),
  position: positionSchema,
  name: z.string(),
  projectedPoints: z.number(),
});

export type RosterSlotView = { playerId: string; position: Position; slot: string };

const rosterSlotSchema = z.object({
  playerId: z.string(),
  position: positionSchema,
  slot: z.string(),
});

export type DraftClockView = {
  overall: number | null;
  managerId: string | null;
  deadline: number | null;
};

const draftClockSchema = z.object({
  overall: z.number().int().nullable(),
  managerId: z.string().nullable(),
  deadline: z.number().nullable(),
});

export type DraftView = {
  status: DraftStatus;
  order: string[];
  picks: DraftPickView[];
  pickSeconds: number;
  board: BoardEntryView[];
  clock: DraftClockView;
  rosters: Record<string, RosterSlotView[]>;
  queues: Record<string, { queue: string[]; autopick: boolean }>;
  seats: DraftSeatView[];
};

export const draftViewSchema = z.object({
  status: z.enum(['pending', 'live', 'complete']),
  order: z.array(z.string()),
  picks: z.array(draftPickSchema),
  pickSeconds: z.number().int(),
  board: z.array(boardEntrySchema),
  clock: draftClockSchema,
  rosters: z.record(z.string(), z.array(rosterSlotSchema)),
  queues: z.record(z.string(), z.object({ queue: z.array(z.string()), autopick: z.boolean() })),
  seats: z.array(draftSeatSchema),
});

export type PlayerCardView = { id: string; name: string; position: Position };

const playerCardViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: positionSchema,
});

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

/** The one error type clients handle: server envelope, validation, or network. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[] | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: ApiErrorDetail[],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ClientOptions {
  /** Prepended to every path; empty for same-origin (dev proxy) callers. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface StakehouseClient {
  signIn(input: SessionInput): Promise<SessionInput>;
  listLeagues(): Promise<LeagueView[]>;
  createLeague(config: LeagueConfig): Promise<LeagueView>;
  joinLeague(leagueId: string): Promise<ManagerView>;
  payBuyIn(leagueId: string): Promise<PayBuyInResult>;
  getLedger(
    leagueId: string,
  ): Promise<{ entries: LedgerEntryView[]; poolCents: number; seats: SeatView[] }>;
  /** The live draft board: picks, rosters, queues, clock, and seats. */
  getDraft(leagueId: string): Promise<DraftView>;
  /** Commissioner: start a full, paid league's draft. */
  startDraft(leagueId: string): Promise<DraftView>;
  /** The guarded on-the-clock pick; rejects with the server's reason. */
  postPick(leagueId: string, playerId: string): Promise<{ pick: DraftPickView; draft: DraftView }>;
  /** Persist my queue order (seat-scoped by the session server-side). */
  putQueue(leagueId: string, queue: string[]): Promise<{ queue: string[] }>;
  /** Resolve an expired clock now — queue top else best available. */
  postAutopick(leagueId: string): Promise<{ autopicked: DraftPickView; draft: DraftView }>;
  /** Commissioner: cascade every remaining pick to the recap. */
  postFastForward(leagueId: string): Promise<{ fastForwarded: number; draft: DraftView }>;
  /** The player universe — names for boards, queues, and recaps. */
  listPlayers(params?: { q?: string; pos?: string }): Promise<PlayerCardView[]>;
  /** Commissioner: simulate the next regular-season week. */
  simulateNextWeek(leagueId: string): Promise<{ week: number; seasonComplete: boolean }>;
  /** Subscribe to the live draft stream (SSE) against the client's own origin. */
  openDraftStream(leagueId: string, handlers: DraftStreamHandlers): DraftStream;
  /** Commissioner: credit the pool with a house-level entry. */
  creditPool(leagueId: string, input: CreditPoolInput): Promise<CreditPoolResult>;
  /** Commissioner: refund a seat's positive remaining net. */
  refundSeat(leagueId: string, managerId: string): Promise<RefundSeatResult>;
  /** Commissioner: cancel the league, refunding every paid seat's net. */
  cancelLeague(leagueId: string): Promise<CancelLeagueResult>;
  /** Commissioner: distribute the pool per the configured split. */
  distributePayouts(leagueId: string): Promise<DistributePayoutsResult>;
}

export function createClient(options: ClientOptions = {}): StakehouseClient {
  const baseUrl = options.baseUrl ?? '';
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...init.headers },
        ...init,
      });
    } catch (cause) {
      throw new ApiError(0, 'network-error', `network failure calling ${path}`, undefined, {
        cause,
      });
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as unknown;
      const envelope = errorEnvelopeSchema.safeParse(body);
      if (envelope.success) {
        throw new ApiError(
          response.status,
          envelope.data.error.code,
          envelope.data.error.message,
          envelope.data.error.details,
        );
      }
      throw new ApiError(response.status, 'unknown-error', `${response.status} calling ${path}`);
    }
    return response;
  }

  async function parseBody<S extends z.ZodTypeAny>(
    response: Response,
    schema: S,
  ): Promise<z.infer<S>> {
    const json = (await response.json().catch(() => null)) as unknown;
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(
        response.status,
        'invalid-response',
        'response failed schema validation',
        undefined,
        { cause: parsed.error },
      );
    }
    return parsed.data;
  }

  return {
    async signIn(input: SessionInput): Promise<SessionInput> {
      // Validate before the network so bad input never leaves the device.
      const body = sessionInputSchema.parse(input);
      const response = await request('/api/session', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const parsed = await parseBody(
        response,
        z.object({ user: z.object({ displayName: z.string(), email: z.string() }) }),
      );
      return parsed.user;
    },

    async listLeagues(): Promise<LeagueView[]> {
      const response = await request('/api/leagues', { method: 'GET' });
      const parsed = await parseBody(response, z.object({ leagues: z.array(leagueViewSchema) }));
      return parsed.leagues.map(toLeagueView);
    },

    async createLeague(config: LeagueConfig): Promise<LeagueView> {
      // The same schema the server parses — garbage fails locally, offline.
      const body = leagueConfigSchema.parse(config);
      const response = await request('/api/leagues', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const parsed = await parseBody(response, z.object({ league: leagueViewSchema }));
      return toLeagueView(parsed.league);
    },

    async joinLeague(leagueId: string): Promise<ManagerView> {
      const response = await request(`/api/leagues/${leagueId}/join`, { method: 'POST' });
      const parsed = await parseBody(response, z.object({ manager: managerSchema }));
      return parsed.manager;
    },

    async payBuyIn(leagueId: string): Promise<PayBuyInResult> {
      const response = await request(`/api/leagues/${leagueId}/pay`, { method: 'POST' });
      return parseBody(response, payBuyInResultSchema);
    },

    async getLedger(
      leagueId: string,
    ): Promise<{ entries: LedgerEntryView[]; poolCents: number; seats: SeatView[] }> {
      const response = await request(`/api/leagues/${leagueId}/ledger`, { method: 'GET' });
      return parseBody(
        response,
        z.object({
          entries: z.array(ledgerEntrySchema),
          poolCents: z.number().int(),
          seats: z.array(seatSchema),
        }),
      );
    },

    async getDraft(leagueId: string): Promise<DraftView> {
      const response = await request(`/api/leagues/${leagueId}/draft`, { method: 'GET' });
      const parsed = await parseBody(response, z.object({ draft: draftViewSchema }));
      return parsed.draft;
    },

    async startDraft(leagueId: string): Promise<DraftView> {
      const response = await request(`/api/leagues/${leagueId}/draft/start`, { method: 'POST' });
      const parsed = await parseBody(response, z.object({ draft: draftViewSchema }));
      return parsed.draft;
    },

    async postPick(
      leagueId: string,
      playerId: string,
    ): Promise<{ pick: DraftPickView; draft: DraftView }> {
      const response = await request(`/api/leagues/${leagueId}/draft/pick`, {
        method: 'POST',
        body: JSON.stringify({ playerId }),
      });
      return parseBody(response, z.object({ pick: draftPickSchema, draft: draftViewSchema }));
    },

    async putQueue(leagueId: string, queue: string[]): Promise<{ queue: string[] }> {
      const response = await request(`/api/leagues/${leagueId}/draft/queue`, {
        method: 'PUT',
        body: JSON.stringify({ queue }),
      });
      return parseBody(response, z.object({ queue: z.array(z.string()) }));
    },

    async postAutopick(leagueId: string): Promise<{ autopicked: DraftPickView; draft: DraftView }> {
      const response = await request(`/api/leagues/${leagueId}/draft/autopick`, {
        method: 'POST',
      });
      return parseBody(response, z.object({ autopicked: draftPickSchema, draft: draftViewSchema }));
    },

    async postFastForward(leagueId: string): Promise<{ fastForwarded: number; draft: DraftView }> {
      const response = await request(`/api/leagues/${leagueId}/draft/fast-forward`, {
        method: 'POST',
      });
      return parseBody(
        response,
        z.object({ fastForwarded: z.number().int(), draft: draftViewSchema }),
      );
    },

    async listPlayers(params?: { q?: string; pos?: string }): Promise<PlayerCardView[]> {
      const search = new URLSearchParams();
      if (params?.q) search.set('q', params.q);
      if (params?.pos) search.set('pos', params.pos);
      const suffix = search.toString();
      const response = await request(`/api/players${suffix ? `?${suffix}` : ''}`, {
        method: 'GET',
      });
      const parsed = await parseBody(
        response,
        z.object({ players: z.array(playerCardViewSchema), total: z.number().int() }),
      );
      return parsed.players;
    },

    async simulateNextWeek(leagueId: string): Promise<{ week: number; seasonComplete: boolean }> {
      const response = await request(`/api/leagues/${leagueId}/simulate`, { method: 'POST' });
      return parseBody(response, z.object({ week: z.number().int(), seasonComplete: z.boolean() }));
    },

    openDraftStream(leagueId: string, handlers: DraftStreamHandlers): DraftStream {
      // The stream rides the client's own origin — same cookies, same base.
      return openDraftStream({ baseUrl, leagueId, fetchImpl }, handlers);
    },

    async creditPool(leagueId: string, input: CreditPoolInput): Promise<CreditPoolResult> {
      // Garbage fails locally, offline — the same discipline as createLeague.
      const body = creditPoolInputSchema.parse(input);
      const response = await request(`/api/leagues/${leagueId}/ledger/credit`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return parseBody(response, moneyDeskResultSchema);
    },

    async refundSeat(leagueId: string, managerId: string): Promise<RefundSeatResult> {
      const response = await request(`/api/leagues/${leagueId}/ledger/refund`, {
        method: 'POST',
        body: JSON.stringify({ managerId }),
      });
      return parseBody(response, moneyDeskResultSchema);
    },

    async cancelLeague(leagueId: string): Promise<CancelLeagueResult> {
      const response = await request(`/api/leagues/${leagueId}/cancel`, { method: 'POST' });
      return parseBody(response, cancelLeagueResultSchema);
    },

    async distributePayouts(leagueId: string): Promise<DistributePayoutsResult> {
      const response = await request(`/api/leagues/${leagueId}/ledger/payouts/distribute`, {
        method: 'POST',
      });
      return parseBody(response, distributePayoutsResultSchema);
    },
  };
}

// ---------------------------------------------------------------------------
// The live draft stream. The server's SSE endpoint carries the same payload
// as GET /draft (`draft` events) plus clock heartbeats (`clock` events) —
// one parser serves both transports. Read over fetch so the session cookie
// rides along and any transport failure surfaces as onDown, where the
// caller's polling fallback takes over.
// ---------------------------------------------------------------------------

export interface DraftStreamHandlers {
  onDraft(draft: DraftView): void;
  onClock(atMs: number): void;
  /** The stream is down — contract/transport error, or a clean server close. */
  onDown(reason: 'error' | 'ended'): void;
}

export interface DraftStreamOptions {
  baseUrl?: string;
  leagueId: string;
  fetchImpl?: typeof fetch;
}

export interface DraftStream {
  close(): void;
}

export function openDraftStream(
  options: DraftStreamOptions,
  handlers: DraftStreamHandlers,
): DraftStream {
  const controller = new AbortController();
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? '';

  void (async () => {
    try {
      const response = await fetchImpl(`${baseUrl}/api/leagues/${options.leagueId}/draft/stream`, {
        credentials: 'include',
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!response.ok || response.body === null) {
        handlers.onDown('error');
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const accepted = handleStreamBlock(buffer.slice(0, boundary), handlers);
          buffer = buffer.slice(boundary + 2);
          if (!accepted) {
            // Contract break — stop trusting this stream; the caller falls
            // back to polling. Exactly one onDown per stream.
            handlers.onDown('error');
            return;
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
      handlers.onDown('ended');
    } catch {
      // An abort is the caller's own close(); anything else is transport failure.
      if (!controller.signal.aborted) handlers.onDown('error');
    }
  })();

  return { close: () => controller.abort() };
}

/** Returns false when the block breaks the contract and the stream must die. */
function handleStreamBlock(block: string, handlers: DraftStreamHandlers): boolean {
  let event = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (event === 'draft') {
    try {
      const parsed = draftViewSchema.safeParse((JSON.parse(data) as { draft: unknown }).draft);
      // A malformed payload is a contract break: say so, then let the
      // fallback take over — never render an unvalidated view.
      if (parsed.success) {
        handlers.onDraft(parsed.data);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  if (event === 'clock') {
    try {
      const at = (JSON.parse(data) as { at?: unknown }).at;
      if (typeof at === 'number') handlers.onClock(at);
    } catch {
      // A heartbeat that cannot be parsed carries nothing actionable.
    }
  }
  return true;
}
