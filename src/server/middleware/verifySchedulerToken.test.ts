// SPDX-License-Identifier: MIT
// Sprint 27 (audit P0 H14) — tests for the scheduler-token gate.
// Ola 1 (AUDIT-2026-06 B19) — extended for Google OIDC support.
//
// Production bug pinned by the OIDC describes below: deploy.yml provisions
// every Cloud Scheduler job with `--oidc-service-account-email` (Google
// signs a JWT into the Authorization header), but the middleware only
// compared the bearer against the literal `SCHEDULER_SHARED_SECRET` →
// every scheduled tick (climate-scan, weekly-digest, check-overdue,
// replicate-critical) died with 401 and NO cron ever ran in production.
// The middleware now accepts EITHER the shared secret OR a Google OIDC
// identity token pinned to the scheduler service account.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

const verifyIdTokenMock = vi.hoisted(() => vi.fn());

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdTokenMock;
  },
}));

import { verifySchedulerToken, verifySchedulerOrFallback } from './verifySchedulerToken';

function makeReq(authHeader?: string): Request {
  return {
    header: (name: string) =>
      name.toLowerCase() === 'authorization' ? authHeader : undefined,
  } as unknown as Request;
}

function makeRes(): Response & { _status?: number; _body?: unknown } {
  const res = {} as any;
  res.status = (code: number) => {
    res._status = code;
    return res;
  };
  res.json = (body: unknown) => {
    res._body = body;
    return res;
  };
  return res;
}

// A syntactically JWT-shaped bearer (three dot-separated segments) so the
// middleware routes it down the OIDC path instead of the shared-secret one.
const FAKE_JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJ4In0.c2ln';

const ENV_KEYS = [
  'SCHEDULER_SHARED_SECRET',
  'SCHEDULER_SERVICE_ACCOUNT',
  'SCHEDULER_OIDC_AUDIENCE',
  'GOOGLE_CLOUD_PROJECT',
  'GCLOUD_PROJECT',
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  verifyIdTokenMock.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('verifySchedulerToken — shared secret (legacy, synchronous paths)', () => {
  it('fails closed with 503 when no auth method is configured at all', () => {
    const req = makeReq('Bearer anything');
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    verifySchedulerToken(req, res, next);
    expect(res._status).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when no Authorization header is present', () => {
    process.env.SCHEDULER_SHARED_SECRET = 'super-secret-xyz';
    const req = makeReq(undefined);
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    verifySchedulerToken(req, res, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 on a wrong bearer token', () => {
    process.env.SCHEDULER_SHARED_SECRET = 'super-secret-xyz';
    const req = makeReq('Bearer wrong-secret');
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    verifySchedulerToken(req, res, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 on a length-mismatched bearer token (timing-safe)', () => {
    process.env.SCHEDULER_SHARED_SECRET = 'super-secret-xyz';
    const req = makeReq('Bearer short');
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    verifySchedulerToken(req, res, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() on the matching bearer token', () => {
    process.env.SCHEDULER_SHARED_SECRET = 'super-secret-xyz';
    const req = makeReq('Bearer super-secret-xyz');
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    verifySchedulerToken(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res._status).toBeUndefined();
  });

  it('rejects a header without the Bearer prefix', () => {
    process.env.SCHEDULER_SHARED_SECRET = 'super-secret-xyz';
    const req = makeReq('super-secret-xyz');
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    verifySchedulerToken(req, res, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

function makeApp() {
  const app = express();
  app.post('/job', verifySchedulerToken, (req, res) => {
    res.json({ ok: true, scheduler: req.schedulerInvocation === true });
  });
  return app;
}

describe('verifySchedulerToken — Google OIDC path (the prod cron fix)', () => {
  it('accepts a Google-signed token from the pinned service account', async () => {
    process.env.SCHEDULER_SERVICE_ACCOUNT =
      'climate-scan-sa@my-proj.iam.gserviceaccount.com';
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        email: 'climate-scan-sa@my-proj.iam.gserviceaccount.com',
        email_verified: true,
      }),
    });
    const res = await request(makeApp())
      .post('/job')
      .set('Authorization', `Bearer ${FAKE_JWT}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, scheduler: true });
    expect(verifyIdTokenMock).toHaveBeenCalledTimes(1);
  });

  it('derives the pinned SA from GOOGLE_CLOUD_PROJECT when env not set', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'guardian-prod';
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        email: 'climate-scan-sa@guardian-prod.iam.gserviceaccount.com',
        email_verified: true,
      }),
    });
    const res = await request(makeApp())
      .post('/job')
      .set('Authorization', `Bearer ${FAKE_JWT}`);
    expect(res.status).toBe(200);
  });

  it('rejects a valid Google token from a DIFFERENT service account (401)', async () => {
    process.env.SCHEDULER_SERVICE_ACCOUNT =
      'climate-scan-sa@my-proj.iam.gserviceaccount.com';
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        email: 'attacker-sa@evil-proj.iam.gserviceaccount.com',
        email_verified: true,
      }),
    });
    const res = await request(makeApp())
      .post('/job')
      .set('Authorization', `Bearer ${FAKE_JWT}`);
    expect(res.status).toBe(401);
  });

  it('rejects when signature/audience verification throws (401)', async () => {
    process.env.SCHEDULER_SERVICE_ACCOUNT =
      'climate-scan-sa@my-proj.iam.gserviceaccount.com';
    verifyIdTokenMock.mockRejectedValue(new Error('invalid audience'));
    const res = await request(makeApp())
      .post('/job')
      .set('Authorization', `Bearer ${FAKE_JWT}`);
    expect(res.status).toBe(401);
  });

  it('passes the explicit SCHEDULER_OIDC_AUDIENCE to the verifier', async () => {
    process.env.SCHEDULER_SERVICE_ACCOUNT =
      'climate-scan-sa@my-proj.iam.gserviceaccount.com';
    process.env.SCHEDULER_OIDC_AUDIENCE = 'https://app.praeventio.net';
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        email: 'climate-scan-sa@my-proj.iam.gserviceaccount.com',
        email_verified: true,
      }),
    });
    await request(makeApp())
      .post('/job')
      .set('Authorization', `Bearer ${FAKE_JWT}`);
    expect(verifyIdTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'https://app.praeventio.net' })
    );
  });

  it('rejects an unverified email claim (401)', async () => {
    process.env.SCHEDULER_SERVICE_ACCOUNT =
      'climate-scan-sa@my-proj.iam.gserviceaccount.com';
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        email: 'climate-scan-sa@my-proj.iam.gserviceaccount.com',
        email_verified: false,
      }),
    });
    const res = await request(makeApp())
      .post('/job')
      .set('Authorization', `Bearer ${FAKE_JWT}`);
    expect(res.status).toBe(401);
  });
});

describe('verifySchedulerOrFallback — scheduler OR human admin', () => {
  // Fresh fallback + app per test: a module-scoped shared `vi.fn` leaks a
  // dangling invocation across supertest requests in this harness.
  function makeComboApp() {
    const fallback = vi.fn((req: Request, _res: Response, next: NextFunction) => {
      req.user = { uid: 'human-admin' };
      next();
    });
    const app = express();
    app.post('/job', verifySchedulerOrFallback(fallback), (req, res) => {
      res.json({
        scheduler: req.schedulerInvocation === true,
        uid: req.user?.uid ?? null,
        fallbackCalls: fallback.mock.calls.length,
      });
    });
    return app;
  }

  it('short-circuits to scheduler when the shared secret matches', async () => {
    process.env.SCHEDULER_SHARED_SECRET = 'super-secret';
    const res = await request(makeComboApp())
      .post('/job')
      .set('Authorization', 'Bearer super-secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scheduler: true, uid: null, fallbackCalls: 0 });
  });

  it('falls through to the human-auth middleware on a non-scheduler bearer', async () => {
    process.env.SCHEDULER_SHARED_SECRET = 'super-secret';
    const res = await request(makeComboApp())
      .post('/job')
      .set('Authorization', 'Bearer firebase-id-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scheduler: false, uid: 'human-admin', fallbackCalls: 1 });
  });

  it('falls through to the human-auth middleware when nothing is configured', async () => {
    const res = await request(makeComboApp())
      .post('/job')
      .set('Authorization', 'Bearer firebase-id-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scheduler: false, uid: 'human-admin', fallbackCalls: 1 });
  });
});
