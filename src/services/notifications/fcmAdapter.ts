// Praeventio Guard — Firebase Cloud Messaging (FCM) server-side adapter.
//
// Round 15 (I5) — wraps `firebase-admin/messaging` behind a tight contract
// so the rest of the server (Express endpoints, background triggers) stays
// SDK-shaped. The adapter:
//
//   • Provides multicast (`sendToTokens`) for fan-out to a known set of
//     device tokens (project members, supervisors, etc.).
//   • Provides topic-based send (`sendToTopic`) for project-scoped or
//     role-scoped pubsub-style fanouts (e.g. /topics/project_<projectId>).
//   • Surfaces failed tokens so callers can prune stale `fcmTokens[]`
//     entries from `users/{uid}` (FCM tokens rotate / are revoked when an
//     app is uninstalled — keeping them around forever bloats writes).
//   • Throws `FcmAdapterError` on infrastructure failures, distinguishable
//     from validation errors via `instanceof`.
//
// Why a separate adapter (vs calling `admin.messaging()` directly)? The
// existing background trigger in server.ts already inlines that logic; as
// we add MORE FCM-emitting endpoints (incident-alert, training reminders,
// curriculum co-sign nudges), inlining will scatter retry / dedupe /
// metric-emission across the codebase. Centralizing here also makes
// unit-testing trivial (mock one module, not the entire firebase-admin
// surface).
//
// Note on the import: we deliberately import from `firebase-admin/messaging`
// (the modular subpath) rather than `firebase-admin` so vitest's mock
// surface is small and tests don't have to stub the whole admin SDK.

import { getMessaging } from 'firebase-admin/messaging';

/** Notification payload accepted by both `sendToTokens` and `sendToTopic`. */
export interface FcmNotification {
  title: string;
  body: string;
  /** Optional string-string data map. Keys + values must already be strings
   *  (FCM rejects non-string `data` entries). Pass `undefined` to omit. */
  data?: Record<string, string>;
}

/** Result of a multicast send. `failedTokens` lists the *exact* tokens that
 *  failed (in input order, not response order — we map by index). */
export interface FcmSendResult {
  successCount: number;
  failureCount: number;
  failedTokens: string[];
}

/** Distinguishes infra/SDK errors from caller-side validation errors. */
export class FcmAdapterError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'FcmAdapterError';
  }
}

function buildBaseMessage(notification: FcmNotification) {
  const base: any = {
    notification: {
      title: notification.title,
      body: notification.body,
    },
    android: { priority: 'high' as const },
  };
  if (notification.data !== undefined) {
    base.data = notification.data;
  }
  return base;
}

export const fcmAdapter = {
  /**
   * Multicast to up to 500 device tokens (FCM hard cap per call). Returns
   * aggregated success/failure counts plus the exact tokens that failed,
   * which the caller may use to prune `users/{uid}.fcmTokens[]`.
   *
   * If `tokens` is empty, this is a no-op and returns a zeroed result —
   * we don't burn an SDK call when there's nothing to send.
   */
  async sendToTokens(
    tokens: string[],
    notification: FcmNotification,
  ): Promise<FcmSendResult> {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return { successCount: 0, failureCount: 0, failedTokens: [] };
    }

    let response;
    try {
      response = await getMessaging().sendEachForMulticast({
        tokens,
        ...buildBaseMessage(notification),
      });
    } catch (err) {
      throw new FcmAdapterError(
        `FCM multicast failed: ${(err as Error)?.message ?? 'unknown'}`,
        err,
      );
    }

    const failedTokens: string[] = [];
    response.responses.forEach((resp: any, idx: number) => {
      if (!resp.success) {
        failedTokens.push(tokens[idx]);
      }
    });

    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      failedTokens,
    };
  },

  /**
   * Send to a topic (e.g. `project_<projectId>`). Returns the FCM message id
   * on success. Empty topic is rejected client-side (FCM would reject too
   * but with a less actionable error).
   */
  async sendToTopic(topic: string, notification: FcmNotification): Promise<string> {
    if (typeof topic !== 'string' || topic.trim().length === 0) {
      throw new FcmAdapterError('Topic must be a non-empty string');
    }

    try {
      const messageId = await getMessaging().send({
        topic,
        ...buildBaseMessage(notification),
      });
      return messageId;
    } catch (err) {
      throw new FcmAdapterError(
        `FCM topic send failed: ${(err as Error)?.message ?? 'unknown'}`,
        err,
      );
    }
  },
};

export type FcmAdapter = typeof fcmAdapter;
