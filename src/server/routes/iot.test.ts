// SPDX-License-Identifier: MIT
//
// Sprint 32 Bucket TT — coverage for POST /api/iot/devices/register.
//
// Mirrors the parallel-app pattern from src/__tests__/server/emergency.test.ts:
// the real router calls `admin.firestore()` + `admin.auth()` which we cannot
// initialize in tests. We rebuild a minimal Express app with the same
// status codes and JSON envelopes, exercising the contract we care about:
//
//   • happy path: 200 + persisted doc + audit row
//   • role gate: worker token → 403
//   • Zod fail: missing required field → 400 + invalid_payload

import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import {
  IOT_DEVICE_TYPES,
} from './iot.js';
import { isAdminRole, isSupervisorRole } from '../../types/roles.js';

interface FakeUser {
  uid: string;
  customClaims?: { role?: string };
}
interface IotTestDeps {
  users: Map<string, FakeUser>;
  store: Map<string, any>;
  audit: any[];
}

const RegisterSchema = z.object({
  deviceId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_\-:.]+$/),
  projectId: z.string().min(1).max(128),
  type: z.enum(IOT_DEVICE_TYPES),
  secret: z.string().min(8).max(512).optional(),
});

function buildIotApp(deps: IotTestDeps): Express {
  const app = express();
  app.use(express.json());

  const verifyAuth = (req: any, res: any, next: any) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const token = auth.slice('Bearer '.length);
    const user = deps.users.get(token);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    req.user = user;
    next();
  };

  app.post(
    '/api/iot/devices/register',
    verifyAuth,
    validate(RegisterSchema),
    async (req: any, res: any) => {
      const callerUid = req.user.uid;
      const { deviceId, projectId, type } = req.validated as z.infer<
        typeof RegisterSchema
      >;
      const role = req.user.customClaims?.role;
      if (!isAdminRole(role) && !isSupervisorRole(role)) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Requires admin or supervisor role' });
      }

      let tenantId = projectId;
      const projSnap = deps.store.get(`projects/${projectId}`);
      if (projSnap && typeof projSnap.tenantId === 'string') {
        tenantId = projSnap.tenantId;
      }
      deps.store.set(`tenants/${tenantId}/iot_devices/${deviceId}`, {
        projectId,
        type,
        registeredBy: callerUid,
        status: 'active',
      });
      deps.audit.push({
        action: 'iot.device.register',
        module: 'iot',
        details: { tenantId, projectId, deviceId, type },
        userId: callerUid,
      });
      return res.json({ ok: true, deviceId, tenantId });
    },
  );
  return app;
}

describe('/api/iot/devices/register', () => {
  let deps: IotTestDeps;

  beforeEach(() => {
    deps = {
      users: new Map([
        ['admin-token', { uid: 'u-admin', customClaims: { role: 'admin' } }],
        [
          'preven-token',
          { uid: 'u-preven', customClaims: { role: 'prevencionista' } },
        ],
        ['worker-token', { uid: 'u-worker', customClaims: { role: 'worker' } }],
      ]),
      store: new Map([['projects/p1', { tenantId: 't1' }]]),
      audit: [],
    };
  });

  it('registers a device for an admin caller (200 + doc + audit)', async () => {
    const app = buildIotApp(deps);
    const r = await request(app)
      .post('/api/iot/devices/register')
      .set('Authorization', 'Bearer admin-token')
      .send({ deviceId: 'dev-001', projectId: 'p1', type: 'gas_sensor' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.tenantId).toBe('t1');
    expect(deps.store.get('tenants/t1/iot_devices/dev-001')).toMatchObject({
      projectId: 'p1',
      type: 'gas_sensor',
      registeredBy: 'u-admin',
      status: 'active',
    });
    expect(deps.audit.find((a) => a.action === 'iot.device.register')).toBeTruthy();
  });

  it('rejects worker-tier role with 403', async () => {
    const app = buildIotApp(deps);
    const r = await request(app)
      .post('/api/iot/devices/register')
      .set('Authorization', 'Bearer worker-token')
      .send({ deviceId: 'dev-002', projectId: 'p1', type: 'temperature' });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/Forbidden/);
    expect(deps.store.has('tenants/t1/iot_devices/dev-002')).toBe(false);
  });

  it('returns 400 invalid_payload when type is not in the enum', async () => {
    const app = buildIotApp(deps);
    const r = await request(app)
      .post('/api/iot/devices/register')
      .set('Authorization', 'Bearer preven-token')
      .send({ deviceId: 'dev-003', projectId: 'p1', type: 'not_a_type' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_payload');
    expect(Array.isArray(r.body.issues)).toBe(true);
  });
});
