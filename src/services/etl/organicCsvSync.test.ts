// SPDX-License-Identifier: MIT
// Phase 5 — csv-crews-fix — behavioral tests for the server-routed CSV
// import of crews/processes. Exercises the REAL mapping + per-row error
// handling against an injected fetch stub (no network, no mirror of the
// handler).

import { describe, it, expect, vi } from 'vitest';
import {
  mapCrewRowToPayload,
  mapProcessRowToPayload,
  importCrewsViaApi,
  importProcessesViaApi,
  type FetchLike,
} from './organicCsvSync';
import type { Crew, Process } from '../../types/organic';

function okResponse(body: unknown = { success: true, id: 'x' }) {
  return { ok: true, status: 201, json: async () => body };
}
function errResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body };
}

const PROJECT = 'proj-1';

describe('mapCrewRowToPayload', () => {
  it('maps a valid crew row to the POST /api/crews payload', () => {
    const row: Partial<Crew> = { name: '  Cuadrilla A  ', memberUids: ['u1', 'u2'] };
    const res = mapCrewRowToPayload(row, PROJECT);
    expect(res).toEqual({
      ok: true,
      payload: { projectId: PROJECT, name: 'Cuadrilla A', memberUids: ['u1', 'u2'] },
    });
  });

  it('defaults memberUids to [] and trims falsy uids', () => {
    const row = { name: 'B', memberUids: ['u1', '', 'u3'] } as unknown as Partial<Crew>;
    const res = mapCrewRowToPayload(row, PROJECT);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.payload.memberUids).toEqual(['u1', 'u3']);
  });

  it('reports a missing name instead of mapping it', () => {
    const res = mapCrewRowToPayload({ name: '   ' }, PROJECT);
    expect(res).toEqual({ ok: false, reason: 'columna "name" requerida' });
  });
});

describe('mapProcessRowToPayload', () => {
  it('maps a valid process row to the POST /api/processes payload', () => {
    const row: Partial<Process> = {
      name: 'Vaciado losa',
      crewId: 'crew-1',
      type: 'concreto',
      description: 'desc',
      plannedEndDate: '2026-07-01',
    };
    const res = mapProcessRowToPayload(row, PROJECT);
    expect(res).toEqual({
      ok: true,
      payload: {
        projectId: PROJECT,
        crewId: 'crew-1',
        type: 'concreto',
        name: 'Vaciado losa',
        description: 'desc',
        plannedEndDate: '2026-07-01',
      },
    });
  });

  it('requires crewId (a process cannot exist without an owning crew)', () => {
    const res = mapProcessRowToPayload({ name: 'X', crewId: '' }, PROJECT);
    expect(res).toEqual({ ok: false, reason: 'columna "crewId" requerida' });
  });

  it('normalises an empty plannedEndDate to null', () => {
    const res = mapProcessRowToPayload(
      { name: 'X', crewId: 'c1', plannedEndDate: '' } as Partial<Process>,
      PROJECT,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.payload.plannedEndDate).toBeNull();
  });
});

describe('importCrewsViaApi', () => {
  it('POSTs each row to /api/crews and reports written count', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fetchImpl: FetchLike = vi.fn(async (url, init) => {
      calls.push({ url, body: JSON.parse(init!.body!) });
      return okResponse();
    });
    const rows: Array<Partial<Crew>> = [
      { name: 'A', memberUids: [] },
      { name: 'B', memberUids: ['u1'] },
    ];
    const result = await importCrewsViaApi(rows, {
      projectId: PROJECT,
      fetchImpl,
      authHeader: 'Bearer test',
    });

    expect(result).toEqual({ written: 2, failed: 0, rowErrors: [] });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('/api/crews');
    expect(calls[0].body).toEqual({ projectId: PROJECT, name: 'A', memberUids: [] });
    // Identity is NEVER sent from the client — the server stamps createdBy.
    expect(calls[1].body).not.toHaveProperty('createdBy');
  });

  it('attaches the Authorization header to every request', async () => {
    const headers: Array<Record<string, string> | undefined> = [];
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      headers.push(init?.headers);
      return okResponse();
    });
    await importCrewsViaApi([{ name: 'A' }], {
      projectId: PROJECT,
      fetchImpl,
      authHeader: 'Bearer abc',
    });
    expect(headers[0]?.Authorization).toBe('Bearer abc');
  });

  it('captures per-row failures without aborting the batch', async () => {
    let n = 0;
    const fetchImpl: FetchLike = vi.fn(async () => {
      n += 1;
      // 2nd row gets a 403 from the server.
      return n === 2 ? errResponse(403, { error: 'forbidden' }) : okResponse();
    });
    const rows: Array<Partial<Crew>> = [
      { name: 'A' },
      { name: 'B' },
      { name: 'C' },
    ];
    const result = await importCrewsViaApi(rows, {
      projectId: PROJECT,
      fetchImpl,
      authHeader: 'Bearer test',
    });
    expect(result.written).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.rowErrors).toEqual([{ row: 2, reason: 'forbidden' }]);
  });

  it('reports invalid rows locally without firing a request', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const rows = [{ name: '' }, { name: 'Good' }] as Array<Partial<Crew>>;
    const result = await importCrewsViaApi(rows, {
      projectId: PROJECT,
      fetchImpl,
      authHeader: 'Bearer test',
    });
    expect(result.written).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.rowErrors).toEqual([{ row: 1, reason: 'columna "name" requerida' }]);
    // Only the valid row reached the network.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails every row visibly when there is no auth session', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const result = await importCrewsViaApi([{ name: 'A' }, { name: 'B' }], {
      projectId: PROJECT,
      fetchImpl,
      authHeader: null,
    });
    expect(result.written).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.rowErrors.map((e) => e.reason)).toEqual([
      'sesión no disponible',
      'sesión no disponible',
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('records a network throw as a row error', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => {
      throw new Error('boom');
    });
    const result = await importCrewsViaApi([{ name: 'A' }], {
      projectId: PROJECT,
      fetchImpl,
      authHeader: 'Bearer test',
    });
    expect(result.failed).toBe(1);
    expect(result.rowErrors[0]).toEqual({ row: 1, reason: 'boom' });
  });
});

describe('importProcessesViaApi', () => {
  it('POSTs to /api/processes and forwards crewId + type', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fetchImpl: FetchLike = vi.fn(async (url, init) => {
      calls.push({ url, body: JSON.parse(init!.body!) });
      return okResponse();
    });
    const rows: Array<Partial<Process>> = [
      { name: 'P1', crewId: 'crew-1', type: 'soldadura' },
    ];
    const result = await importProcessesViaApi(rows, {
      projectId: PROJECT,
      fetchImpl,
      authHeader: 'Bearer test',
    });
    expect(result.written).toBe(1);
    expect(calls[0].url).toBe('/api/processes');
    expect(calls[0].body).toMatchObject({
      projectId: PROJECT,
      crewId: 'crew-1',
      type: 'soldadura',
      name: 'P1',
    });
  });

  it('reports rows missing crewId without calling the API for them', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const rows: Array<Partial<Process>> = [
      { name: 'No crew' },
      { name: 'Has crew', crewId: 'c1' },
    ];
    const result = await importProcessesViaApi(rows, {
      projectId: PROJECT,
      fetchImpl,
      authHeader: 'Bearer test',
    });
    expect(result.written).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.rowErrors).toEqual([{ row: 1, reason: 'columna "crewId" requerida' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
