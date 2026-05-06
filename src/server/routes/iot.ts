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
//     { projectId, type, registeredBy, createdAt, status: 'active' }
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
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { isAdminRole, isSupervisorRole } from '../../types/roles.js';
import { tracedAsync } from '../../services/observability/tracing.js';

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
  validate(RegisterDeviceSchema),
  async (req, res) => {
    const callerUid = (req as any).user.uid;
    const { deviceId, projectId, type } = (req as any).validated as z.infer<
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
      return res.status(500).json({ error: 'iot_device_register_failed' });
    }
  },
);

export default router;
