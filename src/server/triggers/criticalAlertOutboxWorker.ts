// Praeventio Guard — P0 worker de entrega del outbox de alertas críticas.

import {
  claimOutboxForDelivery,
  markOutboxFailed,
  markOutboxSent,
  type OutboxClaimFields,
} from './criticalAlertOutbox';

export interface FcmMulticastResult {
  successCount: number;
  failureCount: number;
}

export interface OutboxDeliveryDeps {
  fields: OutboxClaimFields;
  nowMs: () => number;
  leaseMs: number;
  tokenFactory: () => string;
  backoffBaseMs: number;
  maxAttempts: number;
  sendFcmMulticast: (msg: { tokens: string[]; title: string; body: string; projectId: string; nodeId: string; severity: string }) => Promise<FcmMulticastResult>;
  sendCphsEmail: (recipients: string[], projectId: string, severity: string, title: string) => Promise<boolean>;
  mirrorNodeSent: (nodeId: string) => Promise<void>;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export type OutboxDeliveryResult =
  | { kind: 'sent' }
  | { kind: 'failed'; nextAttemptAtMs: number }
  | { kind: 'dead_lettered' }
  | { kind: 'leased'; retryAfterMs: number }
  | { kind: 'completed' };

export interface DeliverOutboxItemArgs {
  db: Parameters<typeof claimOutboxForDelivery>[0]['db'];
  ref: Parameters<typeof claimOutboxForDelivery>[0]['ref'];
  deps: OutboxDeliveryDeps;
}

/** Claim → deliver with frozen payload → sent/failed/dead_lettered. */
export async function deliverOutboxItem(
  args: DeliverOutboxItemArgs,
): Promise<OutboxDeliveryResult> {
  const { db, ref, deps } = args;
  const token = deps.tokenFactory();

  const claim = await claimOutboxForDelivery({
    db,
    ref,
    fields: deps.fields,
    nowMs: deps.nowMs(),
    leaseMs: deps.leaseMs,
    token,
  });
  if (claim.kind === 'completed') return { kind: 'completed' };
  if (claim.kind === 'leased') return { kind: 'leased', retryAfterMs: claim.retryAfterMs };

  // We own the claim; the outbox doc now carries status=processing.
  const docSnap = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    return { exists: snap.exists, data: (snap.data() ?? {}) as Record<string, unknown> };
  });
  const payload = (docSnap.data?.payload as
    | {
        projectId: string;
        nodeId: string;
        title: string;
        description?: string;
        severity: string;
        location?: string;
        fcmTokens: string[];
        emailRecipients: string[];
      }
    | undefined);
  if (!payload) {
    return { kind: 'dead_lettered' };
  }

  let fcmDelivered = 0;
  if (payload.fcmTokens.length > 0) {
    try {
      const result = await deps.sendFcmMulticast({
        tokens: payload.fcmTokens,
        title: `⚠️ Incidente ${payload.severity || 'Crítico'}`,
        body: `${payload.title || 'Nuevo incidente'} — ${payload.location || 'Ver detalles en la app'}`,
        projectId: payload.projectId,
        nodeId: payload.nodeId,
        severity: payload.severity,
      });
      fcmDelivered = result?.successCount ?? 0;
    } catch (error) {
      deps.logger.warn('outbox_fcm_send_failed', { nodeId: payload.nodeId, error });
      fcmDelivered = 0;
    }
  }

  let emailDelivered = false;
  if (payload.emailRecipients.length > 0) {
    try {
      emailDelivered = await deps.sendCphsEmail(
        payload.emailRecipients,
        payload.projectId,
        payload.severity,
        payload.title,
      );
    } catch (error) {
      deps.logger.warn('outbox_email_send_failed', { nodeId: payload.nodeId, error });
      emailDelivered = false;
    }
  }

  if (fcmDelivered > 0 || emailDelivered) {
    const ok = await markOutboxSent({
      db,
      ref,
      fields: deps.fields,
      token,
      delivery: {
        fcmDelivered,
        fcmAttempted: payload.fcmTokens.length,
        emailDelivered,
      },
      nowMs: deps.nowMs(),
    });
    if (!ok) return { kind: 'completed' }; // claim lost mid-flight; terminal no-op
    try {
      await deps.mirrorNodeSent(payload.nodeId);
    } catch (error) {
      deps.logger.warn('outbox_mirror_failed', { nodeId: payload.nodeId, error });
    }
    return { kind: 'sent' };
  }

  const failed = await markOutboxFailed({
    db,
    ref,
    fields: deps.fields,
    token,
    lastError: `fcm ${fcmDelivered}/${payload.fcmTokens.length} email ${emailDelivered}`,
    nowMs: deps.nowMs(),
    backoffBaseMs: deps.backoffBaseMs,
    maxAttempts: deps.maxAttempts,
  });
  if (failed.kind === 'dead_lettered') return { kind: 'dead_lettered' };
  return { kind: 'failed', nextAttemptAtMs: failed.nextAttemptAtMs };
}
