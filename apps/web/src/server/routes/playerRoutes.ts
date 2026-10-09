import { Router } from 'express';
import { z } from 'zod';
import type { ApiContext } from '../context';

/**
 * The player universe search — board and waiver lookups. Filtering is
 * case-insensitive substring on name plus an exact position match.
 */

const POSITION_VALUES = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

const playersQuery = z.object({
  q: z.string().optional(),
  pos: z.enum(POSITION_VALUES).optional(),
});

export function playerRoutes(ctx: ApiContext): Router {
  const router = Router();

  router.get('/players', (req, res) => {
    const { q, pos } = playersQuery.parse(req.query);
    let players = ctx.store.players.all();
    if (q !== undefined) {
      const needle = q.toLowerCase();
      players = players.filter((player) => player.name.toLowerCase().includes(needle));
    }
    if (pos !== undefined) {
      players = players.filter((player) => player.position === pos);
    }
    res.json({ players, total: players.length });
  });

  return router;
}
