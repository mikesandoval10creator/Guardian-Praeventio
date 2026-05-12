import { describe, it, expect } from 'vitest';
import {
  createPortal,
  derivePortalStatus,
  revokePortal,
  checkAccess,
  summarizePortalUsage,
  generateAccessToken,
  PortalValidationError,
  type CreatePortalInput,
  type AuditPortalConfig,
} from './externalAuditPortal.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function validInput(over: Partial<CreatePortalInput> = {}): CreatePortalInput {
  return {
    id: 'portal-1',
    createdByUid: 'prev-1',
    auditorName: 'Auditor SUSESO Ramón',
    auditorAffiliation: 'suseso',
    scopeProjectIds: ['p1'],
    scopeModules: ['documents', 'incidents'],
    ttlDays: 14,
    now: NOW,
    ...over,
  };
}

describe('generateAccessToken', () => {
  it('genera token único de 64 chars hex', () => {
    const t1 = generateAccessToken();
    const t2 = generateAccessToken();
    expect(t1).toMatch(/^[a-f0-9]{64}$/);
    expect(t2).toMatch(/^[a-f0-9]{64}$/);
    expect(t1).not.toBe(t2);
  });
});

describe('createPortal', () => {
  it('crea portal con token + expiresAt', () => {
    const p = createPortal(validInput());
    expect(p.accessToken).toHaveLength(64);
    expect(p.expiresAt).toBe(new Date(NOW.getTime() + 14 * 86_400_000).toISOString());
  });

  it('rechaza ttlDays > 90', () => {
    expect(() => createPortal(validInput({ ttlDays: 120 }))).toThrow(/TTL_OUT_OF_RANGE/);
  });

  it('rechaza ttlDays < 1', () => {
    expect(() => createPortal(validInput({ ttlDays: 0 }))).toThrow(/TTL_OUT_OF_RANGE/);
  });

  it('rechaza scope vacío', () => {
    expect(() => createPortal(validInput({ scopeProjectIds: [] }))).toThrow(/EMPTY_SCOPE/);
    expect(() => createPortal(validInput({ scopeModules: [] }))).toThrow(/EMPTY_MODULES/);
  });

  it('rechaza auditorName muy corto', () => {
    expect(() => createPortal(validInput({ auditorName: 'AB' }))).toThrow(
      /AUDITOR_NAME_TOO_SHORT/,
    );
  });
});

describe('derivePortalStatus', () => {
  it('active dentro de validity', () => {
    const p = createPortal(validInput());
    expect(derivePortalStatus(p, NOW)).toBe('active');
  });

  it('expired pasado expiresAt', () => {
    const p = createPortal(validInput({ ttlDays: 1 }));
    const future = new Date(NOW.getTime() + 3 * 86_400_000);
    expect(derivePortalStatus(p, future)).toBe('expired');
  });

  it('revoked tras revoke explícito', () => {
    const p = revokePortal(createPortal(validInput()), 'admin-1', 'auditoría completada', NOW);
    expect(derivePortalStatus(p, NOW)).toBe('revoked');
  });
});

describe('revokePortal', () => {
  it('marca revokedAt + revokedByUid', () => {
    const p = revokePortal(
      createPortal(validInput()),
      'admin-1',
      'tarea de auditoría completada exitosamente',
      NOW,
    );
    expect(p.revokedAt).toBe(NOW.toISOString());
    expect(p.revokedByUid).toBe('admin-1');
    expect(p.revokedReason).toContain('completada');
  });

  it('rechaza doble revoke', () => {
    const p1 = revokePortal(createPortal(validInput()), 'admin-1', 'razón válida', NOW);
    expect(() => revokePortal(p1, 'admin-2', 'segundo intento', NOW)).toThrow(/ALREADY_REVOKED/);
  });

  it('rechaza razón corta', () => {
    expect(() =>
      revokePortal(createPortal(validInput()), 'admin', 'corto', NOW),
    ).toThrow(/REASON_TOO_SHORT/);
  });
});

describe('checkAccess', () => {
  it('allowed si token correcto + module en scope + project en scope', () => {
    const p = createPortal(validInput());
    const r = checkAccess(p, { token: p.accessToken, module: 'documents', projectId: 'p1' }, NOW);
    expect(r.allowed).toBe(true);
  });

  it('rechaza si portal=null', () => {
    expect(checkAccess(null, { token: 'x', module: 'documents', projectId: 'p1' }).reason).toBe(
      'token_unknown',
    );
  });

  it('rechaza si token no coincide', () => {
    const p = createPortal(validInput());
    expect(
      checkAccess(p, { token: 'wrong', module: 'documents', projectId: 'p1' }).reason,
    ).toBe('token_unknown');
  });

  it('rechaza si portal expirado', () => {
    const p = createPortal(validInput({ ttlDays: 1 }));
    const future = new Date(NOW.getTime() + 3 * 86_400_000);
    expect(
      checkAccess(
        p,
        { token: p.accessToken, module: 'documents', projectId: 'p1' },
        future,
      ).reason,
    ).toBe('portal_expired');
  });

  it('rechaza si portal revocado', () => {
    const p = revokePortal(createPortal(validInput()), 'admin', 'razón válida', NOW);
    expect(
      checkAccess(p, { token: p.accessToken, module: 'documents', projectId: 'p1' }, NOW).reason,
    ).toBe('portal_revoked');
  });

  it('rechaza si module no está en scope', () => {
    const p = createPortal(validInput({ scopeModules: ['documents'] }));
    expect(
      checkAccess(p, { token: p.accessToken, module: 'incidents', projectId: 'p1' }, NOW).reason,
    ).toBe('module_not_in_scope');
  });

  it('rechaza si projectId no está en scope', () => {
    const p = createPortal(validInput({ scopeProjectIds: ['p1'] }));
    expect(
      checkAccess(p, { token: p.accessToken, module: 'documents', projectId: 'p99' }, NOW).reason,
    ).toBe('project_not_in_scope');
  });
});

describe('summarizePortalUsage', () => {
  it('cuenta accesos + downloads + módulos únicos', () => {
    const p: AuditPortalConfig = createPortal(validInput());
    const logs = [
      { portalId: p.id, accessedAt: '2026-05-12T10:00:00Z', module: 'documents' as const, downloaded: false },
      { portalId: p.id, accessedAt: '2026-05-12T11:00:00Z', module: 'documents' as const, downloaded: true },
      { portalId: p.id, accessedAt: '2026-05-13T09:00:00Z', module: 'incidents' as const, downloaded: false },
      { portalId: 'other-portal', accessedAt: '2026-05-13T10:00:00Z', module: 'documents' as const, downloaded: true },
    ];
    const summary = summarizePortalUsage(p, logs);
    expect(summary.totalAccesses).toBe(3);
    expect(summary.totalDownloads).toBe(1);
    expect(summary.uniqueModulesAccessed).toBe(2);
    expect(summary.lastAccessAt).toBe('2026-05-13T09:00:00Z');
  });
});
