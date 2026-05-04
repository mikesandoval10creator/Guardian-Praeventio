/**
 * Wires `reconcileOfflineSessions()` to the real Zettelkasten
 * persistence layer (`writeNodes`).
 *
 * The orchestrator-level `reconciliation.ts` is fully decoupled from the
 * Zettelkasten module on purpose (see the lengthy comment at the top of
 * that file). This runner is the ONLY point inside the `slm/` namespace
 * that imports from `src/services/zettelkasten/`. Every other module
 * stays free of that dependency graph and therefore unit-testable
 * without Firestore / fetch mocks.
 *
 * Sprint 20 fifth wave (Bucket Rho) — completes the deferred T-1.4.1
 * wiring that Bucket Xi left as `// TODO: wire to writeNodes` in the
 * fourth wave. Pairs with the pre-existing
 * `reconcileOfflineSessions({ zettelkastenWriteFn })` contract — we
 * supply the missing `zettelkastenWriteFn` adapter, nothing else.
 *
 * Why an adapter rather than passing `writeNodes` directly:
 *   - `reconcileOfflineSessions` expects the callback to return
 *     `{ nodeId: string }` per session. `writeNodes` returns a batch
 *     `{ ok, ids?, queued?, status?, error? }` shape.
 *   - The mapping from a `QueuedSession` (a (query, response) pair the
 *     SLM produced offline) into a `RiskNodePayload` (the canonical
 *     Zettelkasten shape) lives here so the SLM contract stays
 *     domain-clean and the Zettelkasten contract stays storage-clean.
 *   - Errors from the batch shape (`ok:false` or thrown fetch) are
 *     re-thrown so `reconcileOfflineSessions` can record them in its
 *     `failures[]` array and leave the row pending for retry.
 */

import {
  reconcileOfflineSessions,
  type ReconciliationResult,
} from './reconciliation';
import type { QueuedSession } from './offlineQueue';
import { writeNodes } from '../zettelkasten/persistence/writeNode';
import type { RiskNodePayload } from '../zettelkasten/types';

/**
 * Options bag for `runReconciliation`. `projectId` is required because
 * `writeNodes` rejects empty / missing projectIds at validation. We
 * surface it explicitly rather than burying it in a default so the
 * caller (typically the app shell, which already knows the active
 * project) is forced to thread it through.
 */
export interface RunReconciliationOptions {
  /**
   * Project the reconciled nodes belong to. Used for both the
   * Zettelkasten partition key and the `idempotencyKey` derivation
   * inside `writeNodes`.
   */
  projectId: string;
}

/**
 * Convert one queued offline SLM session into the
 * `RiskNodePayload` shape `writeNodes` expects.
 *
 * The mapping treats every queued session as a `safety-learning`
 * node — same discriminator the wisdom-capsule pipeline uses for
 * "free-form learning event captured outside the Bernoulli generator
 * fleet" (see `src/server/routes/wisdomCapsule.ts`). That keeps the
 * Zettelkasten edge router from needing a new type just for SLM
 * replays.
 *
 * `description` is clamped to 4000 chars (mirror of the
 * wisdom-capsule cap) so a runaway SLM generation can't blow past
 * Firestore document limits.
 */
function sessionToRiskNodePayload(session: QueuedSession): RiskNodePayload {
  // Title is intentionally compact — the prompt itself, clamped — so
  // the Zettelkasten UI list is scannable. Empty prompts are rare but
  // possible (e.g. a "summarize last shift" macro that builds the
  // prompt out of context); we fall back to a stable label rather
  // than emitting an empty title (the server validator would reject
  // it).
  const promptText = (session.query.prompt ?? '').trim();
  const title = promptText.length > 0
    ? `SLM: ${promptText.slice(0, 96)}`
    : 'SLM offline session';

  const description = (session.response.text ?? '').slice(0, 4000);

  return {
    title,
    description,
    type: 'safety-learning',
    severity: 'info',
    metadata: {
      sessionId: session.id,
      createdAt: session.createdAt,
      backend: session.response.backend,
      latencyMs: session.response.latencyMs,
      tokensGenerated: session.response.tokensGenerated,
      // Surfacing the raw prompt as metadata (in addition to the title)
      // means downstream agents can compute over the full prompt
      // without re-parsing the title.
      prompt: promptText,
    },
    // The runner does not know which entity (worker, sensor, project
    // sub-component) the SLM session relates to — that context wasn't
    // captured at enqueue time. Leave connections empty; downstream
    // consumers can stitch them via the projectId metadata.
    connections: [],
    // No standards citations are attached at this layer; the SLM
    // doesn't currently surface citations in its response shape.
    references: [],
  };
}

/**
 * Adapter that satisfies `ZettelkastenWriteFn`. Translates one
 * `QueuedSession` into a single-node `writeNodes` call and re-shapes
 * the batch result into the per-session `{ nodeId }` contract.
 *
 * Failure modes (each surfaced as a thrown Error so
 * `reconcileOfflineSessions` records it):
 *   - `writeNodes` returns `{ ok: false }` (HTTP 4xx, missing
 *     projectId, etc.).
 *   - `writeNodes` returns `{ ok: true, queued: true }` — the call
 *     fell back to the PWA offline queue. We treat that as a failure
 *     here so the row stays pending and the next online pass can
 *     replay it directly. (If we marked it reconciled now, the SLM
 *     queue row would be lost while the PWA queue row was the only
 *     remaining trace of the session, and the two queues drift out
 *     of sync.)
 *   - `writeNodes` returns `{ ok: true, ids: [] }` — no id was
 *     allocated. Defensive guard: should not happen since we always
 *     pass exactly one node, but if the server ever returns an empty
 *     array we'd otherwise emit `nodeId: undefined`.
 */
function makeAdapter(projectId: string) {
  return async function adapter(input: {
    type: 'slm-session';
    payload: QueuedSession;
  }): Promise<{ nodeId: string }> {
    const node = sessionToRiskNodePayload(input.payload);
    const result = await writeNodes([node], { projectId });

    if (!result.ok) {
      throw new Error(
        `writeNodes failed (status=${result.status ?? 'unknown'}): ${result.error ?? 'no error message'}`,
      );
    }
    if (result.queued) {
      // PWA offline-queue fallback — see the failure-modes comment
      // above. Leaving the SLM session pending is the correct retry
      // semantics here.
      throw new Error('writeNodes queued the call (offline) — leaving SLM session pending for retry');
    }
    const nodeId = result.ids?.[0];
    if (!nodeId) {
      throw new Error('writeNodes returned ok but no node id was allocated');
    }
    return { nodeId };
  };
}

/**
 * Drain the offline SLM session queue into the Zettelkasten.
 *
 * This is the production entry point the app shell wires to the
 * `online` event and to a periodic background refresh. Returns the
 * aggregate result so the UI / Sentry breadcrumbs can surface
 * succeed-vs-fail counts without re-deriving them from logs.
 */
export async function runReconciliation(
  opts: RunReconciliationOptions,
): Promise<ReconciliationResult> {
  if (typeof opts?.projectId !== 'string' || opts.projectId.length === 0) {
    throw new Error('runReconciliation: projectId is required');
  }
  return reconcileOfflineSessions({
    zettelkastenWriteFn: makeAdapter(opts.projectId),
  });
}
