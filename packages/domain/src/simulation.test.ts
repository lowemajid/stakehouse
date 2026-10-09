import { describe, expect, it } from 'vitest';
import { leagueId, managerId } from './brand';
import type { ManagerId } from './brand';
import { DomainError } from './errors';
import type { DomainErrorCode } from './errors';
import type { Position, StatLine } from './scoring';
import type { LeagueConfig, ScoringRules } from './leagueConfig';
import { cents } from './money';
import { drawStatLine, simulateWeek, weekRng } from './simulation';
import type { LineupSlot, PlayerCard, SimLeague, SlotPosition } from './simulation';

const rules: ScoringRules = {
  passYards: 0.04,
  passTd: 4,
  interception: -2,
  rushYards: 0.1,
  rushTd: 6,
  reception: 1,
  fumbleLost: -2,
  kicking: {
    fg: { '0-19': 3, '20-29': 3, '30-39': 3, '40-49': 4, '50-59': 5, '60+': 6 },
    extraPoint: 1,
  },
  defense: {
    sack: 1,
    takeaway: 2,
    td: 6,
    pointsAllowedBands: [
      [0, 10],
      [10, 7],
      [20, 3],
      [30, 1],
      [40, 0],
    ],
  },
};

const config: LeagueConfig = {
  name: 'Simulation League',
  entryFeeCents: cents(10000),
  size: 4,
  roster: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1, K: 1, DEF: 1 },
  scoring: rules,
  regularSeasonWeeks: 10,
  playoffTeams: 2,
  payoutSplitPct: [50, 30, 20],
};

const PROJECTIONS: Record<Position, StatLine> = {
  QB: {
    passYards: 265,
    passTd: 1.8,
    interceptions: 0.7,
    rushYards: 22,
    rushTd: 0.3,
    receptions: 0,
    fumblesLost: 0.2,
    fgMade: {},
    extraPointsMade: 0,
    sacks: 0,
    takeaways: 0,
    defensiveTd: 0,
    pointsAllowed: 0,
  },
  RB: {
    passYards: 0,
    passTd: 0,
    interceptions: 0,
    rushYards: 58,
    rushTd: 0.55,
    receptions: 3.2,
    fumblesLost: 0.15,
    fgMade: {},
    extraPointsMade: 0,
    sacks: 0,
    takeaways: 0,
    defensiveTd: 0,
    pointsAllowed: 0,
  },
  WR: {
    passYards: 0,
    passTd: 0,
    interceptions: 0,
    rushYards: 4,
    rushTd: 0.05,
    receptions: 5.1,
    fumblesLost: 0.1,
    fgMade: {},
    extraPointsMade: 0,
    sacks: 0,
    takeaways: 0,
    defensiveTd: 0,
    pointsAllowed: 0,
  },
  TE: {
    passYards: 0,
    passTd: 0,
    interceptions: 0,
    rushYards: 1,
    rushTd: 0.02,
    receptions: 3.4,
    fumblesLost: 0.1,
    fgMade: {},
    extraPointsMade: 0,
    sacks: 0,
    takeaways: 0,
    defensiveTd: 0,
    pointsAllowed: 0,
  },
  K: {
    passYards: 0,
    passTd: 0,
    interceptions: 0,
    rushYards: 0,
    rushTd: 0,
    receptions: 0,
    fumblesLost: 0,
    fgMade: { '20-29': 0.8, '30-39': 1.1, '40-49': 0.6, '50-59': 0.2 },
    extraPointsMade: 1.6,
    sacks: 0,
    takeaways: 0,
    defensiveTd: 0,
    pointsAllowed: 0,
  },
  DEF: {
    passYards: 0,
    passTd: 0,
    interceptions: 0,
    rushYards: 0,
    rushTd: 0,
    receptions: 0,
    fumblesLost: 0,
    fgMade: {},
    extraPointsMade: 0,
    sacks: 1.3,
    takeaways: 1.1,
    defensiveTd: 0.12,
    pointsAllowed: 21.5,
  },
};

const SLOTS: { key: string; position: Position; slot: SlotPosition }[] = [
  { key: 'qb', position: 'QB', slot: 'QB' },
  { key: 'rb', position: 'RB', slot: 'RB' },
  { key: 'wr', position: 'WR', slot: 'WR' },
  { key: 'te', position: 'TE', slot: 'TE' },
  { key: 'flex', position: 'WR', slot: 'FLEX' },
  { key: 'k', position: 'K', slot: 'K' },
  { key: 'def', position: 'DEF', slot: 'DEF' },
];

const VARIANCE = 0.35;
const LEAGUE_ID = 'lg_sim-demo';
const WEEK = 6;

function makeCard(id: string, position: Position): PlayerCard {
  return {
    id,
    name: id.replace('p_', '').replaceAll('_', ' '),
    position,
    projection: structuredClone(PROJECTIONS[position]),
    variance: VARIANCE,
  };
}

function makeLeague(): SimLeague {
  const players: Record<string, PlayerCard> = {};
  const starters: Record<ManagerId, LineupSlot[]> = {} as Record<ManagerId, LineupSlot[]>;
  for (const owner of ['alpha', 'bravo', 'charlie', 'delta']) {
    starters[managerId(`m_${owner}`)] = SLOTS.map(({ key, slot }) => ({
      slot,
      playerId: `p_${owner}_${key}`,
    }));
    for (const { key, position } of SLOTS) {
      players[`p_${owner}_${key}`] = makeCard(`p_${owner}_${key}`, position);
    }
  }
  // A short bench for alpha, used by the rejection tests as substitute cards.
  players['p_alpha_qb2'] = makeCard('p_alpha_qb2', 'QB');
  players['p_alpha_rb2'] = makeCard('p_alpha_rb2', 'RB');
  players['p_alpha_wr2'] = makeCard('p_alpha_wr2', 'WR');
  players['p_alpha_k2'] = makeCard('p_alpha_k2', 'K');
  return {
    id: leagueId(LEAGUE_ID),
    config,
    pairings: [
      { home: managerId('m_alpha'), away: managerId('m_bravo') },
      { home: managerId('m_charlie'), away: managerId('m_delta') },
    ],
    starters,
    players,
  };
}

function withLineup(league: SimLeague, owner: ManagerId, lineup: LineupSlot[]): SimLeague {
  return { ...league, starters: { ...league.starters, [owner]: lineup } };
}

function withPairings(league: SimLeague, pairings: SimLeague['pairings']): SimLeague {
  return { ...league, pairings };
}

function expectDomainError(fn: () => unknown, code: DomainErrorCode): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  if (!(caught instanceof DomainError)) {
    throw new Error(`expected DomainError[${code}], got ${String(caught)}`);
  }
  expect(caught.code).toBe(code);
}

describe('weekRng', () => {
  it('replays the identical stream for identical identity', () => {
    const first = weekRng(LEAGUE_ID, WEEK, 'p_alpha_qb');
    const second = weekRng(LEAGUE_ID, WEEK, 'p_alpha_qb');
    // Pinned stream values — the seeds are part of the determinism contract.
    expect(first()).toBe(0.4854661722201854);
    expect(first()).toBe(0.9988968577235937);
    expect(first()).toBe(0.30128891952335835);
    expect(second()).toBe(0.4854661722201854);
  });

  it('differs when any identity component differs', () => {
    const base = weekRng(LEAGUE_ID, WEEK, 'p_alpha_qb')();
    expect(weekRng(LEAGUE_ID, WEEK, 'p_alpha_rb')()).not.toBe(base);
    expect(weekRng(LEAGUE_ID, WEEK + 1, 'p_alpha_qb')()).not.toBe(base);
    expect(weekRng('lg_other', WEEK, 'p_alpha_qb')()).not.toBe(base);
  });
});

describe('drawStatLine', () => {
  it('pins the alpha quarterback week-6 line exactly', () => {
    const card = makeLeague().players['p_alpha_qb']!;
    expect(drawStatLine(card, LEAGUE_ID, WEEK)).toEqual({
      passYards: 372,
      passTd: 2,
      interceptions: 0,
      rushYards: 11,
      rushTd: 0,
      receptions: 0,
      fumblesLost: 0,
      fgMade: {},
      extraPointsMade: 0,
      sacks: 0,
      takeaways: 0,
      defensiveTd: 0,
      pointsAllowed: 0,
    });
  });

  it('never draws a negative or fractional stat', () => {
    const league = makeLeague();
    for (const card of Object.values(league.players)) {
      for (const week of [1, WEEK, WEEK + 1]) {
        const stats = drawStatLine(card, LEAGUE_ID, week);
        for (const value of Object.values(stats)) {
          for (const stat of typeof value === 'number' ? [value] : Object.values(value)) {
            expect(Number.isInteger(stat) && stat >= 0).toBe(true);
          }
        }
      }
    }
  });

  it('rejects a non-finite or negative variance', () => {
    const league = makeLeague();
    const card = league.players['p_alpha_qb']!;
    expectDomainError(
      () => drawStatLine({ ...card, variance: -0.1 }, LEAGUE_ID, WEEK),
      'invalid-stat-line',
    );
    expectDomainError(
      () => drawStatLine({ ...card, variance: Number.POSITIVE_INFINITY }, LEAGUE_ID, WEEK),
      'invalid-stat-line',
    );
  });
});

describe('simulateWeek', () => {
  it('replays a seeded week to byte-identical box scores', () => {
    const league = makeLeague();
    const first = simulateWeek(league, WEEK);
    const second = simulateWeek(league, WEEK);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toEqual(second);
  });

  it('is independent of input ordering — seeds come from identity, not array order', () => {
    const league = makeLeague();
    const baseline = JSON.stringify(simulateWeek(league, WEEK));
    const players: Record<string, PlayerCard> = {};
    for (const key of Object.keys(league.players).reverse()) {
      players[key] = league.players[key]!;
    }
    const starters = {} as Record<ManagerId, LineupSlot[]>;
    for (const key of Object.keys(league.starters).reverse()) {
      starters[managerId(key)] = [...league.starters[managerId(key)]!].reverse();
    }
    const permuted: SimLeague = { ...league, players, starters };
    expect(JSON.stringify(simulateWeek(permuted, WEEK))).toBe(baseline);
  });

  it('draws different stat lines for a different week', () => {
    const league = makeLeague();
    expect(JSON.stringify(simulateWeek(league, WEEK + 1))).not.toBe(
      JSON.stringify(simulateWeek(league, WEEK)),
    );
  });

  it('pairs the configured matchups into games with full box scores', () => {
    const result = simulateWeek(makeLeague(), WEEK);
    expect(result.week).toBe(WEEK);
    expect(result.games).toHaveLength(2);
    expect(result.games[0]!.home).toBe(managerId('m_alpha'));
    expect(result.games[0]!.away).toBe(managerId('m_bravo'));
    expect(result.games[1]!.home).toBe(managerId('m_charlie'));
    expect(result.games[1]!.away).toBe(managerId('m_delta'));
    for (const game of result.games) {
      for (const box of [game.homeBox, game.awayBox]) {
        expect(box.lines).toHaveLength(7);
        expect(box.lines.map((line) => line.slot)).toEqual([
          'QB',
          'RB',
          'WR',
          'TE',
          'FLEX',
          'K',
          'DEF',
        ]);
        const sum = box.lines.reduce((acc, line) => acc + line.points, 0);
        expect(box.total).toBeCloseTo(sum, 9); // structural check, not a golden pin
      }
    }
  });

  it('pins the alpha box total and quarterback points exactly', () => {
    const result = simulateWeek(makeLeague(), WEEK);
    const box = result.games[0]!.homeBox;
    const qb = box.lines.find((line) => line.slot === 'QB');
    expect(qb?.points).toBe(23.98); // 372×0.04 + 2×4 + 11×0.1, in milli-points
    expect(box.total).toBe(66.98);
  });

  it('adds the points-allowed bonus only on the defense line', () => {
    const result = simulateWeek(makeLeague(), WEEK);
    const box = result.games[0]!.homeBox;
    const def = box.lines.find((line) => line.slot === 'DEF');
    // drawn: 1 sack, 1 takeaway, 17 points allowed → 1 + 2 + 7 (band [10,7]) = 10
    expect(def?.stats.pointsAllowed).toBe(17);
    expect(def?.points).toBe(10);
    const qb = box.lines.find((line) => line.slot === 'QB');
    expect(qb?.stats.pointsAllowed).toBe(0);
    expect(qb?.points).toBe(23.98); // no shutout bonus for the quarterback
  });

  it('rejects an ineligible starter in any slot', () => {
    const league = makeLeague();
    const alpha = managerId('m_alpha');
    const normal = league.starters[alpha]!;
    const swap = (slot: SlotPosition, playerId: string): LineupSlot[] =>
      normal.map((entry) => (entry.slot === slot ? { slot, playerId } : entry));
    expectDomainError(
      () => simulateWeek(withLineup(league, alpha, swap('FLEX', 'p_alpha_k2')), WEEK),
      'invalid-lineup',
    );
    expectDomainError(
      () => simulateWeek(withLineup(league, alpha, swap('FLEX', 'p_alpha_qb2')), WEEK),
      'invalid-lineup',
    );
    expectDomainError(
      () => simulateWeek(withLineup(league, alpha, swap('QB', 'p_alpha_rb2')), WEEK),
      'invalid-lineup',
    );
    expectDomainError(
      () => simulateWeek(withLineup(league, alpha, swap('DEF', 'p_alpha_k2')), WEEK),
      'invalid-lineup',
    );
  });

  it('rejects lineups whose slot counts disagree with the roster config', () => {
    const league = makeLeague();
    const alpha = managerId('m_alpha');
    const normal = league.starters[alpha]!;
    expectDomainError(
      () =>
        simulateWeek(
          withLineup(
            league,
            alpha,
            normal.filter((entry) => entry.slot !== 'K'),
          ),
          WEEK,
        ),
      'invalid-lineup',
    );
    expectDomainError(
      () =>
        simulateWeek(
          withLineup(league, alpha, [...normal, { slot: 'WR', playerId: 'p_alpha_wr2' }]),
          WEEK,
        ),
      'invalid-lineup',
    );
  });

  it('rejects duplicate players within one lineup', () => {
    const league = makeLeague();
    const alpha = managerId('m_alpha');
    const duplicated = league.starters[alpha]!.map((entry) =>
      entry.slot === 'FLEX' ? { slot: entry.slot, playerId: 'p_alpha_qb' } : entry,
    );
    expectDomainError(
      () => simulateWeek(withLineup(league, alpha, duplicated), WEEK),
      'invalid-lineup',
    );
  });

  it('rejects a player fielded by two managers in the same week', () => {
    const league = makeLeague();
    const bravo = managerId('m_bravo');
    const stolen = league.starters[bravo]!.map((entry) =>
      entry.slot === 'QB' ? { slot: entry.slot, playerId: 'p_alpha_qb' } : entry,
    );
    expectDomainError(
      () => simulateWeek(withLineup(league, bravo, stolen), WEEK),
      'invalid-lineup',
    );
  });

  it('rejects starters missing from the player universe', () => {
    const league = makeLeague();
    const alpha = managerId('m_alpha');
    const ghosted = league.starters[alpha]!.map((entry) =>
      entry.slot === 'QB' ? { slot: entry.slot, playerId: 'p_ghost' } : entry,
    );
    expectDomainError(
      () => simulateWeek(withLineup(league, alpha, ghosted), WEEK),
      'invalid-lineup',
    );
  });

  it('rejects a paired manager without a starting lineup', () => {
    const league = makeLeague();
    const starters = Object.fromEntries(
      Object.entries(league.starters).filter(([owner]) => owner !== 'm_bravo'),
    ) as Record<ManagerId, LineupSlot[]>;
    expectDomainError(() => simulateWeek({ ...league, starters }, WEEK), 'invalid-lineup');
  });

  it('rejects self-games and managers playing twice in one week', () => {
    const league = makeLeague();
    expectDomainError(
      () =>
        simulateWeek(
          withPairings(league, [{ home: managerId('m_alpha'), away: managerId('m_alpha') }]),
          WEEK,
        ),
      'invalid-matchup',
    );
    expectDomainError(
      () =>
        simulateWeek(
          withPairings(league, [
            { home: managerId('m_alpha'), away: managerId('m_bravo') },
            { home: managerId('m_bravo'), away: managerId('m_charlie') },
          ]),
          WEEK,
        ),
      'invalid-matchup',
    );
  });
});
