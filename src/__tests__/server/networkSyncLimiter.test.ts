import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import request from "supertest";
import {
  geminiLimiter,
  networkSyncLimiter,
} from "../../server/middleware/limiters";

const keys: string[] = [];
const user = () => {
  const uid = `network-sync-${randomUUID()}`;
  keys.push(uid);
  return uid;
};

function appWith(limiter: RequestHandler, uid: string) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { uid };
    next();
  });
  app.post("/probe", limiter, (_req, res) => res.json({ ok: true }));
  return app;
}

afterEach(() => {
  for (const uid of keys.splice(0)) {
    networkSyncLimiter.resetKey(uid);
    geminiLimiter.resetKey(uid);
  }
  vi.useRealTimers();
});

describe("durable network sync rate budget", () => {
  it("caps writes at 30 requests and returns a bounded retry hint", async () => {
    const app = appWith(networkSyncLimiter, user());
    for (let index = 0; index < 30; index++) {
      expect((await request(app).post("/probe")).status).toBe(200);
    }
    const capped = await request(app).post("/probe");
    expect(capped.status).toBe(429);
    expect(capped.body).toEqual({
      error: "network_sync_rate_limited",
      retryAfterMs: 60_000,
    });
    expect(Number(capped.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(capped.headers["retry-after"])).toBeLessThanOrEqual(60);
  });

  it("does not share one user write cap with another user", async () => {
    const first = appWith(networkSyncLimiter, user());
    const second = appWith(networkSyncLimiter, user());
    for (let index = 0; index < 30; index++)
      await request(first).post("/probe");
    expect((await request(first).post("/probe")).status).toBe(429);
    expect((await request(second).post("/probe")).status).toBe(200);
  });

  it("expires the write budget after one minute, not before", async () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const app = appWith(networkSyncLimiter, user());
    for (let index = 0; index < 30; index++) await request(app).post("/probe");
    vi.setSystemTime(now + 59_999);
    expect((await request(app).post("/probe")).status).toBe(429);
    vi.setSystemTime(now + 60_001);
    expect((await request(app).post("/probe")).status).toBe(200);
  });

  it("keeps AI exhaustion independent from the same user write budget", async () => {
    const uid = user();
    const ai = appWith(geminiLimiter, uid);
    const sync = appWith(networkSyncLimiter, uid);
    for (let index = 0; index < 30; index++) await request(ai).post("/probe");
    expect((await request(ai).post("/probe")).status).toBe(429);
    expect((await request(sync).post("/probe")).status).toBe(200);
    expect((await request(ai).post("/probe")).status).toBe(429);
  });
});
