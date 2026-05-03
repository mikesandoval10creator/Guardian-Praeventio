// Praeventio Guard — Sprint 11 (zettelkasten route HTTP coverage).
//
// Cubre POST /api/zettelkasten/nodes — la persistencia server-side de los
// 15 nodos Bernoulli que antes vivían sólo en logger.info. El handler
// real está en src/server/routes/zettelkasten.ts; aquí golpeamos la
// versión espejada en test-server.ts (mismas validaciones, mismos
// status codes — ver justificación en test-server.ts).
//
// Casos:
//   • Auth: 401 sin token / token inválido
//   • Validación: 400 si falta projectId, type, severity, metadata, etc.
//   • Tenant isolation: 403 si el caller no es member
//   • Happy path + idempotencia: re-POST con misma idempotencyKey ⇒
//     mismos ids, sin duplicar la fila en zettelkasten_nodes.
//   • Audit: cada write deja audit_logs con userId server-decoded.
//   • Rate limit: 31º POST en la ventana ⇒ 429.

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { buildTestServer, type TestServerHandle, InMemoryFirestore } from './test-server.js';

let handle: TestServerHandle;
let fs: InMemoryFirestore;

function validNode(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Riesgo levantamiento andamio',
    description: 'F sustentación supera capacidad anclajes (NCh 432)',
    type: 'scaffold-uplift',
    severity: 'high',
    metadata: { forceN: 1234, ratedN: 5000 },
    connections: ['surface:scaff-1'],
    references: ['NCh 432'],
    idempotencyKey: 'abc1234567890def',
    ...overrides,
  };
}

beforeEach(() => {
  fs = new InMemoryFirestore();
  handle = buildTestServer({ firestore: fs });
  // Proyecto con uid-A como member.
  fs.store.set('projects/proj-A', { name: 'Faena Norte', members: ['uid-A'], createdBy: 'uid-A' });
});

describe('POST /api/zettelkasten/nodes', () => {
  it('returns 401 without Authorization header', async () => {
    const res = await request(handle.app).post('/api/zettelkasten/nodes').send({});
    expect(res.status).toBe(401);
  });

  it('returns 400 when projectId is missing', async () => {
    const res = await request(handle.app)
      .post('/api/zettelkasten/nodes')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ nodes: [validNode()] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectId/);
  });

  it('returns 400 when nodes array is empty', async () => {
    const res = await request(handle.app)
      .post('/api/zettelkasten/nodes')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ projectId: 'proj-A', nodes: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when a node is missing nodeType', async () => {
    const bad = validNode();
    delete (bad as any).type;
    const res = await request(handle.app)
      .post('/api/zettelkasten/nodes')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ projectId: 'proj-A', nodes: [bad] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type/);
  });

  it('returns 400 when severity is invalid', async () => {
    const res = await request(handle.app)
      .post('/api/zettelkasten/nodes')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ projectId: 'proj-A', nodes: [validNode({ severity: 'doom' })] });
    expect(res.status).toBe(400);
  });

  it('returns 403 when caller is not a member of the project (cross-tenant)', async () => {
    const res = await request(handle.app)
      .post('/api/zettelkasten/nodes')
      .set('Authorization', 'Bearer test:uid-Z:z@test.com')
      .send({ projectId: 'proj-A', nodes: [validNode()] });
    expect(res.status).toBe(403);
    // No write to zettelkasten_nodes occurred.
    const keys = Array.from(fs.store.keys()).filter((k) => k.startsWith('zettelkasten_nodes/'));
    expect(keys).toHaveLength(0);
  });

  it('writes node + audit_log when caller is a member (happy path)', async () => {
    const res = await request(handle.app)
      .post('/api/zettelkasten/nodes')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ projectId: 'proj-A', nodes: [validNode()] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.ids).toEqual(['abc1234567890def']);
    // Doc landed.
    const doc = fs.store.get('zettelkasten_nodes/abc1234567890def');
    expect(doc).toBeDefined();
    expect(doc.projectId).toBe('proj-A');
    expect(doc.createdBy).toBe('uid-A');
    expect(doc.createdByEmail).toBe('a@test.com');
    // Audit row landed with server-decoded userId.
    const audit = fs.audit.find((e) => e.action === 'zettelkasten.node.write');
    expect(audit).toBeDefined();
    expect(audit!.userId).toBe('uid-A');
    expect(audit!.projectId).toBe('proj-A');
    expect(audit!.details.nodeId).toBe('abc1234567890def');
  });

  it('is idempotent: re-POSTing same idempotencyKey returns same ids and does not duplicate', async () => {
    await request(handle.app)
      .post('/api/zettelkasten/nodes')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ projectId: 'proj-A', nodes: [validNode()] });
    const res2 = await request(handle.app)
      .post('/api/zettelkasten/nodes')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ projectId: 'proj-A', nodes: [validNode()] });
    expect(res2.status).toBe(200);
    expect(res2.body.ids).toEqual(['abc1234567890def']);
    // Sigue siendo UNA fila.
    const keys = Array.from(fs.store.keys()).filter((k) => k.startsWith('zettelkasten_nodes/'));
    expect(keys).toHaveLength(1);
  });

  it('returns 429 on the 31st request in the same window (rate limit)', async () => {
    // Mandamos 30 OKs y luego 1 que excede.
    for (let i = 0; i < 30; i++) {
      const res = await request(handle.app)
        .post('/api/zettelkasten/nodes')
        .set('Authorization', 'Bearer test:uid-A:a@test.com')
        .send({
          projectId: 'proj-A',
          nodes: [
            validNode({
              idempotencyKey: `k${i.toString().padStart(15, '0')}`,
            }),
          ],
        });
      expect(res.status).toBe(200);
    }
    const over = await request(handle.app)
      .post('/api/zettelkasten/nodes')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ projectId: 'proj-A', nodes: [validNode({ idempotencyKey: 'kover0000000000' })] });
    expect(over.status).toBe(429);
  });
});
