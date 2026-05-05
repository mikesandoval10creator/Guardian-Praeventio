// SPDX-License-Identifier: MIT
// Sprint 23 Bucket EE.5 — USDZ converter client adapter.
//
// Talks to the isolated `usdz-converter` Cloud Run service (see
// infra/usdz-converter/) which wraps Pixar OpenUSD's glTF -> USDZ
// pipeline. Apple `usdzconvert` only runs on macOS, so we cannot do
// this in-process; the converter lives in its own image.
//
// This adapter is the same shape the DWG adapter uses (see
// src/services/cad/dwgAdapter.ts) and is only invoked from server-side
// code or build-time scripts (`scripts/generate-ar-usdz.mjs`). It does
// NOT mint signed URLs or talk to GCS directly — that is the converter
// service's job.
//
// Env vars (consumed via fromEnv()):
//   USDZ_CONVERTER_URL    https://usdz-converter-xxx.a.run.app
//   USDZ_CONVERTER_TOKEN  bearer token shared with the service

export interface UsdzConvertResult {
  ok: boolean;
  /** `gs://bucket/path.usdz` of the converted artifact. */
  outputUri?: string;
  /** Pre-signed v4 GET URL valid for 7 days. */
  signedUrl?: string;
  /** sha256 hex of the produced .usdz. */
  sha256?: string;
  /** Stable error code prefix, e.g. `unauthorized`, `convert_failed`, `network`. */
  error?: string;
  /** Server stderr / extra detail when `error === 'convert_failed'`. */
  detail?: string;
}

interface ServerResponse {
  ok?: boolean;
  outputUri?: string;
  signedUrl?: string;
  sha256?: string;
  error?: string;
  message?: string;
  stderr?: string;
}

/** Default conversion timeout — matches the converter's 120 s envelope. */
const CONVERT_TIMEOUT_MS = 2 * 60 * 1000;

export class UsdzConverter {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Build an instance from environment variables. Returns null if either
   * `USDZ_CONVERTER_URL` or `USDZ_CONVERTER_TOKEN` is missing — the
   * caller is expected to gracefully no-op in that case (build script
   * skips, runtime route returns 503 disabled).
   */
  static fromEnv(
    env: NodeJS.ProcessEnv | Record<string, string | undefined> = (typeof process !== 'undefined'
      ? process.env
      : {}),
    fetchImpl: typeof fetch = fetch,
  ): UsdzConverter | null {
    const url = env.USDZ_CONVERTER_URL;
    const token = env.USDZ_CONVERTER_TOKEN;
    if (!url || !token) return null;
    // Strip trailing slash so callers can pass either form.
    const base = url.endsWith('/') ? url.slice(0, -1) : url;
    return new UsdzConverter(base, token, fetchImpl);
  }

  /**
   * POST /convert with the GCS URI of an already-uploaded `.glb`. The
   * service downloads the GLB, runs OpenUSD, uploads the resulting
   * `.usdz`, and returns the gs:// URI plus a 7-day signed URL.
   *
   * Never throws — always resolves to a {ok, error?} envelope so
   * callers (build script + runtime route) can decide whether to
   * surface a user-facing message or skip.
   */
  async convertGlbToUsdz(
    inputUri: string,
    outputBucket: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<UsdzConvertResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? CONVERT_TIMEOUT_MS);

    try {
      const res = await this.fetchImpl(`${this.baseUrl}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ inputUri, outputBucket }),
        signal: ctrl.signal,
      });

      let body: ServerResponse | null = null;
      try {
        body = (await res.json()) as ServerResponse;
      } catch {
        body = null;
      }

      if (!res.ok) {
        return {
          ok: false,
          error: body?.error ?? `http_${res.status}`,
          detail: body?.stderr ?? body?.message,
        };
      }

      if (!body || !body.outputUri || !body.signedUrl || !body.sha256) {
        return { ok: false, error: 'missing_fields' };
      }

      return {
        ok: true,
        outputUri: body.outputUri,
        signedUrl: body.signedUrl,
        sha256: body.sha256,
      };
    } catch (err) {
      // AbortError -> timeout. TypeError on fetch -> network error.
      const code =
        (err as { name?: string } | undefined)?.name === 'AbortError'
          ? 'timeout'
          : 'network';
      return {
        ok: false,
        error: code,
        detail: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
