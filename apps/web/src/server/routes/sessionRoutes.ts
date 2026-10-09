import { Router } from 'express';
import type { ApiContext } from '../context';
import { sessionSchema, signSession } from '../sessions';

const COOKIE_NAME = 'sh_session';

export function sessionRoutes(ctx: ApiContext): Router {
  const router = Router();

  router.post('/session', (req, res) => {
    const payload = sessionSchema.parse(req.body);
    res.cookie(COOKIE_NAME, signSession(payload, ctx.cookieSecret), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    res.json({ user: payload });
  });

  return router;
}
