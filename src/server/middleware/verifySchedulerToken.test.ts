// SPDX-License-Identifier: MIT
// Sprint 27 (audit P0 H14) — tests for the scheduler-token gate.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { verifySchedulerToken } from './verifySchedulerToken';

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

describe('verifySchedulerToken', () => {
  const ORIG_SECRET = process.env.SCHEDULER_SHARED_SECRET;

  beforeEach(() => {
    delete process.env.SCHEDULER_SHARED_SECRET;
  });

  afterEach(() => {
    if (ORIG_SECRET === undefined) {
      delete process.env.SCHEDULER_SHARED_SECRET;
    } else {
      process.env.SCHEDULER_SHARED_SECRET = ORIG_SECRET;
    }
  });

  it('fails closed with 503 when SCHEDULER_SHARED_SECRET is unset', () => {
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
