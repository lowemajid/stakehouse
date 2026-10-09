import type { LeagueId, ManagerId } from './brand';
import { DomainError } from './errors';
import type { LeagueConfig } from './leagueConfig';
import { standardNormal, weekRng } from './rng';
import { integerStatLine, POINTS_SCALE, pointsAllowedBonusScaled, scoreLineScaled } from './scoring';
import type { Position, Projection, StatLine } from './scoring';

// weekRng stays part of the simulation surface — the spec names it here.
export { weekRng };

// ---------------------------------------------------------------------------
// Players and lineups
// ---------------------------------------------------------------------------

export interface PlayerCard {
  id: string;
  name: string;
  position: Position;
  /** Expected counting stats for one week — the float means the draw starts from. */
  projection: Projection;
  /** Relative spread of the draw (0 repeats the projection exactly). */
  variance: number;
}

export type SlotPosition = Position | 'FLEX';

export interface LineupSlot {
  slot: SlotPosition;
  playerId: string;
}

const SLOT_ELIGIBILITY: Record<SlotPosition, readonly Position[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
};

const SLOT_ORDER: Record<SlotPosition, number> = {
  QB: 0,
  RB: 1,
  WR: 2,
  TE: 3,
  FLEX: 4,
  K: 5,
  DEF: 6,
};

// ---------------------------------------------------------------------------
// Week simulation
// ---------------------------------------------------------------------------

export interface SimMatchup {
  home: ManagerId;
  away: ManagerId;
}

/**
 * The simulation-facing view of a league for one week: configuration, the
 * week's head-to-head pairings, each manager's starting lineup, and the
 * player universe to draw from. Bench players never draw — only starters do.
 */
export interface SimLeague {
  id: LeagueId;
  config: LeagueConfig;
  pairings: readonly SimMatchup[];
  starters: Readonly<Record<ManagerId, readonly LineupSlot[]>>;
  players: Readonly<Record<string, PlayerCard>>;
}

export interface PlayerLine {
  playerId: string;
  name: string;
  position: Position;
  slot: SlotPosition;
  stats: StatLine;
  points: number;
}

export interface BoxScore {
  managerId: ManagerId;
  /** Team total, exact — summed in integer milli-points, divided once. */
  total: number;
  lines: PlayerLine[];
}

export interface SimGame {
  home: ManagerId;
  away: ManagerId;
  homeBox: BoxScore;
  awayBox: BoxScore;
}

export interface WeekResult {
  week: number;
  games: SimGame[];
}

/**
 * Draw one player's week stat line: each projected stat moves by normal
 * noise scaled by the player's variance. The draw itself stays raw; the
 * assembled line passes through `integerStatLine` — the engine-side integer
 * contract — before it can exist, so the validator always accepts the
 * engine's own output. Stats projected at zero never draw (and consume no
 * randomness). The FG record is rebuilt with sorted band keys so the output
 * byte-stream cannot depend on input key order.
 */
export function drawStatLine(player: PlayerCard, leagueId: string, week: number): StatLine {
  if (!Number.isFinite(player.variance) || player.variance < 0) {
    throw new DomainError(
      'invalid-stat-line',
      `player ${player.id} variance must be a finite non-negative number, got ${player.variance}`,
    );
  }
  const rng = weekRng(leagueId, week, player.id);
  // Raw (float) draw. Zero projections draw nothing and consume no
  // randomness — the RNG stream depends on identity, not on who is benched.
  const jitter = (expected: number): number =>
    expected > 0 ? expected + standardNormal(rng) * player.variance * expected : 0;
  const fgMade: Record<string, number> = {};
  for (const band of Object.keys(player.projection.fgMade).sort()) {
    fgMade[band] = jitter(player.projection.fgMade[band] ?? 0);
  }
  return integerStatLine({
    passYards: jitter(player.projection.passYards),
    passTd: jitter(player.projection.passTd),
    interceptions: jitter(player.projection.interceptions),
    rushYards: jitter(player.projection.rushYards),
    rushTd: jitter(player.projection.rushTd),
    receptions: jitter(player.projection.receptions),
    fumblesLost: jitter(player.projection.fumblesLost),
    fgMade,
    extraPointsMade: jitter(player.projection.extraPointsMade),
    sacks: jitter(player.projection.sacks),
    takeaways: jitter(player.projection.takeaways),
    defensiveTd: jitter(player.projection.defensiveTd),
    pointsAllowed: jitter(player.projection.pointsAllowed),
  });
}

function assertPairings(pairings: readonly SimMatchup[]): void {
  const seen = new Set<ManagerId>();
  for (const pairing of pairings) {
    if (pairing.home === pairing.away) {
      throw new DomainError('invalid-matchup', `manager ${pairing.home} cannot play itself`);
    }
    for (const manager of [pairing.home, pairing.away]) {
      if (seen.has(manager)) {
        throw new DomainError(
          'invalid-matchup',
          `manager ${manager} appears in two matchups for one week`,
        );
      }
      seen.add(manager);
    }
  }
}

function assertNoSharedPlayers(league: SimLeague): void {
  const owner = new Map<string, ManagerId>();
  for (const pairing of league.pairings) {
    for (const manager of [pairing.home, pairing.away]) {
      for (const entry of league.starters[manager] ?? []) {
        const priorOwner = owner.get(entry.playerId);
        if (priorOwner !== undefined) {
          throw new DomainError(
            'invalid-lineup',
            `player ${entry.playerId} is fielded by both ${priorOwner} and ${manager}`,
          );
        }
        owner.set(entry.playerId, manager);
      }
    }
  }
}

function boxFor(league: SimLeague, manager: ManagerId, week: number): BoxScore {
  const lineup = league.starters[manager];
  if (!lineup) {
    throw new DomainError(
      'invalid-lineup',
      `manager ${manager} has no starting lineup for week ${week}`,
    );
  }
  const counts = {} as Record<SlotPosition, number>;
  for (const entry of lineup) {
    counts[entry.slot] = (counts[entry.slot] ?? 0) + 1;
  }
  for (const slot of Object.keys(SLOT_ORDER) as SlotPosition[]) {
    if ((counts[slot] ?? 0) !== league.config.roster[slot]) {
      throw new DomainError(
        'invalid-lineup',
        `manager ${manager} fields ${counts[slot] ?? 0} ${slot} slots but the roster config wants ${league.config.roster[slot]}`,
      );
    }
  }
  const seen = new Set<string>();
  const lines: PlayerLine[] = [];
  let totalMilli = 0;
  for (const entry of lineup) {
    if (seen.has(entry.playerId)) {
      throw new DomainError(
        'invalid-lineup',
        `player ${entry.playerId} appears twice in ${manager}'s lineup`,
      );
    }
    seen.add(entry.playerId);
    const card = league.players[entry.playerId];
    if (!card) {
      throw new DomainError(
        'invalid-lineup',
        `player ${entry.playerId} in ${manager}'s lineup is not in the player universe`,
      );
    }
    if (!SLOT_ELIGIBILITY[entry.slot].includes(card.position)) {
      throw new DomainError(
        'invalid-lineup',
        `${card.position} ${entry.playerId} cannot fill a ${entry.slot} slot`,
      );
    }
    const stats = drawStatLine(card, league.id, week);
    // Points-allowed bands score only on the defense slot; everywhere else
    // the field is ignored by design (see StatLine).
    const milli =
      scoreLineScaled(stats, league.config.scoring) +
      (entry.slot === 'DEF'
        ? pointsAllowedBonusScaled(stats.pointsAllowed, league.config.scoring)
        : 0);
    totalMilli += milli;
    lines.push({
      playerId: card.id,
      name: card.name,
      position: card.position,
      slot: entry.slot,
      stats,
      points: milli / POINTS_SCALE,
    });
  }
  // Canonical order: box scores must not depend on the lineup's input order.
  lines.sort(
    (a, b) =>
      SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] ||
      (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
  );
  return { managerId: manager, total: totalMilli / POINTS_SCALE, lines };
}

/**
 * Simulate one week: draw every starter's stat line from seeded randomness,
 * score it under the league's exact rules, and pair the matchups into box
 * scores. Pure and deterministic — the same league and week always return
 * byte-identical results, whatever order the inputs arrive in.
 */
export function simulateWeek(league: SimLeague, week: number): WeekResult {
  assertPairings(league.pairings);
  assertNoSharedPlayers(league);
  const games = league.pairings.map((pairing) => ({
    home: pairing.home,
    away: pairing.away,
    homeBox: boxFor(league, pairing.home, week),
    awayBox: boxFor(league, pairing.away, week),
  }));
  return { week, games };
}
