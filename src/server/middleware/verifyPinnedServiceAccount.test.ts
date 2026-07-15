import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createPinnedServiceAccountMiddleware } from './verifyPinnedServiceAccount.js';

function harness(input: {
  authorization?: string;
  env?: Record<string, string | undefined>;
  payload?: Record<string, unknown> | null;
  verifyError?: Error;
}) {
  const verifyIdToken = vi.fn(async () => {
    if (input.verifyError) throw input.verifyError;
    return { getPayload: () => input.payload ?? null };
  });
  const middleware = createPinnedServiceAccountMiddleware({
    oidcClient: { verifyIdToken },
    env: input.env ?? {
      COMPLIANCE_KMS_SIGNING_ENABLED: 'true',
      COMPLIANCE_KMS_CALLER_SERVICE_ACCOUNT: 'signer@project.iam.gserviceaccount.com',
      COMPLIANCE_KMS_OIDC_AUDIENCE: 'https://app.example.com/api',
    },
  });
  const req = {
    header: (name: string) => name.toLowerCase() === 'authorization' ? input.authorization : undefined,
  } as Request;
  const responseBody: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) { responseBody.status = code; return this; },
    json(body: unknown) { responseBody.body = body; return this; },
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { middleware, req, res, next, responseBody, verifyIdToken };
}

describe('createPinnedServiceAccountMiddleware', () => {
  it('accepts only a Google-verified token for the exact account and audience', async () => {
    const h = harness({
      authorization: 'Bearer aaa.bbb.ccc',
      payload: {
        email: 'signer@project.iam.gserviceaccount.com',
        email_verified: true,
      },
    });
    await h.middleware(h.req, h.res, h.next);
    expect(h.next).toHaveBeenCalledTimes(1);
    expect(h.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'aaa.bbb.ccc', audience: 'https://app.example.com/api',
    });
  });

  it.each([
    ['missing bearer', undefined, { email: 'signer@project.iam.gserviceaccount.com', email_verified: true }],
    ['non-JWT bearer', 'Bearer shared-secret', { email: 'signer@project.iam.gserviceaccount.com', email_verified: true }],
    ['wrong account', 'Bearer aaa.bbb.ccc', { email: 'other@project.iam.gserviceaccount.com', email_verified: true }],
    ['unverified email', 'Bearer aaa.bbb.ccc', { email: 'signer@project.iam.gserviceaccount.com', email_verified: false }],
  ])('returns 401 for %s', async (_label, authorization, payload) => {
    const h = harness({ authorization, payload });
    await h.middleware(h.req, h.res, h.next);
    expect(h.responseBody).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(h.next).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when pinning configuration is incomplete', async () => {
    const h = harness({
      authorization: 'Bearer aaa.bbb.ccc', payload: null,
      env: {
        COMPLIANCE_KMS_SIGNING_ENABLED: 'true',
        COMPLIANCE_KMS_CALLER_SERVICE_ACCOUNT: 'signer@project.iam.gserviceaccount.com',
      },
    });
    await h.middleware(h.req, h.res, h.next);
    expect(h.responseBody).toEqual({
      status: 503, body: { error: 'compliance_kms_oidc_not_configured' },
    });
    expect(h.verifyIdToken).not.toHaveBeenCalled();
  });

  it('returns 401 when Google verification fails', async () => {
    const h = harness({
      authorization: 'Bearer aaa.bbb.ccc', verifyError: new Error('invalid token'),
    });
    await h.middleware(h.req, h.res, h.next);
    expect(h.responseBody.status).toBe(401);
    expect(h.next).not.toHaveBeenCalled();
  });
});
