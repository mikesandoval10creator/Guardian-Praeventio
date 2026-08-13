// Praeventio Guard — Sprint 39 Fase G.11 — Lone Worker HTTP surface.
//
// Mirrors the readReceipts wire pattern: pure-compute endpoints over the
// engine at `src/services/loneWorker/loneWorkerService.ts`. The engine is
// deterministic and stateless — these routes only marshal JSON in/out,
// verify the caller is a project member, and surface idempotency support
// for mutating calls (check-in, end-session).
//
// Endpoints:
//   POST /:projectId/lone-worker/start-session   { checkInIntervalMin, startedAt?, lastKnownLocation? }
//   POST /:projectId/lone-worker/check-in        { session, checkIn }
//   POST /:projectId/lone-worker/end-session     { session, endedAt? }
//   POST /:projectId/lone-worker/derive-status   { session, now? }
//   POST /:projectId/lone-worker/decide-escalation { session, now? }
//   POST /:projectId/lone-worker/admin-overview  { sessions, now? }
//
// Anti-blame note (mirror of read-receipts.acknowledge):
//   • A worker starts/checks-in their OWN session: start-session stamps
//     `workerUid` from the verified TOKEN (never the body) and mints the id
//     server-side; check-in requires `session.workerUid === caller`.
//   • Anyone with project membership can end-session (supervisors close out).
//   • Admin-overview is project-membership gated; no per-worker filtering.
//
// Persistence model: these routes are pure-compute + audit only (the engine is
// stateless). The client persists the returned session to Firestore
// (`projects/{pid}/lone_worker_sessions/{id}`, rules gate create to
// workerUid==auth.uid). start-session is the AUDITED creation point so every
// started lone-worker session is traced (the man-down escalation cron reads
// these docs — a session that began must leave an audit trail).

import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import admin from "firebase-admin";
import { verifyAuth } from "../middleware/verifyAuth.js";
import { validate } from "../middleware/validate.js";
import { idempotencyKey } from "../middleware/idempotencyKey.js";
import { logger } from "../../utils/logger.js";
import { captureRouteError } from "../middleware/captureRouteError.js";
import { auditServerEvent } from "../middleware/auditLog.js";
import {
  assertProjectMember,
  ProjectMembershipError,
} from "../../services/auth/projectMembership.js";
import { randomId } from "../../utils/randomId.js";
import {
  startLoneWorkerSession,
  recordCheckIn,
  endSession,
  deriveLoneWorkerStatus,
  decideEscalation,
  type LoneWorkerSession,
  type LoneWorkerStatus,
  type EscalationDecision,
} from "../../services/loneWorker/loneWorkerService.js";

const router = Router();

async function guard(
  callerUid: string,
  projectId: string,
  res: import("express").Response,
): Promise<boolean> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: "forbidden" });
      return false;
    }
    throw err;
  }
  return true;
}

// ── shared schemas ─────────────────────────────────────────────────────

const statusSchema = z.enum([
  "active",
  "overdue_warning",
  "overdue_critical",
  "help_requested",
  "ended",
]) as unknown as z.ZodType<LoneWorkerStatus>;

const checkInEntrySchema = z.object({
  at: z.string().min(10),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  status: z.enum(["ok", "help"]),
});

const lastKnownLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  at: z.string().min(10),
});

const sessionSchema = z.object({
  id: z.string().min(1).max(200),
  workerUid: z.string().min(1).max(200),
  startedAt: z.string().min(10),
  checkInIntervalMin: z.number().int().min(1).max(720),
  lastKnownLocation: lastKnownLocationSchema.optional(),
  checkIns: z.array(checkInEntrySchema).max(10_000),
  endedAt: z.string().min(10).optional(),
  status: statusSchema,
}) as unknown as z.ZodType<LoneWorkerSession>;

// ────────────────────────────────────────────────────────────────────────
// 0. start-session — worker begins a monitored solo-work session (AUDITED)
// ────────────────────────────────────────────────────────────────────────
//
// The previous flow built the session entirely client-side and wrote it
// straight to Firestore with NO audit_logs entry — the only lone-worker
// lifecycle action that wasn't audited. workerUid + id are now server-stamped
// (identity from the token, id from randomId — no client RNG). The session is
// still persisted client-side; this route is the audited creation record.
const startSessionSchema = z.object({
  checkInIntervalMin: z.number().int().min(1).max(720),
  startedAt: z.string().min(10).optional(),
  lastKnownLocation: lastKnownLocationSchema.optional(),
});

router.post(
  "/:projectId/lone-worker/start-session",
  verifyAuth,
  idempotencyKey(),
  validate(startSessionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof startSessionSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      // workerUid + id are server-stamped: a worker starts their OWN session,
      // and the id is server-minted (no client Math.random). The engine
      // normalizes to a fresh active session (no carried-over check-ins).
      const session = startLoneWorkerSession({
        id: randomId(),
        workerUid: callerUid,
        startedAt: body.startedAt,
        checkInIntervalMin: body.checkInIntervalMin,
        ...(body.lastKnownLocation
          ? { lastKnownLocation: body.lastKnownLocation }
          : {}),
      });
      // CLAUDE.md #3: the START of a lone-worker session is a safety-critical
      // state change — audit it with the server-stamped actor.
      // CLAUDE.md #14: the session already started; an audit-log failure must
      // NOT 500 the worker's request. Capture for observability and continue.
      try {
        await auditServerEvent(
          req,
          "loneWorker.startSession",
          "loneWorker",
          {
          sessionId: session.id,
          workerUid: session.workerUid,
          checkInIntervalMin: session.checkInIntervalMin,
          projectId,
          },
          { projectId },
        );
      } catch (auditErr) {
        logger.error?.("audit_event_failed", auditErr);
        captureRouteError(auditErr, "loneWorker.startSession.audit", {
          callerUid,
          projectId,
        });
      }
      return res.json({ session });
    } catch (err) {
      logger.error?.("loneWorker.startSession.error", err);
      captureRouteError(err, "loneWorker.startSession", {
        callerUid,
        projectId,
      });
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────────
// Native foreground ManDown bridge — capability mint + idempotent ingest
// ────────────────────────────────────────────────────────────────────────────
//
// Android foreground services cannot safely retain a Firebase refresh token or
// a project secret. The authenticated WebView therefore mints an opaque
// capability bound to one open lone-worker session. Only its SHA-256 hash
// reaches Firestore. A capability is valid for the bounded session window and
// may authenticate multiple distinct native triggers; every trigger carries a
// stable clientEventId and is idempotent server-side. A stopped/ended session,
// expired capability, or mismatched hash fails closed. Explicit session end
// invalidates the capability in the same server transaction.
// A lone-worker session is capped at 12h. Leave a small delivery margin so an
// alert captured near shift end can survive a transient offline retry; explicit
// end-session remains the immediate authority revocation point.
const NATIVE_MANDOWN_CAPABILITY_TTL_MS = 13 * 60 * 60_000;
const NATIVE_MANDOWN_HEADER = "x-mandown-capability";

const nativeManDownSchema = z
  .object({
    /** Stable per-trigger UUID: retries reuse it, distinct triggers mint another. */
    clientEventId: z.string().uuid(),
    kind: z.enum(["impact", "inactivity"]),
    occurredAt: z.string().min(10).max(80),
    accelerationMps2: z.number().finite().min(0).max(200).optional(),
    inactivityMs: z
      .number()
      .int()
      .min(1_000)
      .max(24 * 60 * 60_000)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "impact" && value.accelerationMps2 === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "impact requires accelerationMps2",
      });
    }
    if (value.kind === "inactivity" && value.inactivityMs === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "inactivity requires inactivityMs",
      });
    }
  });

type NativeManDownPayload = z.infer<typeof nativeManDownSchema>;

type NativeSessionRecord = {
  workerUid?: unknown;
  status?: unknown;
  endedAt?: unknown;
  nativeManDownCapabilityHash?: unknown;
  nativeManDownCapabilityExpiresAt?: unknown;
};

class NativeManDownError extends Error {
  constructor(
    readonly httpStatus: 409,
    message:
      "native_mandown_session_inactive" | "native_mandown_capability_invalid",
  ) {
    super(message);
    this.name = "NativeManDownError";
  }
}

function isOpenNativeSession(
  data: NativeSessionRecord,
  workerUid: string,
): boolean {
  // Only canonical non-terminal statuses are native-safe. A malformed/missing
  // status must fail closed rather than turning an arbitrary Firestore record
  // into an Android background authority.
  const openStatuses = new Set([
    "active",
    "overdue_warning",
    "overdue_critical",
    "help_requested",
  ]);
  return (
    data.workerUid === workerUid &&
    typeof data.status === "string" &&
    openStatuses.has(data.status) &&
    !data.endedAt
  );
}

function capabilityHash(capability: string): string {
  return crypto.createHash("sha256").update(capability, "utf8").digest("hex");
}

function capabilityMatches(raw: string, expectedHash: unknown): boolean {
  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash))
    return false;
  const actual = Buffer.from(capabilityHash(raw), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}

function validNativeCapability(raw: unknown): raw is string {
  return (
    typeof raw === "string" &&
    /^[A-Za-z0-9_-]{32,}$/.test(raw) &&
    raw.length <= 256
  );
}

router.post(
  "/:projectId/lone-worker/:sessionId/native-mandown-capability",
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, sessionId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;

    const db = admin.firestore();
    const sessionRef = db
      .collection("projects")
      .doc(projectId)
      .collection("lone_worker_sessions")
      .doc(sessionId);
    const capability = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + NATIVE_MANDOWN_CAPABILITY_TTL_MS,
    ).toISOString();

    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(sessionRef);
        if (
          !snap.exists ||
          !isOpenNativeSession(snap.data() as NativeSessionRecord, callerUid)
        ) {
          throw new NativeManDownError(409, "native_mandown_session_inactive");
        }
        tx.update(sessionRef, {
          nativeManDownCapabilityHash: capabilityHash(capability),
          nativeManDownCapabilityExpiresAt: expiresAt,
          nativeManDownCapabilityIssuedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    } catch (err) {
      if (err instanceof NativeManDownError) {
        return res.status(err.httpStatus).json({ error: err.message });
      }
      logger.error?.("loneWorker.nativeCapability.error", err);
      captureRouteError(err, "loneWorker.nativeCapability", {
        callerUid,
        projectId,
        sessionId,
      });
      return res.status(500).json({ error: "internal_error" });
    }

    try {
      await auditServerEvent(
        req,
        "loneWorker.nativeManDownCapabilityIssued",
        "loneWorker",
        {
          projectId,
          sessionId,
          workerUid: callerUid,
          expiresAt,
        },
        { projectId },
      );
    } catch (auditErr) {
      logger.warn?.("loneWorker.nativeCapability.audit_failed", auditErr);
      captureRouteError(auditErr, "loneWorker.nativeCapability.audit", {
        callerUid,
        projectId,
        sessionId,
      });
    }
    return res.json({ sessionId, capability, expiresAt });
  },
);

router.post(
  "/:projectId/lone-worker/:sessionId/native-man-down",
  validate(nativeManDownSchema),
  async (req, res) => {
    const { projectId, sessionId } = req.params;
    const rawCapability = req.header(NATIVE_MANDOWN_HEADER);
    if (!validNativeCapability(rawCapability)) {
      return res.status(401).json({ error: "native_mandown_unauthorized" });
    }
    const body = req.validated as NativeManDownPayload;
    const occurredAtMs = Date.parse(body.occurredAt);
    // A persisted native outbox can retry after a transient network outage.
    // `clientEventId` provides replay protection; reject only malformed or
    // materially-future device clocks, not a genuine alert captured earlier in
    // the same still-open session.
    if (
      !Number.isFinite(occurredAtMs) ||
      occurredAtMs > Date.now() + 5 * 60_000
    ) {
      return res
        .status(400)
        .json({ error: "native_mandown_invalid_timestamp" });
    }

    const db = admin.firestore();
    const sessionRef = db
      .collection("projects")
      .doc(projectId)
      .collection("lone_worker_sessions")
      .doc(sessionId);
    // clientEventId is a stable UUID persisted by Android before network I/O.
    // Deterministic document identity makes offline retries idempotent without
    // consuming the session capability after the first alert of a shift.
    const eventRef = db
      .collection("projects")
      .doc(projectId)
      .collection("mandown_events")
      .doc(body.clientEventId);
    const auditRef = db.collection("audit_logs").doc();

    let workerUid = "";
    let duplicate = false;
    try {
      await db.runTransaction(async (tx) => {
        const [sessionSnap, existingEvent] = await Promise.all([
          tx.get(sessionRef),
          tx.get(eventRef),
        ]);
        if (!sessionSnap.exists)
          throw new NativeManDownError(409, "native_mandown_session_inactive");
        const session = sessionSnap.data() as NativeSessionRecord;
        const storedWorkerUid =
          typeof session.workerUid === "string" ? session.workerUid : "";
        const expiry =
          typeof session.nativeManDownCapabilityExpiresAt === "string"
            ? Date.parse(session.nativeManDownCapabilityExpiresAt)
            : Number.NaN;
        if (
          !isOpenNativeSession(session, storedWorkerUid) ||
          !Number.isFinite(expiry) ||
          expiry <= Date.now() ||
          !capabilityMatches(rawCapability, session.nativeManDownCapabilityHash)
        ) {
          throw new NativeManDownError(
            409,
            "native_mandown_capability_invalid",
          );
        }
        workerUid = storedWorkerUid;
        if (existingEvent.exists) {
          const existing = existingEvent.data() as Record<string, unknown>;
          if (
            existing.projectId !== projectId ||
            existing.sessionId !== sessionId ||
            existing.workerId !== workerUid ||
            existing.source !== "android_foreground_service"
          ) {
            throw new NativeManDownError(
              409,
              "native_mandown_capability_invalid",
            );
          }
          duplicate = true;
          return;
        }
        tx.create(eventRef, {
          projectId,
          sessionId,
          workerId: workerUid,
          status: "active",
          source: "android_foreground_service",
          clientEventId: body.clientEventId,
          trigger: body.kind,
          triggeredAt: admin.firestore.FieldValue.serverTimestamp(),
          occurredAt: body.occurredAt,
          ...(body.accelerationMps2 !== undefined
            ? { accelerationMps2: body.accelerationMps2 }
            : {}),
          ...(body.inactivityMs !== undefined
            ? { inactivityMs: body.inactivityMs }
            : {}),
          acknowledgedBy: null,
          acknowledgedAt: null,
        });
        tx.set(auditRef, {
          action: "loneWorker.nativeManDownAccepted",
          module: "loneWorker",
          details: {
            projectId,
            sessionId,
            eventId: eventRef.id,
            workerUid,
            kind: body.kind,
            source: "android_foreground_service",
          },
          userId: workerUid,
          projectId,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    } catch (err) {
      if (err instanceof NativeManDownError) {
        return res.status(err.httpStatus).json({ error: err.message });
      }
      logger.error?.("loneWorker.nativeManDown.error", err);
      captureRouteError(err, "loneWorker.nativeManDown", {
        projectId,
        sessionId,
      });
      return res.status(500).json({ error: "internal_error" });
    }

    // A transport retry for the same persisted clientEventId is a successful
    // idempotent delivery, not a second emergency/fan-out.
    if (duplicate) {
      return res
        .status(202)
        .json({ accepted: true, duplicate: true, eventId: eventRef.id });
    }

    // The durable event is committed before this best-effort immediate fan-out.
    // The existing ManDown escalation job continues to retry/expand notification
    // levels if a transient push failure occurs here.
    try {
      const { sendToProjectSupervisors } = await import("./emergency.js");
      await sendToProjectSupervisors(
        projectId,
        {
          title: "Alerta Man Down detectada",
          body: "El monitoreo nativo detectó una posible caída o inmovilidad.",
          data: {
            projectId,
            eventId: eventRef.id,
            type: "man_down",
            workerUid,
          },
        },
        db,
        admin.messaging(),
      );
    } catch (notifyErr) {
      logger.warn?.("loneWorker.nativeManDown.fanout_failed", notifyErr);
      captureRouteError(notifyErr, "loneWorker.nativeManDown.fanout", {
        projectId,
        sessionId,
        eventId: eventRef.id,
      });
    }

    // Explicit post-write audit for the route convention gate. The transaction
    // already wrote the immutable forensic audit with the event; this secondary
    // server audit records HTTP completion and never blocks life-safety fan-out.
    try {
      await auditServerEvent(
        req,
        "loneWorker.nativeManDownDelivered",
        "loneWorker",
        {
          projectId,
          sessionId,
          eventId: eventRef.id,
          workerUid,
          kind: body.kind,
        },
        { projectId },
      );
    } catch (auditErr) {
      logger.warn?.("loneWorker.nativeManDown.audit_failed", auditErr);
      captureRouteError(auditErr, "loneWorker.nativeManDown.audit", {
        projectId,
        sessionId,
        eventId: eventRef.id,
      });
    }

    return res.status(202).json({ accepted: true, eventId: eventRef.id });
  },
);

// ────────────────────────────────────────────────────────────────────────────
// 1. check-in  — worker pulses heartbeat (or "help")
// ────────────────────────────────────────────────────────────────────────────

const checkInSchema = z.object({
  session: sessionSchema,
  checkIn: z.object({
    at: z.string().min(10).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    status: z.enum(["ok", "help"]).optional(),
  }),
});

router.post(
  "/:projectId/lone-worker/check-in",
  verifyAuth,
  idempotencyKey(),
  validate(checkInSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof checkInSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    // Anti-blame: a worker can only check-in for themselves. Supervisors
    // wanting to mark a check-in for another worker must go through a
    // separate audited flow (out-of-scope here).
    if (body.session.workerUid !== callerUid) {
      return res.status(403).json({
        error: "forbidden",
        message: "Only the worker themselves can record their own check-in.",
      });
    }
    try {
      const session = recordCheckIn(body.session, body.checkIn);
      // CLAUDE.md #3: a safety-critical lone-worker check-in (esp. status:'help')
      // must be audited even though the session itself isn't server-persisted.
      // CLAUDE.md #14 (LIFE-SAFETY): a check-in — especially status:'help' — must
      // reach the worker as success once recordCheckIn succeeds. An audit-log
      // outage must NOT 500 a distress signal (the worker would think help was
      // not received). Capture the audit failure out-of-band and still respond OK.
      try {
        await auditServerEvent(
          req,
          "loneWorker.checkIn",
          "loneWorker",
          {
          sessionId: session.id,
          workerUid: session.workerUid,
            help: body.checkIn.status === "help",
          projectId,
          },
          { projectId },
        );
      } catch (auditErr) {
        logger.error?.("audit_event_failed", auditErr);
        captureRouteError(auditErr, "loneWorker.checkIn.audit", {
          callerUid,
          projectId,
        });
      }
      return res.json({ session });
    } catch (err) {
      logger.error?.("loneWorker.checkIn.error", err);
      captureRouteError(err, "loneWorker.checkIn", { callerUid, projectId });
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. end-session — supervisor / worker closes the active session
// ────────────────────────────────────────────────────────────────────────

const endSessionSchema = z.object({
  session: sessionSchema,
  endedAt: z.string().min(10).optional(),
});

router.post(
  "/:projectId/lone-worker/end-session",
  verifyAuth,
  idempotencyKey(),
  validate(endSessionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof endSessionSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      // Session closure is the server-side authority boundary for the Android
      // foreground capability. Do not rely on the following client Firestore
      // write: the WebView can die after receiving this HTTP response.
      const db = admin.firestore();
      const sessionRef = db
        .collection("projects")
        .doc(projectId)
        .collection("lone_worker_sessions")
        .doc(body.session.id);
      const session = await db.runTransaction(async (tx) => {
        const snap = await tx.get(sessionRef);
        if (!snap.exists) {
          throw new NativeManDownError(409, "native_mandown_session_inactive");
        }
        const persisted = snap.data() as LoneWorkerSession;
        if (persisted.workerUid !== body.session.workerUid) {
          throw new NativeManDownError(409, "native_mandown_session_inactive");
        }
        const ended = endSession(persisted, body.endedAt);
        tx.update(sessionRef, {
          status: ended.status,
          endedAt: ended.endedAt,
          nativeManDownCapabilityHash: admin.firestore.FieldValue.delete(),
          nativeManDownCapabilityExpiresAt: admin.firestore.FieldValue.delete(),
          nativeManDownCapabilityIssuedAt: admin.firestore.FieldValue.delete(),
        });
        return ended;
      });
      // CLAUDE.md #14: session already ended; audit failure must not 500 it.
      try {
        await auditServerEvent(
          req,
          "loneWorker.endSession",
          "loneWorker",
          {
          sessionId: session.id,
          workerUid: session.workerUid,
          projectId,
          },
          { projectId },
        );
      } catch (auditErr) {
        logger.error?.("audit_event_failed", auditErr);
        captureRouteError(auditErr, "loneWorker.endSession.audit", {
          callerUid,
          projectId,
        });
      }
      const {
        nativeManDownCapabilityHash: _capabilityHash,
        nativeManDownCapabilityExpiresAt: _capabilityExpiresAt,
        nativeManDownCapabilityIssuedAt: _capabilityIssuedAt,
        ...publicSession
      } = session as LoneWorkerSession & Record<string, unknown>;
      return res.json({ session: publicSession });
    } catch (err) {
      logger.error?.("loneWorker.endSession.error", err);
      captureRouteError(err, "loneWorker.endSession", { callerUid, projectId });
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. derive-status — pure read of derived state
// ────────────────────────────────────────────────────────────────────────

const deriveSchema = z.object({
  session: sessionSchema,
  now: z.string().min(10).optional(),
});

router.post(
  "/:projectId/lone-worker/derive-status",
  verifyAuth,
  validate(deriveSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof deriveSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const status = deriveLoneWorkerStatus(body.session, now);
      return res.json({ status });
    } catch (err) {
      logger.error?.("loneWorker.deriveStatus.error", err);
      captureRouteError(err, "loneWorker.deriveStatus", {
        callerUid,
        projectId,
      });
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. decide-escalation — pure read of escalation decision (nullable)
// ────────────────────────────────────────────────────────────────────────

router.post(
  "/:projectId/lone-worker/decide-escalation",
  verifyAuth,
  validate(deriveSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof deriveSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const escalation: EscalationDecision | null = decideEscalation(
        body.session,
        now,
      );
      return res.json({ escalation });
    } catch (err) {
      logger.error?.("loneWorker.decideEscalation.error", err);
      captureRouteError(err, "loneWorker.decideEscalation", {
        callerUid,
        projectId,
      });
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. admin-overview — derive status+escalation across many sessions in one
//    call (mobile admin dashboard convenience).
// ────────────────────────────────────────────────────────────────────────

const overviewSchema = z.object({
  sessions: z.array(sessionSchema).max(2_000),
  now: z.string().min(10).optional(),
});

interface OverviewEntry {
  session: LoneWorkerSession;
  status: LoneWorkerStatus;
  escalation: EscalationDecision | null;
}

router.post(
  "/:projectId/lone-worker/admin-overview",
  verifyAuth,
  validate(overviewSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof overviewSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const overview: OverviewEntry[] = body.sessions.map((session) => ({
        session,
        status: deriveLoneWorkerStatus(session, now),
        escalation: decideEscalation(session, now),
      }));
      return res.json({ overview });
    } catch (err) {
      logger.error?.("loneWorker.adminOverview.error", err);
      captureRouteError(err, "loneWorker.adminOverview", {
        callerUid,
        projectId,
      });
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

export default router;
