// Real-router supertest for project membership/invitation authorization —
// a privilege + IDOR surface (who can invite/list/remove/cancel). Mounted via
// fakeFirestore + a controllable Auth mock. Bug-hunting: creator-only gates,
// self-vs-other removal, un-removable creator, cross-project invite IDOR.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  roles: {} as Record<string, string | undefined>,
  emailToUid: {} as Record<string, string>,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  const auth = {
    getUser: async (uid: string) => ({
      uid, customClaims: { role: H.roles[uid] }, displayName: `User ${uid}`, email: `${uid}@x.cl`, photoURL: null,
    }),
    getUserByEmail: async (email: string) => {
      const uid = H.emailToUid[email];
      if (!uid) throw new Error('auth/user-not-found');
      return { uid, email, displayName: `User ${uid}` };
    },
  };
  return adminMock(() => H.db!, auth);
});
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('resend', () => ({ Resend: class { emails = { send: vi.fn(async () => ({ id: 'e' })) }; } }));
vi.mock('../../services/email/resendService.js', () => ({ EmailService: { fromEnv: () => null } }));
vi.mock('../../services/email/templates.js', () => ({ projectInvitationTemplate: () => '<html>' }));
vi.mock('../../services/analytics/serverAdapter.js', () => ({ serverAnalytics: { track: vi.fn(async () => {}) } }));
vi.mock('../../services/observability/index.js', () => ({ getErrorTracker: () => ({ captureException: vi.fn() }) }));
vi.mock('../../utils/logger.js', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import projectsRouter from '../../server/routes/projects.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', projectsRouter);
  return app;
}
const as = (uid: string) => ({ 'x-test-uid': uid });

beforeEach(() => {
  H.roles = { creator1: 'operario', admin1: 'admin', member1: 'operario', stranger: 'operario' };
  H.emailToUid = {};
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', {
    name: 'Obra Norte', createdBy: 'creator1',
    members: ['creator1', 'member1'], memberRoles: { creator1: 'gerente', member1: 'operario' },
  });
});

describe('POST /:id/invite', () => {
  it('404 when the project is missing', async () => {
    const res = await request(buildApp()).post('/api/projects/nope/invite').set(as('creator1')).send({ invitedEmail: 'a@x.cl', invitedRole: 'operario' });
    expect(res.status).toBe(404);
  });

  it('400 when fields are missing', async () => {
    const res = await request(buildApp()).post('/api/projects/p1/invite').set(as('creator1')).send({ invitedEmail: 'a@x.cl' });
    expect(res.status).toBe(400);
  });

  it('403 when a non-creator non-admin tries to invite', async () => {
    const res = await request(buildApp()).post('/api/projects/p1/invite').set(as('stranger')).send({ invitedEmail: 'a@x.cl', invitedRole: 'operario' });
    expect(res.status).toBe(403);
  });

  it('200 when the creator invites a new email (writes a pending invitation + token)', async () => {
    const res = await request(buildApp()).post('/api/projects/p1/invite').set(as('creator1')).send({ invitedEmail: 'nuevo@x.cl', invitedRole: 'supervisor' });
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^[a-f0-9]{64}$/);
    const inviteKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('invitations/'));
    expect(inviteKeys.length).toBe(1);
  });

  it('200 when a per-project gerente member (non-creator) invites', async () => {
    // gerenteMember belongs to p1 with a `gerente` per-project role.
    H.db!._seed('projects/p1', {
      name: 'Obra Norte', createdBy: 'creator1',
      members: ['creator1', 'gerenteMember'], memberRoles: { creator1: 'gerente', gerenteMember: 'gerente' },
    });
    const res = await request(buildApp()).post('/api/projects/p1/invite').set(as('gerenteMember')).send({ invitedEmail: 'nuevo@x.cl', invitedRole: 'operario' });
    expect(res.status).toBe(200);
  });

  it('403 — a GLOBAL admin who is NOT a member of this project cannot invite (B17 cross-project IDOR)', async () => {
    // admin1 carries a global `admin` custom claim but is not in p1.members.
    // Under the per-project model the global claim grants nothing here.
    const res = await request(buildApp()).post('/api/projects/p1/invite').set(as('admin1')).send({ invitedEmail: 'nuevo@x.cl', invitedRole: 'operario' });
    expect(res.status).toBe(403);
  });

  it('403 — a member WITHOUT a management role cannot invite', async () => {
    // member1 is a member but their per-project role is `operario`.
    const res = await request(buildApp()).post('/api/projects/p1/invite').set(as('member1')).send({ invitedEmail: 'nuevo@x.cl', invitedRole: 'operario' });
    expect(res.status).toBe(403);
  });

  it('409 when the invited email already belongs to a member', async () => {
    H.emailToUid['member@x.cl'] = 'member1';
    const res = await request(buildApp()).post('/api/projects/p1/invite').set(as('creator1')).send({ invitedEmail: 'member@x.cl', invitedRole: 'operario' });
    expect(res.status).toBe(409);
  });

  it('409 when a pending invitation already exists for that email', async () => {
    H.db!._seed('invitations/i1', { projectId: 'p1', invitedEmail: 'dup@x.cl', status: 'pending' });
    const res = await request(buildApp()).post('/api/projects/p1/invite').set(as('creator1')).send({ invitedEmail: 'dup@x.cl', invitedRole: 'operario' });
    expect(res.status).toBe(409);
  });
});

describe('GET /:id/members', () => {
  it('403 for a non-member non-admin', async () => {
    expect((await request(buildApp()).get('/api/projects/p1/members').set(as('stranger'))).status).toBe(403);
  });

  it('200 for a member — returns members + pending invitations', async () => {
    H.db!._seed('invitations/i1', { projectId: 'p1', invitedEmail: 'p@x.cl', invitedRole: 'operario', status: 'pending' });
    const res = await request(buildApp()).get('/api/projects/p1/members').set(as('member1'));
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(2);
    expect(res.body.members.find((m: { uid: string }) => m.uid === 'creator1').isCreator).toBe(true);
    expect(res.body.pendingInvitations).toHaveLength(1);
  });
});

describe('DELETE /:id/members/:uid', () => {
  it('403 when a member tries to remove ANOTHER member', async () => {
    // member1 removing creator1 is also blocked, but test the generic case:
    H.db!._seed('projects/p1', { name: 'Obra', createdBy: 'creator1', members: ['creator1', 'member1', 'member2'], memberRoles: {} });
    const res = await request(buildApp()).delete('/api/projects/p1/members/member2').set(as('member1'));
    expect(res.status).toBe(403);
  });

  it('400 cannot remove the project creator', async () => {
    const res = await request(buildApp()).delete('/api/projects/p1/members/creator1').set(as('creator1'));
    expect(res.status).toBe(400);
  });

  it('200 creator removes a member (arrayRemove + role cleanup)', async () => {
    const res = await request(buildApp()).delete('/api/projects/p1/members/member1').set(as('creator1'));
    expect(res.status).toBe(200);
    const proj = H.db!._dump()['projects/p1'] as { members: string[]; memberRoles: Record<string, string> };
    expect(proj.members).not.toContain('member1');
    expect(proj.memberRoles.member1).toBeUndefined();
  });

  it('200 a member may remove THEMSELVES (self-leave)', async () => {
    const res = await request(buildApp()).delete('/api/projects/p1/members/member1').set(as('member1'));
    expect(res.status).toBe(200);
    expect((H.db!._dump()['projects/p1'] as { members: string[] }).members).not.toContain('member1');
  });

  it('200 a per-project gerente member removes another member', async () => {
    H.db!._seed('projects/p1', {
      name: 'Obra', createdBy: 'creator1',
      members: ['creator1', 'gerenteMember', 'member2'],
      memberRoles: { gerenteMember: 'gerente', member2: 'operario' },
    });
    const res = await request(buildApp()).delete('/api/projects/p1/members/member2').set(as('gerenteMember'));
    expect(res.status).toBe(200);
    expect((H.db!._dump()['projects/p1'] as { members: string[] }).members).not.toContain('member2');
  });

  it('403 a GLOBAL admin who is NOT a member cannot remove (B17 cross-project IDOR)', async () => {
    const res = await request(buildApp()).delete('/api/projects/p1/members/member1').set(as('admin1'));
    expect(res.status).toBe(403);
  });
});

describe('DELETE /:id/invite (cancel)', () => {
  it('403 for a non-creator non-admin', async () => {
    H.db!._seed('invitations/i1', { projectId: 'p1', status: 'pending' });
    const res = await request(buildApp()).delete('/api/projects/p1/invite').set(as('stranger')).send({ inviteId: 'i1' });
    expect(res.status).toBe(403);
  });

  it('403 IDOR — cannot cancel an invitation belonging to another project', async () => {
    H.db!._seed('invitations/other', { projectId: 'OTHER_PROJECT', status: 'pending' });
    const res = await request(buildApp()).delete('/api/projects/p1/invite').set(as('creator1')).send({ inviteId: 'other' });
    expect(res.status).toBe(403);
    expect(H.db!._store.has('invitations/other')).toBe(true); // not deleted
  });

  it('200 creator cancels a pending invitation', async () => {
    H.db!._seed('invitations/i1', { projectId: 'p1', status: 'pending' });
    const res = await request(buildApp()).delete('/api/projects/p1/invite').set(as('creator1')).send({ inviteId: 'i1' });
    expect(res.status).toBe(200);
    expect(H.db!._store.has('invitations/i1')).toBe(false);
  });
});

// POST / (create) — the server-side creation path that closes the audit-log
// gap: the Projects page used to addDoc straight from the client (identity
// held by rules, but NO audit_logs row — CLAUDE.md #3). The endpoint stamps
// createdBy/tenantId/members from the verified token and audits the create.
describe('POST / (create project)', () => {
  const validBody = {
    name: 'Obra Sur',
    description: 'Edificio habitacional',
    location: 'Rancagua',
    industry: 'Construcción',
    startDate: '2026-07-06',
    riskLevel: 'Medio',
    status: 'active',
  };

  const auditRows = () =>
    [...H.db!._store.entries()]
      .filter(([k]) => k.startsWith('audit_logs/'))
      .map(([, v]) => v as Record<string, any>);

  it('401 without a token', async () => {
    const res = await request(buildApp()).post('/api/projects').send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 when name is missing/empty', async () => {
    const res = await request(buildApp()).post('/api/projects').set(as('u1')).send({ ...validBody, name: '' });
    expect(res.status).toBe(400);
  });

  it('400 on an invalid status', async () => {
    const res = await request(buildApp()).post('/api/projects').set(as('u1')).send({ ...validBody, status: 'hacked' });
    expect(res.status).toBe(400);
  });

  it('200 creates the project with server-stamped identity + audit row', async () => {
    const res = await request(buildApp()).post('/api/projects').set(as('u1')).send(validBody);
    expect(res.status).toBe(200);
    const projectId = res.body.projectId as string;
    expect(typeof projectId === 'string' && projectId.length > 0).toBe(true);

    const doc = H.db!._store.get(`projects/${projectId}`) as Record<string, any>;
    expect(doc).toBeTruthy();
    expect(doc.name).toBe('Obra Sur');
    expect(doc.createdBy).toBe('u1'); // from the verified token
    expect(doc.tenantId).toBe('u1'); // single-tenant-per-user
    expect(doc.members).toEqual(['u1']);
    expect(typeof doc.createdAt === 'string' && doc.createdAt.length > 0).toBe(true);

    const audit = auditRows().find((r) => r.action === 'projects.create');
    expect(audit, 'a projects.create audit row must exist').toBeTruthy();
    expect(audit!.userId).toBe('u1'); // stamped by auditServerEvent from the token
    expect(audit!.details?.projectId).toBe(projectId);
  });

  it('200 ignores client-supplied identity fields (createdBy/tenantId/members spoof)', async () => {
    const res = await request(buildApp())
      .post('/api/projects')
      .set(as('u1'))
      .send({ ...validBody, createdBy: 'evil', tenantId: 'other-tenant', members: ['evil', 'u1'] });
    expect(res.status).toBe(200);
    const doc = H.db!._store.get(`projects/${res.body.projectId}`) as Record<string, any>;
    expect(doc.createdBy).toBe('u1');
    expect(doc.tenantId).toBe('u1');
    expect(doc.members).toEqual(['u1']);
  });
});
