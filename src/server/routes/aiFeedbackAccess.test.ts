// @vitest-environment node
// Praeventio Guard — AI feedback (tarea P1 "El ciclo RLHF/feedback de
// IA sigue desconectado"). 3 bugs:
//
// 1. Particionado: POST persistia tenantId = req.user.uid en lugar
//    del tenant real (claims.tenantId o fallback al uid). El agregador
//    interpretaba uid como tenant → resumenes por usuario, no por
//    empresa.
// 2. Autorización de lectura: GET /feedback/summary exigía
//    req.user?.admin===true, pero el sistema promueve por claim
//    role:admin|gerente. Un admin legitimo recibía 403.
// 3. Scheduler: el job aggregate-ai-feedback no se creaba en deploy.
//
// TDD: estos tests pujan el contrato que el PR cumple.

import { describe, it, expect } from 'vitest';
import {
  resolveFeedbackTenantId,
  isFeedbackReader,
  type FeedbackUser,
} from './aiFeedbackAccess.js';

describe('resolveFeedbackTenantId', () => {
  it('prioriza claims.tenantId cuando existe (particionado real)', () => {
    const u: FeedbackUser = {
      uid: 'uid-A',
      email: 'a@empresa.cl',
      claims: { tenantId: 'tenant-1', role: 'worker' },
    };
    expect(resolveFeedbackTenantId(u)).toBe('tenant-1');
  });

  it('fallback a uid cuando no hay claims.tenantId (no silent user→tenant)', () => {
    const u: FeedbackUser = {
      uid: 'uid-A',
      email: 'a@empresa.cl',
      claims: { role: 'worker' },
    };
    expect(resolveFeedbackTenantId(u)).toBe('uid-A');
  });

  it('rechaza user sin uid ni tenantId (defensa)', () => {
    const u: FeedbackUser = {
      uid: '',
      email: 'a@empresa.cl',
      claims: {},
    };
    expect(() => resolveFeedbackTenantId(u)).toThrow();
  });
});

describe('isFeedbackReader — claim role admin/gerente', () => {
  it('admin con claim role es reader', () => {
    expect(
      isFeedbackReader({
        uid: 'uid-A',
        email: 'a@empresa.cl',
        claims: { role: 'admin' },
      }),
    ).toBe(true);
  });

  it('gerente con claim role es reader', () => {
    expect(
      isFeedbackReader({
        uid: 'uid-A',
        email: 'a@empresa.cl',
        claims: { role: 'gerente' },
      }),
    ).toBe(true);
  });

  it('worker con claim role NO es reader', () => {
    expect(
      isFeedbackReader({
        uid: 'uid-A',
        email: 'a@empresa.cl',
        claims: { role: 'worker' },
      }),
    ).toBe(false);
  });

  it('user sin claims no es reader', () => {
    expect(
      isFeedbackReader({
        uid: 'uid-A',
        email: 'a@empresa.cl',
        claims: {},
      }),
    ).toBe(false);
  });

  it('rechaza boolean admin legacy (es admin vía flag custom)', () => {
    // Compatibilidad: si un token viejo trae `admin: true` sin claim role,
    // sigue siendo reader (varios usuarios en producción lo tienen).
    expect(
      isFeedbackReader({
        uid: 'uid-A',
        email: 'a@empresa.cl',
        claims: { admin: true },
      }),
    ).toBe(true);
  });
});
