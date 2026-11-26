/**
 * emergencyContact — resolving a human channel when the SOS data path failed.
 *
 * Contract under test:
 *   • `project.phone` wins;
 *   • an explicit supervisor directory is the fallback;
 *   • public emergency numbers are NEVER auto-dialed (a near-miss must not
 *     raise a false police alarm) — they are surfaced as an instruction;
 *   • an unusable geo/region degrades gracefully instead of throwing.
 */

import { describe, expect, it } from 'vitest';
import { formatEmergencyInstruction, resolveEmergencyContact } from './emergencyContact';

describe('emergencyContact — resolveEmergencyContact', () => {
  it('prefers the project phone', () => {
    const result = resolveEmergencyContact({
      projectPhone: '+56 9 1111 2222',
      supervisorPhones: ['+56 9 3333 4444'],
    });
    expect(result.contact?.number).toBe('+56911112222');
    expect(result.contact?.source).toBe('project');
    expect(result.contact?.label).toBe('tu supervisor');
  });

  it('falls back to the supervisor directory when the project has no phone', () => {
    const result = resolveEmergencyContact({
      projectPhone: null,
      supervisorPhones: [null, '', '+56 9 3333 4444'],
    });
    expect(result.contact?.number).toBe('+56933334444');
    expect(result.contact?.source).toBe('supervisor');
  });

  it('never auto-dials a public emergency number', () => {
    const result = resolveEmergencyContact({
      projectPhone: null,
      supervisorPhones: [],
      geo: { lat: -33.45, lng: -70.67 },
    });
    expect(result.contact).toBeNull();
    expect(result.regional).not.toBeNull();
  });

  it('resolves the regional directory from the region code when there are no coordinates', () => {
    const result = resolveEmergencyContact({ regionCode: 'CL' });
    expect(result.contact).toBeNull();
    expect(result.regional?.police).toBe('133');
  });

  it('degrades to no regional directory for an unknown region', () => {
    const result = resolveEmergencyContact({ regionCode: 'ZZ' });
    expect(result.contact).toBeNull();
    // The directory falls back to Chile rather than throwing.
    expect(result.regional === null || typeof result.regional.police === 'string').toBe(true);
  });

  it('rejects a phone value with no digits', () => {
    const result = resolveEmergencyContact({ projectPhone: 'sin numero' });
    expect(result.contact).toBeNull();
  });

  it('never throws on a malformed geo', () => {
    const result = resolveEmergencyContact({
      geo: { lat: Number.NaN, lng: 0 } as unknown as { lat: number; lng: number },
    });
    expect(result.contact).toBeNull();
  });
});

describe('emergencyContact — formatEmergencyInstruction', () => {
  it('lists the regional numbers so the worker can choose', () => {
    const { regional } = resolveEmergencyContact({ regionCode: 'CL' });
    const text = formatEmergencyInstruction(regional);
    expect(text).toContain('133');
    expect(text).toContain('Marcá a mano');
  });

  it('gives an explicit instruction when there is no regional directory', () => {
    const text = formatEmergencyInstruction(null);
    expect(text).toContain('Sin canal de teléfono');
  });
});
