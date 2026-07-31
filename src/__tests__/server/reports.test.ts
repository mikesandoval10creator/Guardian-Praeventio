// Praeventio Guard — security depth: /api/reports/generate-pdf body limits.
//
// The route was bumped past the global 64kb cap because legitimate
// occupational-safety reports carry the full incident narrative + AI
// summary — frequently >100kb. We assert:
//   • A 200kb+ body is ACCEPTED (the bump works).
//   • A >2MB body is REJECTED with 413 (the new ceiling is enforced).

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { buildTestServer, type TestServerHandle, InMemoryFirestore } from './test-server.js';

let handle: TestServerHandle;
let fs: InMemoryFirestore;

beforeEach(() => {
  fs = new InMemoryFirestore();
  handle = buildTestServer({ firestore: fs });
});

describe('POST /api/reports/generate-pdf — body size limits', () => {
  it('accepts a 200kb+ body (the bumped limit works)', async () => {
    const bigContent = 'A'.repeat(220 * 1024); // 220kb of payload
    const res = await request(handle.app)
      .post('/api/reports/generate-pdf')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ incidentId: 'inc-1', title: 'Big Report', content: bigContent });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
  });

  it('rejects a >2MB body with 413', async () => {
    const tooBig = 'B'.repeat(2.2 * 1024 * 1024); // 2.2MB
    const res = await request(handle.app)
      .post('/api/reports/generate-pdf')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ incidentId: 'inc-2', title: 'Too Big', content: tooBig });
    expect(res.status).toBe(413);
  });
});

// ─────────────────────────────────────────────────────────────────────
// P0 fabrication guards — see ticket 39baa66d-73fe-8113-92d3-f77c21e69724.
// A "Reporte SUSESO" PDF must NEVER be emittable from arbitrary client
// content. The legacy endpoint accepted title/content/metadata and emitted
// a PDF bearing Praeventio brand + "Válido como registro interno conforme
// a directrices Minsal" + a `Reporte_SUSESO_*` filename. That contract is
// a legal exposure. The new contract:
//   • A caller-supplied incidentId MUST match a real incident scoped to
//     the caller's project (assertProjectMember + projectId cross-check).
//   • The PDF title/content/metadata MUST come from the server's
//     reconstruction of the incident — NOT from the request body.
//   • The PDF MUST include a server-computed signature (SHA-256 of the
//     canonical incident payload) so the report is verifiable.
//   • Draft reports go through `/api/sprint-k/:projectId/reports/draft`
//     and explicitly do NOT carry the SUSESO / "registro interno" claim.
//   • The legacy `/api/reports/generate-pdf` (no projectId, no
//     incidentId) only allows the historical ad-hoc PDF shape and the
//     PDF MUST be marked "BORRADOR — NO ES REPORTE OFICIAL".
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/sprint-k/:projectId/incidents/:incidentId/report — official reconstruction', () => {
  function seedProjectAndIncident() {
    fs.store.set('projects/p-off', {
      tenantId: 't-off',
      members: ['uid-A'],
      createdBy: 'uid-A',
      name: 'Oficial Test',
    });
    fs.store.set('incidents/inc-real', {
      projectId: 'p-off',
      tenantId: 't-off',
      occurredAt: '2026-07-15T10:00:00.000Z',
      reportedAt: '2026-07-15T10:05:00.000Z',
      reportedByUid: 'uid-A',
      severity: 'high',
      summary: 'Resumen autoritativo del incidente',
      description: 'Descripción autoritativa',
      location: { site: 'Faena Norte' },
    });
  }

  it('rejects fabrication: server ignores client title/content and rebuilds from incident', async () => {
    seedProjectAndIncident();
    const res = await request(handle.app)
      .post('/api/sprint-k/p-off/incidents/inc-real/report')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({
        title: 'TITULO FALSO INYECTADO POR ATACANTE',
        content: '## Contenido inventado\nMentira completa.',
        metadata: { funcionario: 'Fake SUSESO Officer', supervisor: 'Inexistente' },
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
    const buf = res.body as Buffer;
    const text = buf.toString('utf8');
    // The fake title MUST NOT appear — server only renders from canonical data.
    expect(text).not.toMatch(/TITULO FALSO INYECTADO POR ATACANTE/);
    expect(text).not.toMatch(/Mentira completa/);
    // Server-derived content MUST be present.
    expect(text).toMatch(/Resumen autoritativo del incidente/);
    expect(text).not.toMatch(/Fake SUSESO Officer/);
  });

  it('official report carries a server-computed SHA-256 signature', async () => {
    seedProjectAndIncident();
    const res = await request(handle.app)
      .post('/api/sprint-k/p-off/incidents/inc-real/report')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ title: 'IGNORED', content: 'IGNORED' });
    expect(res.status).toBe(200);
    expect(res.headers['x-report-sha256']).toMatch(/^[a-f0-9]{64}$/);
    expect(res.headers['x-report-incident-id']).toBe('inc-real');
  });

  it('403 when caller is NOT a project member (cross-tenant prevention)', async () => {
    fs.store.set('projects/p-iso', {
      tenantId: 't-iso',
      members: ['somebody-else'],
      createdBy: 'somebody-else',
    });
    fs.store.set('incidents/inc-iso', {
      projectId: 'p-iso',
      tenantId: 't-iso',
      occurredAt: '2026-07-15T10:00:00.000Z',
      reportedByUid: 'somebody-else',
      severity: 'medium',
      summary: 'Aislado',
    });
    const res = await request(handle.app)
      .post('/api/sprint-k/p-iso/incidents/inc-iso/report')
      .set('Authorization', 'Bearer test:uid-attacker:attacker@evil.com')
      .send({});
    expect(res.status).toBe(403);
  });

  it('404 when incidentId does not exist (no fabrication of ghost incidents)', async () => {
    fs.store.set('projects/p-off', {
      tenantId: 't-off',
      members: ['uid-A'],
      createdBy: 'uid-A',
    });
    const res = await request(handle.app)
      .post('/api/sprint-k/p-off/incidents/inc-ghost/report')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({});
    expect(res.status).toBe(404);
  });

  it('403 when incident belongs to a DIFFERENT project (cross-project smuggling)', async () => {
    fs.store.set('projects/p-real', {
      tenantId: 't-real',
      members: ['uid-A'],
      createdBy: 'uid-A',
    });
    fs.store.set('projects/p-other', {
      tenantId: 't-other',
      members: [],
      createdBy: 'somebody-else',
    });
    fs.store.set('incidents/inc-smuggle', {
      projectId: 'p-other',
      tenantId: 't-other',
      occurredAt: '2026-07-15T10:00:00.000Z',
      reportedByUid: 'somebody-else',
      severity: 'low',
      summary: 'belongs to p-other',
    });
    const res = await request(handle.app)
      .post('/api/sprint-k/p-real/incidents/inc-smuggle/report')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('POST /api/sprint-k/:projectId/reports/draft — ad-hoc drafts explicitly NOT official', () => {
  it('returns a DRAFT PDF that does NOT carry the SUSESO / Minsal official claim', async () => {
    fs.store.set('projects/p-draft', {
      tenantId: 't-draft',
      members: ['uid-A'],
      createdBy: 'uid-A',
    });
    const res = await request(handle.app)
      .post('/api/sprint-k/p-draft/reports/draft')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({
        type: 'safety',
        title: 'Borrador propio del supervisor',
        content: 'Notas en borrador, todavía sin validar.',
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
    expect(res.headers['content-disposition']).toMatch(/Borrador/i);
    expect(res.headers['content-disposition']).not.toMatch(/SUSESO/);
    const text = (res.body as Buffer).toString('utf8');
    // The official claim MUST be absent on a draft.
    expect(text).not.toMatch(/Válido como registro interno/);
    expect(text).not.toMatch(/Reporte SUSESO/);
    // The draft marker MUST be present.
    expect(text).toMatch(/BORRADOR/i);
  });

  it('403 when caller is NOT a project member', async () => {
    fs.store.set('projects/p-draft-iso', {
      tenantId: 't-draft-iso',
      members: ['someone-else'],
      createdBy: 'someone-else',
    });
    const res = await request(handle.app)
      .post('/api/sprint-k/p-draft-iso/reports/draft')
      .set('Authorization', 'Bearer test:uid-stranger:stranger@x.com')
      .send({ title: 'Borrador aislado' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/reports/generate-pdf — legacy path is now DRAFT-only', () => {
  it('legacy endpoint output is explicitly marked as BORRADOR (not a SUSESO official)', async () => {
    const res = await request(handle.app)
      .post('/api/reports/generate-pdf')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ title: 'Legacy PDF test', content: 'hello world' });
    expect(res.status).toBe(200);
    const text = (res.body as Buffer).toString('utf8');
    // The legacy path can no longer claim to be a SUSESO / official Minsal record.
    expect(text).toMatch(/BORRADOR/i);
    expect(text).not.toMatch(/Reporte SUSESO/);
    expect(text).not.toMatch(/Válido como registro interno/);
  });
});
