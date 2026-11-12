// Real supplier router against the Firestore emulator. Authentication is a
// deterministic test seam; membership, tenant lookup, create precondition and
// audit persistence use the real Admin SDK connected to the emulator.
import { describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

const UID = 'supplier-atomic-owner';
const PROJECT_ID = 'supplier-atomic-project';
const TENANT_ID = 'supplier-atomic-tenant';
const SUPPLIER_ID = 'same-id';
const SUPPLIERS_PATH = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/suppliers`;

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));

import suppliersRouter from '../../server/routes/suppliers.js';
import { getEmulatorAdminFirestore } from '../../test/firestore-emulator-setup';

const app = express();
app.use(express.json());
app.use('/api/sprint-k', suppliersRouter);

const headers = { 'x-test-uid': UID };

describe('supplier create-only precondition against Firestore emulator', () => {
  it('allows only one of two concurrent creates for the same tenant/project/id', async () => {
    const db = getEmulatorAdminFirestore();
    await db.collection('projects').doc(PROJECT_ID).set({
      createdBy: UID,
      members: [UID],
      tenantId: TENANT_ID,
    });

    const responses = await Promise.all(
      ['A', 'B'].map((suffix) =>
        request(app)
          .post(`/api/sprint-k/${PROJECT_ID}/suppliers`)
          .set(headers)
          .send({
            id: SUPPLIER_ID,
            name: `Proveedor concurrente ${suffix}`,
            taxId: `12.345.67${suffix === 'A' ? '8' : '9'}-K`,
            services: ['soldadura'],
          }),
      ),
    );

    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([
      201,
      409,
    ]);
    const conflict = responses.find((response) => response.status === 409)!;
    expect(conflict.body).toEqual({
      error: 'supplier_duplicate_id',
      message:
        'Este proveedor ya está registrado en este proyecto. No se creó un registro duplicado ni se modificaron los datos existentes. Revisa el listado; si necesitas corregirlo, consulta con un administrador.',
    });

    const supplierDocs = await db.collection(SUPPLIERS_PATH).get();
    expect(supplierDocs.docs).toHaveLength(1);
    const persisted = supplierDocs.docs[0].data();
    const created = responses.find((response) => response.status === 201)!;
    expect(persisted.id).toBe(SUPPLIER_ID);
    expect(persisted.legalName).toBe(created.body.supplier.legalName);
    expect(persisted.registeredByUid).toBe(UID);
    expect(persisted.incidents).toEqual([]);
    expect(persisted.audits).toEqual([]);

    const audits = await db
      .collection('audit_logs')
      .where('action', '==', 'suppliers.create')
      .get();
    expect(
      audits.docs.filter((doc) => doc.data().details?.supplierId === SUPPLIER_ID),
    ).toHaveLength(1);
  });
});
