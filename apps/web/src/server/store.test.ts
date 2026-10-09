import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bootStore } from './store';

/** bootStore reads STAKEHOUSE_DB at call time — each test points it at a virgin file. */
function pointBootAtVirginDb(): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'sh-boot-')), 'stakehouse.db');
  process.env.STAKEHOUSE_DB = file;
  return file;
}

afterEach(() => {
  delete process.env.STAKEHOUSE_DB;
});

describe('bootStore', () => {
  it('seeds a virgin database with the player universe and sandbox league', () => {
    pointBootAtVirginDb();
    const store = bootStore();
    expect(store.players.all().length).toBeGreaterThanOrEqual(300);
    expect(store.leagues.list()).toHaveLength(1);
    expect(store.leagues.list()[0]!.id).toBe('lg-sandbox');
  });

  it('never reseeds a populated store on a later boot', () => {
    pointBootAtVirginDb();
    bootStore();
    const second = bootStore();
    expect(second.leagues.list()).toHaveLength(1);
    expect(second.leagues.list()[0]!.id).toBe('lg-sandbox');
  });
});
