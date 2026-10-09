import type { DraftPickView } from '@stakehouse/api-client';

/** One snake round of the recap board, picks in overall order. */
export interface RecapRound {
  round: number;
  picks: DraftPickView[];
}

/** Group the draft's picks into consecutive rounds of `seatCount` picks. */
export function groupRecapByRound(picks: DraftPickView[], seatCount: number): RecapRound[] {
  if (picks.length === 0 || seatCount < 1) {
    return [];
  }
  const rounds: RecapRound[] = [];
  for (const pick of picks) {
    const round = Math.floor((pick.overall - 1) / seatCount) + 1;
    const bucket = rounds[rounds.length - 1];
    if (bucket?.round === round) {
      bucket.picks.push(pick);
    } else {
      rounds.push({ round, picks: [pick] });
    }
  }
  return rounds;
}
