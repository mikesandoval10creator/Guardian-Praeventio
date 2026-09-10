// SPDX-License-Identifier: MIT
// One durable completion per authenticated owner. Firestore retries serialize
// competitors; NO external side effect is allowed inside the transaction.
import { createHash, randomUUID } from "node:crypto";
import admin from "firebase-admin";
import { WORKER_ROLES } from "../../types/roles.js";
import { buildProjectSeeds } from "../../services/sii/projectSeeds.js";
import { CL_PACK } from "../../data/normativa/cl.js";

export interface OnboardingPayload {
  industry: string;
  countries: string[];
  tier: string;
  inviteEmails: string[];
  projectName: string;
  workersCsv: string | null;
  siiCode: number | null;
  sectorId: string | null;
  estimatedWorkers: number | null;
}

export interface OnboardingResult {
  success: true;
  projectId: string;
  invitedEmails: string[];
  invitationFailures: string[];
  pendingPayment: boolean;
  seededRisks: number;
  seededObligations: number;
}

export class OnboardingConflict extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export async function provisionOnboarding(
  db: admin.firestore.Firestore,
  uid: string,
  payload: OnboardingPayload,
) {
  // Server-only collection (default-deny rules). No expiresAt: a completed
  // onboarding must not become executable again when the HTTP cache expires.
  const ownerHash = createHash("sha256").update(uid).digest("hex");
  const receiptRef = db
    .collection("system_idempotency_cache")
    .doc(`onboarding-${ownerHash}`);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  const userRef = db.collection("users").doc(uid);
  const projectRef = db
    .collection("tenants")
    .doc(uid)
    .collection("projects")
    .doc();
  const projectId = projectRef.id;
  const now = new Date();
  // Random secrets/ids are allocated once, NOT on transaction callback retries.
  const invitations = payload.inviteEmails.map((email) => ({
    email,
    token: randomUUID(),
  }));

  return db.runTransaction(async (tx) => {
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      const saved = receipt.data();
      if (
        !saved ||
        saved.state !== "completed" ||
        saved.result?.success !== true ||
        typeof saved.result?.projectId !== "string"
      ) {
        throw new Error("invalid_onboarding_receipt");
      }
      if (saved.fingerprint !== fingerprint)
        throw new OnboardingConflict("onboarding_payload_conflict");
      return {
        replayed: true,
        promoted: false,
        invitations: [],
        result: saved.result as OnboardingResult,
      };
    }
    const userSnapshot = await tx.get(userRef);
    const user = userSnapshot.data() ?? {};
    // Legacy completions have no durable receipt. Do not silently recreate a
    // tenant or overwrite its billing config; reconciliation is a separate flow.
    if (user.onboarded === true)
      throw new OnboardingConflict("onboarding_already_completed");
    const promoted =
      user.role == null ||
      (WORKER_ROLES as readonly string[]).includes(user.role);
    const subscription = user.subscription as
      Record<string, unknown> | undefined;
    const hasPaidSubscription =
      typeof subscription?.planId === "string" &&
      subscription.planId !== "gratis";
    const isPaidTier = payload.tier !== "gratis";
    const pendingPayment =
      isPaidTier &&
      !(
        subscription?.planId === payload.tier &&
        subscription.status === "active"
      );
    const seeds =
      payload.siiCode != null || payload.estimatedWorkers != null
        ? buildProjectSeeds({
            projectId,
            siiCode: payload.siiCode,
            sectorId: payload.sectorId,
            workerCount: payload.countries.includes("CL")
              ? payload.estimatedWorkers
              : null,
            pack: CL_PACK,
            now,
          })
        : { riskSeeds: [], obligationSeeds: [] };
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    tx.set(projectRef, {
      name: payload.projectName,
      ownerUid: uid,
      createdAt: timestamp,
      members: { [uid]: { role: "gerente", joinedAt: now.toISOString() } },
      industry: payload.industry,
      countries: payload.countries,
      source: "onboarding-wizard",
      ...(payload.siiCode != null
        ? { codigoActividadSii: payload.siiCode, sectorId: payload.sectorId }
        : {}),
      ...(payload.estimatedWorkers != null
        ? { estimatedWorkers: payload.estimatedWorkers }
        : {}),
    });
    // Preserve both read models: SPA/rules use the canonical top-level mirror.
    tx.set(db.collection("projects").doc(projectId), {
      name: payload.projectName,
      tenantId: uid,
      industry: payload.industry,
      status: "active",
      createdAt: now.toISOString(),
      createdBy: uid,
      members: [uid],
      riskLevel: "Medio",
      ...(payload.estimatedWorkers != null
        ? { workersCount: payload.estimatedWorkers }
        : {}),
      metadata: {
        origin: "onboarding-wizard",
        ...(payload.siiCode != null
          ? { codigoActividadSii: payload.siiCode, sectorId: payload.sectorId }
          : {}),
      },
    });
    for (const seed of seeds.riskSeeds) {
      tx.set(db.collection("nodes").doc(seed.id), {
        ...seed.doc,
        metadata: { ...seed.doc.metadata, authorId: uid },
      });
    }
    for (const seed of seeds.obligationSeeds) {
      tx.set(
        db
          .collection("projects")
          .doc(projectId)
          .collection("legal_obligations")
          .doc(seed.id),
        seed.doc,
      );
    }
    for (const { email, token } of invitations) {
      // Canonical consumer: /api/invitations/info/:token and /:token/accept.
      // Keep the tenant-scoped mirror while making the emailed link usable.
      tx.set(db.collection("invitations").doc(token), {
        projectId,
        projectName: payload.projectName,
        invitedEmail: email,
        invitedRole: "operario",
        invitedBy: uid,
        token,
        status: "pending",
        createdAt: now.toISOString(),
        expiresAt: new Date(
          now.getTime() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      });
      tx.set(projectRef.collection("invitations").doc(token), {
        email,
        status: "pending",
        role: "operario",
        invitedBy: uid,
        createdAt: timestamp,
        source: "onboarding-wizard",
      });
    }
    if (payload.workersCsv) {
      tx.set(
        db
          .collection("tenants")
          .doc(uid)
          .collection("imports")
          .doc(`onboarding-${projectId}`),
        {
          kind: "workers-csv",
          projectId,
          uploadedBy: uid,
          status: "pending",
          csv: payload.workersCsv,
          createdAt: timestamp,
        },
      );
    }
    tx.set(
      userRef,
      {
        tenantConfig: {
          industry: payload.industry,
          countries: payload.countries,
          tier: payload.tier,
          ...(payload.siiCode != null
            ? { siiCode: payload.siiCode, sectorId: payload.sectorId }
            : {}),
          ...(payload.estimatedWorkers != null
            ? { estimatedWorkers: payload.estimatedWorkers }
            : {}),
          configuredAt: timestamp,
        },
        // Never clobber server-verified billing state (including canceled/paused
        // paid plans). New paid intent remains gratis until the payment flow clears.
        ...(!hasPaidSubscription
          ? {
              subscription: {
                planId: "gratis",
                status: isPaidTier ? "pending_payment" : "active",
                ...(isPaidTier
                  ? { pendingTier: payload.tier }
                  : subscription?.pendingTier != null
                    ? { pendingTier: admin.firestore.FieldValue.delete() }
                    : {}),
                updatedAt: timestamp,
              },
            }
          : {}),
        onboarded: true,
        onboardedAt: timestamp,
        ...(promoted ? { role: "gerente" } : {}),
      },
      { merge: true },
    );
    const result: OnboardingResult = {
      success: true,
      projectId,
      invitedEmails: payload.inviteEmails,
      invitationFailures: [],
      pendingPayment,
      seededRisks: seeds.riskSeeds.length,
      seededObligations: seeds.obligationSeeds.length,
    };
    // Same commit as every invariant: a lost HTTP response is now safe to retry.
    tx.create(receiptRef, {
      fingerprint,
      state: "completed",
      result,
      completedAt: timestamp,
    });
    return { replayed: false, promoted, invitations, result };
  });
}
