// @vitest-environment node
// Praeventio Guard — listar las solicitudes del usuario autenticado
// (tarea [P1][privacidad] "El usuario no puede recuperar el historial
// de solicitudes"). Hoy existe GET /data-request/:id individual pero
// no GET /data-requests (lista). La UI de MyData pierde las solicitudes
// tras recarga. Esta serie agrega el list endpoint seguro y la
// pieza de service listDataAccessRequests() que sólo devuelve
// documentos del `uid` autenticado (aislamiento por tenant/usuario).
//
// Diseño: 100% server-authoritative. El cliente NO pasa el uid; el
// endpoint lo lee de req.user.uid. Sin orden-por-importante — la
// UI ordena localmente. Cap 50 (suficiente para una bandeja
// realista; un export es una, no 50).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  listDataAccessRequests,
  type MinimalComplianceDb,
  type DataAccessRequest,
} from './ley19628.js';

const NOW = 1_750_000_000_000;

function makeDb(requests: DataAccessRequest[]) {
  const map = new Map<string, DataAccessRequest>();
  for (const r of requests) map.set(r.id, r);
  return {
    collection() {
      return {
        where(field: string, op: string, val: any) {
          return {
            async get() {
              const out = Array.from(map.values()).filter(
                (r) => op === '==' && r[field as keyof DataAccessRequest] === val,
              );
              return { docs: out.map((data) => ({ id: data.id, data: () => ({ ...data }) })) };
            },
          };
        },
        doc() {
          return {
            async get() {
              return { exists: false, data: () => undefined };
            },
          };
        },
      };
    },
    _map: map,
  } as unknown as MinimalComplianceDb;
}

describe('listDataAccessRequests', () => {
  beforeEach(() => vi.setSystemTime(NOW));

  it('devuelve solo las solicitudes del uid solicitado', async () => {
    const db = makeDb([
      { id: 'r-1', uid: 'uid-A', type: 'access', status: 'pending', requestedAt: 1 },
      { id: 'r-2', uid: 'uid-A', type: 'erasure', status: 'completed', requestedAt: 2 },
      { id: 'r-3', uid: 'uid-B', type: 'access', status: 'pending', requestedAt: 3 },
    ]);
    const list = await listDataAccessRequests(db, 'uid-A');
    expect(list.map((r) => r.id).sort()).toEqual(['r-1', 'r-2']);
  });

  it('lista vacía para uid sin solicitudes', async () => {
    const db = makeDb([
      { id: 'r-1', uid: 'uid-B', type: 'access', status: 'pending', requestedAt: 1 },
    ]);
    const list = await listDataAccessRequests(db, 'uid-A');
    expect(list).toEqual([]);
  });

  it('cap 50 (bandeja realista)', async () => {
    const requests: DataAccessRequest[] = [];
    for (let i = 0; i < 200; i++) {
      requests.push({
        id: `r-${i}`,
        uid: 'uid-A',
        type: 'access',
        status: 'pending',
        requestedAt: i,
      });
    }
    const db = makeDb(requests);
    const list = await listDataAccessRequests(db, 'uid-A', 50);
    expect(list).toHaveLength(50);
  });

  it('rechaza uid vacío (defensa contra error de auth)', async () => {
    const db = makeDb([]);
    await expect(listDataAccessRequests(db, '')).rejects.toThrow();
  });
});
