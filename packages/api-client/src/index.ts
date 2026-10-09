import { leagueConfigSchema } from '@stakehouse/domain';
import type { LeagueConfig } from '@stakehouse/domain';
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
};

const leagueViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  config: leagueConfigSchema,
  seatsFilled: z.number().int().nonnegative(),
  poolCents: z.number().int(),
});

export type LedgerEntryView = {
  id: string;
  kind: string;
  managerId: string | null;
  amountCents: number;
  memo: string;
  at: string;
};

const ledgerEntrySchema = z.object({
  id: z.string(),
  kind: z.string(),
  managerId: z.string().nullable(),
  amountCents: z.number().int(),
  memo: z.string(),
  at: z.string(),
});

export type PayBuyInResult = {
  simulated: true;
  entry: LedgerEntryView;
  poolCents: number;
};

/**
 * The buy-in receipt must still admit the checkout is simulated — a server
 * that stops saying so fails at this boundary, before any UI can render it.
 */
const payBuyInResultSchema = z.object({
  simulated: z.literal(true),
  entry: ledgerEntrySchema,
  poolCents: z.number().int(),
});

export type ApiErrorDetail = { path: string; message: string };

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
  getLedger(leagueId: string): Promise<{ entries: LedgerEntryView[]; poolCents: number }>;
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
      return parsed.leagues;
    },

    async createLeague(config: LeagueConfig): Promise<LeagueView> {
      // The same schema the server parses — garbage fails locally, offline.
      const body = leagueConfigSchema.parse(config);
      const response = await request('/api/leagues', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const parsed = await parseBody(response, z.object({ league: leagueViewSchema }));
      return parsed.league;
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

    async getLedger(leagueId: string): Promise<{ entries: LedgerEntryView[]; poolCents: number }> {
      const response = await request(`/api/leagues/${leagueId}/ledger`, { method: 'GET' });
      return parseBody(
        response,
        z.object({ entries: z.array(ledgerEntrySchema), poolCents: z.number().int() }),
      );
    },
  };
}
