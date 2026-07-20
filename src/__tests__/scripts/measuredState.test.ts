// Vitest gate for scripts/gen-measured-state.cjs — keeps docs/ESTADO-MEDIDO.md
// (the generated "what the ratchets actually measure" counters) in sync with
// the baselines on disk, AND fails when a hand-written doc states a counter the
// code contradicts.
//
// Why this exists — measured 2026-07-20:
//   docs/PENDIENTE.md, which calls itself "la ÚNICA fuente de verdad", said
//   "39 huérfanos" and "10 routers sin cobertura". The baselines on disk said
//   4 and 0. For a month that document pointed work at problems already solved
//   — the definition of going in circles. Counters written by hand rot; the fix
//   is to generate them and fail the commit when a doc drifts from the code.
//
// Regenerate with `npm run gen:measured-state` and commit docs/ESTADO-MEDIDO.md.
//
// Requiring the .cjs does NOT run its CLI (guarded by require.main).

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';

const require = createRequire(import.meta.url);

interface MeasuredState {
  orphans: number;
  routersTotal: number;
  routersVerified: number;
  routersUncovered: number;
  phantoms: number;
  anyTotal: number;
}

const gen = require('../../../scripts/gen-measured-state.cjs') as {
  readMeasuredState: () => MeasuredState;
  generate: () => { content: string };
  findStaleClaims: (
    text: string,
    state: MeasuredState,
  ) => Array<{ claimed: number; actual: number; dimension: string; line: string }>;
  OUT: string;
  TRACKED_DOCS: string[];
};

const state = gen.readMeasuredState();

/** Synthetic counters — pinned so prose detection is tested independently of disk. */
const fixture: MeasuredState = {
  orphans: 4,
  routersTotal: 205,
  routersVerified: 205,
  routersUncovered: 0,
  phantoms: 16,
  anyTotal: 155,
};

describe('measured-state — lectura de los baselines', () => {
  it('lee contadores plausibles de los ratchets en disco', () => {
    // Si un baseline cambia de forma, esto avisa antes de que el gate mienta.
    expect(state.routersTotal).toBeGreaterThan(100);
    expect(state.routersVerified).toBeGreaterThan(100);
    expect(state.orphans).toBeGreaterThanOrEqual(0);
    expect(state.phantoms).toBeGreaterThanOrEqual(0);
  });
});

describe('measured-state — documento generado', () => {
  it('docs/ESTADO-MEDIDO.md existe y está al día con los baselines', () => {
    const fresh = gen.generate();
    expect(existsSync(gen.OUT)).toBe(true);
    expect(readFileSync(gen.OUT, 'utf8').trim()).toBe(fresh.content.trim());
  });
});

describe('measured-state — afirmaciones obsoletas en prosa', () => {
  it('caza el caso real de PENDIENTE.md: "baseline 39" cuando se miden 4', () => {
    const claims = gen.findStaleClaims(
      '## A. Huérfanos · GATE: connectivity-ratchet (baseline 39)',
      fixture,
    );

    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ claimed: 39, actual: 4 });
  });

  it('caza el conteo obsoleto de routers sin cobertura', () => {
    const claims = gen.findStaleClaims(
      'Gate: `check-router-test-ratchet.cjs` (baseline 10 uncovered, solo baja).',
      fixture,
    );

    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ claimed: 10, actual: 0 });
  });

  it('calla cuando la prosa dice la verdad', () => {
    expect(gen.findStaleClaims('GATE: connectivity-ratchet (baseline 4)', fixture)).toHaveLength(0);
    expect(
      gen.findStaleClaims('check-router-test-ratchet.cjs (baseline 0 uncovered)', fixture),
    ).toHaveLength(0);
  });

  it('no confunde una fecha ni un file:line con un contador', () => {
    const claims = gen.findStaleClaims(
      'Ver `firestore.rules:1103` — revisado el 2026-06-22 con 39 casos.',
      fixture,
    );

    expect(claims).toHaveLength(0);
  });

  it('los documentos rectores no contienen contadores obsoletos', () => {
    const offenders: string[] = [];
    for (const doc of gen.TRACKED_DOCS) {
      if (!existsSync(doc)) continue;
      for (const claim of gen.findStaleClaims(readFileSync(doc, 'utf8'), state)) {
        offenders.push(
          `${doc}: dice ${claim.claimed} para ${claim.dimension}, el código mide ${claim.actual} — "${claim.line.trim()}"`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });
});
