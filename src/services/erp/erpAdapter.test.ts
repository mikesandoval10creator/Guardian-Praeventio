// Praeventio Guard — Tests del ERP adapter honesto.
//
// Cubre:
//   - selectErpAdapter() devuelve null cuando ERP_ADAPTER no está seteado
//   - MockErpAdapter devuelve mode:'mock' sin setTimeout ni I/O
//   - Adapters reales (SAP/Buk/Talana) tiran ErpMissingCredentialsError si
//     faltan credenciales (NO simulan éxito)
//   - Adapters reales tiran ErpNotImplementedError cuando hay credenciales
//     pero la acción no está implementada (NO simulan éxito)
//   - buildNotConfiguredResult() construye respuesta honesta

import { describe, it, expect } from 'vitest';
import {
  selectErpAdapter,
  MockErpAdapter,
  SapAdapter,
  BukAdapter,
  TalanaAdapter,
  ErpMissingCredentialsError,
  ErpNotImplementedError,
  buildNotConfiguredResult,
} from './erpAdapter.js';

describe('selectErpAdapter', () => {
  it('devuelve null cuando ERP_ADAPTER no está seteado', () => {
    const adapter = selectErpAdapter({ env: {} });
    expect(adapter).toBeNull();
  });

  it('devuelve MockErpAdapter cuando ERP_ADAPTER=mock', () => {
    const adapter = selectErpAdapter({ env: { ERP_ADAPTER: 'mock' } });
    expect(adapter).toBeInstanceOf(MockErpAdapter);
    expect(adapter?.name).toBe('mock');
  });

  it('devuelve SapAdapter cuando ERP_ADAPTER=sap', () => {
    const adapter = selectErpAdapter({
      env: {
        ERP_ADAPTER: 'sap',
        ERP_SAP_BASE_URL: 'https://sap.example.com',
        ERP_SAP_CLIENT_ID: 'id',
        ERP_SAP_CLIENT_SECRET: 'secret',
      },
    });
    expect(adapter).toBeInstanceOf(SapAdapter);
  });

  it('devuelve BukAdapter cuando ERP_ADAPTER=buk', () => {
    const adapter = selectErpAdapter({
      env: {
        ERP_ADAPTER: 'buk',
        ERP_BUK_BASE_URL: 'https://api.buk.cl',
        ERP_BUK_API_KEY: 'key',
      },
    });
    expect(adapter).toBeInstanceOf(BukAdapter);
  });

  it('devuelve TalanaAdapter cuando ERP_ADAPTER=talana', () => {
    const adapter = selectErpAdapter({
      env: {
        ERP_ADAPTER: 'talana',
        ERP_TALANA_BASE_URL: 'https://api.talana.com',
        ERP_TALANA_API_KEY: 'key',
      },
    });
    expect(adapter).toBeInstanceOf(TalanaAdapter);
  });

  it('devuelve null para adapter desconocido', () => {
    const adapter = selectErpAdapter({

      env: { ERP_ADAPTER: 'oracle' as any },
    });
    expect(adapter).toBeNull();
  });
});

describe('MockErpAdapter', () => {
  it('devuelve mode:"mock" inmediatamente sin I/O', async () => {
    const adapter = new MockErpAdapter();
    const start = Date.now();
    const result = await adapter.sync({
      tenantId: 't1',
      action: 'manual_sync',
    });
    const elapsed = Date.now() - start;
    // Debe ser INSTANTÁNEO — sin setTimeout fake delay
    expect(elapsed).toBeLessThan(50);
    expect(result.mode).toBe('mock');
    expect(result.ok).toBe(true);
  });

  it('marca explícitamente que NO es real en el message', async () => {
    const adapter = new MockErpAdapter();
    const result = await adapter.sync({
      tenantId: 't1',
      action: 'fetch_employees',
    });
    expect(result.message).toMatch(/MOCK/);
    expect(result.message).toMatch(/NO se conectó/);
  });

  it('incluye reason para que el front muestre banner', async () => {
    const adapter = new MockErpAdapter();
    const result = await adapter.sync({
      tenantId: 't1',
      action: 'manual_sync',
    });
    expect(result.reason).toMatch(/mock/);
  });
});

describe('SapAdapter (real, stub)', () => {
  it('tira ErpMissingCredentialsError si faltan credenciales', async () => {
    const adapter = new SapAdapter({});
    await expect(
      adapter.sync({ tenantId: 't1', action: 'manual_sync' }),
    ).rejects.toBeInstanceOf(ErpMissingCredentialsError);
  });

  it('tira ErpNotImplementedError con credenciales válidas (stub)', async () => {
    const adapter = new SapAdapter({
      baseUrl: 'https://sap.example.com',
      clientId: 'id',
      clientSecret: 'secret',
    });
    await expect(
      adapter.sync({ tenantId: 't1', action: 'manual_sync' }),
    ).rejects.toBeInstanceOf(ErpNotImplementedError);
  });

  it('lista las keys faltantes en el error', async () => {
    const adapter = new SapAdapter({ baseUrl: 'x' }); // falta clientId, clientSecret
    try {
      await adapter.sync({ tenantId: 't1', action: 'manual_sync' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ErpMissingCredentialsError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/clientId/);
      expect(msg).toMatch(/clientSecret/);
      expect(msg).not.toMatch(/baseUrl/);
    }
  });
});

describe('BukAdapter (real, stub)', () => {
  it('requiere apiKey, no clientId/secret', async () => {
    const adapter = new BukAdapter({ baseUrl: 'https://api.buk.cl' });
    try {
      await adapter.sync({ tenantId: 't1', action: 'fetch_employees' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ErpMissingCredentialsError);
      expect((err as Error).message).toMatch(/apiKey/);
    }
  });
});

describe('buildNotConfiguredResult', () => {
  it('construye respuesta honesta cuando no hay ERP_ADAPTER', () => {
    const result = buildNotConfiguredResult({
      tenantId: 't1',
      action: 'manual_sync',
    });
    expect(result.ok).toBe(false);
    expect(result.mode).toBe('not_configured');
    expect(result.message).toMatch(/no está configurada/);
    expect(result.reason).toMatch(/ERP_ADAPTER/);
  });
});
