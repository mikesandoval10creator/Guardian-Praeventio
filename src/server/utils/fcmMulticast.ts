// SPDX-License-Identifier: MIT
// PR #482 codex P1 — chunked FCM multicast.
//
// `messaging.sendEachForMulticast` only accepts up to 500 registration
// tokens per invocation. Larger brigade/emergency rosters silently fail
// when sent in one shot, which (combined with cron jobs that swallow
// notify errors before persisting idempotency markers) can result in
// "escalation emitted" telemetry without any successful delivery.
//
// This helper chunks tokens, calls `sendEachForMulticast` per batch, and
// aggregates `successCount`/`failureCount`. Errors raised by a single
// chunk are recorded in `errorCount` and do not abort subsequent chunks.

import type { messaging as adminMessaging } from 'firebase-admin';
import { logger } from '../../utils/logger.js';

/** Firebase Admin SDK limit per multicast call. */
export const FCM_MULTICAST_MAX_TOKENS = 500;

export interface MulticastChunkedResult {
  /** Total tokens attempted (after dedup by the caller). */
  attempted: number;
  /** Sum of FCM `successCount` across all chunks. */
  successCount: number;
  /** Sum of FCM `failureCount` across all chunks. */
  failureCount: number;
  /** Number of chunks that threw before returning. */
  errorCount: number;
  /** Number of chunks dispatched (informational). */
  chunkCount: number;
}

export type MulticastPayload = Omit<adminMessaging.MulticastMessage, 'tokens'>;

/**
 * Send `payload` to `tokens` in batches of `FCM_MULTICAST_MAX_TOKENS`.
 * Returns aggregated counts; never throws on a per-chunk failure.
 */
export async function sendMulticastChunked(
  messaging: adminMessaging.Messaging,
  tokens: readonly string[],
  payload: MulticastPayload,
): Promise<MulticastChunkedResult> {
  const result: MulticastChunkedResult = {
    attempted: tokens.length,
    successCount: 0,
    failureCount: 0,
    errorCount: 0,
    chunkCount: 0,
  };
  if (tokens.length === 0) return result;

  for (let i = 0; i < tokens.length; i += FCM_MULTICAST_MAX_TOKENS) {
    const chunk = tokens.slice(i, i + FCM_MULTICAST_MAX_TOKENS);
    result.chunkCount += 1;
    try {
      const res = await messaging.sendEachForMulticast({ ...payload, tokens: chunk });
      result.successCount += res.successCount;
      result.failureCount += res.failureCount;
    } catch (err) {
      result.errorCount += 1;
      logger.warn?.('fcm_multicast.chunk_failed', {
        chunkIndex: result.chunkCount - 1,
        chunkSize: chunk.length,
        err: String(err),
      });
    }
  }

  return result;
}
