import { describe, expect, it } from 'vitest';

import { StubProfessionalRegistryProvider } from './professionalRegistryProvider';

describe('StubProfessionalRegistryProvider', () => {
  it('is fail-closed and reports not_configured by default', async () => {
    const provider = new StubProfessionalRegistryProvider();

    await expect(
      provider.verifyPhysician({
        country: 'CL',
        registryNumber: 'RNPI-12345',
        normalizedRut: '123456785',
      }),
    ).resolves.toEqual({
      status: 'not_configured',
      provider: 'superintendencia_salud_cl_stub',
    });
  });

  it('can represent temporary unavailability but can never return verified', async () => {
    const provider = new StubProfessionalRegistryProvider('unavailable');
    const result = await provider.verifyPhysician({
      country: 'CL',
      registryNumber: 'RNPI-12345',
      normalizedRut: '123456785',
    });

    expect(result).toEqual({
      status: 'unavailable',
      provider: 'superintendencia_salud_cl_stub',
    });
    expect(result.status).not.toBe('verified');
  });
});
