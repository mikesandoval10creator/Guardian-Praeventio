import { describe, it, expect } from 'vitest';
import { AuditPortalAdapter, hashAccessToken } from './auditPortalFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import { createPortal } from './externalAuditPortal.js';

function makePortal(
  over: { id?: string; auditorAffiliation?: 'suseso' | 'mandante' | 'mutualidad'; createdAt?: string } = {},
) {
  return createPortal({
    id: over.id ?? 'ap-1',
    createdByUid: 'admin-1',
    auditorName: 'Ana Fiscalizadora',
    auditorAffiliation: over.auditorAffiliation ?? 'suseso',
    scopeProjectIds: ['p1'],
    scopeModules: ['documents', 'incidents'],
    ttlDays: 14,
    now: new Date(over.createdAt ?? '2026-05-11T08:00:00Z'),
  });
}

describe('AuditPortalAdapter', () => {
  it('save almacena hash y NO plaintext del token', async () => {
    const db = createFakeFirestore();
    const a = new AuditPortalAdapter(db, 't1');
    const p = makePortal();
    await a.save(p);
    const got = await a.getById(p.id);
    expect(got).not.toBeNull();
    // El campo accessToken NO debe existir en lo almacenado
    expect((got as any).accessToken).toBeUndefined();
    expect(got!.accessTokenHash).toBe(hashAccessToken(p.accessToken));
  });

  it('findByToken resuelve por token plaintext (vía hash)', async () => {
    const db = createFakeFirestore();
    const a = new AuditPortalAdapter(db, 't1');
    const p = makePortal();
    await a.save(p);
    const found = await a.findByToken(p.accessToken);
    expect(found?.id).toBe(p.id);
  });

  it('findByToken devuelve null con token inválido', async () => {
    const db = createFakeFirestore();
    const a = new AuditPortalAdapter(db, 't1');
    await a.save(makePortal());
    const found = await a.findByToken('token-falso-no-existe');
    expect(found).toBeNull();
  });

  it('markRevoked persiste motivo y autor', async () => {
    const db = createFakeFirestore();
    const a = new AuditPortalAdapter(db, 't1');
    await a.save(makePortal());
    await a.markRevoked('ap-1', '2026-05-12T10:00:00Z', 'admin-2', 'fiscalización completada');
    const got = await a.getById('ap-1');
    expect(got?.revokedAt).toBe('2026-05-12T10:00:00Z');
    expect(got?.revokedByUid).toBe('admin-2');
    expect(got?.revokedReason).toContain('fiscalización');
  });

  it('listByAffiliation filtra y ordena desc', async () => {
    const db = createFakeFirestore();
    const a = new AuditPortalAdapter(db, 't1');
    await a.save(makePortal({ id: 'p-old', auditorAffiliation: 'suseso', createdAt: '2026-05-10T08:00:00Z' }));
    await a.save(makePortal({ id: 'p-new', auditorAffiliation: 'suseso', createdAt: '2026-05-11T08:00:00Z' }));
    await a.save(makePortal({ id: 'p-other', auditorAffiliation: 'mandante', createdAt: '2026-05-11T08:00:00Z' }));
    const list = await a.listByAffiliation('suseso');
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('p-new');
  });

  it('appendAccessLog + listAccessLogs en subcollection', async () => {
    const db = createFakeFirestore();
    const a = new AuditPortalAdapter(db, 't1');
    await a.save(makePortal());
    await a.appendAccessLog({
      portalId: 'ap-1',
      accessedAt: '2026-05-11T09:00:00Z',
      module: 'documents',
      downloaded: false,
    });
    await a.appendAccessLog({
      portalId: 'ap-1',
      accessedAt: '2026-05-11T10:00:00Z',
      module: 'incidents',
      downloaded: true,
      payloadBytes: 12345,
    });
    const logs = await a.listAccessLogs('ap-1');
    expect(logs).toHaveLength(2);
    // Orden desc por accessedAt
    expect(logs[0].accessedAt).toBe('2026-05-11T10:00:00Z');
    expect(logs[0].downloaded).toBe(true);
  });
});
