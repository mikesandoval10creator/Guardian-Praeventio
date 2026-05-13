import { describe, it, expect } from 'vitest';
import {
  decideRetention,
  checkConsent,
  piiBucketFor,
  sensitivityForCategory,
  type DataRecord,
  type ConsentArtifact,
} from './dataRetentionPolicy.js';

const NOW = new Date('2026-05-12T22:00:00Z');

function rec(over: Partial<DataRecord>): DataRecord {
  return {
    id: 'r-1',
    category: 'incident',
    jurisdiction: 'CL',
    createdAt: '2026-04-12T00:00:00Z',
    ...over,
  };
}

describe('decideRetention', () => {
  it('incidente fresco → keep_active', () => {
    const d = decideRetention(rec({ category: 'incident' }), { now: NOW });
    expect(d.action).toBe('keep_active');
  });

  it('incidente +6 años → archive_immutable', () => {
    const d = decideRetention(
      rec({ category: 'incident', createdAt: '2020-01-01T00:00:00Z' }),
      { now: NOW },
    );
    expect(d.action).toBe('archive_immutable');
  });

  it('incidente +11 años → purge', () => {
    const d = decideRetention(
      rec({ category: 'incident', createdAt: '2015-01-01T00:00:00Z' }),
      { now: NOW },
    );
    expect(d.action).toBe('purge');
  });

  it('legal hold bloquea purge → forzar archive_immutable', () => {
    const d = decideRetention(
      rec({ category: 'incident', createdAt: '2015-01-01T00:00:00Z', legalHold: true }),
      { now: NOW },
    );
    expect(d.action).toBe('archive_immutable');
    expect(d.blockedByLegalHold).toBe(true);
  });

  it('retentionOverrideDays extiende ventana total', () => {
    const d = decideRetention(
      rec({
        category: 'attendance',
        createdAt: '2023-01-01T00:00:00Z',
        retentionOverrideDays: 3650,
      }),
      { now: NOW },
    );
    // Default attendance total 1095d; override +3650 → 4745d
    expect(d.effectiveRetentionDays).toBe(4745);
  });

  it('aptitud médica 30 años — record antiguo igual retenido', () => {
    const d = decideRetention(
      rec({ category: 'medical_aptitude', createdAt: '2010-01-01T00:00:00Z' }),
      { now: NOW },
    );
    // Total 10950d (30 años); record tiene ~16 años → archive
    expect(d.action).toBe('archive_immutable');
  });

  it('sensor_telemetry 90d activo → datos viejos archivados rápido', () => {
    const d = decideRetention(
      rec({ category: 'sensor_telemetry', createdAt: '2025-01-01T00:00:00Z' }),
      { now: NOW },
    );
    expect(['archive_immutable', 'purge']).toContain(d.action);
  });

  it('jurisdicción sin regla custom usa fallback CL', () => {
    const d = decideRetention(
      rec({ category: 'incident', jurisdiction: 'MX', createdAt: '2026-04-12T00:00:00Z' }),
      { now: NOW },
    );
    // Same as CL incident → keep_active
    expect(d.action).toBe('keep_active');
  });
});

describe('checkConsent', () => {
  const baseArtifact: ConsentArtifact = {
    subjectUid: 'w1',
    purpose: 'medical_data_share_mutual',
    grantedAt: '2026-04-01T00:00:00Z',
    legalTextVersion: 'v1.0',
    signatureMethod: 'webauthn',
  };

  it('sin artefacto → not granted', () => {
    const c = checkConsent(null, { now: NOW, currentLegalTextVersion: 'v1.0' });
    expect(c.granted).toBe(false);
    expect(c.revoked).toBe(false);
  });

  it('artefacto vigente con versión match → granted', () => {
    const c = checkConsent(baseArtifact, { now: NOW, currentLegalTextVersion: 'v1.0' });
    expect(c.granted).toBe(true);
    expect(c.gracePeriod).toBeUndefined();
  });

  it('revocación previa → revoked', () => {
    const c = checkConsent(
      { ...baseArtifact, revokedAt: '2026-05-01T00:00:00Z' },
      { now: NOW, currentLegalTextVersion: 'v1.0' },
    );
    expect(c.granted).toBe(false);
    expect(c.revoked).toBe(true);
  });

  it('texto legal cambió + dentro grace → granted con grace flag', () => {
    const recent: ConsentArtifact = {
      ...baseArtifact,
      grantedAt: '2026-05-08T00:00:00Z',
    };
    const c = checkConsent(recent, {
      now: NOW,
      currentLegalTextVersion: 'v2.0',
      graceDays: 14,
    });
    expect(c.granted).toBe(true);
    expect(c.gracePeriod).toBe(true);
  });

  it('texto legal cambió + fuera grace → not granted', () => {
    const c = checkConsent(baseArtifact, {
      now: NOW,
      currentLegalTextVersion: 'v2.0',
      graceDays: 14,
    });
    expect(c.granted).toBe(false);
    expect(c.gracePeriod).toBeUndefined();
  });
});

describe('piiBucketFor (ADR 0012 separation)', () => {
  it('medical bucket exige role claim', () => {
    const b = piiBucketFor('medical');
    expect(b.requiresMedicalRoleClaim).toBe(true);
    expect(b.firestoreCollectionPrefix).toBe('tenants_medical/');
  });

  it('public bucket sin role claim', () => {
    const b = piiBucketFor('public');
    expect(b.requiresMedicalRoleClaim).toBe(false);
  });

  it('sensitive es distinto de medical (no double-lock)', () => {
    const m = piiBucketFor('medical');
    const s = piiBucketFor('sensitive');
    expect(m.firestoreCollectionPrefix).not.toBe(s.firestoreCollectionPrefix);
    expect(s.requiresMedicalRoleClaim).toBe(false);
  });
});

describe('sensitivityForCategory', () => {
  it('medical_aptitude + medical_diagnosis → medical sensitivity', () => {
    expect(sensitivityForCategory('medical_aptitude')).toBe('medical');
    expect(sensitivityForCategory('medical_diagnosis')).toBe('medical');
  });

  it('incident + audit_log + consent → sensitive', () => {
    expect(sensitivityForCategory('incident')).toBe('sensitive');
    expect(sensitivityForCategory('audit_log')).toBe('sensitive');
    expect(sensitivityForCategory('consent_artifact')).toBe('sensitive');
  });

  it('training + attendance + epp → internal', () => {
    expect(sensitivityForCategory('training_record')).toBe('internal');
    expect(sensitivityForCategory('attendance')).toBe('internal');
    expect(sensitivityForCategory('epp_assignment')).toBe('internal');
  });
});
