// Round 15 / I4 — Arcade hub registry contract.
//
// The registry is what the hub renders into cards and what tier-gates each
// route. We pin the shape so a future refactor can't accidentally drop the
// normativa or tier metadata that B2B customers rely on for evidence reports.

import { describe, expect, it } from 'vitest';
import { GAMES_REGISTRY } from './ArcadeGames';

describe('GAMES_REGISTRY', () => {
  it('declares at least two real serious-games (claw + pool)', () => {
    const ids = GAMES_REGISTRY.map(g => g.id);
    expect(ids).toContain('clawmachine');
    expect(ids).toContain('poolgame');
  });

  it('every game declares title, path, objective, normativa and tier', () => {
    for (const game of GAMES_REGISTRY) {
      expect(game.title.length).toBeGreaterThan(0);
      expect(game.path.startsWith('/')).toBe(true);
      expect(game.objective.length).toBeGreaterThan(10);
      expect(game.normativa.length).toBeGreaterThan(0);
      expect(game.tier).toBe('Diamante+');
    }
  });

  it('ids are unique (paths may be shared by sub-features of /training)', () => {
    const ids = GAMES_REGISTRY.map(g => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the two new tier-gated games target the dedicated routes I4 wired', () => {
    const claw = GAMES_REGISTRY.find(g => g.id === 'clawmachine');
    const pool = GAMES_REGISTRY.find(g => g.id === 'poolgame');
    expect(claw?.path).toBe('/clawmachine');
    expect(pool?.path).toBe('/poolgame');
  });
});
