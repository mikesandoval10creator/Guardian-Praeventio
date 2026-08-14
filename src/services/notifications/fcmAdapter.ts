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

import { getMessaging } from "firebase-admin/messaging";
import {
  type NotificationSeverity,
  severityToAndroidPriority,
  severityToApnsPriority,
  severityToCriticalSound,
  severityToChannelId,
  severityShouldPush,
} from "./notificationSeverity.js";

/** Notification payload accepted by both `sendToTokens` and `sendToTopic`. */
export interface FcmNotification {
  title: string;
  body: string;
  /** Optional string-string data map. Keys + values must already be strings
   *  (FCM rejects non-string `data` entries). Pass `undefined` to omit. */
  data?: Record<string, string>;
}

/** Calm-Technology severity tier. Defaults to `vital` so existing call
 *  sites that pre-date the tier system keep their behaviour. Set
 *  `severity: 'ambient'` to make the push adapter reject the call: the
 *  In-app NotificationContext surface handles ambient notifications. */
export interface FcmSendOptions {
  severity?: NotificationSeverity;
}

/** Default severity for the adapter. `vital` preserves the historical
 *  safe behaviour for call sites that pre-date the tier system. */
function resolveSeverity(
  severity: NotificationSeverity | undefined,
): NotificationSeverity {
  return severity ?? "vital";
}

/** Result of a multicast send. `failedTokens` lists the *exact* tokens that
 *  failed (in input order, not response order — we map by index).
 *  `invalidTokens` is the subset of `failedTokens` that FCM reported as
 *  DEFINITIVELY dead (unregistered / malformed) — safe to prune from
 *  `users/{uid}.fcmTokens`. Temporary failures (server-unavailable, quota) are
 *  in `failedTokens` but NOT `invalidTokens`, so a transient outage never
 *  deletes a live device's token. */
export interface FcmSendResult {
  successCount: number;
  failureCount: number;
  failedTokens: string[];
  invalidTokens: string[];
}

/** FCM error codes that mean the token is permanently dead — prune these. */
const DEFINITIVE_INVALID_CODES: ReadonlySet<string> = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

/** FCM caps sendEachForMulticast at 500 tokens per call. */
const FCM_MULTICAST_MAX = 500;

/** Distinguishes infra/SDK errors from caller-side validation errors. */
export class FcmAdapterError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FcmAdapterError";
  }
}

function buildBaseMessage(
  notification: FcmNotification,
  severity: NotificationSeverity,
) {
  const base: any = {
    notification: {
      title: notification.title,
      body: notification.body,
    },
    android: {
      priority: severityToAndroidPriority(severity),
      notification: {
        channel_id: severityToChannelId(severity),
      },
    },
    apns: {
      headers: {
        "apns-priority": severityToApnsPriority(severity),
      },
    },
  };
  if (severityToCriticalSound(severity)) {
    base.apns.payload = {
      aps: {
        sound: { critical: true, name: "default", volume: 1 },
      },
    };
  }
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
    options: FcmSendOptions = {},
  ): Promise<FcmSendResult> {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return {
        successCount: 0,
        failureCount: 0,
        failedTokens: [],
        invalidTokens: [],
      };
    }
    const severity = resolveSeverity(options.severity);
    if (!severityShouldPush(severity)) {
      // Calm Tech guard: ambient notifications must never reach the FCM
      // adapter. They render in-app via NotificationContext instead.
      throw new FcmAdapterError(
        `Refusing to push ambient notification '${notification.title}': use the in-app surface.`,
      );
    }

    const base = buildBaseMessage(notification, severity);
    let successCount = 0;
    let failureCount = 0;
    const failedTokens: string[] = [];
    const invalidTokens: string[] = [];

    // Batch by the FCM 500-token multicast cap so a large fan-out doesn't throw.
    for (let i = 0; i < tokens.length; i += FCM_MULTICAST_MAX) {
      const chunk = tokens.slice(i, i + FCM_MULTICAST_MAX);
      let response;
      try {
        response = await getMessaging().sendEachForMulticast({
          tokens: chunk,
          ...base,
        });
      } catch (err) {
        throw new FcmAdapterError(
          `FCM multicast failed: ${(err as Error)?.message ?? "unknown"}`,
          err,
        );
      }

      successCount += response.successCount;
      failureCount += response.failureCount;
      response.responses.forEach((resp: any, idx: number) => {
        if (resp.success) return;
        const token = chunk[idx];
        failedTokens.push(token);
        // Only prune tokens FCM says are permanently dead — a temporary error
        // (server-unavailable, quota) must never delete a live device's token.
        const code: unknown = resp.error?.code;
        if (typeof code === "string" && DEFINITIVE_INVALID_CODES.has(code)) {
          invalidTokens.push(token);
        }
      });
    }

    return { successCount, failureCount, failedTokens, invalidTokens };
  },

  /**
   * Send to a topic (e.g. `project_<projectId>`). Returns the FCM message id
   * on success. Empty topic is rejected client-side (FCM would reject too
   * but with a less actionable error).
   */
  async sendToTopic(
    topic: string,
    notification: FcmNotification,
    options: FcmSendOptions = {},
  ): Promise<string> {
    if (typeof topic !== "string" || topic.trim().length === 0) {
      throw new FcmAdapterError("Topic must be a non-empty string");
    }
    const severity = resolveSeverity(options.severity);
    if (!severityShouldPush(severity)) {
      throw new FcmAdapterError(
        `Refusing to push ambient topic notification '${notification.title}'.`,
      );
    }

    try {
      const messageId = await getMessaging().send({
        topic,
        ...buildBaseMessage(notification, severity),
      });
      return messageId;
    } catch (err) {
      throw new FcmAdapterError(
        `FCM topic send failed: ${(err as Error)?.message ?? "unknown"}`,
        err,
      );
    }
  },
};

export type FcmAdapter = typeof fcmAdapter;
