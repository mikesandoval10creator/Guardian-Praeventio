// SPDX-License-Identifier: MIT
//
// COLMAP photogrammetry adapter — Cloud Run worker over HTTP.
//
// Wraps the worker defined in `infra/photogrammetry-worker/` (Dockerfile
// + Flask server). The worker exposes:
//
//   POST   /jobs              -> 202 { jobId, status: 'queued' }
//   GET    /jobs/{jobId}      -> 200 { jobId, status, meshUri?, errorMessage?, createdAt, completedAt? }
//   POST   /jobs/{jobId}/cancel -> 204
//
// All endpoints require `Authorization: Bearer <PHOTOGRAMMETRY_WORKER_TOKEN>`.
//
// In dev, env vars are usually missing; `ColmapAdapter.fromEnv()` returns
// null and the page should fall back to the mock adapter so the UI stays
// alive without a deployed worker.
//
// IMPORTANT: this adapter never holds the worker token in client bundles —
// it is meant to be called from the API backend (Cloud Functions / Cloud
// Run app), which then surfaces sanitized status to the browser. The
// browser never sees PHOTOGRAMMETRY_WORKER_TOKEN.

import type {
  PhotogrammetryAdapter,
  PhotogrammetryJobInput,
  PhotogrammetryJobResult,
  PhotogrammetryJobStatus,
} from './types';

export interface ColmapAdapterConfig {
  /** Base URL of the Cloud Run worker, e.g. https://photogrammetry-worker-xxx.run.app */
  workerUrl: string;
  /** Shared bearer token. NEVER ship this to the browser. */
  token: string;
  /**
   * Optional fetch impl override (for tests). Defaults to global `fetch`.
   * Typed as `typeof fetch` so vi.fn() can stand in transparently.
   */
  fetchImpl?: typeof fetch;
  /**
   * Polling interval for `waitForJob`. Default 10 s — matches typical
   * COLMAP stage transitions (frame extraction, matching, mapping).
   */
  pollIntervalMs?: number;
}

/** Shape of the worker's `/jobs/<id>` response. Aligns with server.py. */
interface WorkerJobResponse {
  jobId: string;
  status: PhotogrammetryJobStatus;
  createdAt: number;
  completedAt: number | null;
  meshUri: string | null;
  errorMessage: string | null;
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 1_800_000; // 30 min — matches Cloud Run --timeout 1800

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export class ColmapAdapter implements PhotogrammetryAdapter {
  readonly engine = 'colmap' as const;

  private readonly workerUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;

  constructor(config: ColmapAdapterConfig) {
    if (!config.workerUrl) {
      throw new Error('ColmapAdapter: workerUrl is required');
    }
    if (!config.token) {
      throw new Error('ColmapAdapter: token is required');
    }
    this.workerUrl = trimTrailingSlash(config.workerUrl);
    this.token = config.token;
    // Bind fetch to globalThis so it doesn't lose `this` when called from
    // node/undici. Tests pass vi.fn() which doesn't need binding.
    const provided = config.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
    if (!provided) {
      throw new Error('ColmapAdapter: no fetch implementation available');
    }
    this.fetchImpl = config.fetchImpl ?? provided.bind(globalThis);
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  /**
   * Build an adapter from `process.env`. Returns null when either env
   * var is missing — caller should fall back to the mock adapter.
   *
   * Reads from `process.env` (server-side / Vite SSR). Vite client
   * builds expose `import.meta.env.VITE_*` instead — but we deliberately
   * do NOT read VITE_ vars here because the worker token must NEVER
   * land in the browser bundle.
   */
  static fromEnv(): ColmapAdapter | null {
    const env = (typeof process !== 'undefined' && process.env) ? process.env : {};
    const url = env.PHOTOGRAMMETRY_WORKER_URL;
    const token = env.PHOTOGRAMMETRY_WORKER_TOKEN;
    if (!url || !token) return null;
    return new ColmapAdapter({ workerUrl: url, token });
  }

  private authHeader(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  async submitJob(input: PhotogrammetryJobInput): Promise<{ jobId: string }> {
    const res = await this.fetchImpl(`${this.workerUrl}/jobs`, {
      method: 'POST',
      headers: this.authHeader(),
      body: JSON.stringify({
        videoUri: input.videoUri,
        projectId: input.projectId,
      }),
    });
    if (!res.ok) {
      const text = await this.safeText(res);
      throw new Error(`ColmapAdapter.submitJob: worker returned ${res.status} ${text}`);
    }
    const body = (await res.json()) as { jobId?: string };
    if (!body.jobId) {
      throw new Error('ColmapAdapter.submitJob: worker response missing jobId');
    }
    return { jobId: body.jobId };
  }

  async getJobStatus(jobId: string): Promise<PhotogrammetryJobResult> {
    const res = await this.fetchImpl(`${this.workerUrl}/jobs/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      headers: this.authHeader(),
    });
    if (!res.ok) {
      const text = await this.safeText(res);
      throw new Error(`ColmapAdapter.getJobStatus: worker returned ${res.status} ${text}`);
    }
    const body = (await res.json()) as WorkerJobResponse;
    return this.mapResponse(body);
  }

  async cancelJob(jobId: string): Promise<void> {
    const res = await this.fetchImpl(
      `${this.workerUrl}/jobs/${encodeURIComponent(jobId)}/cancel`,
      {
        method: 'POST',
        headers: this.authHeader(),
      },
    );
    // Worker returns 204 on success, 404 when the job is unknown — both
    // acceptable from the caller's perspective (no-op semantics).
    if (!res.ok && res.status !== 404) {
      const text = await this.safeText(res);
      throw new Error(`ColmapAdapter.cancelJob: worker returned ${res.status} ${text}`);
    }
  }

  async waitForJob(
    jobId: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<PhotogrammetryJobResult> {
    const startedAt = Date.now();
    let lastError: unknown = null;
    while (Date.now() - startedAt < timeoutMs) {
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
        // Transient worker hiccup — keep polling, but remember the error
        // for the timeout message if we never recover.
        lastError = err;
      }
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
    const suffix = lastError ? ` (last error: ${String(lastError)})` : '';
    throw new Error(
      `ColmapAdapter.waitForJob: timed out after ${timeoutMs}ms for job ${jobId}${suffix}`,
    );
  }

  private mapResponse(body: WorkerJobResponse): PhotogrammetryJobResult {
    return {
      jobId: body.jobId,
      status: body.status,
      createdAt: body.createdAt,
      completedAt: body.completedAt ?? undefined,
      meshUri: body.meshUri ?? undefined,
      meshFormat: body.meshUri ? 'glb' : undefined,
      errorMessage: body.errorMessage ?? undefined,
      engine: 'colmap',
    };
  }

  private async safeText(res: Response): Promise<string> {
    try {
      return (await res.text()).slice(0, 200);
    } catch {
      return '';
    }
  }
}
