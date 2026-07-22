export type ProfessionalRegistryVerification =
  | {
      status: 'verified';
      provider: 'superintendencia_salud_cl';
      verifiedDisplayName: string;
      verifiedRegistryNumber: string;
    }
  | {
      status: 'not_found' | 'mismatch' | 'unavailable' | 'not_configured';
      provider: 'superintendencia_salud_cl' | 'superintendencia_salud_cl_stub';
    };

export interface ProfessionalRegistryProvider {
  verifyPhysician(input: {
    country: 'CL';
    registryNumber: string;
    normalizedRut: string;
  }): Promise<ProfessionalRegistryVerification>;
}

/**
 * Integration seam used until the Superintendencia de Salud grants API access.
 * It deliberately cannot represent `verified`, so configuration mistakes cannot
 * silently convert a development stub into an official attestation.
 */
export class StubProfessionalRegistryProvider implements ProfessionalRegistryProvider {
  constructor(private readonly state: 'not_configured' | 'unavailable' = 'not_configured') {}

  async verifyPhysician(): Promise<ProfessionalRegistryVerification> {
    return {
      status: this.state,
      provider: 'superintendencia_salud_cl_stub',
    };
  }
}
