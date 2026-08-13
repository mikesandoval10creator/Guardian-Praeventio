// Praeventio Guard — worker-owned portable offboarding passport.
//
// The offboarding route writes the immutable snapshot. This router exposes
// only worker-sovereign operations: own export, narrowly scoped future-project
// share, authenticated recipient consume, and revoke. No employer gets a
// direct Firestore read path to the passport.

import crypto from "node:crypto";
import { Router } from "express";
import admin from "firebase-admin";
import { verifyAuth } from "../middleware/verifyAuth.js";
import { auditServerEvent } from "../middleware/auditLog.js";
import { logger } from "../../utils/logger.js";
import { captureRouteError } from "../middleware/captureRouteError.js";
import { verifyComplianceEvidenceAttestation } from "../services/complianceEvidenceAttestation.js";
import type { ComplianceArchiveAttestation } from "../../services/compliance/complianceSignature.js";

export const personalPassportRouter = Router();

const SHAREABLE_FIELDS = [
  "roles",
  "capabilities",
  "certifications",
  "trainings",
  "shareableAptitudes",
  "taskExperience",
] as const;
type ShareableField = (typeof SHAREABLE_FIELDS)[number];
const MAX_SHARE_TTL_HOURS = 24 * 7;
const DEFAULT_SHARE_TTL_HOURS = 24;

interface PassportSnapshot extends Record<string, unknown> {
  schemaVersion: "1.0.0";
  subjectUid: string;
  sourceProjectId: string;
  sourceTenantId: string | null;
  createdAt: string;
  checksumSha256: string;
  archiveAttestation: ComplianceArchiveAttestation;
}

interface PassportShare extends Record<string, unknown> {
  id: string;
  ownerUid: string;
  passportId: string;
  recipientUid: string;
  targetProjectId: string;
  targetTenantId: string;
  fields: ShareableField[];
  tokenHash: string;
  expiresAt: number;
  revokedAt: number | null;
  createdAt: number;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function verifyChecksum(snapshot: PassportSnapshot): boolean {
  const {
    checksumSha256,
    archiveAttestation: _attestation,
    ...unsigned
  } = snapshot;
  if (
    typeof checksumSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(checksumSha256)
  )
    return false;
  const expected = crypto
    .createHash("sha256")
    .update(canonicalJson(unsigned), "utf8")
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(checksumSha256, "hex"),
  );
}

function parseFields(value: unknown): ShareableField[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > SHAREABLE_FIELDS.length
  )
    return null;
  const fields = value.filter(
    (field): field is ShareableField =>
      typeof field === "string" &&
      (SHAREABLE_FIELDS as readonly string[]).includes(field),
  );
  return fields.length === value.length &&
    new Set(fields).size === fields.length
    ? fields
    : null;
}

function parseTtlHours(value: unknown): number | null {
  if (value === undefined) return DEFAULT_SHARE_TTL_HOURS;
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_SHARE_TTL_HOURS
    ? value
    : null;
}

function matchesSecret(secret: unknown, hash: unknown): boolean {
  if (
    typeof secret !== "string" ||
    typeof hash !== "string" ||
    !/^[a-f0-9]{64}$/.test(hash)
  )
    return false;
  const candidate = crypto
    .createHash("sha256")
    .update(secret, "utf8")
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(candidate, "hex"),
    Buffer.from(hash, "hex"),
  );
}

function isDirectProjectMember(
  project: Record<string, unknown>,
  uid: string,
): boolean {
  return (
    project.createdBy === uid ||
    (Array.isArray(project.members) && project.members.includes(uid))
  );
}

function projectTenantId(project: Record<string, unknown>): string | null {
  const tenantId = project.tenantId;
  return typeof tenantId === "string" &&
    tenantId.length > 0 &&
    tenantId.length <= 200
    ? tenantId
    : null;
}

function passportPayload(
  snapshot: PassportSnapshot,
  fields: ShareableField[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    schemaVersion: snapshot.schemaVersion,
    issuedAt: snapshot.createdAt,
    checksumSha256: snapshot.checksumSha256,
  };
  for (const field of fields) payload[field] = snapshot[field];
  return payload;
}

function authenticatedUid(req: import("express").Request): string | null {
  const uid = req.user?.uid;
  return typeof uid === "string" && uid.length > 0 ? uid : null;
}

async function loadOwnedPassport(
  ownerUid: string,
  passportId: string,
): Promise<{
  ref: FirebaseFirestore.DocumentReference;
  snapshot: PassportSnapshot;
} | null> {
  const ref = admin
    .firestore()
    .collection("users")
    .doc(ownerUid)
    .collection("personal_passports")
    .doc(passportId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const snapshot = doc.data() as PassportSnapshot;
  if (snapshot.subjectUid !== ownerUid || !verifyChecksum(snapshot))
    return null;
  if (verifyComplianceEvidenceAttestation(snapshot) !== "verified") return null;
  return { ref, snapshot };
}

// GET /api/personal-passports/:passportId/export — owner-only sovereign export.
personalPassportRouter.get(
  "/:passportId/export",
  verifyAuth,
  async (req, res) => {
    const ownerUid = authenticatedUid(req);
    if (!ownerUid) return res.status(401).json({ error: "unauthorized" });
    const passportId = req.params.passportId;
    try {
      const loaded = await loadOwnedPassport(ownerUid, passportId);
      if (!loaded) return res.status(404).json({ error: "passport_not_found" });
      const body = canonicalJson(loaded.snapshot);
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="praeventio-passport-${passportId}.json"`,
      );
      res.setHeader("Cache-Control", "no-store, private, max-age=0");
      res.setHeader("X-Passport-Checksum", loaded.snapshot.checksumSha256);
      await auditServerEvent(
        req,
        "personalPassport.exported",
        "personalPassport",
        { passportId },
      );
      return res.status(200).send(body);
    } catch (error) {
      logger.error?.("personal_passport_export_failed", error);
      captureRouteError(error, "personalPassport.export");
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

// POST /api/personal-passports/:passportId/shares — owner explicitly selects
// fields and an authenticated recipient in a DIFFERENT future project.
personalPassportRouter.post(
  "/:passportId/shares",
  verifyAuth,
  async (req, res) => {
    const ownerUid = authenticatedUid(req);
    if (!ownerUid) return res.status(401).json({ error: "unauthorized" });
    const passportId = req.params.passportId;
    const recipientUid = req.body?.recipientUid;
    const targetProjectId = req.body?.targetProjectId;
    const fields = parseFields(req.body?.fields);
    const ttlHours = parseTtlHours(req.body?.ttlHours);
    if (
      typeof recipientUid !== "string" ||
      recipientUid.length === 0 ||
      recipientUid.length > 128 ||
      typeof targetProjectId !== "string" ||
      targetProjectId.length === 0 ||
      targetProjectId.length > 128 ||
      !fields ||
      ttlHours === null
    ) {
      return res.status(400).json({ error: "invalid_share_request" });
    }

    try {
      const loaded = await loadOwnedPassport(ownerUid, passportId);
      if (!loaded) return res.status(404).json({ error: "passport_not_found" });
      if (targetProjectId === loaded.snapshot.sourceProjectId) {
        return res
          .status(403)
          .json({ error: "source_project_cannot_receive_passport" });
      }
      const targetProject = await admin
        .firestore()
        .collection("projects")
        .doc(targetProjectId)
        .get();
      if (!targetProject.exists) {
        return res
          .status(403)
          .json({ error: "recipient_not_member_of_target_project" });
      }
      const targetData = targetProject.data() as Record<string, unknown>;
      const targetTenantId = projectTenantId(targetData);
      if (
        !targetTenantId ||
        !loaded.snapshot.sourceTenantId ||
        targetTenantId === loaded.snapshot.sourceTenantId
      ) {
        return res
          .status(403)
          .json({ error: "target_tenant_must_differ_from_source" });
      }
      if (!isDirectProjectMember(targetData, recipientUid)) {
        return res
          .status(403)
          .json({ error: "recipient_not_member_of_target_project" });
      }

      const secret = crypto.randomBytes(32).toString("base64url");
      const id = `pps_${crypto.randomBytes(12).toString("hex")}`;
      const share: PassportShare = {
        id,
        ownerUid,
        passportId,
        recipientUid,
        targetProjectId,
        targetTenantId,
        fields,
        tokenHash: crypto
          .createHash("sha256")
          .update(secret, "utf8")
          .digest("hex"),
        expiresAt: Date.now() + ttlHours * 60 * 60 * 1000,
        revokedAt: null,
        createdAt: Date.now(),
      };
      await admin
        .firestore()
        .collection("users")
        .doc(ownerUid)
        .collection("personal_passport_shares")
        .doc(id)
        .create(share);
      await auditServerEvent(
        req,
        "personalPassport.shareCreated",
        "personalPassport",
        {
          passportId,
          shareId: id,
          targetProjectId,
          fieldCount: fields.length,
        },
      );
      const baseUrl = process.env.APP_BASE_URL ?? "https://praeventio.app";
      return res.status(201).json({
        shareId: id,
        expiresAt: share.expiresAt,
        // The secret is returned only to the worker, and belongs in the URL fragment.
        shareUrl: `${baseUrl}/passport/share/${ownerUid}/${id}#${secret}`,
        secret,
      });
    } catch (error) {
      logger.error?.("personal_passport_share_create_failed", error);
      captureRouteError(error, "personalPassport.shareCreate");
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

// POST /api/personal-passports/:ownerUid/shares/:shareId/consume — recipient
// must authenticate as the worker-selected UID and remain in the target project.
personalPassportRouter.post(
  "/:ownerUid/shares/:shareId/consume",
  verifyAuth,
  async (req, res) => {
    const { ownerUid, shareId } = req.params;
    const recipientUid = authenticatedUid(req);
    if (!recipientUid) return res.status(401).json({ error: "unauthorized" });
    try {
      const shareRef = admin
        .firestore()
        .collection("users")
        .doc(ownerUid)
        .collection("personal_passport_shares")
        .doc(shareId);
      const shareDoc = await shareRef.get();
      if (!shareDoc.exists)
        return res.status(404).json({ error: "share_not_found" });
      const share = shareDoc.data() as PassportShare;
      if (
        share.ownerUid !== ownerUid ||
        share.id !== shareId ||
        share.recipientUid !== recipientUid ||
        share.revokedAt !== null ||
        Date.now() > share.expiresAt ||
        !matchesSecret(req.body?.secret, share.tokenHash)
      ) {
        return res.status(403).json({ error: "share_access_denied" });
      }
      const targetProject = await admin
        .firestore()
        .collection("projects")
        .doc(share.targetProjectId)
        .get();
      const targetData = targetProject.exists
        ? (targetProject.data() as Record<string, unknown>)
        : null;
      if (
        !targetData ||
        projectTenantId(targetData) !== share.targetTenantId ||
        !isDirectProjectMember(targetData, recipientUid)
      ) {
        return res
          .status(403)
          .json({ error: "recipient_not_member_of_target_project" });
      }
      const loaded = await loadOwnedPassport(ownerUid, share.passportId);
      if (!loaded) return res.status(404).json({ error: "passport_not_found" });
      await auditServerEvent(
        req,
        "personalPassport.shareConsumed",
        "personalPassport",
        {
          passportId: share.passportId,
          shareId,
          targetProjectId: share.targetProjectId,
        },
      );
      return res.json({
        passport: passportPayload(loaded.snapshot, share.fields),
      });
    } catch (error) {
      logger.error?.("personal_passport_share_consume_failed", error);
      captureRouteError(error, "personalPassport.shareConsume");
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

personalPassportRouter.post(
  "/:passportId/shares/:shareId/revoke",
  verifyAuth,
  async (req, res) => {
    const ownerUid = authenticatedUid(req);
    if (!ownerUid) return res.status(401).json({ error: "unauthorized" });
    const { passportId, shareId } = req.params;
    try {
      const ref = admin
        .firestore()
        .collection("users")
        .doc(ownerUid)
        .collection("personal_passport_shares")
        .doc(shareId);
      const doc = await ref.get();
      if (!doc.exists)
        return res.status(404).json({ error: "share_not_found" });
      const share = doc.data() as PassportShare;
      if (share.ownerUid !== ownerUid || share.passportId !== passportId)
        return res.status(404).json({ error: "share_not_found" });
      if (share.revokedAt === null) await ref.update({ revokedAt: Date.now() });
      await auditServerEvent(
        req,
        "personalPassport.shareRevoked",
        "personalPassport",
        { passportId, shareId },
      );
      return res.json({ success: true });
    } catch (error) {
      logger.error?.("personal_passport_share_revoke_failed", error);
      captureRouteError(error, "personalPassport.shareRevoke");
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

export default personalPassportRouter;
