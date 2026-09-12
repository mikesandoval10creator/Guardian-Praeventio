import { describe, expect, it } from 'vitest';
import { isRefereePreview, isValidRefereeToken } from './RefereeAccept';

const validPreview = {
  claimText: 'Operé el equipo bajo el procedimiento vigente.',
  workerName: 'Trabajador de prueba',
  workerEmail: 'worker@example.test',
  refereeName: 'Referencia de prueba',
  refereeEmail: 'referee@example.test',
  category: 'competencia',
  status: 'pending_referees',
  alreadySigned: false,
  expiresAt: '2026-09-20T12:00:00.000Z',
} as const;

describe('RefereeAccept response boundary', () => {
  it('accepts only 32-byte hexadecimal referee tokens', () => {
    expect(isValidRefereeToken('a'.repeat(64))).toBe(true);
    expect(isValidRefereeToken('A1'.repeat(32))).toBe(true);
    expect(isValidRefereeToken('invalid-probe-token')).toBe(false);
    expect(isValidRefereeToken('g'.repeat(64))).toBe(false);
  });

  it('accepts a complete preview matching the server contract', () => {
    expect(isRefereePreview(validPreview)).toBe(true);
  });

  it('rejects empty or malformed success payloads', () => {
    expect(isRefereePreview({})).toBe(false);
    expect(isRefereePreview({ ...validPreview, claimText: '' })).toBe(false);
    expect(isRefereePreview({ ...validPreview, status: 'unknown' })).toBe(false);
    expect(isRefereePreview({ ...validPreview, alreadySigned: 'false' })).toBe(false);
  });
});
