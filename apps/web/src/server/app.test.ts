import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('web server', () => {
  it('boots and answers the health check', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('serves the built SPA shell at /', async () => {
    const res = await request(createApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('<div id="root">');
  });
});
