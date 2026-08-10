import { createHash } from "node:crypto";
import { Router } from "express";
import admin from "firebase-admin";
import { z } from "zod";

import { verifyAuth } from "../middleware/verifyAuth.js";
import { readSubscriptionPlanId } from "../middleware/requireTier.js";
import { auditServerEvent } from "../middleware/auditLog.js";
import {
  PLAN_RANK,
  TIER_TO_SUBSCRIPTION_PLAN,
  type SubscriptionPlan,
} from "../../services/pricing/subscriptionPlan.js";
import {
  getTierById,
  TIER_IDS,
  type TierId,
} from "../../services/pricing/tiers.js";
import { logger } from "../../utils/logger.js";

const targetSchema = z
  .object({
    targetTier: z.enum(TIER_IDS),
  })
  .strict();

const categorySchema = targetSchema.extend({
  category: z.enum(["workers", "projects"]),
});

const archiveSchema = categorySchema.extend({
  expectedFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

type DowngradeCategory = z.infer<typeof categorySchema>["category"];
type DocData = Record<string, unknown>;

interface ProjectCandidate {
  kind: "project";
  projectId: string;
  data: DocData;
}

interface WorkerCandidate {
  kind: "worker";
  projectId: string;
  workerId: string;
  data: DocData;
}

interface WorkerProjectOverage {
  projectId: string;
  current: number;
  cap: number;
  count: number;
  candidateIds: string[];
}

interface DowngradePlan {
  sourceTier: TierId;
  targetTier: TierId;
  projectCandidates: ProjectCandidate[];
  workerCandidates: WorkerCandidate[];
  workerOverages: WorkerProjectOverage[];
  workerRemainingByProject: Record<string, number>;
  activeProjectCount: number;
  projectCap: number;
  workerCap: number;
}

function sortKey(value: unknown): number {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (value && typeof value === "object") {
    const candidate = value as { toMillis?: () => number; toDate?: () => Date };
    if (typeof candidate.toMillis === "function") return candidate.toMillis();
    if (typeof candidate.toDate === "function")
      return candidate.toDate().getTime();
  }
  return 0;
}

function tierIdForPlan(plan: SubscriptionPlan): TierId {
  return plan === "free" ? "gratis" : plan;
}

function isDowngrade(
  sourcePlan: SubscriptionPlan,
  targetTier: TierId,
): boolean {
  const targetPlan = TIER_TO_SUBSCRIPTION_PLAN[targetTier];
  return PLAN_RANK[targetPlan] < PLAN_RANK[sourcePlan];
}

function normalizeForJson(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeForJson);
  if (value && typeof value === "object") {
    const timestamp = value as { toDate?: () => Date };
    if (typeof timestamp.toDate === "function")
      return timestamp.toDate().toISOString();
    return Object.fromEntries(
      Object.entries(value as DocData)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, normalizeForJson(nested)]),
    );
  }
  return value;
}

function fingerprintRecords(
  sourceTier: TierId,
  targetTier: TierId,
  category: DowngradeCategory,
  records: Array<ProjectCandidate | WorkerCandidate>,
): string {
  const canonical = JSON.stringify(
    normalizeForJson({ sourceTier, targetTier, category, records }),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

async function buildDowngradePlan(
  uid: string,
  targetTier: TierId,
): Promise<DowngradePlan> {
  const sourcePlan = await readSubscriptionPlanId(uid);
  if (!isDowngrade(sourcePlan, targetTier)) {
    const error = new Error("target_is_not_a_downgrade");
    error.name = "InvalidDowngrade";
    throw error;
  }

  const target = getTierById(targetTier);
  const activeProjects = await admin
    .firestore()
    .collection("projects")
    .where("tenantId", "==", uid)
    .where("status", "==", "active")
    .get();

  const sortedProjects = activeProjects.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as DocData }))
    .sort(
      (a, b) =>
        sortKey(a.data.createdAt) - sortKey(b.data.createdAt) ||
        a.id.localeCompare(b.id),
    );
  const projectExcess = Math.max(
    0,
    sortedProjects.length - target.proyectosMax,
  );
  const projectCandidates: ProjectCandidate[] = sortedProjects
    .slice(0, projectExcess)
    .map((project) => ({
      kind: "project",
      projectId: project.id,
      data: project.data,
    }));

  const projectCandidateIds = new Set(
    projectCandidates.map((project) => project.projectId),
  );
  const workerProjectPlans = await Promise.all(
    activeProjects.docs
      .filter((projectDoc) => !projectCandidateIds.has(projectDoc.id))
      .map(async (projectDoc) => {
        const workersSnapshot = await projectDoc.ref
          .collection("workers")
          .get();
        const activeWorkers = workersSnapshot.docs
          .filter((workerDoc) => workerDoc.data().archived !== true)
          .map((workerDoc) => ({
            id: workerDoc.id,
            data: workerDoc.data() as DocData,
          }))
          .sort(
            (a, b) =>
              sortKey(a.data.createdAt) - sortKey(b.data.createdAt) ||
              a.id.localeCompare(b.id),
          );
        const excess = Math.max(
          0,
          activeWorkers.length - target.trabajadoresMax,
        );
        const candidates: WorkerCandidate[] = activeWorkers
          .slice(0, excess)
          .map((worker) => ({
            kind: "worker",
            projectId: projectDoc.id,
            workerId: worker.id,
            data: worker.data,
          }));
        return {
          projectId: projectDoc.id,
          activeCount: activeWorkers.length,
          candidates,
        };
      }),
  );

  const workerCandidates = workerProjectPlans.flatMap(
    (project) => project.candidates,
  );
  const workerOverages = workerProjectPlans
    .filter((project) => project.candidates.length > 0)
    .map((project) => ({
      projectId: project.projectId,
      current: project.activeCount,
      cap: target.trabajadoresMax,
      count: project.candidates.length,
      candidateIds: project.candidates.map(
        (worker) => `${worker.projectId}/${worker.workerId}`,
      ),
    }));
  const workerRemainingByProject = Object.fromEntries(
    workerProjectPlans
      .filter((project) => project.candidates.length > 0)
      .map((project) => [
        project.projectId,
        project.activeCount - project.candidates.length,
      ]),
  );

  return {
    sourceTier: tierIdForPlan(sourcePlan),
    targetTier,
    projectCandidates,
    workerCandidates,
    workerOverages,
    workerRemainingByProject,
    activeProjectCount: sortedProjects.length,
    projectCap: target.proyectosMax,
    workerCap: target.trabajadoresMax,
  };
}

function handleRouteError(
  error: unknown,
  res: Parameters<Parameters<Router["post"]>[1]>[1],
  context: Record<string, unknown>,
) {
  if (error instanceof Error && error.name === "InvalidDowngrade") {
    return res.status(400).json({ error: error.message });
  }
  logger.error("tier_downgrade_route_failed", error, context);
  return res.status(500).json({ error: "tier_downgrade_failed" });
}

const tierDowngradeRouter = Router();

tierDowngradeRouter.post("/preview", verifyAuth, async (req, res) => {
  const parsed = targetSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "invalid_request" });
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: "unauthorized" });

  try {
    const plan = await buildDowngradePlan(uid, parsed.data.targetTier);
    return res.json({
      sourceTier: plan.sourceTier,
      targetTier: plan.targetTier,
      overages: {
        projects: {
          count: plan.projectCandidates.length,
          current: plan.activeProjectCount,
          cap: plan.projectCap,
          candidateIds: plan.projectCandidates.map(
            (project) => project.projectId,
          ),
        },
        workers: {
          count: plan.workerCandidates.length,
          capPerProject: plan.workerCap,
          projects: plan.workerOverages,
        },
      },
    });
  } catch (error) {
    return handleRouteError(error, res, {
      uid,
      targetTier: parsed.data.targetTier,
    });
  }
});

tierDowngradeRouter.post("/archive", verifyAuth, async (req, res) => {
  const parsed = archiveSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "invalid_request" });
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  const { targetTier, category, expectedFingerprint } = parsed.data;

  try {
    const plan = await buildDowngradePlan(uid, targetTier);
    const records =
      category === "workers" ? plan.workerCandidates : plan.projectCandidates;
    const normalizedRecords = normalizeForJson(records) as Array<
      ProjectCandidate | WorkerCandidate
    >;
    const currentFingerprint = fingerprintRecords(
      plan.sourceTier,
      targetTier,
      category,
      normalizedRecords,
    );
    if (expectedFingerprint && expectedFingerprint !== currentFingerprint) {
      return res.status(409).json({ error: "downgrade_candidates_changed" });
    }

    const mutations: Array<{ path: string; data: DocData }> = [];
    if (category === "workers") {
      for (const worker of plan.workerCandidates) {
        mutations.push({
          path: `projects/${worker.projectId}/workers/${worker.workerId}`,
          data: {
            archived: true,
            archivedAt: admin.firestore.FieldValue.serverTimestamp(),
            archivedBy: uid,
          },
        });
      }
      for (const [projectId, workersCount] of Object.entries(
        plan.workerRemainingByProject,
      )) {
        mutations.push({
          path: `projects/${projectId}`,
          data: { workersCount },
        });
      }
    } else {
      for (const project of plan.projectCandidates) {
        mutations.push({
          path: `projects/${project.projectId}`,
          data: {
            status: "archived",
            archivedAt: admin.firestore.FieldValue.serverTimestamp(),
            archivedBy: uid,
          },
        });
      }
    }

    // Firestore batches accept at most 500 writes. Keep headroom so future
    // audit/receipt writes can be added without silently crossing the limit.
    for (let offset = 0; offset < mutations.length; offset += 450) {
      const batch = admin.firestore().batch();
      for (const mutation of mutations.slice(offset, offset + 450)) {
        batch.update(
          admin.firestore().doc(mutation.path),
          mutation.data as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
        );
      }
      await batch.commit();
    }

    try {
      await auditServerEvent(req, "tierDowngrade.archive", "billing", {
        sourceTier: plan.sourceTier,
        targetTier,
        category,
        archivedCount: records.length,
        fingerprint: currentFingerprint,
      });
    } catch (auditError) {
      logger.error("tier_downgrade_audit_failed", auditError, {
        uid,
        targetTier,
        category,
      });
    }

    return res.json({ success: true, archivedCount: records.length });
  } catch (error) {
    return handleRouteError(error, res, { uid, targetTier, category });
  }
});

tierDowngradeRouter.post("/export", verifyAuth, async (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "invalid_request" });
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  const { targetTier, category } = parsed.data;

  try {
    const plan = await buildDowngradePlan(uid, targetTier);
    const records =
      category === "workers" ? plan.workerCandidates : plan.projectCandidates;
    const normalizedRecords = normalizeForJson(records) as Array<
      ProjectCandidate | WorkerCandidate
    >;
    return res.json({
      backup: {
        version: 1,
        generatedAt: new Date().toISOString(),
        sourceTier: plan.sourceTier,
        targetTier,
        category,
        count: normalizedRecords.length,
        records: normalizedRecords,
      },
      fingerprint: fingerprintRecords(
        plan.sourceTier,
        targetTier,
        category,
        normalizedRecords,
      ),
    });
  } catch (error) {
    return handleRouteError(error, res, { uid, targetTier, category });
  }
});

export default tierDowngradeRouter;
