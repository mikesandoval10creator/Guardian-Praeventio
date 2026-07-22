import { describe, expect, it } from 'vitest';

import { bucketHealthAccessDuration, buildHealthAnalyticsProperties } from './healthPrivacy';

describe('health analytics privacy boundary', () => {
  it('keeps only closed, non-clinical funnel dimensions', () => {
    const properties = buildHealthAnalyticsProperties({
      country: 'CL',
      verification_status: 'provisional',
      channel: 'qr',
      duration_bucket: '1_to_24h',
      outcome_code: 'success',
      rut: '12.345.678-5',
      uid: 'doctor-1',
      patient_uid: 'patient-1',
      purpose: 'diagnostic_review',
      resource_ids: ['record-1'],
      specialty: 'oncology',
      patient_name: 'Persona sensible',
    });

    expect(properties).toEqual({
      country: 'CL',
      verification_status: 'provisional',
      channel: 'qr',
      duration_bucket: '1_to_24h',
      outcome_code: 'success',
    });
    expect(JSON.stringify(properties)).not.toMatch(
      /rut|uid|patient|purpose|resource|specialty|oncology|record-1/i,
    );
  });

  it('drops unknown values instead of forwarding high-cardinality strings', () => {
    expect(
      buildHealthAnalyticsProperties({
        country: 'Chile',
        verification_status: 'custom-state',
        channel: 'email',
        duration_bucket: '37-hours',
        outcome_code: 'raw backend exception with personal data',
      }),
    ).toEqual({});
  });

  it('buckets grant duration without emitting exact timestamps', () => {
    expect(bucketHealthAccessDuration(30 * 60 * 1000)).toBe('under_1h');
    expect(bucketHealthAccessDuration(24 * 60 * 60 * 1000)).toBe('1_to_24h');
    expect(bucketHealthAccessDuration(7 * 24 * 60 * 60 * 1000)).toBe('1_to_7d');
  });
});
