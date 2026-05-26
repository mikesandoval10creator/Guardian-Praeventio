// Praeventio Guard — customClaims unit tests (§12.4.2).

import { describe, it, expect } from 'vitest';
import {
  readAssignedSites,
  hasAssignedSite,
  resolveAssignedSitesCheck,
  buildClaimsWithAssignedSites,
  ASSIGNED_SITES_CLAIM,
  MAX_ASSIGNED_SITES,
} from './customClaims';

describe('readAssignedSites', () => {
  it('extrae array de strings del claim', () => {
    const token = { [ASSIGNED_SITES_CLAIM]: ['proj-1', 'proj-2'] };
    expect(readAssignedSites(token)).toEqual(['proj-1', 'proj-2']);
  });

  it('devuelve null si el claim no existe', () => {
    expect(readAssignedSites({})).toBeNull();
  });

  it('devuelve null si el claim es non-array', () => {
    expect(readAssignedSites({ [ASSIGNED_SITES_CLAIM]: 'proj-1' })).toBeNull();
    expect(readAssignedSites({ [ASSIGNED_SITES_CLAIM]: 42 })).toBeNull();
  });

  it('filtra strings vacíos / non-string del array', () => {
    const token = {
      [ASSIGNED_SITES_CLAIM]: ['proj-1', '', 42, null, 'proj-2'],
    };
    expect(readAssignedSites(token)).toEqual(['proj-1', 'proj-2']);
  });
});

describe('hasAssignedSite', () => {
  it('true cuando el projectId está en la lista', () => {
    const token = { [ASSIGNED_SITES_CLAIM]: ['p-a', 'p-b'] };
    expect(hasAssignedSite(token, 'p-a')).toBe(true);
  });

  it('false cuando no', () => {
    const token = { [ASSIGNED_SITES_CLAIM]: ['p-a'] };
    expect(hasAssignedSite(token, 'p-z')).toBe(false);
  });

  it('false cuando el claim no existe', () => {
    expect(hasAssignedSite({}, 'any')).toBe(false);
  });
});

describe('resolveAssignedSitesCheck', () => {
  it('fast-path: resolved+member cuando claim cubre el projectId', () => {
    const r = resolveAssignedSitesCheck(
      { [ASSIGNED_SITES_CLAIM]: ['p-1', 'p-2'] },
      'p-1',
    );
    expect(r.resolved).toBe(true);
    if (r.resolved) {
      expect(r.member).toBe(true);
    }
  });

  it('fallback: not resolved cuando el claim NO cubre (puede estar stale)', () => {
    const r = resolveAssignedSitesCheck(
      { [ASSIGNED_SITES_CLAIM]: ['p-1'] },
      'p-not-in-claim',
    );
    expect(r.resolved).toBe(false);
  });

  it('fallback: not resolved cuando claim ausente (compat pre-migración)', () => {
    const r = resolveAssignedSitesCheck({}, 'p-1');
    expect(r.resolved).toBe(false);
  });
});

describe('buildClaimsWithAssignedSites', () => {
  it('agrega assignedSiteIds preservando claims existentes', () => {
    const out = buildClaimsWithAssignedSites({
      existingClaims: { role: 'supervisor', tier: 'oro' },
      newAssignedSites: ['p-1', 'p-2'],
    });
    expect(out).toEqual({
      role: 'supervisor',
      tier: 'oro',
      [ASSIGNED_SITES_CLAIM]: ['p-1', 'p-2'],
    });
  });

  it('dedupe + sort para idempotencia', () => {
    const out1 = buildClaimsWithAssignedSites({
      existingClaims: {},
      newAssignedSites: ['p-2', 'p-1', 'p-2', 'p-3'],
    });
    expect(out1[ASSIGNED_SITES_CLAIM]).toEqual(['p-1', 'p-2', 'p-3']);
  });

  it('mismo input produce mismo output (idempotente)', () => {
    const a = buildClaimsWithAssignedSites({
      existingClaims: { role: 'admin' },
      newAssignedSites: ['p-1', 'p-2'],
    });
    const b = buildClaimsWithAssignedSites({
      existingClaims: { role: 'admin' },
      newAssignedSites: ['p-2', 'p-1'],
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('rechaza si excede MAX_ASSIGNED_SITES', () => {
    const tooMany = Array.from(
      { length: MAX_ASSIGNED_SITES + 1 },
      (_, i) => `p-${i}`,
    );
    expect(() =>
      buildClaimsWithAssignedSites({
        existingClaims: {},
        newAssignedSites: tooMany,
      }),
    ).toThrow(/excede el máximo/);
  });

  it('existingClaims undefined funciona como vacío', () => {
    const out = buildClaimsWithAssignedSites({
      existingClaims: undefined,
      newAssignedSites: ['p-1'],
    });
    expect(out[ASSIGNED_SITES_CLAIM]).toEqual(['p-1']);
  });
});
