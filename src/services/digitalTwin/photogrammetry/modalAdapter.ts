// SPDX-License-Identifier: MIT
//
// Modal.run photogrammetry adapter — Brecha C, GPU branch.
//
// This is the client-side counterpart of `infra/modal-photogrammetry/app.py`.
// The Python file is deployed to Modal.run with `modal deploy app.py`, which
// produces three stable HTTPS endpoints (submit / status / cancel). This
// adapter implements `PhotogrammetryAdapter` by calling them with a Bearer
// token.
//
// Why Modal vs Cloud Run? See `docs/photogrammetry-modal.md`. TL;DR: Modal
// gives serverless GPUs (A10G, ~4x faster than COLMAP CPU) at $0.10/job
// without operating an autoscaler. Cold start is ~30 s, so for steady traffic
// Cloud Run + COLMAP (Bucket H) is cheaper; for spiky usage Modal wins.
//
// Auth: every request carries `Authorization: Bearer <MODAL_TOKEN>`. The
// token is provisioned in the Modal dashboard and stored as a Modal Secret
// named `praeventio-auth`; clients additionally need it as `MODAL_TOKEN`
// env var on whatever server is calling this adapter.
//
// Notes for testing:
// - All HTTP calls go through the injected `fetchImpl` (default `fetch`),
//   so tests can mock without touching globals.
// - `Date.now()` is read through the injected `clock` (default `() => Date.now()`)
//   so timeout/poll tests are deterministic.
// - We never throw on transient HTTP errors during polling — instead they
//   surface as the next `getJobStatus` rejection. `waitForJob` retries.

import type {
  MeshFormat,
  PhotogrammetryAdapter,
  PhotogrammetryEngine,
  PhotogrammetryJobInput,
  PhotogrammetryJobResult,
  PhotogrammetryJobStatus,
} from './types';

export interface ModalAdapterConfig {
  /** HTTPS POST endpoint that accepts `PhotogrammetryJobInput`-shaped JSON. */
  submitUrl: string;
  /** HTTPS GET endpoint that takes `?jobId=` and returns `PhotogrammetryJobResult`. */
  statusUrl: string;
  /** HTTPS POST endpoint that accepts `{ jobId }` to mark cancellation. */
  cancelUrl?: string;
  /** Bearer token. Provisioned in Modal dashboard. NEVER ship in client bundles. */
  token: string;
  /** Optional override for testing. */
  fetchImpl?: typeof fetch;
  /** Optional override for testing. */
  clock?: () => number;
  /** Polling interval for `waitForJob`. Default 2000 ms (Modal job runs ~3 min). */
  pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_WAIT_TIMEOUT_MS = 15 * 60 * 1000; // 15 min — matches server-side limit

/**
 * Modal.run + Meshroom adapter. Routes photogrammetry jobs to a serverless
 * GPU pool exposed via three HTTPS endpoints.
 */
export class ModalAdapter implements PhotogrammetryAdapter {
  // The server-side engine is Meshroom; we expose `'meshroom'` so consumers
  // can distinguish the engine even though the CHANNEL is Modal.
  readonly engine: PhotogrammetryEngine = 'meshroom';

  private readonly submitUrl: string;
  private readonly statusUrl: string;
  private readonly cancelUrl?: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => number;
  private readonly pollIntervalMs: number;

  constructor(config: ModalAdapterConfig) {
    if (!config.submitUrl) throw new Error('ModalAdapter: submitUrl required');
    if (!config.statusUrl) throw new Error('ModalAdapter: statusUrl required');
    if (!config.token) throw new Error('ModalAdapter: token required');
    this.submitUrl = config.submitUrl;
    this.statusUrl = config.statusUrl;
    this.cancelUrl = config.cancelUrl;
    this.token = config.token;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.clock = config.clock ?? (() => Date.now());
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  /**
   * Build an adapter from environment variables, or return null if any of the
   * required vars is missing. Caller decides whether to fall back to mock.
   *
   * Required:
   *   MODAL_SUBMIT_URL
   *   MODAL_STATUS_URL
   *   MODAL_TOKEN
   * Optional:
   *   MODAL_CANCEL_URL  (recommended — without it, cancelJob is a no-op)
   */
  static fromEnv(env: Record<string, string | undefined> = process.env): ModalAdapter | null {
    const submitUrl = env.MODAL_SUBMIT_URL;
    const statusUrl = env.MODAL_STATUS_URL;
    const cancelUrl = env.MODAL_CANCEL_URL;
    const token = env.MODAL_TOKEN;
    if (!submitUrl || !statusUrl || !token) return null;
    return new ModalAdapter({ submitUrl, statusUrl, cancelUrl, token });
  }

  async submitJob(input: PhotogrammetryJobInput): Promise<{ jobId: string }> {
    // The server validates these too, but we fail fast client-side.
    if (!input.videoUri) throw new Error('ModalAdapter.submitJob: videoUri required');
    if (!input.projectId) throw new Error('ModalAdapter.submitJob: projectId required');
    if (!input.userId) throw new Error('ModalAdapter.submitJob: userId required');

    const res = await this.fetchImpl(this.submitUrl, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        videoUri: input.videoUri,
        projectId: input.projectId,
        userId: input.userId,
        outputFormat: input.outputFormat ?? 'glb',
        geoAnchor: input.geoAnchor,
        videoMeta: input.videoMeta,
      }),
    });
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(`ModalAdapter.submitJob HTTP ${res.status}: ${detail}`);
    }
    const body = (await res.json()) as { jobId?: string };
    if (!body.jobId) {
      throw new Error('ModalAdapter.submitJob: server returned no jobId');
    }
    return { jobId: body.jobId };
  }

  async getJobStatus(jobId: string): Promise<PhotogrammetryJobResult> {
    if (!jobId) throw new Error('ModalAdapter.getJobStatus: jobId required');
    const url = appendQuery(this.statusUrl, { jobId });
    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: this.headers(),
    });
    if (res.status === 404) {
      throw new Error(`ModalAdapter: job ${jobId} not found`);
    }
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(`ModalAdapter.getJobStatus HTTP ${res.status}: ${detail}`);
    }
    const body = (await res.json()) as Partial<PhotogrammetryJobResult>;
    return normaliseStatus(body, jobId);
  }

  async cancelJob(jobId: string): Promise<void> {
    if (!jobId) throw new Error('ModalAdapter.cancelJob: jobId required');
    if (!this.cancelUrl) {
      // Cancellation endpoint not deployed — no-op. The Modal worker will
      // continue to completion, but the result will be discarded by the
      // orchestrator on next poll.
      return;
    }
    const res = await this.fetchImpl(this.cancelUrl, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jobId }),
    });
    // Treat 404 as already-gone (matches Mock semantics).
    if (res.status === 404) return;
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(`ModalAdapter.cancelJob HTTP ${res.status}: ${detail}`);
    }
  }

  async waitForJob(
    jobId: string,
    timeoutMs: number = DEFAULT_WAIT_TIMEOUT_MS,
  ): Promise<PhotogrammetryJobResult> {
    const startedAt = this.clock();
    // First-shot fast path — many polls returning the SAME state is wasteful.
    let lastErr: unknown;
    while (this.clock() - startedAt < timeoutMs) {
      try {
        const result = await this.getJobStatus(jobId);
        if (
          result.status === 'completed' ||
          result.status === 'failed' ||
          result.status === 'cancelled'
        ) {
          return result;
        }
      } catch (err) {
        // Transient — keep polling. Persist last error in case we time out.
        lastErr = err;
      }
      await sleep(this.pollIntervalMs);
    }
    if (lastErr) {
      throw new Error(
        `ModalAdapter.waitForJob timed out after ${timeoutMs}ms; last error: ${String(lastErr)}`,
      );
    }
    throw new Error(`ModalAdapter.waitForJob timed out after ${timeoutMs}ms for job ${jobId}`);
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
  }
}

/** Factory mirroring the mock adapter's shape. */
export function createModalAdapter(config: ModalAdapterConfig): PhotogrammetryAdapter {
  return new ModalAdapter(config);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function appendQuery(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  return u.toString();
}

async function safeReadText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 500); // cap leakage to logs
  } catch {
    return '<no body>';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const VALID_STATUSES: ReadonlySet<PhotogrammetryJobStatus> = new Set<PhotogrammetryJobStatus>([
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled',
]);

const VALID_FORMATS: ReadonlySet<MeshFormat> = new Set<MeshFormat>(['gltf', 'glb', 'obj', 'ply']);

function normaliseStatus(
  body: Partial<PhotogrammetryJobResult>,
  fallbackJobId: string,
): PhotogrammetryJobResult {
  const status =
    body.status && VALID_STATUSES.has(body.status as PhotogrammetryJobStatus)
      ? (body.status as PhotogrammetryJobStatus)
      : ('queued' as PhotogrammetryJobStatus);
  const meshFormat =
    body.meshFormat && VALID_FORMATS.has(body.meshFormat as MeshFormat)
      ? (body.meshFormat as MeshFormat)
      : undefined;
  return {
    jobId: body.jobId ?? fallbackJobId,
    status,
    createdAt: typeof body.createdAt === 'number' ? body.createdAt : Date.now(),
    completedAt: typeof body.completedAt === 'number' ? body.completedAt : undefined,
    meshUri: status === 'completed' ? body.meshUri : undefined,
    meshFormat,
    meshSizeBytes: typeof body.meshSizeBytes === 'number' ? body.meshSizeBytes : undefined,
    errorMessage: status === 'failed' ? body.errorMessage : undefined,
    engine: 'meshroom',
    metrics: status === 'completed' ? body.metrics : undefined,
  };
}
