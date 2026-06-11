// SPDX-License-Identifier: MIT
//
// Sprint 32 Bucket TT — IoT device registration endpoint.
//
// Closes audit P0 W2: the MQTT adapter shipped without a wiring path; the
// admin had no way to enrol a physical device into the tenant. This router
// exposes:
//
//   POST /api/iot/devices/register
//
// Auth contract (mirrors emergency.ts pattern):
//   • verifyAuth (Firebase ID token)
//   • Zod schema validation (deviceId, projectId, type, optional secret)
//   • Role gate: caller must hold an admin or supervisor-tier role
//     (admin / gerente / supervisor / prevencionista). Worker-tier tokens
//     cannot register devices.
//
// Persistence:
//   tenants/{tenantId}/iot_devices/{deviceId}
//     { projectId, type, registeredBy, createdAt, status: 'active',
//       secret? }   // optional per-device HMAC key for the MQTT bridge
//
// Audit row:
//   audit_logs/  { action: 'iot.device.register', module: 'iot', ... }
//
// Tenant resolution mirrors emergency.ts: read `projects/{projectId}.tenantId`
// and fall back to `projectId` itself for legacy installs.

import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { isAdminRole, isSupervisorRole } from '../../types/roles.js';
import { tracedAsync } from '../../services/observability/tracing.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

export const IOT_DEVICE_TYPES = [
  'gas_sensor',
  'wind_anemometer',
  'vibration_accel',
  'co_meter',
  'pressure_gauge',
  'flow_meter',
  'temperature',
  'humidity',
  'other',
] as const;

const RegisterDeviceSchema = z.object({
  deviceId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_\-:.]+$/, 'deviceId must be alphanumeric / _ - : .'),
  projectId: z.string().min(1).max(128),
  type: z.enum(IOT_DEVICE_TYPES),
  secret: z.string().min(8).max(512).optional(),
});

const router = Router();

router.post(
  '/devices/register',
  verifyAuth,
  idempotencyKey(),
  validate(RegisterDeviceSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { deviceId, projectId, type, secret } = req.validated as z.infer<
      typeof RegisterDeviceSchema
    >;

    try {
      const callerRecord = await admin.auth().getUser(callerUid);
      const role = callerRecord.customClaims?.role;
      if (!isAdminRole(role) && !isSupervisorRole(role)) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Requires admin or supervisor role' });
      }
    } catch (err: any) {
      logger.warn('iot_device_register_role_lookup_failed', {
        callerUid,
        message: err?.message,
      });
      return res.status(403).json({ error: 'Forbidden' });
    }

    const db = admin.firestore();

    // Cross-tenant guard (#700/#707/#708): the admin/supervisor role check above
    // is GLOBAL — it does not bind the caller to `projectId`. Without this, a
    // privileged user of tenant A could register a device into any tenant B's
    // project (the tenant is derived from `projects/{projectId}.tenantId` below).
    // assertProjectMember requires the caller to be a member of THIS project.
    try {
      await assertProjectMember(callerUid, projectId, db, req.user as Record<string, unknown> | undefined);
    } catch (err: any) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      // Infra failure (Firestore outage) — fail closed without leaking internals.
      logger.error('iot_device_register_membership_check_failed', err, { callerUid, projectId });
      captureRouteError(err, 'iot.device.register');
      return res.status(500).json({ error: 'internal_error' });
    }

    let tenantId = projectId;
    try {
      const projectSnap = await db.collection('projects').doc(projectId).get();
      if (projectSnap.exists) {
        const candidate = (projectSnap.data() as any)?.tenantId;
        if (typeof candidate === 'string' && candidate.length > 0) {
          tenantId = candidate;
        }
      }
    } catch (err: any) {
      logger.warn('iot_device_register_tenant_lookup_failed', {
        projectId,
        message: err?.message,
      });
    }

    try {
      await tracedAsync(
        'iot.device.register',
        { 'praeventio.uid': callerUid, 'praeventio.projectId': projectId, 'praeventio.tenantId': tenantId, deviceType: type },
        () => db
          .collection('tenants')
          .doc(tenantId)
          .collection('iot_devices')
          .doc(deviceId)
          .set(
            {
              projectId,
              type,
              registeredBy: callerUid,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              status: 'active',
              // claude/mqtt-wire (2026-06): the schema always accepted an
              // optional per-device secret but the handler silently dropped
              // it. Persisted now — the MQTT bridge requires a payload HMAC
              // (`sig`) from devices that have one (defense-in-depth over
              // broker auth; see src/server/triggers/mqttTelemetryBridge.ts).
              // Raw storage mirrors `tenants/{id}.iotSecret`; the collection
              // has no client rules (default-deny ⇒ Admin-SDK-only) and the
              // secret is NEVER echoed back by any read surface.
              ...(secret ? { secret } : {}),
            },
            { merge: true },
          ),
      );

      try {
        await auditServerEvent(req, 'iot.device.register', 'iot', {
          tenantId,
          projectId,
          deviceId,
          type,
        });
      } catch {
        /* observability never breaks request path */
      }

      return res.json({ ok: true, deviceId, tenantId });
    } catch (err: any) {
      logger.error('iot_device_register_failed', err, {
        callerUid,
        deviceId,
        projectId,
      });
      captureRouteError(err, 'iot.device_register', { callerUid, deviceId, projectId });
      return res.status(500).json({ error: 'iot_device_register_failed' });
    }
  },
);

export default router;
