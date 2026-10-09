import type {
  DraftState,
  LeagueConfig,
  LeagueId,
  LedgerEntry,
  LineupSlot,
  ManagerId,
  PlayerCard,
  PlayerRef,
  Position,
  Schedule,
  SlotKey,
} from '@stakehouse/domain';
import {
  cents,
  createDraft,
  hash32,
  leagueId,
  managerId,
  mulberry32,
  parseLeagueConfig,
  playoffWeeks,
  record,
  resolveDeadline,
  roundRobinSchedule,
  startDraft,
  totalPicks,
} from '@stakehouse/domain';
import type { Rng } from '@stakehouse/domain';
import type { ManagerRecord } from '@stakehouse/persistence';

/**
 * The sandbox league: a fully played fiction, built once on first boot so no
 * screen is ever empty. Every move it records went through the real engines —
 * the draft through `resolveDeadline`'s guarded transitions, weeks 1–5
 * through `simulateWeek`, the ledger through `record`. Every instant is a
 * fixed constant (storage never reads a clock), so the whole league replays
 * byte-for-byte on any empty store.
 */

export const SANDBOX_LEAGUE_ID: LeagueId = leagueId('lg-sandbox');

/** Weeks already in the books — the league sits at week 6, mid-season. */
export const SANDBOX_WEEKS_SIMULATED = 5;

export const SANDBOX_SEAT_COUNT = 8;

const DRAFT_PICK_SECONDS = 60;
/** One second past the clock, every pick — autopicks always beat the buzzer. */
const DRAFT_PICK_GAP_MS = 61_000;
const COMMISSIONER_CREDIT_CENTS = 500;

const isoUtc = (year: number, month: number, day: number, hour: number, minute = 0): string =>
  new Date(Date.UTC(year, month - 1, day, hour, minute, 0)).toISOString();

/** When the sandbox league record says it was created. */
export const SANDBOX_CREATED_AT = isoUtc(2026, 8, 30, 12);
const T_DRAFT_START_MS = Date.UTC(2026, 7, 31, 12, 0, 0);

// ---------------------------------------------------------------------------
// Configuration and seats
// ---------------------------------------------------------------------------

/**
 * The sandbox league's shape: half-PPR, 9 starting slots per seat, 10-week
 * regular season with a 4-team bracket over the final two weeks, $25 demo
 * buy-in, payouts 50/30/20. Validated through the same zod schema a
 * commissioner's creation request goes through.
 */
export function sandboxLeagueConfig(): LeagueConfig {
  return parseLeagueConfig({
    name: 'The Stakehouse Sandbox',
    entryFeeCents: 2500,
    size: 8,
    roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
    scoring: {
      passYards: 0.04,
      passTd: 4,
      interception: -2,
      rushYards: 0.1,
      rushTd: 6,
      reception: 0.5,
      fumbleLost: -2,
      kicking: {
        fg: { '0-19': 3, '20-29': 3, '30-39': 4, '40-49': 5, '50+': 6 },
        extraPoint: 1,
      },
      defense: {
        sack: 1,
        takeaway: 2,
        td: 6,
        pointsAllowedBands: [
          [0, 12],
          [6, 7],
          [13, 4],
          [20, 1],
          [27, 0],
          [34, -1],
        ],
      },
    },
    regularSeasonWeeks: 10,
    playoffTeams: 4,
    payoutSplitPct: [50, 30, 20],
  });
}

export interface SandboxSeat {
  readonly id: ManagerId;
  readonly displayName: string;
  readonly isAi: boolean;
}

/**
 * Eight seats: two human placeholders (a visitor claims one of these later)
 * and six AI managers with table talk for names. Array order is join order.
 */
export const SANDBOX_SEATS: readonly SandboxSeat[] = [
  { id: managerId('mgr-ava'), displayName: 'Ava Whitfield', isAi: false },
  { id: managerId('mgr-roman'), displayName: 'Roman Castellano', isAi: false },
  { id: managerId('mgr-marge'), displayName: 'Marge "Two Beers" Kowalski', isAi: true },
  { id: managerId('mgr-dmitri'), displayName: 'Dmitri "The Ledger" Volkov', isAi: true },
  { id: managerId('mgr-wes'), displayName: 'Coach Wes Halloway', isAi: true },
  { id: managerId('mgr-greta'), displayName: 'Greta "Full Pot" Emerson', isAi: true },
  { id: managerId('mgr-bernard'), displayName: 'Bernard "Blind Bet" Cho', isAi: true },
  { id: managerId('mgr-sol'), displayName: 'Sol "Straight Cash" Meridian', isAi: true },
];

/** The seats as manager records — joined the hour before the buy-ins land. */
export function sandboxManagers(): ManagerRecord[] {
  return SANDBOX_SEATS.map((seat, index) => ({
    id: seat.id,
    leagueId: SANDBOX_LEAGUE_ID,
    displayName: seat.displayName,
    isAi: seat.isAi,
    joinedAt: isoUtc(2026, 8, 30, 11, index),
  }));
}

// ---------------------------------------------------------------------------
// Draft — every pick through the engine's own transitions
// ---------------------------------------------------------------------------

/** Fisher–Yates over a copy — deterministic under a seeded rng. */
function seededShuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}

/**
 * Run the sandbox draft to completion through the real engine: a
 * deterministic seat order, then autopick on every turn — the clock expires
 * and `resolveDeadline` answers with best-available (the board is ranked, so
 * board order is need-filtered value). This is exactly how AI managers draft;
 * unclaimed human seats play the same way.
 */
export function runSandboxDraft(config: LeagueConfig, board: readonly PlayerRef[]): DraftState {
  const order = seededShuffle(
    SANDBOX_SEATS.map((seat) => seat.id),
    mulberry32(hash32(`${SANDBOX_LEAGUE_ID}:draft-order`)),
  );
  let state = startDraft(
    createDraft({
      order,
      slots: config.roster,
      pickSeconds: DRAFT_PICK_SECONDS,
      board,
    }),
    T_DRAFT_START_MS,
  );
  const total = totalPicks(state);
  for (let pick = 1; state.picks.length < total; pick++) {
    const advanced = resolveDeadline(state, {}, T_DRAFT_START_MS + pick * DRAFT_PICK_GAP_MS);
    if (advanced === state) {
      throw new Error('sandbox draft stalled — the pick clock did not advance');
    }
    state = advanced;
  }
  if (state.status !== 'complete') {
    throw new Error(`sandbox draft ended as ${state.status} with ${state.picks.length} picks`);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Starters — the engine's slot accounting, replayed
// ---------------------------------------------------------------------------

const FLEX_ELIGIBLE: readonly Position[] = ['RB', 'WR', 'TE'];

/**
 * Turn a finished draft into starting lineups: each seat's picks in pick
 * order, each placed in its exact position slot while one is open, else
 * FLEX — the same accounting the engine's roster guard used to admit the
 * pick, so the replay can never fail.
 */
export function startersFromDraft(
  draft: DraftState,
  players: Readonly<Record<string, PlayerCard>>,
  roster: Record<SlotKey, number>,
): Record<ManagerId, readonly LineupSlot[]> {
  const lineups = new Map<string, LineupSlot[]>();
  const used = new Map<string, Record<SlotKey, number>>();
  const zeroed = (): Record<SlotKey, number> => ({
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    FLEX: 0,
    K: 0,
    DEF: 0,
  });
  for (const pick of draft.picks) {
    const card = players[pick.playerId];
    if (!card) {
      throw new Error(`drafted player ${pick.playerId} is not in the player universe`);
    }
    const key = String(pick.managerId);
    const counts = used.get(key) ?? zeroed();
    const lineup = lineups.get(key) ?? [];
    if (counts[card.position] < roster[card.position]) {
      counts[card.position] += 1;
      lineup.push({ slot: card.position, playerId: card.id });
    } else if (FLEX_ELIGIBLE.includes(card.position) && counts.FLEX < roster.FLEX) {
      counts.FLEX += 1;
      lineup.push({ slot: 'FLEX', playerId: card.id });
    } else {
      throw new Error(`player ${card.id} cannot fit ${key}'s roster — draft replay diverged`);
    }
    used.set(key, counts);
    lineups.set(key, lineup);
  }
  const starters: Record<string, readonly LineupSlot[]> = Object.fromEntries(lineups);
  if (Object.keys(starters).length !== SANDBOX_SEAT_COUNT) {
    throw new Error('the draft left a seat without a roster');
  }
  return starters;
}

// ---------------------------------------------------------------------------
// Schedule and ledger
// ---------------------------------------------------------------------------

/**
 * The round-robin regular season, drawn by the season engine and stored on
 * the league record — the weeks after the seeder's sims (then the bracket)
 * stay playable. Length matches `simulateSeason`'s expectation exactly.
 */
export function sandboxSchedule(config: LeagueConfig): Schedule {
  const regularWeeks = config.regularSeasonWeeks - playoffWeeks(config.playoffTeams);
  return roundRobinSchedule(
    SANDBOX_SEATS.map((seat) => seat.id),
    regularWeeks,
    SANDBOX_LEAGUE_ID,
  );
}

/**
 * The money story of opening week: every seat pays the buy-in, and the
 * commissioner drops a promo credit into the pool. Built through `record`,
 * so sign and shape rules hold; ids are sequential; the balance is derived
 * from these entries alone.
 */
export function sandboxLedgerEntries(config: LeagueConfig): LedgerEntry[] {
  let entries: LedgerEntry[] = [];
  SANDBOX_SEATS.forEach((seat, index) => {
    entries = record(entries, {
      leagueId: SANDBOX_LEAGUE_ID,
      kind: 'buy-in',
      managerId: seat.id,
      amountCents: config.entryFeeCents,
      memo: `sandbox buy-in — ${seat.displayName}`,
      at: isoUtc(2026, 8, 30, 12, index),
    });
  });
  entries = record(entries, {
    leagueId: SANDBOX_LEAGUE_ID,
    kind: 'commissioner-credit',
    managerId: null,
    amountCents: cents(COMMISSIONER_CREDIT_CENTS),
    memo: 'commissioner promo — season-opening credit',
    at: isoUtc(2026, 8, 30, 13),
  });
  return entries;
}
