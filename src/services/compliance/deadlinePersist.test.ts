// @vitest-environment node
// Praeventio Guard — plazo regulatorio persistido en la solicitud.
//
// Tarea [P1][privacidad] "El plazo regulatorio se calcula pero no se
// conserva": antes, requestDataAccess no guardaba subjectCountry /
// dataResidency / regime / deadlineDays / regla — al recargar se
// perdía el contexto para controlar el vencimiento. Esta serie agrega
// los campos al DataAccessRequest, los persiste en Firestore, y
// comprueba que la deadline se controla desde el dato persistido
// (no recalculada, que es donde estaba el bug).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  requestDataAccess,
  getDataAccessRequest,
  type MinimalComplianceDb,
} from './ley19628.js';

function makeDb(initial: { requests?: Array<{ id: string; data: any }> } = {}) {
  const requests = new Map<string, any>();
  for (const r of initial.requests ?? []) requests.set(r.id, r.data);

  const makeCol = (name: string) => ({
    async add(data: any) {
      const id = `${name}-${requests.size + 1}`;
      requests.set(id, { ...data });
      return { get: async () => ({ id, data: () => ({ ...data }) }) };
    },
    doc(id: string) {
      return {
        async get() {
          const data = requests.get(id);
          return data
            ? { id, exists: true, data: () => ({ ...data }) }
            : { id, exists: false, data: () => undefined };
        },
        async set(data: any) {
          requests.set(id, { ...data });
        },
      };
    },
  });

  return {
    collection(name: string) {
      if (name === 'data_access_requests') return makeCol(name);
      return makeCol(name);
    },
    _requests: requests,
  } as unknown as MinimalComplianceDb;
}

const NOW = 1_750_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe('requestDataAccess — persistencia regulatoria', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it('persiste subjectCountry/dataResidency/regime/deadlineDays/regla', async () => {
    const db = makeDb();
    const req = await requestDataAccess(db, 'uid-A', 'access', {
      subjectCountry: 'BR',
      dataResidency: 'BR',
    });

    expect(req.subjectCountry).toBe('BR');
    expect(req.dataResidency).toBe('BR');
    expect(typeof req.regime).toBe('string');
    expect(req.regime?.length).toBeGreaterThan(0);
    expect(typeof req.deadlineDays).toBe('number');
    expect(req.deadlineDays).toBeGreaterThan(0);
    expect(typeof req.deadlineAt).toBe('number');
    expect(req.deadlineAt).toBe(NOW + req.deadlineDays! * DAY);
    expect(typeof req.deadlineRule).toBe('string');
    expect(req.deadlineRule?.length).toBeGreaterThan(0);
  });

  it('relee de Firestore: getDataAccessRequest devuelve los campos persistidos', async () => {
    const db = makeDb();
    const req = await requestDataAccess(db, 'uid-B', 'erasure', {
      subjectCountry: 'CL',
      dataResidency: 'CL',
    });

    const reread = await getDataAccessRequest(db, req.id);
    expect(reread).not.toBeNull();
    expect(reread!.subjectCountry).toBe('CL');
    expect(reread!.deadlineAt).toBe(req.deadlineAt);
    expect(reread!.regime).toBe(req.regime);
  });

  it('el plazo se calcula desde el dato persistido, no desde la fecha actual', async () => {
    const db = makeDb();
    const req = await requestDataAccess(db, 'uid-C', 'access', {
      subjectCountry: 'BR',
      dataResidency: 'BR',
    });

    // Avanzamos 30 días. La deadline persistida debe ser estable
    // (no se recalcula contra Date.now() cada vez que se recarga).
    vi.setSystemTime(NOW + 30 * DAY);
    const reread = await getDataAccessRequest(db, req.id);
    expect(reread!.deadlineAt).toBe(req.deadlineAt);
    expect(reread!.requestedAt).toBe(req.requestedAt);
  });

  it('sin country/residency → deadline null (no default silencioso)', async () => {
    // Política: sin contexto regulatorio NO se inventa una deadline.
    // El runbook lo decide el equipo de compliance; el sistema no
    // asume un default.
    const db = makeDb();
    const req = await requestDataAccess(db, 'uid-D', 'portability');
    expect(req.id).toBeTruthy();
    expect(req.deadlineAt).toBeUndefined();
  });

  it('país con deadline default (no BR/CL/GDPR-list) → 30d regime=default', async () => {
    const db = makeDb();
    const req = await requestDataAccess(db, 'uid-E', 'access', {
      subjectCountry: 'AR',
      dataResidency: 'AR',
    });
    expect(req.regime).toBe('default');
    expect(req.deadlineDays).toBe(30);
    expect(req.deadlineAt).toBe(NOW + 30 * DAY);
  });
});
