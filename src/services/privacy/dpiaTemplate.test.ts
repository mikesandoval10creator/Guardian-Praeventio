// Praeventio Guard — Sprint 31 Bucket MM.

import { describe, it, expect } from 'vitest';
import { generateDpiaPdf, type DpiaInput } from './dpiaTemplate';

const baseInput: DpiaInput = {
  tenantId: 'tenant_demo',
  tenantName: 'Constructora Andes SpA',
  regimes: ['GDPR-EU', 'LGPD-BR'],
  preparedBy: {
    fullName: 'Daho Sandoval',
    role: 'Data Protection Officer',
    email: 'dpo@example.com',
  },
  dataFlows: [
    {
      name: 'Identidad → Firebase Auth',
      dataCategories: ['identidad', 'credenciales'],
      legalBasis: 'Ejecución de contrato',
      recipients: ['Firebase Auth'],
      internationalTransfer: true,
      retention: 'Mientras la cuenta esté activa',
    },
    {
      name: 'Salud ocupacional → Firestore',
      dataCategories: ['salud_ocupacional'],
      legalBasis: 'Obligación legal Ley 16.744',
      recipients: ['Firebase Firestore', 'SUSESO'],
      internationalTransfer: true,
      retention: '7 años post-empleo',
    },
  ],
  mitigations: [
    {
      risk: 'Acceso no autorizado a datos sensibles',
      severity: 5,
      likelihood: 2,
      control: 'KMS envelope + tenant isolation + audit logs',
      residual: 'low',
    },
    {
      risk: 'Brecha en proveedor cloud',
      severity: 4,
      likelihood: 2,
      control: 'Encryption at rest + monitoring',
      residual: 'medium',
    },
  ],
  preparedAt: '2026-05-05T12:00:00.000Z',
};

describe('generateDpiaPdf', () => {
  it('returns a non-empty Uint8Array', () => {
    const bytes = generateDpiaPdf(baseInput);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it('starts with %PDF- magic header', () => {
    const bytes = generateDpiaPdf(baseInput);
    const header = String.fromCharCode(...bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
  });

  it('embeds tenant id in the rendered text bytes', () => {
    const bytes = generateDpiaPdf(baseInput);
    // jsPDF emits readable strings inside content streams. We just check
    // that the tenantId appears somewhere in the byte buffer.
    const haystack = String.fromCharCode(...bytes);
    expect(haystack).toContain('tenant_demo');
  });

  it('handles empty data flows + mitigations without throwing', () => {
    const empty: DpiaInput = {
      ...baseInput,
      dataFlows: [],
      mitigations: [],
    };
    const bytes = generateDpiaPdf(empty);
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it('renders each residual risk level (smoke)', () => {
    const allLevels: DpiaInput = {
      ...baseInput,
      mitigations: [
        { risk: 'r1', severity: 1, likelihood: 1, control: 'c1', residual: 'low' },
        { risk: 'r2', severity: 3, likelihood: 3, control: 'c2', residual: 'medium' },
        { risk: 'r3', severity: 5, likelihood: 5, control: 'c3', residual: 'high' },
      ],
    };
    const bytes = generateDpiaPdf(allLevels);
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});
