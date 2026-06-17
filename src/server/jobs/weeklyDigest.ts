// Praeventio Guard — Sprint 22 (Bucket Y).
//
// Weekly digest job: aggregates project-level stats for the previous
// 7-day window (Mon 00:00 → Sun 23:59 Santiago) and emails a digest to
// each project's supervisors / gerentes / prevencionistas.
//
// Designed to be invoked by Cloud Scheduler every Monday at 09:00
// Santiago via `POST /api/admin/jobs/weekly-digest`. The wrapper in
// `routes/admin.ts` is the HTTP entry point; this module is the pure
// job so unit tests can drive it without spinning up Express.
//
// Stats aggregated per active project (read paths match a verified writer):
//   • Findings created / closed (Firestore: projects/{pid}/findings)
//   • Processes completed (Firestore: top-level `processes`, status=completed)
//   • Crew XP gained this week (Σ processes.xpAwardedAtClose, in-window)
//   • Days without incident (computeDaysWithoutIncident over `reports`, cap 999)
//   • Top 3 risks identified (priority/riskLabel frequency over the week)
//
// Failure model: per-project failure does NOT abort the run. We collect
// counts and surface them in the result so ops can see partial outcomes
// in Cloud Run logs / audit_logs.

import type { Firestore } from 'firebase-admin/firestore';
import { EmailService } from '../../services/email/resendService.js';
import {
  weeklyDigestTemplate,
  type WeeklyDigestStats,
} from '../../services/email/templates.js';
import { logger } from '../../utils/logger.js';
import {
  computeDaysWithoutIncident,
  awardDaysMilestones,
  type MinimalDb,
} from '../../services/gamification/daysWithoutIncident.js';

const SUPERVISOR_ROLES = new Set([
  'supervisor',
  'gerente',
  'prevencionista',
  'admin',
]);

export interface WeeklyDigestOptions {
  /** Firestore handle factory. Default reads firebase-admin lazily. */
  getDb?: () => Firestore;
  /** Email service. Default reads from `RESEND_API_KEY` env. */
  emailService?: EmailService | null;
  /** "Now" for the run. Defaults to `new Date()`. */
  now?: () => Date;
  /** Optional projectId filter — useful for ad-hoc replays. */
  projectIds?: string[];
}

export interface WeeklyDigestProjectResult {
  projectId: string;
  recipientsTried: number;
  recipientsSent: number;
  errors: number;
  stats?: WeeklyDigestStats;
  skippedReason?: string;
}

export interface WeeklyDigestResult {
  windowStart: string;
  windowEnd: string;
  projectsProcessed: number;
  projectsSent: number;
  projectsSkipped: number;
  totalEmailsSent: number;
  totalEmailErrors: number;
  perProject: WeeklyDigestProjectResult[];
}

/** Compute the previous Mon..Sun (in Santiago time) given `now`.
 *  Returns ISO strings. We don't bring in date-fns; the math is small. */
export function computeLastWeekWindow(now: Date): { start: string; end: string } {
  // Round `now` to UTC midnight; weekly digest precision in days is fine.
  const day = now.getUTCDay(); // 0 Sun .. 6 Sat
  // Find last Monday: if today is Monday (1), go back 7 days; else (day - 1) days back.
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const thisMondayUtc = new Date(now);
  thisMondayUtc.setUTCDate(now.getUTCDate() - daysSinceMonday);
  thisMondayUtc.setUTCHours(0, 0, 0, 0);
  const lastMonday = new Date(thisMondayUtc);
  lastMonday.setUTCDate(thisMondayUtc.getUTCDate() - 7);
  const lastSunday = new Date(thisMondayUtc);
  lastSunday.setUTCMilliseconds(-1);
  return { start: lastMonday.toISOString(), end: lastSunday.toISOString() };
}

async function getDefaultDb(): Promise<Firestore> {
  const adminMod = await import('firebase-admin');
  return (adminMod as any).default.firestore();
}

async function aggregateProjectStats(
  db: Firestore,
  project: { id: string; name: string; tenantId: string },
  windowStart: string,
  windowEnd: string,
): Promise<WeeklyDigestStats> {
  const startTs = new Date(windowStart);
  const endTs = new Date(windowEnd);
  let findingsCreated = 0;
  let findingsClosed = 0;
  let processesCompleted = 0;
  let crewXpGained = 0;
  let daysWithoutIncident = 0;
  // Per-collection isolation (one failing query must not abort the digest) WITHOUT
  // silent failure: each catch logs + bumps queryErrors so the result can be
  // flagged `partial` — ops can then tell a real zero from a swallowed error
  // (Plan v3 Fase 2.5).
  let queryErrors = 0;
  const riskCounts = new Map<string, number>();

  // Findings — the project SUB-collection is the canonical write path
  // (BioAnalysis.tsx + the expiry jobs write `projects/{pid}/findings`). The
  // previous `tenants/{tid}/findings` path had NO writer, so findingsCreated and
  // topRisks were ALWAYS 0 (only daysWithoutIncident was repointed in #943).
  try {
    const findingsSnap = await db
      .collection('projects')
      .doc(project.id)
      .collection('findings')
      .get();
    for (const doc of findingsSnap.docs) {
      const data: any = doc.data();
      const createdAt: Date | null = data?.createdAt?.toDate?.() ?? null;
      const closedAt: Date | null = data?.closedAt?.toDate?.() ?? null;
      const inWindow = !!createdAt && createdAt >= startTs && createdAt <= endTs;
      if (inWindow) findingsCreated++;
      // No writer sets `closedAt` today → findingsClosed stays 0 (HONEST; a
      // future close-writer lights it up). Never fabricate a close signal.
      if (closedAt && closedAt >= startTs && closedAt <= endTs) findingsClosed++;
      // Real findings carry `priority` (Crítica/Alta/Media/Baja); `riskLabel` is
      // legacy. Count only the WEEK's findings (not all-time).
      if (inWindow) {
        const label =
          typeof data?.riskLabel === 'string' && data.riskLabel.length > 0
            ? data.riskLabel
            : typeof data?.priority === 'string' && data.priority.length > 0
              ? data.priority
              : null;
        if (label) riskCounts.set(label, (riskCounts.get(label) ?? 0) + 1);
      }
    }
  } catch (err) {
    queryErrors++;
    logger.warn('weekly_digest_query_failed', {
      projectId: project.id,
      collection: 'findings',
      error: String(err),
    });
  }

  // Processes (TOP-LEVEL — the organic.ts write path) + crew XP gained this
  // week. The previous `tenants/{tid}/processes` path had no writer; also the
  // close writes `endedAt` (ISO string) + `xpAwardedAtClose`, never
  // `completedAt`. One query now covers both processesCompleted and crewXp.
  try {
    const procSnap = await db
      .collection('processes')
      .where('projectId', '==', project.id)
      .where('status', '==', 'completed')
      .get();
    for (const doc of procSnap.docs) {
      const data: any = doc.data();
      const endedAtMs =
        typeof data?.endedAt === 'string'
          ? Date.parse(data.endedAt)
          : data?.endedAt?.toDate?.()?.getTime() ?? NaN;
      if (
        Number.isFinite(endedAtMs) &&
        endedAtMs >= startTs.getTime() &&
        endedAtMs <= endTs.getTime()
      ) {
        processesCompleted++;
        // Real weekly crew-XP delta = XP awarded at close of THIS week's
        // processes (organic.ts:214), replacing the never-written `weeklyXp`
        // field. (Alert-ack +30 XP lives in predictive_alert_acks — follow-up.)
        const xp = data?.xpAwardedAtClose;
        if (typeof xp === 'number' && Number.isFinite(xp) && xp > 0) {
          crewXpGained += xp;
        }
      }
    }
  } catch (err) {
    queryErrors++;
    logger.warn('weekly_digest_query_failed', {
      projectId: project.id,
      collection: 'processes',
      error: String(err),
    });
  }

  // Days without incident — derive from the project's incident reports (the
  // canonical source). The previous code read `projects/{id}.daysWithoutIncident`,
  // a field NO writer ever sets (writers target the `crews` collection), so the
  // digest ALWAYS reported 0 in the supervisor email. computeDaysWithoutIncident
  // queries `reports` (type==='Incidente') for this project — the real streak.
  try {
    // `db` is the admin Firestore — a structural superset of the DI subset
    // computeDaysWithoutIncident accepts (same `reports` queries the digest
    // already runs above). The cast only bridges the SDK type to that subset.
    const days = await computeDaysWithoutIncident(project.id, db as unknown as MinimalDb);
    daysWithoutIncident = Math.max(0, Math.min(999, Math.floor(days)));
  } catch (err) {
    queryErrors++;
    logger.warn('weekly_digest_query_failed', {
      projectId: project.id,
      collection: 'reports',
      error: String(err),
    });
  }

  const topRisks = Array.from(riskCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, count]) => ({ label, count }));

  return {
    projectId: project.id,
    projectName: project.name,
    weekStart: windowStart,
    weekEnd: windowEnd,
    findingsCreated,
    findingsClosed,
    processesCompleted,
    crewXpGained,
    daysWithoutIncident,
    topRisks,
    ...(queryErrors > 0 ? { partial: true } : {}),
  };
}

async function getSupervisorEmails(
  db: Firestore,
  projectId: string,
): Promise<string[]> {
  try {
    const snap = await db
      .collection('projects')
      .doc(projectId)
      .collection('members')
      .get();
    const emails = new Set<string>();
    for (const doc of snap.docs) {
      const data: any = doc.data();
      if (
        SUPERVISOR_ROLES.has(data?.role) &&
        typeof data?.email === 'string' &&
        data.email.includes('@')
      ) {
        emails.add(data.email);
      }
    }
    return Array.from(emails);
  } catch {
    return [];
  }
}

/** Run the weekly digest. Pure-ish: reads Firestore + sends email. */
export async function runWeeklyDigest(
  options: WeeklyDigestOptions = {},
): Promise<WeeklyDigestResult> {
  const now = options.now ? options.now() : new Date();
  const { start, end } = computeLastWeekWindow(now);
  const db = options.getDb ? options.getDb() : await getDefaultDb();
  const emailService =
    options.emailService === undefined ? EmailService.fromEnv() : options.emailService;

  const result: WeeklyDigestResult = {
    windowStart: start,
    windowEnd: end,
    projectsProcessed: 0,
    projectsSent: 0,
    projectsSkipped: 0,
    totalEmailsSent: 0,
    totalEmailErrors: 0,
    perProject: [],
  };

  if (!emailService) {
    // No-op when Resend not configured. Caller still gets a structured
    // response so ops can confirm the cron fired.
    return result;
  }

  // Discover active projects.
  let projectsSnap: FirebaseFirestore.QuerySnapshot;
  try {
    if (options.projectIds && options.projectIds.length > 0) {
      const docs = await Promise.all(
        options.projectIds.map((id) => db.collection('projects').doc(id).get()),
      );
      projectsSnap = {
        docs: docs.filter((d) => d.exists),
      } as unknown as FirebaseFirestore.QuerySnapshot;
    } else {
      projectsSnap = await db.collection('projects').where('status', '==', 'active').get();
    }
  } catch (err: any) {
    return {
      ...result,
      perProject: [
        {
          projectId: '*',
          recipientsTried: 0,
          recipientsSent: 0,
          errors: 1,
          skippedReason: `projects_query_failed: ${err?.message ?? 'unknown'}`,
        },
      ],
    };
  }

  for (const doc of projectsSnap.docs) {
    const projectId = doc.id;
    const data: any = doc.data();
    result.projectsProcessed += 1;

    // Award any days-without-incident milestones the project just crossed,
    // crediting each member (#9). Runs for EVERY active project (before the
    // supervisor-email skip below) and is best-effort — a failure here must
    // never abort the digest.
    try {
      await awardDaysMilestones(projectId, db as unknown as MinimalDb);
    } catch (err) {
      logger.warn('weekly_digest_milestone_award_failed', { projectId, error: String(err) });
    }

    const tenantId: string = data?.tenantId || projectId;
    const projectName: string = data?.name || projectId;
    const emails = await getSupervisorEmails(db, projectId);
    if (emails.length === 0) {
      result.projectsSkipped += 1;
      result.perProject.push({
        projectId,
        recipientsTried: 0,
        recipientsSent: 0,
        errors: 0,
        skippedReason: 'no_supervisor_emails',
      });
      continue;
    }
    let stats: WeeklyDigestStats;
    try {
      stats = await aggregateProjectStats(
        db,
        { id: projectId, name: projectName, tenantId },
        start,
        end,
      );
    } catch (err: any) {
      result.perProject.push({
        projectId,
        recipientsTried: emails.length,
        recipientsSent: 0,
        errors: 1,
        skippedReason: `aggregation_failed: ${err?.message ?? 'unknown'}`,
      });
      continue;
    }

    const html = weeklyDigestTemplate(stats);
    const batch = await emailService.sendBatch(
      emails.map((email) => ({
        to: email,
        subject: `📊 Resumen semanal · ${projectName}`,
        html,
        tag: 'weekly-digest',
      })),
    );
    result.totalEmailsSent += batch.sent;
    result.totalEmailErrors += batch.failed;
    if (batch.sent > 0) result.projectsSent += 1;
    result.perProject.push({
      projectId,
      recipientsTried: emails.length,
      recipientsSent: batch.sent,
      errors: batch.failed,
      stats,
    });
  }

  return result;
}
