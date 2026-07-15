import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { createComplianceKmsSigningRouter } from '../../server/routes/complianceKmsSigning.js';
import { ComplianceSigningFlowError } from '../../server/services/complianceWebAuthnSigning.js';
import { ComplianceKmsSigningError } from '../../services/compliance/cloudKmsComplianceSigner.js';

const signDocument = vi.fn();
const auditSignature = vi.fn();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', createComplianceKmsSigningRouter({
    verifyCaller: (_req: Request, _res: Response, next: NextFunction) => next(),
    signDocument,
    auditSignature,
  }));
  return app;
}

describe('private compliance KMS signing router', () => {
  beforeEach(() => {
    signDocument.mockReset();
    auditSignature.mockReset();
    signDocument.mockResolvedValue({ folio: 'F-1', signature: { algorithm: 'kms-sign-rsa' } });
    auditSignature.mockResolvedValue(undefined);
  });

  it.each([
    ['/api/suseso/form/F-1/kms-sign', 'suseso'],
    ['/api/compliance/ds67/F-1/kms-sign', 'ds67'],
    ['/api/compliance/ds76/F-1/kms-sign', 'ds76'],
  ] as const)('signs %s through the expected document adapter', async (url, kind) => {
    const res = await request(buildApp()).post(url).send({ tenantId: 'tenant-1' });
    expect(res.status).toBe(200);
    expect(signDocument).toHaveBeenCalledWith(kind, 'tenant-1', 'F-1');
    expect(auditSignature).toHaveBeenCalledWith(
      expect.anything(), kind, 'tenant-1', 'F-1', expect.anything(),
    );
  });

  it('rejects caller-supplied signature, hash, signer and date fields', async () => {
    const res = await request(buildApp())
      .post('/api/suseso/form/F-1/kms-sign')
      .send({ tenantId: 'tenant-1', signatureB64: 'fabricated', signerRut: '1-9' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(signDocument).not.toHaveBeenCalled();
  });

  it('returns 409 for an already-signed form without auditing a false success', async () => {
    signDocument.mockRejectedValueOnce(new ComplianceSigningFlowError('already_signed'));
    const res = await request(buildApp())
      .post('/api/compliance/ds67/F-1/kms-sign')
      .send({ tenantId: 'tenant-1' });
    expect(res.status).toBe(409);
    expect(auditSignature).not.toHaveBeenCalled();
  });

  it('returns 503 when KMS configuration or provider is unavailable', async () => {
    signDocument.mockRejectedValueOnce(new ComplianceKmsSigningError('kms_not_configured'));
    const res = await request(buildApp())
      .post('/api/compliance/ds76/F-1/kms-sign')
      .send({ tenantId: 'tenant-1' });
    expect(res.status).toBe(503);
  });
});
