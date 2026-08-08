// SPDX-License-Identifier: MIT
// Sprint 17a (initial stub) → Sprint 21 Bucket Q (LibreDWG Cloud Function proxy).
//
// Mounted via `app.use('/api/cad', cadRouter)`.
//
// On-the-wire paths:
//   • POST /api/cad/convert-dwg  — proxies DWG → DXF conversion to an
//     ISOLATED Cloud Run service running LibreDWG (GPL-3.0).
//
// === Why a server-side DWG converter ===
//
// AutoCAD's DWG is a binary, proprietary format. The most popular open
// implementation, GNU LibreDWG, is GPL-3.0 — bundling it into the
// frontend would contaminate the entire client bundle with GPL
// obligations (see ADR 0002). The strategy adopted is:
//
//   1. Frontend stays MIT-only (`dxf-parser` + `@mlightcad/three-renderer`).
//   2. DWG → DXF conversion happens in a separate Cloud Run service
//      (`infra/dwg-converter/`) that bundles LibreDWG. The HTTP boundary
//      keeps GPL contamination scoped to that image — see ADR 0008 for
//      the full legal rationale.
//   3. This route is a thin authenticated proxy: it forwards `inputUri`
//      (a `gs://...` location the client uploaded to via signed URL) to
//      the converter, then returns the resulting DXF signed URL + sha256
//      back to the client.
//
// === Sprint 21 Bucket Q wire-up ===
//
//   • `DWG_CONVERTER_URL`   — Cloud Run service URL (https://...run.app)
//   • `DWG_CONVERTER_TOKEN` — shared bearer secret for service-to-service auth
//   • `CAD_OUTPUT_BUCKET`   — GCS bucket where converted DXF files land
//
// If any of those env vars are missing the route returns 503
// `dwg_converter_not_configured` so health checks and deploy smoke tests
// can detect a misconfigured environment.

import { Router } from 'express';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  validateDwgUpload,
  type DwgValidationInput,
  type DwgValidationFinding,
} from '../../services/cad/dwgDocumentValidator.js';

const router = Router();

interface ConvertDwgBody {
  inputUri?: string;
  filename?: string;
  byteSize?: number;
  declaredKind?: DwgValidationInput['declaredKind'];
  declaredVersion?: string;
  declaredScale?: string;
  projectId?: string;
}

interface ConverterResponse {
  outputUri?: string;
  signedUrl?: string;
  sha256?: string;
  error?: string;
}

// Sprint 50 E.5 P2 H1 — strict GCS URI gate. We only proxy conversions
// for objects uploaded to OUR Praeventio GCS bucket (configurable via
// CAD_INPUT_BUCKET — defaults to the legacy 'praeventio-cad' /
// 'praeventio-cad-upload' buckets). External URIs (http(s)://, other
// gs:// buckets, arbitrary schemes) are rejected at the edge so a
// malicious caller can't coerce the converter into fetching an
// attacker-controlled URL (SSRF / bucket takeover). The regex is
// intentionally conservative: it pins scheme + bucket prefix + path
// must start with the caller's projectId (so cross-project uploads
// cannot piggy-back on someone else's signed URL).
const ALLOWED_INPUT_BUCKET = process.env.CAD_INPUT_BUCKET || 'praeventio-cad-upload';
const ALLOWED_URI_RE = new RegExp(
  `^gs://${ALLOWED_INPUT_BUCKET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(.+)$`
);

/**
 * POST /api/cad/convert-dwg
 *
 * Proxies a DWG → DXF conversion request to the isolated LibreDWG
 * Cloud Run service. The client must have already uploaded the .dwg to
 * Cloud Storage (e.g. via a signed PUT URL) and pass the resulting
 * `gs://bucket/path.dwg` URI here.
 *
 * Sprint 50 E.5 P2 H1 — endpoint now requires full validation metadata
 * (filename, byteSize, declaredKind, projectId). The pre-upload
 * validator (`src/services/cad/dwgDocumentValidator.ts`) runs BEFORE
 * the upstream call to reject malformed metadata at the edge — saves
 * Cloud Run quota and closes the SSRF surface (external URIs).
 *
 * Responses:
 *   • 200 `{ ok: true, dxfUri, dxfSignedUrl, sha256, uploadId, warnings }` on success
 *   • 400 `{ error: 'missing_input_uri' }` if `inputUri` absent
 *   • 400 `{ error: 'external_uri_rejected' }` if inputUri outside our bucket
 *   • 400 `{ error: 'cad_validation_failed', findings }` if metadata invalid
 *   • 401 (from verifyAuth) if the caller is not authenticated
 *   • 502 `{ error: 'converter_failed', status }` on upstream non-2xx
 *   • 502 `{ error: 'converter_unreachable' }` on network failure
 *   • 503 `{ error: 'dwg_converter_not_configured' }` if env not set
 */
router.post('/convert-dwg', verifyAuth, async (req, res) => {
  const body = (req.body ?? {}) as ConvertDwgBody;
  const {
    inputUri,
    filename,
    byteSize,
    declaredKind,
    declaredVersion,
    declaredScale,
    projectId,
  } = body;

  const fnUrl = process.env.DWG_CONVERTER_URL;
  const fnToken = process.env.DWG_CONVERTER_TOKEN;
  const outputBucket = process.env.CAD_OUTPUT_BUCKET;

  if (!fnUrl || !fnToken || !outputBucket) {
    return res.status(503).json({ error: 'dwg_converter_not_configured' });
  }
  if (!inputUri || typeof inputUri !== 'string') {
    return res.status(400).json({ error: 'missing_input_uri' });
  }

  // SSRF gate — only our bucket.
  const bucketMatch = inputUri.match(ALLOWED_URI_RE);
  if (!bucketMatch) {
    return res.status(400).json({ error: 'external_uri_rejected' });
  }

  // Auth-derived uid (verifyAuth guarantees this on a 200 path).
  const uid = (req as { user?: { uid?: string } }).user?.uid ?? '';

  // Pre-upload validation (extension, size, traversal, kind, version,
  // scale, projectId, uid). Sprint 50 E.5 P2 H1 — wired into the
  // endpoint per the ticket.
  const validation = validateDwgUpload({
    filename: filename ?? '',
    byteSize: typeof byteSize === 'number' ? byteSize : 0,
    uploadedByUid: uid,
    projectId: projectId ?? '',
    declaredKind: declaredKind ?? ('' as DwgValidationInput['declaredKind']),
    declaredVersion,
    declaredScale,
  });
  if (!validation.valid) {
    return res.status(400).json({
      error: 'cad_validation_failed',
      findings: validation.findings as DwgValidationFinding[],
    });
  }

  // Defense in depth — the URI path's first segment must match the
  // projectId the caller declared (or the validation step rejects it
  // upstream because uploadedByUid isn't on that project). We compare
  // for symmetry: if the bucket object is at
  // `gs://.../projects/{pid}/uploads/...` and the body says pid=X, X
  // must equal the first non-empty segment.
  const uriPathSegments = bucketMatch[1].split('/').filter(Boolean);
  if (projectId && uriPathSegments[0] && !uriPathSegments[0].startsWith('projects-')
      && !uriPathSegments.includes(projectId)) {
    return res.status(400).json({
      error: 'project_id_uri_mismatch',
      detail: 'URI path does not reference the declared projectId',
    });
  }

  let fnRes: Response;
  try {
    fnRes = await fetch(`${fnUrl.replace(/\/$/, '')}/convert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + fnToken,
      },
      body: JSON.stringify({
        inputUri,
        outputBucket,
        uploadId: validation.sanitizedMetadata.uploadId,
        declaredKind: validation.sanitizedMetadata.declaredKind,
        projectId: validation.sanitizedMetadata.projectId,
      }),
    });
  } catch (err) {
    captureRouteError(err, 'cad.converter_unreachable', { inputUri, uploadId: validation.sanitizedMetadata.uploadId });
    return res
      .status(502)
      .json({ error: 'converter_unreachable', message: process.env.NODE_ENV === 'production' ? undefined : (err as Error).message });
  }

  if (!fnRes.ok) {
    return res
      .status(502)
      .json({ error: 'converter_failed', status: fnRes.status });
  }

  const json = (await fnRes.json()) as ConverterResponse;
  return res.json({
    ok: true,
    dxfUri: json.outputUri,
    dxfSignedUrl: json.signedUrl,
    sha256: json.sha256,
    uploadId: validation.sanitizedMetadata.uploadId,
    warnings: validation.warnings,
  });
});

export default router;
