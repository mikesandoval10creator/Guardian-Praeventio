// Praeventio Guard — Sprint 39 Wire UI hazmat. HTTP surface for the pure
// engine at `src/services/hazmat/hazmatInventory.ts`.
//
// Mirrors the readReceipts wire pattern (Sprint 39 G.1): pure-compute
// endpoints that marshal JSON in/out, verify project membership and
// surface idempotency support for mutating calls. The engine itself is
// stateless and deterministic, so this route does NOT touch Firestore —
// it accepts the inventory in the body and computes the response.
//
// Compliance — DS 43/2016 (Almacenamiento Sustancias Peligrosas, Chile):
//   Por norma chilena la empresa debe mantener un inventario actualizado
//   de sustancias peligrosas con cantidad, ubicación, hoja de seguridad y
//   compatibilidad química. Este endpoint expone el motor que cumple esa
//   obligación. NUNCA enviamos los datos directamente a SUSESO/MINSAL: el
//   API genera el documento (la directiva "no push a APIs estatales").
//
// Endpoints:
//   POST /:projectId/hazmat/substance              { item }               → registro
//   POST /:projectId/hazmat/substance/get          { itemId, inventory } → lookup
//   POST /:projectId/hazmat/inventory              { inventory, filters? } → list
//   POST /:projectId/hazmat/substance/update       { item, inventory }    → update item
//   POST /:projectId/hazmat/substance/delete       { itemId, inventory }  → remove item
//   POST /:projectId/hazmat/compatibility-check    { inventory }          → audit pairs
//   POST /:projectId/hazmat/spill-plan             { item }                → derrame plan
//
// Storage model: the client owns the inventory document (Firestore or
// IndexedDB offline-first); this route returns the next-state inventory
// so the client can persist. Keeps the surface stateless, mirrors the
// "events return values" shape of `readReceipts` and `loneWorker`.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  auditStorageLocation,
  buildSpillPlan,
  checkPairCompatibility,
  type HazmatItem,
  type HazmatClass,
  type CompatibilityIssue,
} from '../../services/hazmat/hazmatInventory.js';

const router = Router();

// ────────────────────────────────────────────────────────────────────────
// Shared Zod schemas
// ────────────────────────────────────────────────────────────────────────

const hazmatClassSchema = z.enum([
  'oxidizer',
  'flammable',
  'corrosive',
  'toxic',
  'reactive_water',
  'compressed_gas',
  'explosive',
  'radioactive',
  'biohazard',
  'other',
]) as unknown as z.ZodType<HazmatClass>;

const hazmatItemSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  cas: z.string().min(1).max(50).optional(),
  unNumber: z.string().min(1).max(10).optional(),
  hazardClasses: z.array(hazmatClassSchema).min(1).max(20),
  stockQty: z.number().nonnegative().max(1_000_000_000),
  stockUnit: z.enum(['L', 'kg', 'unit']),
  locationId: z.string().min(1).max(200),
  expiresAt: z.string().min(10).optional(),
  requiredEpp: z.array(z.string().min(1).max(200)).max(50),
  sdsUrl: z.string().max(2048).optional(),
}) as unknown as z.ZodType<HazmatItem>;

const inventorySchema = z.array(hazmatItemSchema).max(10_000);

// ────────────────────────────────────────────────────────────────────────
// Project-membership guard mirror of readReceipts/loneWorker
// ────────────────────────────────────────────────────────────────────────

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<boolean> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return false;
    }
    throw err;
  }
  return true;
}

// ────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/hazmat/substance — add or upsert a substance
// ────────────────────────────────────────────────────────────────────────

const addSchema = z.object({
  item: hazmatItemSchema,
  inventory: inventorySchema.optional(),
});

router.post(
  '/:projectId/hazmat/substance',
  verifyAuth,
  idempotencyKey(),
  validate(addSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof addSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const inventory = body.inventory ?? [];
      // Reject duplicate IDs — caller must call /update for an existing id.
      if (inventory.some((it) => it.id === body.item.id)) {
        return res.status(409).json({ error: 'duplicate_substance_id' });
      }
      const nextInventory = [...inventory, body.item];
      const issues = auditStorageLocation(nextInventory);
      return res.json({ item: body.item, inventory: nextInventory, issues });
    } catch (err) {
      logger.error?.('hazmatInventory.add.error', err);
      captureRouteError(err, 'hazmatInventory.add', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/hazmat/substance/get — lookup by id from a list
// ────────────────────────────────────────────────────────────────────────

const getSchema = z.object({
  itemId: z.string().min(1).max(200),
  inventory: inventorySchema,
});

router.post(
  '/:projectId/hazmat/substance/get',
  verifyAuth,
  validate(getSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof getSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const item = body.inventory.find((it) => it.id === body.itemId);
      if (!item) {
        return res.status(404).json({ error: 'substance_not_found' });
      }
      return res.json({ item });
    } catch (err) {
      logger.error?.('hazmatInventory.get.error', err);
      captureRouteError(err, 'hazmatInventory.get', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/hazmat/inventory — list with optional filters
// ────────────────────────────────────────────────────────────────────────

const listSchema = z.object({
  inventory: inventorySchema,
  filters: z
    .object({
      locationId: z.string().min(1).max(200).optional(),
      hazardClass: hazmatClassSchema.optional(),
      search: z.string().min(1).max(200).optional(),
      expiringWithinDays: z.number().int().min(0).max(3650).optional(),
    })
    .optional(),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/hazmat/inventory',
  verifyAuth,
  validate(listSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof listSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const filters = body.filters ?? {};
      let items: HazmatItem[] = body.inventory.slice();
      if (filters.locationId) {
        items = items.filter((it) => it.locationId === filters.locationId);
      }
      if (filters.hazardClass) {
        items = items.filter((it) =>
          it.hazardClasses.includes(filters.hazardClass as HazmatClass),
        );
      }
      if (filters.search) {
        const needle = filters.search.toLowerCase();
        items = items.filter(
          (it) =>
            it.name.toLowerCase().includes(needle) ||
            (it.cas ?? '').toLowerCase().includes(needle) ||
            (it.unNumber ?? '').toLowerCase().includes(needle),
        );
      }
      if (typeof filters.expiringWithinDays === 'number') {
        const horizonMs =
          now.getTime() + filters.expiringWithinDays * 24 * 60 * 60 * 1000;
        items = items.filter((it) => {
          if (!it.expiresAt) return false;
          const expMs = Date.parse(it.expiresAt);
          return Number.isFinite(expMs) && expMs <= horizonMs;
        });
      }
      return res.json({ items, total: items.length });
    } catch (err) {
      logger.error?.('hazmatInventory.list.error', err);
      captureRouteError(err, 'hazmatInventory.list', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. POST /:projectId/hazmat/substance/update — replace item by id
// ────────────────────────────────────────────────────────────────────────

const updateSchema = z.object({
  item: hazmatItemSchema,
  inventory: inventorySchema,
});

router.post(
  '/:projectId/hazmat/substance/update',
  verifyAuth,
  idempotencyKey(),
  validate(updateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof updateSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const idx = body.inventory.findIndex((it) => it.id === body.item.id);
      if (idx < 0) {
        return res.status(404).json({ error: 'substance_not_found' });
      }
      const nextInventory = body.inventory.slice();
      nextInventory[idx] = body.item;
      const issues = auditStorageLocation(nextInventory);
      return res.json({ item: body.item, inventory: nextInventory, issues });
    } catch (err) {
      logger.error?.('hazmatInventory.update.error', err);
      captureRouteError(err, 'hazmatInventory.update', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. POST /:projectId/hazmat/substance/delete — remove item by id
// ────────────────────────────────────────────────────────────────────────

const deleteSchema = z.object({
  itemId: z.string().min(1).max(200),
  inventory: inventorySchema,
});

router.post(
  '/:projectId/hazmat/substance/delete',
  verifyAuth,
  idempotencyKey(),
  validate(deleteSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof deleteSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const idx = body.inventory.findIndex((it) => it.id === body.itemId);
      if (idx < 0) {
        return res.status(404).json({ error: 'substance_not_found' });
      }
      const nextInventory = body.inventory.filter((it) => it.id !== body.itemId);
      return res.json({ itemId: body.itemId, inventory: nextInventory });
    } catch (err) {
      logger.error?.('hazmatInventory.delete.error', err);
      captureRouteError(err, 'hazmatInventory.delete', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 6. POST /:projectId/hazmat/compatibility-check — audit inventory
// ────────────────────────────────────────────────────────────────────────

const compatSchema = z.object({
  inventory: inventorySchema,
});

router.post(
  '/:projectId/hazmat/compatibility-check',
  verifyAuth,
  validate(compatSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof compatSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const issues: CompatibilityIssue[] = auditStorageLocation(body.inventory);
      const summary = {
        total: issues.length,
        incompatible: issues.filter((i) => i.level === 'incompatible').length,
        caution: issues.filter((i) => i.level === 'caution').length,
      };
      return res.json({ issues, summary });
    } catch (err) {
      logger.error?.('hazmatInventory.compat.error', err);
      captureRouteError(err, 'hazmatInventory.compat', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 7. POST /:projectId/hazmat/spill-plan — derrame plan for a single item
// ────────────────────────────────────────────────────────────────────────

const spillSchema = z.object({
  item: hazmatItemSchema,
});

router.post(
  '/:projectId/hazmat/spill-plan',
  verifyAuth,
  validate(spillSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof spillSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const plan = buildSpillPlan(body.item);
      return res.json({ plan });
    } catch (err) {
      logger.error?.('hazmatInventory.spill.error', err);
      captureRouteError(err, 'hazmatInventory.spill', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// Re-export the pure helper so consumers (UI/hook) can preview locally
// without a network roundtrip.
export { checkPairCompatibility };

export default router;
