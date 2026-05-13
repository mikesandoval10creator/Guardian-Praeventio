import { describe, it, expect } from 'vitest';
import {
  evaluateOnboardingStage,
  listMissingMandatory,
  listRejectedRequirements,
  buildClientRequirementsBundle,
  computeExpiresAt,
  isComplianceExpired,
  type VendorOnboardingState,
  type VendorRequirement,
  type VendorRequirementCompliance,
} from './vendorOnboardingFlow.js';

const NOW = '2026-05-13T12:00:00.000Z';

function state(overrides: Partial<VendorOnboardingState> = {}): VendorOnboardingState {
  return {
    vendorId: 'v1',
    legalName: 'Constructora Foo Ltda.',
    invitedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function req(
  id: string,
  overrides: Partial<VendorRequirement> = {},
): VendorRequirement {
  return {
    id,
    label: id,
    kind: 'document',
    mandatory: true,
    ...overrides,
  };
}

function comp(
  requirementId: string,
  status: VendorRequirementCompliance['status'],
  overrides: Partial<VendorRequirementCompliance> = {},
): VendorRequirementCompliance {
  return {
    vendorId: 'v1',
    requirementId,
    status,
    ...overrides,
  };
}

describe('evaluateOnboardingStage', () => {
  const reqs = [
    req('rut'),
    req('contract'),
    req('insurance', { kind: 'insurance' }),
    req('iso45001', { kind: 'certification', mandatory: false }),
  ];

  it('returns "invited" when no compliance submitted', () => {
    const s = state();
    expect(evaluateOnboardingStage(s, [], reqs, NOW)).toBe('invited');
  });

  it('returns "invited" when only some mandatory are submitted', () => {
    const s = state();
    const c = [comp('rut', 'submitted')];
    expect(evaluateOnboardingStage(s, c, reqs, NOW)).toBe('invited');
  });

  it('returns "docs_uploaded" when all mandatory are submitted but not approved', () => {
    const s = state();
    const c = [
      comp('rut', 'submitted'),
      comp('contract', 'submitted'),
      comp('insurance', 'submitted'),
    ];
    expect(evaluateOnboardingStage(s, c, reqs, NOW)).toBe('docs_uploaded');
  });

  it('returns "docs_validated" when all mandatory are approved', () => {
    const s = state();
    const c = [
      comp('rut', 'approved'),
      comp('contract', 'approved'),
      comp('insurance', 'approved'),
    ];
    expect(evaluateOnboardingStage(s, c, reqs, NOW)).toBe('docs_validated');
  });

  it('ignores non-mandatory for stage promotion', () => {
    const s = state();
    const c = [
      comp('rut', 'approved'),
      comp('contract', 'approved'),
      comp('insurance', 'approved'),
      // iso45001 not submitted, but it's optional
    ];
    expect(evaluateOnboardingStage(s, c, reqs, NOW)).toBe('docs_validated');
  });

  it('returns "site_walk" when siteWalkAt set', () => {
    const s = state({ siteWalkAt: '2026-05-10T00:00:00.000Z' });
    expect(evaluateOnboardingStage(s, [], reqs, NOW)).toBe('site_walk');
  });

  it('returns "accredited" when accreditedAt set and no expirations', () => {
    const s = state({
      accreditedAt: '2026-05-12T00:00:00.000Z',
      siteWalkAt: '2026-05-10T00:00:00.000Z',
    });
    const c = [
      comp('rut', 'approved'),
      comp('contract', 'approved'),
      comp('insurance', 'approved'),
    ];
    expect(evaluateOnboardingStage(s, c, reqs, NOW)).toBe('accredited');
  });

  it('returns "expired" when accredited but a mandatory compliance is past expiresAt', () => {
    const s = state({ accreditedAt: '2025-05-01T00:00:00.000Z' });
    const c = [
      comp('rut', 'approved', { expiresAt: '2026-01-01T00:00:00.000Z' }),
      comp('contract', 'approved'),
      comp('insurance', 'approved'),
    ];
    expect(evaluateOnboardingStage(s, c, reqs, NOW)).toBe('expired');
  });

  it('returns "expired" when accredited but a mandatory compliance is marked expired status', () => {
    const s = state({ accreditedAt: '2025-05-01T00:00:00.000Z' });
    const c = [
      comp('rut', 'expired'),
      comp('contract', 'approved'),
      comp('insurance', 'approved'),
    ];
    expect(evaluateOnboardingStage(s, c, reqs, NOW)).toBe('expired');
  });

  it('returns "rejected" when rejectedAt set (overrides everything)', () => {
    const s = state({
      accreditedAt: '2025-05-01T00:00:00.000Z',
      rejectedAt: '2026-05-12T00:00:00.000Z',
    });
    expect(evaluateOnboardingStage(s, [], reqs, NOW)).toBe('rejected');
  });
});

describe('listMissingMandatory', () => {
  const reqs = [
    req('rut'),
    req('contract'),
    req('iso', { kind: 'certification', mandatory: false }),
  ];

  it('lists every mandatory with no compliance', () => {
    const missing = listMissingMandatory('v1', [], reqs);
    expect(missing.map((r) => r.id).sort()).toEqual(['contract', 'rut']);
  });

  it('treats pending and rejected as missing', () => {
    const c = [comp('rut', 'pending'), comp('contract', 'rejected')];
    const missing = listMissingMandatory('v1', c, reqs);
    expect(missing.map((r) => r.id).sort()).toEqual(['contract', 'rut']);
  });

  it('excludes approved + optional from missing', () => {
    const c = [comp('rut', 'approved'), comp('contract', 'submitted')];
    const missing = listMissingMandatory('v1', c, reqs);
    expect(missing).toHaveLength(0);
  });

  it('treats expired as missing again (renewal needed)', () => {
    const c = [comp('rut', 'expired'), comp('contract', 'approved')];
    const missing = listMissingMandatory('v1', c, reqs);
    expect(missing.map((r) => r.id)).toEqual(['rut']);
  });
});

describe('listRejectedRequirements', () => {
  const reqs = [req('rut'), req('contract')];
  it('returns rejected compliance records for mandatory reqs', () => {
    const c = [
      comp('rut', 'rejected', { reason: 'documento ilegible' }),
      comp('contract', 'approved'),
    ];
    const rejected = listRejectedRequirements('v1', c, reqs);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].requirementId).toBe('rut');
  });
});

describe('buildClientRequirementsBundle', () => {
  const base: VendorRequirement[] = [
    req('rut'),
    req('contract'),
    req('insurance', { kind: 'insurance' }),
    // base requirement targeted to a SPECIFIC other client → should be filtered out
    req('special-codelco', { clientSpecific: 'codelco' }),
  ];

  it('includes baseline + client-specific addons', () => {
    const clientReqs: VendorRequirement[] = [
      req('drug-test', { kind: 'document', clientSpecific: 'antofagasta-minerals' }),
    ];
    const bundle = buildClientRequirementsBundle('antofagasta-minerals', base, clientReqs);
    const ids = bundle.map((r) => r.id).sort();
    expect(ids).toEqual(['contract', 'drug-test', 'insurance', 'rut']);
  });

  it('filters out requirements targeted to other clients', () => {
    const bundle = buildClientRequirementsBundle('antofagasta-minerals', base, []);
    expect(bundle.find((r) => r.id === 'special-codelco')).toBeUndefined();
  });

  it('client-specific override beats baseline on id collision (stricter wins)', () => {
    const stricter: VendorRequirement = {
      id: 'insurance',
      label: 'Poliza UF 5000+',
      kind: 'insurance',
      mandatory: true,
      clientSpecific: 'codelco',
      expiresAfterMonths: 12,
    };
    const bundle = buildClientRequirementsBundle('codelco', base, [stricter]);
    const ins = bundle.find((r) => r.id === 'insurance');
    expect(ins?.label).toBe('Poliza UF 5000+');
    expect(ins?.expiresAfterMonths).toBe(12);
  });

  it('returns empty when no requirements apply', () => {
    expect(buildClientRequirementsBundle('x', [], [])).toEqual([]);
  });
});

describe('computeExpiresAt', () => {
  it('adds months correctly', () => {
    const expires = computeExpiresAt('2026-01-15T00:00:00.000Z', 6);
    expect(expires).toBe('2026-07-15T00:00:00.000Z');
  });

  it('returns undefined when no expiration', () => {
    expect(computeExpiresAt('2026-01-15T00:00:00.000Z', undefined)).toBeUndefined();
    expect(computeExpiresAt('2026-01-15T00:00:00.000Z', 0)).toBeUndefined();
  });

  it('returns undefined when no submission', () => {
    expect(computeExpiresAt(undefined, 12)).toBeUndefined();
  });

  it('returns undefined on invalid date', () => {
    expect(computeExpiresAt('not-a-date', 12)).toBeUndefined();
  });
});

describe('isComplianceExpired', () => {
  it('returns true when status is expired', () => {
    expect(isComplianceExpired(comp('rut', 'expired'), NOW)).toBe(true);
  });

  it('returns true when expiresAt is in the past', () => {
    const c = comp('rut', 'approved', { expiresAt: '2025-01-01T00:00:00.000Z' });
    expect(isComplianceExpired(c, NOW)).toBe(true);
  });

  it('returns false when expiresAt is in the future', () => {
    const c = comp('rut', 'approved', { expiresAt: '2027-01-01T00:00:00.000Z' });
    expect(isComplianceExpired(c, NOW)).toBe(false);
  });

  it('returns false when no expiresAt and status not expired', () => {
    expect(isComplianceExpired(comp('rut', 'approved'), NOW)).toBe(false);
  });
});
