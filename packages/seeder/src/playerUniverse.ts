import type { PlayerCard, Position, ScoringRules, StatLine } from '@stakehouse/domain';
import {
  hash32,
  mulberry32,
  POINTS_SCALE,
  pointsAllowedBonus,
  scoreLineScaled,
  zeroStatLine,
} from '@stakehouse/domain';
import type { Rng } from '@stakehouse/domain';
import type { PlayerRef } from '@stakehouse/domain';

/**
 * The fictional player universe — ~300 invented athletes with
 * position-appropriate weekly projections. Everything here is deterministic:
 * names, tiers, and per-player jitter all derive from identity (a player's
 * id, a position's name), never from wall clock or iteration order, so
 * re-running the generator is byte-identical. No real athlete can appear:
 * every name is drawn from invented pools shipped in this file.
 */

export const PLAYER_UNIVERSE_SIZE = 300;

/** League-independent depth per position — the waiver wire stays stocked. */
export const POSITION_COUNTS: Record<Position, number> = {
  QB: 40,
  RB: 70,
  WR: 90,
  TE: 48,
  K: 26,
  DEF: 26,
};

const POSITION_ORDER: readonly Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/**
 * The seeder's projection schema, defined to the AMENDED spec:
 * `receivingYards`, `receivingTd`, and `receptions` are first-class fields
 * alongside passing, rushing, kicking, and defense. The domain's `StatLine`
 * gains its receiving-yard/TD fields with the parallel scoring amendment —
 * `projectionToStatLine` forwards them the moment they exist; until then the
 * generator still models receiving production here (and `receptions` already
 * rides through, scoring under the league's PPR rate).
 */
export interface PlayerProjection {
  passYards: number;
  passTd: number;
  interceptions: number;
  rushYards: number;
  rushTd: number;
  receivingYards: number;
  receivingTd: number;
  receptions: number;
  fumblesLost: number;
  fgMade: Record<string, number>;
  extraPointsMade: number;
  sacks: number;
  takeaways: number;
  defensiveTd: number;
  pointsAllowed: number;
}

/** A generated player in the seeder's own (amended-spec) stat schema. */
export interface GeneratedPlayer {
  id: string;
  name: string;
  position: Position;
  projection: PlayerProjection;
  variance: number;
}

const FG_BANDS = ['0-19', '20-29', '30-39', '40-49', '50+'] as const;

// ---------------------------------------------------------------------------
// Name pools — invented, one source of truth for every generated athlete
// ---------------------------------------------------------------------------

const FIRST_NAMES: readonly string[] = [
  'Dov',
  'Silas',
  'Teo',
  'Amos',
  'Bram',
  'Cassius',
  'Dorian',
  'Emeric',
  'Fitz',
  'Gideon',
  'Harlan',
  'Idris',
  'Jules',
  'Kasimir',
  'Leander',
  'Mortimer',
  'Nikolai',
  'Otis',
  'Percival',
  'Quentin',
  'Rufus',
  'Simeon',
  'Thaddeus',
  'Umberto',
  'Vaughn',
  'Wendell',
  'Xavier',
  'Yusuf',
  'Zeke',
  'Alaric',
  'Boris',
  'Cyrus',
  'Desmond',
  'Emory',
  'Faustino',
  'Grady',
  'Hendrick',
  'Ignatius',
  'Jabari',
  'Kellan',
  'Lazarus',
  'Miles',
  'Nyles',
  'Osric',
];

const LAST_NAMES: readonly string[] = [
  'Amado',
  'Brummell',
  'Ferreira',
  'Idowu',
  'Kowalski',
  'Abernathy',
  'Blackwood',
  'Castellano',
  'Delacroix',
  'Everhart',
  'Fontaine',
  'Galloway',
  'Hawthorne',
  'Ivanov',
  'Jessup',
  'Kellerman',
  'Lindqvist',
  'Marchetti',
  'Novikov',
  'Okafor',
  'Pemberton',
  'Quartermaine',
  'Rothbury',
  'Sterling',
  'Thorne',
  'Underhill',
  'Vasquez',
  'Whitfield',
  'Yarrow',
  'Zelman',
  'Crane',
  'Dunwoody',
  'Eastwick',
  'Fenwick',
  'Grimaldi',
  'Huxley',
  'Ironside',
  'Jankowski',
  'Kilbride',
  'Lovelace',
  'Muldoon',
  'Nethercott',
  'Osgood',
  'Przybylski',
];

/** Team-defense entries are invented clubs, not athletes. */
const DEF_TEAM_NAMES: readonly string[] = [
  'Ashford Ironbacks',
  'Barrow Wreckers',
  'Cinderforge Foundry',
  'Dovergate Hounds',
  'Eastmarch Owls',
  'Fenwick Boars',
  'Grimstead Crows',
  'Hollowbrook Stags',
  'Ironquay Dockers',
  'Jarrow Wolves',
  'Kestrelmoor Herons',
  'Larkspur Legion',
  'Millhaven Miners',
  'Northgate Wardens',
  'Oakhedge Sentinels',
  'Pinewild Pikes',
  'Quarrymill Grinders',
  'Redvale Ramblers',
  'Stonemarrow Golems',
  'Thornbury Threshers',
  'Underbrook Eels',
  'Valefest Vanguard',
  'Westhollow Anchors',
  'Yarrowgate Yeomen',
  'Zephyrhill Zephyrs',
  'Amberdine Antlerbacks',
];

// ---------------------------------------------------------------------------
// Tier models — baseline weekly projections; per-player jitter decorates them
// ---------------------------------------------------------------------------

interface Tier {
  readonly label: string;
  readonly count: number;
  readonly model: PlayerProjection;
}

const QB_TIERS: readonly Tier[] = [
  {
    label: 'elite',
    count: 4,
    model: {
      ...zeroProjection(),
      passYards: 295,
      passTd: 2.8,
      interceptions: 0.8,
      rushYards: 35,
      rushTd: 0.4,
      fumblesLost: 0.1,
    },
  },
  {
    label: 'good',
    count: 10,
    model: {
      ...zeroProjection(),
      passYards: 265,
      passTd: 2.2,
      interceptions: 1,
      rushYards: 20,
      rushTd: 0.2,
      fumblesLost: 0.1,
    },
  },
  {
    label: 'middling',
    count: 14,
    model: {
      ...zeroProjection(),
      passYards: 238,
      passTd: 1.6,
      interceptions: 1.1,
      rushYards: 12,
      rushTd: 0.1,
      fumblesLost: 0.15,
    },
  },
  {
    label: 'backup',
    count: 12,
    model: {
      ...zeroProjection(),
      passYards: 205,
      passTd: 1.1,
      interceptions: 1.3,
      rushYards: 6,
      rushTd: 0.05,
      fumblesLost: 0.1,
    },
  },
];

const RB_TIERS: readonly Tier[] = [
  {
    label: 'bellcow',
    count: 8,
    model: {
      ...zeroProjection(),
      rushYards: 95,
      rushTd: 0.9,
      receptions: 5.5,
      receivingYards: 42,
      receivingTd: 0.4,
      fumblesLost: 0.15,
    },
  },
  {
    label: 'workhorse',
    count: 16,
    model: {
      ...zeroProjection(),
      rushYards: 70,
      rushTd: 0.6,
      receptions: 3.8,
      receivingYards: 30,
      receivingTd: 0.25,
      fumblesLost: 0.15,
    },
  },
  {
    label: 'committee',
    count: 26,
    model: {
      ...zeroProjection(),
      rushYards: 45,
      rushTd: 0.4,
      receptions: 2.5,
      receivingYards: 18,
      receivingTd: 0.12,
      fumblesLost: 0.1,
    },
  },
  {
    label: 'handcuff',
    count: 20,
    model: {
      ...zeroProjection(),
      rushYards: 22,
      rushTd: 0.2,
      receptions: 1.4,
      receivingYards: 10,
      receivingTd: 0.05,
      fumblesLost: 0.1,
    },
  },
];

const WR_TIERS: readonly Tier[] = [
  {
    label: 'alpha',
    count: 10,
    model: {
      ...zeroProjection(),
      receptions: 8.5,
      receivingYards: 112,
      receivingTd: 0.9,
      rushYards: 4,
      fumblesLost: 0.1,
    },
  },
  {
    label: 'showcase',
    count: 20,
    model: {
      ...zeroProjection(),
      receptions: 6.5,
      receivingYards: 82,
      receivingTd: 0.55,
      rushYards: 2,
      fumblesLost: 0.1,
    },
  },
  {
    label: 'rotational',
    count: 30,
    model: {
      ...zeroProjection(),
      receptions: 4.5,
      receivingYards: 55,
      receivingTd: 0.35,
      rushYards: 1,
      fumblesLost: 0.05,
    },
  },
  {
    label: 'depth',
    count: 30,
    model: {
      ...zeroProjection(),
      receptions: 2.8,
      receivingYards: 33,
      receivingTd: 0.18,
      rushYards: 0.5,
      fumblesLost: 0.05,
    },
  },
];

const TE_TIERS: readonly Tier[] = [
  {
    label: 'unicorn',
    count: 4,
    model: {
      ...zeroProjection(),
      receptions: 6.8,
      receivingYards: 78,
      receivingTd: 0.6,
      fumblesLost: 0.1,
    },
  },
  {
    label: 'safety',
    count: 10,
    model: {
      ...zeroProjection(),
      receptions: 5,
      receivingYards: 58,
      receivingTd: 0.4,
      fumblesLost: 0.1,
    },
  },
  {
    label: 'rotational',
    count: 16,
    model: {
      ...zeroProjection(),
      receptions: 3.2,
      receivingYards: 36,
      receivingTd: 0.22,
      fumblesLost: 0.05,
    },
  },
  {
    label: 'blocking',
    count: 18,
    model: {
      ...zeroProjection(),
      receptions: 1.8,
      receivingYards: 20,
      receivingTd: 0.1,
      fumblesLost: 0.05,
    },
  },
];

const K_TIERS: readonly Tier[] = [
  {
    label: 'elite',
    count: 4,
    model: {
      ...zeroProjection(),
      fgMade: { '0-19': 0.1, '20-29': 1, '30-39': 0.7, '40-49': 0.4, '50+': 0.15 },
      extraPointsMade: 2.2,
    },
  },
  {
    label: 'steady',
    count: 8,
    model: {
      ...zeroProjection(),
      fgMade: { '0-19': 0.1, '20-29': 0.9, '30-39': 0.6, '40-49': 0.25, '50+': 0.05 },
      extraPointsMade: 1.8,
    },
  },
  {
    label: 'fringe',
    count: 14,
    model: {
      ...zeroProjection(),
      fgMade: { '0-19': 0.1, '20-29': 0.8, '30-39': 0.5, '40-49': 0.15 },
      extraPointsMade: 1.3,
    },
  },
];

const DEF_TIERS: readonly Tier[] = [
  {
    label: 'menacing',
    count: 4,
    model: { ...zeroProjection(), sacks: 2, takeaways: 1.6, defensiveTd: 0.1, pointsAllowed: 15 },
  },
  {
    label: 'stingy',
    count: 8,
    model: {
      ...zeroProjection(),
      sacks: 1.6,
      takeaways: 1.2,
      defensiveTd: 0.06,
      pointsAllowed: 20,
    },
  },
  {
    label: 'porous',
    count: 14,
    model: {
      ...zeroProjection(),
      sacks: 1.1,
      takeaways: 0.9,
      defensiveTd: 0.03,
      pointsAllowed: 26,
    },
  },
];

const POSITION_TIERS: Record<Position, readonly Tier[]> = {
  QB: QB_TIERS,
  RB: RB_TIERS,
  WR: WR_TIERS,
  TE: TE_TIERS,
  K: K_TIERS,
  DEF: DEF_TIERS,
};

const POSITION_VARIANCE: Record<Position, number> = {
  QB: 0.15,
  RB: 0.2,
  WR: 0.22,
  TE: 0.25,
  K: 0.1,
  DEF: 0.3,
};

function zeroProjection(): PlayerProjection {
  return {
    passYards: 0,
    passTd: 0,
    interceptions: 0,
    rushYards: 0,
    rushTd: 0,
    receivingYards: 0,
    receivingTd: 0,
    receptions: 0,
    fumblesLost: 0,
    fgMade: {},
    extraPointsMade: 0,
    sacks: 0,
    takeaways: 0,
    defensiveTd: 0,
    pointsAllowed: 0,
  };
}

/** Map a generated projection onto the domain's stat line. Receiving yards
 * and TDs join the moment the scoring amendment adds their fields — the
 * generator models them now either way. */
export function projectionToStatLine(projection: PlayerProjection): StatLine {
  const line = zeroStatLine();
  line.passYards = projection.passYards;
  line.passTd = projection.passTd;
  line.interceptions = projection.interceptions;
  line.rushYards = projection.rushYards;
  line.rushTd = projection.rushTd;
  line.receptions = projection.receptions;
  line.fumblesLost = projection.fumblesLost;
  for (const band of FG_BANDS) {
    const made = projection.fgMade[band];
    if (made !== undefined) line.fgMade[band] = made;
  }
  line.extraPointsMade = projection.extraPointsMade;
  line.sacks = projection.sacks;
  line.takeaways = projection.takeaways;
  line.defensiveTd = projection.defensiveTd;
  line.pointsAllowed = projection.pointsAllowed;
  return line;
}

// ---------------------------------------------------------------------------
// Generation
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

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Decorate a tier's baseline with per-player jitter: one seeded draw per
 * non-zero field, in a fixed field order, clamped at zero. Yards wobble
 * less than counting stats; points-allowed stays an integer so the defense
 * bonus can score it directly.
 */
function jitterProjection(base: PlayerProjection, rng: Rng): PlayerProjection {
  const jittered = (value: number, rate: number): number => {
    if (!(value > 0)) return 0;
    return round2(Math.max(0, value + (rng() * 2 - 1) * value * rate));
  };
  const projection = zeroProjection();
  projection.passYards = jittered(base.passYards, 0.08);
  projection.passTd = jittered(base.passTd, 0.18);
  projection.interceptions = jittered(base.interceptions, 0.18);
  projection.rushYards = jittered(base.rushYards, 0.08);
  projection.rushTd = jittered(base.rushTd, 0.18);
  projection.receivingYards = jittered(base.receivingYards, 0.08);
  projection.receivingTd = jittered(base.receivingTd, 0.18);
  projection.receptions = jittered(base.receptions, 0.18);
  projection.fumblesLost = jittered(base.fumblesLost, 0.18);
  for (const band of FG_BANDS) {
    const made = base.fgMade[band];
    if (made !== undefined) projection.fgMade[band] = jittered(made, 0.18);
  }
  projection.extraPointsMade = jittered(base.extraPointsMade, 0.18);
  projection.sacks = jittered(base.sacks, 0.18);
  projection.takeaways = jittered(base.takeaways, 0.18);
  projection.defensiveTd = jittered(base.defensiveTd, 0.18);
  projection.pointsAllowed = Math.round(jittered(base.pointsAllowed, 0.08));
  return projection;
}

function expandTiers(tiers: readonly Tier[], position: Position): readonly string[] {
  const total = tiers.reduce((sum, tier) => sum + tier.count, 0);
  const expected = POSITION_COUNTS[position];
  if (total !== expected) {
    throw new Error(`tier counts for ${position} sum to ${total}, expected ${expected}`);
  }
  return seededShuffle(
    tiers.flatMap((tier) => Array.from({ length: tier.count }, () => tier.label)),
    mulberry32(hash32(`stakehouse:universe:tiers:${position}`)),
  );
}

function playerKey(position: Position, index: number): string {
  return `p-${position}-${String(index + 1).padStart(2, '0')}`;
}

/**
 * The fictional universe in the seeder's own stat schema: names, positions,
 * and full projections with receiving stats first-class. Deterministic and
 * byte-identical across runs.
 */
export function generatePlayerProjections(): readonly GeneratedPlayer[] {
  const namePool = seededShuffle(
    FIRST_NAMES.flatMap((first) => LAST_NAMES.map((last) => `${first} ${last}`)),
    mulberry32(hash32('stakehouse:universe:names')),
  );
  const defNames = seededShuffle(
    DEF_TEAM_NAMES,
    mulberry32(hash32('stakehouse:universe:def-names')),
  );
  let nameCursor = 0;
  let defCursor = 0;

  const players: GeneratedPlayer[] = [];
  for (const position of POSITION_ORDER) {
    const tierLabels = expandTiers(POSITION_TIERS[position], position);
    tierLabels.forEach((label, index) => {
      const id = playerKey(position, index);
      const tier = POSITION_TIERS[position].find((candidate) => candidate.label === label)!;
      const rng = mulberry32(hash32(`stakehouse:player:${id}`));
      players.push({
        id,
        name: position === 'DEF' ? defNames[defCursor++]! : namePool[nameCursor++]!,
        position,
        projection: jitterProjection(tier.model, rng),
        variance: POSITION_VARIANCE[position],
      });
    });
  }
  if (nameCursor > namePool.length || defCursor > defNames.length) {
    throw new Error('the name pools ran dry — enlarge FIRST_NAMES/LAST_NAMES/DEF_TEAM_NAMES');
  }
  return players;
}

/** Storage-ready cards: projections mapped onto the domain's stat line. */
export function generatePlayerUniverse(): PlayerCard[] {
  return generatePlayerProjections().map((player) => ({
    id: player.id,
    name: player.name,
    position: player.position,
    projection: projectionToStatLine(player.projection),
    variance: player.variance,
  }));
}

// ---------------------------------------------------------------------------
// Draft board
// ---------------------------------------------------------------------------

/**
 * Expected weekly points under the league's exact rules — the same arithmetic
 * the simulator uses, on a ×100-scaled stat line so fractional projections
 * stay exact in integer milli-points. Defenses add the points-allowed bonus.
 */
export function expectedPoints(line: StatLine, position: Position, rules: ScoringRules): number {
  const scale = 100;
  const scaled: StatLine = {
    ...line,
    fgMade: Object.fromEntries(
      Object.entries(line.fgMade).map(([band, made]) => [band, Math.round(made * scale)]),
    ),
  };
  for (const key of Object.keys(scaled) as (keyof StatLine)[]) {
    if (key === 'fgMade') continue;
    // Round: the underlying values carry at most 2 decimals, but ×100 in
    // floats lands a hair off an integer (301.66 → 30166.000000000004),
    // and scoreLineScaled asserts exact integers.
    scaled[key] = Math.round((scaled[key] as number) * scale);
  }
  const base = scoreLineScaled(scaled, rules) / scale / POINTS_SCALE;
  if (position !== 'DEF') return base;
  return base + pointsAllowedBonus(line.pointsAllowed, rules);
}

/**
 * The ranked draft board: best expected points first, ties broken by id so
 * the order never depends on input iteration. Board order IS best-available
 * order — the draft engine's autopick walks it top-down.
 */
export function rankBoard(players: readonly PlayerCard[], rules: ScoringRules): PlayerRef[] {
  return players
    .map((card) => ({ card, points: expectedPoints(card.projection, card.position, rules) }))
    .sort((a, b) => b.points - a.points || (a.card.id < b.card.id ? -1 : 1))
    .map(({ card }) => ({ playerId: card.id, position: card.position }));
}
