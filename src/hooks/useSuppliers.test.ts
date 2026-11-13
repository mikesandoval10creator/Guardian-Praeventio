import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  recordSupplierAudit,
  recordSupplierIncident,
  registerSupplier,
} from './useSuppliers';

vi.mock('../services/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('../lib/apiAuth', () => ({ apiAuthHeader: async () => null }));

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('supplier mutations use human-readable HTTP results', () => {
  it('returns the supplier on a successful create response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(201, {
          ok: true,
          message: 'Proveedor registrado correctamente.',
          supplier: { id: 's1', legalName: 'Proveedor X' },
        }),
      ),
    );

    await expect(
      registerSupplier('p1', {
        name: 'Proveedor X',
        taxId: '12.345.678-9',
        services: ['soldadura'],
      }),
    ).resolves.toMatchObject({ id: 's1', legalName: 'Proveedor X' });
  });

  it('explains a duplicate supplier id instead of exposing 409 or the machine code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          error: 'supplier_duplicate_id',
          message:
            'Este proveedor ya está registrado en este proyecto. No se creó un registro duplicado ni se modificaron los datos existentes. Revisa el listado; si necesitas corregirlo, consulta con un administrador.',
        }),
      ),
    );

    await expect(
      registerSupplier('p1', {
        name: 'Proveedor X',
        taxId: '12.345.678-9',
        services: ['soldadura'],
      }),
    ).rejects.toThrow(/proveedor ya está registrado en este proyecto/i);
  });

  it('explains a missing supplier on a 404 incident response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(404, { error: 'supplier_not_found' })),
    );

    await expect(
      recordSupplierIncident('p1', 'missing', {
        occurredAt: '2026-05-01T00:00:00.000Z',
        severity: 'near_miss',
        description: 'Casi incidente',
      }),
    ).rejects.toThrow(/no encontramos este proveedor/i);
  });

  it('explains a server failure on a 500 audit response without exposing its code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(500, { error: 'internal_error' })),
    );

    await expect(
      recordSupplierAudit('p1', 's1', {
        auditedAt: '2026-05-01T00:00:00.000Z',
        documentComplianceRatio: 0.9,
        avgResponseHours: 4,
        reputationScore: 0.8,
      }),
    ).rejects.toThrow(/servidor tuvo un problema/i);
  });
});
