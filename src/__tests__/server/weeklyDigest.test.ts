// Unit tests for src/server/jobs/weeklyDigest.ts
// Covers: computeLastWeekWindow, runWeeklyDigest (all branches).
// Pattern: inject fakeFirestore via options.getDb + fake emailService via
// options.emailService — no firebase-admin global mock needed because the job
// accepts deps injection. Follows the proven pattern in adminJobs.test.ts /
// fakeFirestore.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeLastWeekWindow,
  runWeeklyDigest,
  type WeeklyDigestOptions,
  type WeeklyDigestResult,
} from '../../server/jobs/weeklyDigest.js';
import { createFakeFirestore, type FakeFirestore } from '../helpers/fakeFirestore.js';
import type { BatchResult } from '../../services/email/resendService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDate(isoString: string): Date {
  return new Date(isoString);
}

/** Fake EmailService that records calls and returns a configurable BatchResult. */
function makeFakeEmailService(batchResult: BatchResult = { sent: 1, failed: 0, results: [{ ok: true, id: 'msg-1' }] }) {
  const calls: Array<{ emails: string[]; subject: string; tag: string | undefined }> = [];
  return {
    sendBatch: vi.fn(async (messages: Array<{ to: string; subject: string; html: string; tag?: string }>) => {
      calls.push({
        emails: messages.map((m) => m.to),
        subject: messages[0]?.subject ?? '',
        tag: messages[0]?.tag,
      });
      return batchResult;
    }),
    _calls: calls,
  };
}

/** Seed a project doc + members subcollection into the fake store. */
function seedProject(
  db: FakeFirestore,
  projectId: string,
  opts: {
    tenantId: string;
    name: string;
    status?: string;
    daysWithoutIncident?: number;
    supervisors?: Array<{ role: string; email: string }>;
  },
) {
  db._seed(`projects/${projectId}`, {
    tenantId: opts.tenantId,
    name: opts.name,
    status: opts.status ?? 'active',
    daysWithoutIncident: opts.daysWithoutIncident ?? 0,
  });
  for (const [i, sup] of (opts.supervisors ?? []).entries()) {
    db._seed(`projects/${projectId}/members/m${i}`, {
      role: sup.role,
      email: sup.email,
    });
  }
}

/** Seed a finding doc.  createdAt / closedAt are fake Timestamp objects. */
function makeTimestamp(isoString: string) {
  const d = new Date(isoString);
  return { toDate: () => d };
}

function seedFinding(
  db: FakeFirestore,
  tenantId: string,
  findingId: string,
  opts: {
    projectId: string;
    createdAt?: string;
    closedAt?: string;
    riskLabel?: string;
  },
) {
  const data: Record<string, unknown> = { projectId: opts.projectId };
  if (opts.createdAt) data.createdAt = makeTimestamp(opts.createdAt);
  if (opts.closedAt) data.closedAt = makeTimestamp(opts.closedAt);
  if (opts.riskLabel) data.riskLabel = opts.riskLabel;
  db._seed(`tenants/${tenantId}/findings/${findingId}`, data);
}

function seedProcess(
  db: FakeFirestore,
  tenantId: string,
  procId: string,
  opts: { projectId: string; status: string; completedAt?: string },
) {
  const data: Record<string, unknown> = {
    projectId: opts.projectId,
    status: opts.status,
  };
  if (opts.completedAt) data.completedAt = makeTimestamp(opts.completedAt);
  db._seed(`tenants/${tenantId}/processes/${procId}`, data);
}

function seedCrew(
  db: FakeFirestore,
  tenantId: string,
  crewId: string,
  opts: { projectId: string; weeklyXp?: number },
) {
  db._seed(`tenants/${tenantId}/crews/${crewId}`, {
    projectId: opts.projectId,
    weeklyXp: opts.weeklyXp ?? 0,
  });
}

// ---------------------------------------------------------------------------
// computeLastWeekWindow — pure utility
// ---------------------------------------------------------------------------

describe('computeLastWeekWindow', () => {
  it('returns the previous Mon–Sun window (ISO)', () => {
    // Tuesday 2026-05-12 UTC => last Mon was 2026-05-04, last Sun was 2026-05-10T23:59:59.999Z
    const { start, end } = computeLastWeekWindow(makeDate('2026-05-12T10:00:00Z'));
    expect(start).toBe('2026-05-04T00:00:00.000Z');
    expect(end).toBe('2026-05-10T23:59:59.999Z');
  });

  it('on Monday itself the window is still the previous week', () => {
    // Monday 2026-05-11 => last Mon was 2026-05-04, last Sun was 2026-05-10
    const { start, end } = computeLastWeekWindow(makeDate('2026-05-11T09:00:00Z'));
    expect(start).toBe('2026-05-04T00:00:00.000Z');
    expect(end).toBe('2026-05-10T23:59:59.999Z');
  });

  it('on Sunday the window covers the week that just ended', () => {
    // Sunday 2026-05-10 => last Mon was 2026-04-27, last Sun was 2026-05-03
    const { start, end } = computeLastWeekWindow(makeDate('2026-05-10T23:00:00Z'));
    expect(start).toBe('2026-04-27T00:00:00.000Z');
    expect(end).toBe('2026-05-03T23:59:59.999Z');
  });

  it('returned start is before end', () => {
    const { start, end } = computeLastWeekWindow(new Date());
    expect(new Date(start).getTime()).toBeLessThan(new Date(end).getTime());
  });

  it('window spans exactly 7 days minus 1 ms', () => {
    const { start, end } = computeLastWeekWindow(makeDate('2026-05-27T08:00:00Z'));
    const diffMs = new Date(end).getTime() - new Date(start).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000 - 1;
    expect(diffMs).toBe(sevenDaysMs);
  });
});

// ---------------------------------------------------------------------------
// runWeeklyDigest — no emailService (null / missing RESEND_API_KEY)
// ---------------------------------------------------------------------------

describe('runWeeklyDigest — no emailService configured', () => {
  it('returns a structured result without processing projects when emailService is null', async () => {
    const db = createFakeFirestore();
    const result = await runWeeklyDigest({
      getDb: () => db as any,
      emailService: null,
      now: () => makeDate('2026-05-26T09:00:00Z'),
    } satisfies WeeklyDigestOptions);

    expect(result.projectsProcessed).toBe(0);
    expect(result.totalEmailsSent).toBe(0);
    expect(result.perProject).toHaveLength(0);
    // windowStart/End are still populated
    expect(result.windowStart).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.windowEnd).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// runWeeklyDigest — project discovery failure
// ---------------------------------------------------------------------------

describe('runWeeklyDigest — Firestore unavailable', () => {
  it('returns error entry when projects query throws', async () => {
    const brokenDb = {
      collection: () => ({
        where: () => ({
          get: async () => {
            throw new Error('firestore_unavailable');
          },
        }),
      }),
    };
    const fakeEmail = makeFakeEmailService();

    const result: WeeklyDigestResult = await runWeeklyDigest({
      getDb: () => brokenDb as any,
      emailService: fakeEmail as any,
      now: () => makeDate('2026-05-26T09:00:00Z'),
    });

    expect(result.perProject).toHaveLength(1);
    expect(result.perProject[0].projectId).toBe('*');
    expect(result.perProject[0].errors).toBe(1);
    expect(result.perProject[0].skippedReason).toContain('projects_query_failed');
    expect(vi.mocked(fakeEmail.sendBatch)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runWeeklyDigest — happy path with data
// ---------------------------------------------------------------------------

describe('runWeeklyDigest — happy path', () => {
  let db: FakeFirestore;
  // Use a fixed "now" = Tuesday 2026-05-12; window = 2026-05-04 to 2026-05-10
  const NOW = makeDate('2026-05-12T09:00:00Z');
  const WIN_START = '2026-05-04T00:00:00.000Z';
  const WIN_END = '2026-05-10T23:59:59.999Z';

  beforeEach(() => {
    db = createFakeFirestore();
    seedProject(db, 'proj-alpha', {
      tenantId: 'tenant-1',
      name: 'Proyecto Alpha',
      status: 'active',
      daysWithoutIncident: 42,
      supervisors: [
        { role: 'supervisor', email: 'sup@example.com' },
        { role: 'gerente', email: 'ger@example.com' },
        { role: 'trabajador', email: 'worker@example.com' }, // non-supervisor — should NOT receive
      ],
    });
    // 2 findings inside window, 1 outside
    seedFinding(db, 'tenant-1', 'f1', { projectId: 'proj-alpha', createdAt: '2026-05-05T10:00:00Z', riskLabel: 'caida' });
    seedFinding(db, 'tenant-1', 'f2', { projectId: 'proj-alpha', createdAt: '2026-05-07T10:00:00Z', closedAt: '2026-05-08T10:00:00Z', riskLabel: 'caida' });
    seedFinding(db, 'tenant-1', 'f3', { projectId: 'proj-alpha', createdAt: '2026-04-20T10:00:00Z', riskLabel: 'ergonomia' }); // before window
    // 1 process completed inside window, 1 outside
    seedProcess(db, 'tenant-1', 'proc1', { projectId: 'proj-alpha', status: 'completed', completedAt: '2026-05-06T12:00:00Z' });
    seedProcess(db, 'tenant-1', 'proc2', { projectId: 'proj-alpha', status: 'completed', completedAt: '2026-04-01T12:00:00Z' }); // outside window
    seedProcess(db, 'tenant-1', 'proc3', { projectId: 'proj-alpha', status: 'open' }); // wrong status
    // XP
    seedCrew(db, 'tenant-1', 'crew1', { projectId: 'proj-alpha', weeklyXp: 120 });
    seedCrew(db, 'tenant-1', 'crew2', { projectId: 'proj-alpha', weeklyXp: 80 });
  });

  it('processes one project, sends to 2 supervisor emails, returns correct stats', async () => {
    const fakeEmail = makeFakeEmailService({ sent: 2, failed: 0, results: [{ ok: true, id: 'id-1' }, { ok: true, id: 'id-2' }] });

    const result = await runWeeklyDigest({
      getDb: () => db as any,
      emailService: fakeEmail as any,
      now: () => NOW,
      projectIds: ['proj-alpha'],
    });

    expect(result.projectsProcessed).toBe(1);
    expect(result.projectsSent).toBe(1);
    expect(result.projectsSkipped).toBe(0);
    expect(result.totalEmailsSent).toBe(2);
    expect(result.totalEmailErrors).toBe(0);
    expect(result.windowStart).toBe(WIN_START);
    expect(result.windowEnd).toBe(WIN_END);

    const proj = result.perProject[0];
    expect(proj.projectId).toBe('proj-alpha');
    expect(proj.recipientsTried).toBe(2);
    expect(proj.recipientsSent).toBe(2);
    expect(proj.errors).toBe(0);
    expect(proj.skippedReason).toBeUndefined();

    // Stats assertions
    const stats = proj.stats!;
    expect(stats.projectId).toBe('proj-alpha');
    expect(stats.projectName).toBe('Proyecto Alpha');
    expect(stats.findingsCreated).toBe(2);   // f1 + f2 inside window
    expect(stats.findingsClosed).toBe(1);    // f2 closed inside window
    expect(stats.processesCompleted).toBe(1); // proc1 inside window
    expect(stats.crewXpGained).toBe(200);    // 120 + 80
    expect(stats.daysWithoutIncident).toBe(42);
    // top risk: 'caida' appears 2 times (f1 + f2)
    expect(stats.topRisks[0].label).toBe('caida');
    expect(stats.topRisks[0].count).toBe(2);
  });

  it('sends email only to supervisor/gerente/prevencionista/admin roles', async () => {
    const fakeEmail = makeFakeEmailService({ sent: 2, failed: 0, results: [] });

    await runWeeklyDigest({
      getDb: () => db as any,
      emailService: fakeEmail as any,
      now: () => NOW,
      projectIds: ['proj-alpha'],
    });

    const sendCall = vi.mocked(fakeEmail.sendBatch).mock.calls[0][0];
    const sentEmails = sendCall.map((m: { to: string }) => m.to);
    expect(sentEmails).toContain('sup@example.com');
    expect(sentEmails).toContain('ger@example.com');
    expect(sentEmails).not.toContain('worker@example.com');
  });

  it('email subject contains project name', async () => {
    const fakeEmail = makeFakeEmailService({ sent: 2, failed: 0, results: [] });

    await runWeeklyDigest({
      getDb: () => db as any,
      emailService: fakeEmail as any,
      now: () => NOW,
      projectIds: ['proj-alpha'],
    });

    const sendCall = vi.mocked(fakeEmail.sendBatch).mock.calls[0][0];
    expect(sendCall[0].subject).toContain('Proyecto Alpha');
    expect(sendCall[0].tag).toBe('weekly-digest');
  });

  it('email html body contains findingsCreated count', async () => {
    const fakeEmail = makeFakeEmailService({ sent: 2, failed: 0, results: [] });

    await runWeeklyDigest({
      getDb: () => db as any,
      emailService: fakeEmail as any,
      now: () => NOW,
      projectIds: ['proj-alpha'],
    });

    const sendCall = vi.mocked(fakeEmail.sendBatch).mock.calls[0][0];
    // The template renders stats.findingsCreated (2) inline
    expect(sendCall[0].html).toContain('2');
  });
});

// ---------------------------------------------------------------------------
// runWeeklyDigest — empty case (no data in window)
// ---------------------------------------------------------------------------

describe('runWeeklyDigest — empty data window', () => {
  it('does not crash when project has no findings/processes/crews', async () => {
    const db = createFakeFirestore();
    seedProject(db, 'proj-empty', {
      tenantId: 'tenant-empty',
      name: 'Proyecto Vacío',
      status: 'active',
      daysWithoutIncident: 0,
      supervisors: [{ role: 'supervisor', email: 'sup2@example.com' }],
    });
    // No findings, processes, or crews seeded

    const fakeEmail = makeFakeEmailService({ sent: 1, failed: 0, results: [{ ok: true, id: 'x' }] });

    const result = await runWeeklyDigest({
      getDb: () => db as any,
      emailService: fakeEmail as any,
      now: () => makeDate('2026-05-12T09:00:00Z'),
      projectIds: ['proj-empty'],
    });

    expect(result.projectsProcessed).toBe(1);
    expect(result.projectsSent).toBe(1);
    const proj = result.perProject[0];
    expect(proj.stats?.findingsCreated).toBe(0);
    expect(proj.stats?.findingsClosed).toBe(0);
    expect(proj.stats?.processesCompleted).toBe(0);
    expect(proj.stats?.crewXpGained).toBe(0);
    expect(proj.stats?.topRisks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runWeeklyDigest — no supervisor emails → skip project
// ---------------------------------------------------------------------------

describe('runWeeklyDigest — project with no supervisor members', () => {
  it('skips the project with no_supervisor_emails reason', async () => {
    const db = createFakeFirestore();
    seedProject(db, 'proj-nosup', {
      tenantId: 'tenant-1',
      name: 'Sin Supervisores',
      status: 'active',
      supervisors: [], // no members
    });

    const fakeEmail = makeFakeEmailService();

    const result = await runWeeklyDigest({
      getDb: () => db as any,
      emailService: fakeEmail as any,
      now: () => makeDate('2026-05-12T09:00:00Z'),
      projectIds: ['proj-nosup'],
    });

    expect(result.projectsProcessed).toBe(1);
    expect(result.projectsSkipped).toBe(1);
    expect(result.projectsSent).toBe(0);
    expect(result.totalEmailsSent).toBe(0);
    const proj = result.perProject[0];
    expect(proj.skippedReason).toBe('no_supervisor_emails');
    expect(proj.stats).toBeUndefined();
    expect(vi.mocked(fakeEmail.sendBatch)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runWeeklyDigest — partial email failure (some sent, some failed)
// ---------------------------------------------------------------------------

describe('runWeeklyDigest — partial email failure', () => {
  it('accounts for sent+failed counts correctly', async () => {
    const db = createFakeFirestore();
    seedProject(db, 'proj-partial', {
      tenantId: 'tenant-partial',
      name: 'Partial Fail Project',
      status: 'active',
      daysWithoutIncident: 5,
      supervisors: [
        { role: 'supervisor', email: 'a@example.com' },
        { role: 'gerente', email: 'b@example.com' },
      ],
    });

    const fakeEmail = makeFakeEmailService({
      sent: 1,
      failed: 1,
      results: [{ ok: true, id: 'ok-id' }, { ok: false, error: 'bounce' }],
    });

    const result = await runWeeklyDigest({
      getDb: () => db as any,
      emailService: fakeEmail as any,
      now: () => makeDate('2026-05-12T09:00:00Z'),
      projectIds: ['proj-partial'],
    });

    expect(result.totalEmailsSent).toBe(1);
    expect(result.totalEmailErrors).toBe(1);
    // projectsSent is 1 because batch.sent > 0
    expect(result.projectsSent).toBe(1);
    const proj = result.perProject[0];
    expect(proj.recipientsSent).toBe(1);
    expect(proj.errors).toBe(1);
  });

  it('does NOT abort other projects when one batch returns failures', async () => {
    const db = createFakeFirestore();
    // Two projects
    seedProject(db, 'proj-a', {
      tenantId: 'tenant-x', name: 'Alpha', status: 'active',
      supervisors: [{ role: 'supervisor', email: 'a@x.com' }],
    });
    seedProject(db, 'proj-b', {
      tenantId: 'tenant-x', name: 'Beta', status: 'active',
      supervisors: [{ role: 'supervisor', email: 'b@x.com' }],
    });

    const fakeEmail = makeFakeEmailService({ sent: 1, failed: 0, results: [{ ok: true, id: 'ok' }] });

    const result = await runWeeklyDigest({
      getDb: () => db as any,
      emailService: fakeEmail as any,
      now: () => makeDate('2026-05-12T09:00:00Z'),
      projectIds: ['proj-a', 'proj-b'],
    });

    expect(result.projectsProcessed).toBe(2);
    expect(vi.mocked(fakeEmail.sendBatch)).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// runWeeklyDigest — active-project query (no projectIds filter)
// ---------------------------------------------------------------------------

describe('runWeeklyDigest — no projectIds filter (query all active)', () => {
  it('processes only status=active projects from the store', async () => {
    const db = createFakeFirestore();
    seedProject(db, 'proj-active', {
      tenantId: 'tenant-q', name: 'Active One', status: 'active',
      supervisors: [{ role: 'admin', email: 'admin@example.com' }],
    });
    seedProject(db, 'proj-inactive', {
      tenantId: 'tenant-q', name: 'Inactive One', status: 'inactive',
      supervisors: [{ role: 'supervisor', email: 'sup@example.com' }],
    });

    const fakeEmail = makeFakeEmailService({ sent: 1, failed: 0, results: [{ ok: true, id: 'ok' }] });

    const result = await runWeeklyDigest({
      getDb: () => db as any,
      emailService: fakeEmail as any,
      now: () => makeDate('2026-05-12T09:00:00Z'),
      // No projectIds — uses the .where('status','==','active') query
    });

    expect(result.projectsProcessed).toBe(1);
    expect(result.perProject[0].projectId).toBe('proj-active');
  });
});

// ---------------------------------------------------------------------------
// runWeeklyDigest — top risks ranking
// ---------------------------------------------------------------------------

describe('runWeeklyDigest — top risks ranking', () => {
  it('returns at most 3 risks, sorted descending by count', async () => {
    const db = createFakeFirestore();
    const TENANT = 'tenant-risks';
    const NOW = makeDate('2026-05-12T09:00:00Z');
    const IN_WIN = '2026-05-05T10:00:00Z';

    seedProject(db, 'proj-risks', {
      tenantId: TENANT, name: 'Risk Project', status: 'active',
      supervisors: [{ role: 'supervisor', email: 'r@example.com' }],
    });
    // 4 different risk labels; one appears 3x, one 2x, one 1x, one 1x
    ['f1', 'f2', 'f3'].forEach((id) =>
      seedFinding(db, TENANT, id, { projectId: 'proj-risks', createdAt: IN_WIN, riskLabel: 'caida' }),
    );
    ['f4', 'f5'].forEach((id) =>
      seedFinding(db, TENANT, id, { projectId: 'proj-risks', createdAt: IN_WIN, riskLabel: 'quimico' }),
    );
    seedFinding(db, TENANT, 'f6', { projectId: 'proj-risks', createdAt: IN_WIN, riskLabel: 'ergonomia' });
    seedFinding(db, TENANT, 'f7', { projectId: 'proj-risks', createdAt: IN_WIN, riskLabel: 'ruido' });

    const fakeEmail = makeFakeEmailService({ sent: 1, failed: 0, results: [{ ok: true, id: 'x' }] });

    const result = await runWeeklyDigest({
      getDb: () => db as any,
      emailService: fakeEmail as any,
      now: () => NOW,
      projectIds: ['proj-risks'],
    });

    const topRisks = result.perProject[0].stats!.topRisks;
    expect(topRisks).toHaveLength(3);
    expect(topRisks[0]).toEqual({ label: 'caida', count: 3 });
    expect(topRisks[1]).toEqual({ label: 'quimico', count: 2 });
    // 3rd can be ergonomia or ruido (both count=1)
    expect(topRisks[2].count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// runWeeklyDigest — daysWithoutIncident capping
// ---------------------------------------------------------------------------

describe('runWeeklyDigest — daysWithoutIncident capping', () => {
  it('caps at 999 when the project doc has a very large value', async () => {
    const db = createFakeFirestore();
    seedProject(db, 'proj-cap', {
      tenantId: 'tenant-cap', name: 'Cap Project', status: 'active',
      daysWithoutIncident: 1500,
      supervisors: [{ role: 'supervisor', email: 's@cap.com' }],
    });

    const fakeEmail = makeFakeEmailService({ sent: 1, failed: 0, results: [{ ok: true, id: 'x' }] });

    const result = await runWeeklyDigest({
      getDb: () => db as any,
      emailService: fakeEmail as any,
      now: () => makeDate('2026-05-12T09:00:00Z'),
      projectIds: ['proj-cap'],
    });

    expect(result.perProject[0].stats?.daysWithoutIncident).toBe(999);
  });

  it('floors negative values to 0', async () => {
    const db = createFakeFirestore();
    seedProject(db, 'proj-neg', {
      tenantId: 'tenant-neg', name: 'Neg Project', status: 'active',
      daysWithoutIncident: -5,
      supervisors: [{ role: 'supervisor', email: 's@neg.com' }],
    });

    const fakeEmail = makeFakeEmailService({ sent: 1, failed: 0, results: [{ ok: true, id: 'x' }] });

    const result = await runWeeklyDigest({
      getDb: () => db as any,
      emailService: fakeEmail as any,
      now: () => makeDate('2026-05-12T09:00:00Z'),
      projectIds: ['proj-neg'],
    });

    expect(result.perProject[0].stats?.daysWithoutIncident).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runWeeklyDigest — tenantId fallback (project doc missing tenantId field)
// ---------------------------------------------------------------------------

describe('runWeeklyDigest — tenantId fallback', () => {
  it('uses projectId as tenantId when project doc has no tenantId field', async () => {
    const db = createFakeFirestore();
    // Seed project without tenantId; seed findings under tenants/<projectId>
    db._seed('projects/proj-notenant', {
      name: 'No Tenant',
      status: 'active',
      daysWithoutIncident: 0,
    });
    db._seed('projects/proj-notenant/members/m0', { role: 'supervisor', email: 'x@t.com' });
    seedFinding(db, 'proj-notenant' /* projectId used as tenantId */, 'f1', {
      projectId: 'proj-notenant',
      createdAt: '2026-05-05T10:00:00Z',
    });

    const fakeEmail = makeFakeEmailService({ sent: 1, failed: 0, results: [{ ok: true, id: 'ok' }] });

    const result = await runWeeklyDigest({
      getDb: () => db as any,
      emailService: fakeEmail as any,
      now: () => makeDate('2026-05-12T09:00:00Z'),
      projectIds: ['proj-notenant'],
    });

    expect(result.projectsProcessed).toBe(1);
    expect(result.perProject[0].stats?.findingsCreated).toBe(1);
  });
});
