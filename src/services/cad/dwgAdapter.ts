// SPDX-License-Identifier: MIT
// Sprint 21 Bucket Q — DWG client-side adapter.
//
// Bridges the AutoCAD viewer's "user uploaded a .dwg" flow to the
// server-side LibreDWG conversion proxy. The actual conversion runs in
// an ISOLATED Cloud Run service (see ADR 0008 + infra/dwg-converter/);
// this module never imports any GPL-3.0 code, only fetches the DXF
// produced by the converter and feeds it into the existing MIT-only
// `dxf-parser` + `dxfAdapter` pipeline.
//
// Flow:
//   1. Frontend asks the backend for a signed PUT URL targeting a
//      project-private bucket.
//   2. Frontend uploads the raw .dwg bytes via PUT (single-shot, no
//      multipart — limit ≈ 100 MB matches the converter cap).
//   3. Frontend POSTs to /api/cad/convert-dwg with the resulting
//      `gs://...` URI.
//   4. Backend proxies to the LibreDWG service, returns
//      { dxfSignedUrl, sha256 }.
//   5. Frontend GETs the DXF text and hands it to `dxf-parser` via the
//      caller's existing parsing pipeline.
//
// This adapter does NOT parse the DXF — it deliberately stops at the
// DXF text so the caller can reuse `dxfAdapter.adaptEntities()` and the
// renderer wired in Sprint 17a/b.

/** Signed PUT URL contract returned by the backend (mirrors the
 *  `/api/cad/upload-url` endpoint planned for the same Sprint). */
export interface DwgUploadTicket {
  /** PUT here with body = .dwg bytes, header Content-Type: application/octet-stream. */
  uploadUrl: string;
  /** `gs://bucket/path/file.dwg` — pass to /convert-dwg as inputUri. */
  inputUri: string;
}

export interface DwgConversionResult {
  /** Plain-text DXF body, ready for `dxf-parser`. */
  dxfText: string;
  /** `gs://bucket/path/file.dxf` of the converted artifact. */
  dxfUri: string;
  /** sha256 hex of the converted DXF, useful for caching/integrity. */
  sha256: string;
}

interface ConvertResponse {
  ok: boolean;
  dxfUri?: string;
  dxfSignedUrl?: string;
  sha256?: string;
  error?: string;
}

/** Default upload timeout — matches the converter's 100 MB / 5 min envelope. */
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Upload a DWG file blob to the signed PUT URL the backend provided.
 * Throws `Error` with a stable code prefix on failure so the caller can
 * surface a useful message to the user.
 */
export async function uploadDwgToSignedUrl(
  ticket: DwgUploadTicket,
  file: Blob,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetchImpl(ticket.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`dwg_upload_failed:${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call the backend `/api/cad/convert-dwg` proxy with the GCS URI of an
 * already-uploaded .dwg, then fetch the resulting DXF body. Returns
 * everything the caller needs to feed into the MIT-only viewer.
 *
 * `apiBase` defaults to '' so the call is same-origin in production;
 * tests inject a baseURL to point at the express test app.
 */
export async function convertDwgToDxf(
  inputUri: string,
  opts: {
    apiBase?: string;
    /** Bearer / Firebase ID token forwarded to /api/cad/*. */
    authToken?: string;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<DwgConversionResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.apiBase ?? '';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.authToken) headers.Authorization = `Bearer ${opts.authToken}`;

  const proxyRes = await fetchImpl(`${base}/api/cad/convert-dwg`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ inputUri }),
  });

  if (!proxyRes.ok) {
    let serverError: string | undefined;
    try {
      const j = (await proxyRes.json()) as ConvertResponse;
      serverError = j.error;
    } catch {
      /* ignore JSON parse */
    }
    throw new Error(
      `dwg_proxy_failed:${proxyRes.status}${serverError ? `:${serverError}` : ''}`
    );
  }

  const json = (await proxyRes.json()) as ConvertResponse;
  if (!json.dxfSignedUrl || !json.dxfUri || !json.sha256) {
    throw new Error('dwg_proxy_missing_fields');
  }

  // 5. Fetch the DXF body itself. The signed URL is a direct
  //    storage.googleapis.com link; no auth header needed.
  const dxfRes = await fetchImpl(json.dxfSignedUrl);
  if (!dxfRes.ok) {
    throw new Error(`dxf_fetch_failed:${dxfRes.status}`);
  }
  const dxfText = await dxfRes.text();

  return {
    dxfText,
    dxfUri: json.dxfUri,
    sha256: json.sha256,
  };
}

/**
 * One-shot helper for the AutoCADViewer: takes a Blob the user dropped
 * onto the viewer, plus a previously-issued upload ticket, and returns
 * the DXF text ready to be parsed.
 *
 * The caller is responsible for obtaining `ticket` from the backend
 * (e.g. `/api/cad/upload-url?ext=dwg`) — that endpoint is project-aware
 * and applies `assertProjectMember`, so we keep it out of this pure
 * client adapter.
 */
export async function uploadAndConvertDwg(
  file: Blob,
  ticket: DwgUploadTicket,
  opts: {
    apiBase?: string;
    authToken?: string;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<DwgConversionResult> {
  await uploadDwgToSignedUrl(ticket, file, opts.fetchImpl);
  return convertDwgToDxf(ticket.inputUri, opts);
}
