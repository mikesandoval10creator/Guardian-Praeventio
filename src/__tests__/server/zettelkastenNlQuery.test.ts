// Sprint 29 Bucket AA F-B â€” integration tests para POST /api/zettelkasten/nl-query.
//
// Estrategia: en vez de bootear el server.ts completo (3000+ LOC, depende de
// firebase-admin global), montamos un Express mini-app que mimetiza el
// pipeline real (verifyAuth fake â†’ validate(zodSchema) â†’ assertProjectMember
// fake â†’ searchIncidents). Los dos casos cubiertos:
//   1. Zod fail (query vacÃ­o) â†’ 400 con error 'invalid_payload'.
//   2. Happy path â†’ 200 con results + citations del incidente sembrado.

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { searchIncidents, type IncidentRagDeps, type MinimalDocSnap } from
  '../../services/incidents/incidentRagService';
import { validate } from '../../server/middleware/validate.js';

const nlQuerySchema = z.object({
  query: z.string().min(1).max(1024),
  projectId: z.string().min(1).max(128),
  topK: z.number().int().min(1).max(20).optional().default(5),
});

function buildApp(opts: {
  isMember: boolean;
  tenantADocs: MinimalDocSnap[];
}) {
  const app = express();
  app.use(express.json());

  // Fake verifyAuth: token "valid:uid-X" passes; everything else 401.
  app.use((req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const tok = auth.slice(7);
    const [_, uid] = tok.split(':');
    if (!uid) return res.status(401).json({ error: 'unauthorized' });
    req.user = { uid };
    next();
  });

  app.post('/api/zettelkasten/nl-query', validate(nlQuerySchema), async (req, res) => {
    const callerUid = req.user?.uid;
    if (!callerUid) return res.status(401).json({ error: 'unauthorized' });
    const { query, projectId, topK } = req.body;
    if (!opts.isMember) return res.status(403).json({ error: 'forbidden' });

    // Fake firestore exposing tenantADocs at the expected path.
    const fakeDb = {
      collection(path: string) {
        return {
          doc(_id: string) {
            return { async set() {} };
          },
          findNearest(_field: string, _vector: unknown, options: any) {
            const docs = path === `incident_vectors/${projectId}/items`
              ? opts.tenantADocs
              : [];
            const limited = docs.slice(0, options.limit);
            return {
              async get() {
                return { docs: limited, empty: limited.length === 0 };
              },
            };
          },
        } as any;
      },
    };
    const deps: IncidentRagDeps = {
      db: fakeDb as any,
      embed: async () => [0.1, 0.2, 0.3],
    };
    const result = await searchIncidents(projectId, query, topK ?? 5, deps);
    return res.json(result);
  });

  return app;
}

describe('POST /api/zettelkasten/nl-query â€” Zod fail', () => {
  it('returns 400 when query is empty (Zod min(1))', async () => {
    const app = buildApp({ isMember: true, tenantADocs: [] });
    const res = await request(app)
      .post('/api/zettelkasten/nl-query')
      .set('Authorization', 'Bearer tok:uid-1')
      .send({ query: '', projectId: 'proj-A' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 400 when projectId is missing', async () => {
    const app = buildApp({ isMember: true, tenantADocs: [] });
    const res = await request(app)
      .post('/api/zettelkasten/nl-query')
      .set('Authorization', 'Bearer tok:uid-1')
      .send({ query: 'caÃ­da altura' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

describe('POST /api/zettelkasten/nl-query â€” happy path', () => {
  it('returns results+citations for a tenant-scoped incident match', async () => {
    const docs: MinimalDocSnap[] = [
      {
        id: 'inc-1',
        data: () => ({
          tenantId: 'proj-A',
          incidentId: 'inc-1',
          projectId: 'proj-A',
          summary: 'CaÃ­da de altura sin arnÃ©s en pasarela.',
          occurredAt: '2026-04-10',
        }),
      },
    ];
    const app = buildApp({ isMember: true, tenantADocs: docs });
    const res = await request(app)
      .post('/api/zettelkasten/nl-query')
      .set('Authorization', 'Bearer tok:uid-1')
      .send({ query: 'altura arnÃ©s', projectId: 'proj-A', topK: 3 });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      incidentId: 'inc-1',
      projectId: 'proj-A',
    });
    expect(res.body.citations[0]).toContain('inc-1');
  });
});
