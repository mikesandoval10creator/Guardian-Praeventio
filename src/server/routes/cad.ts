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

const router = Router();

interface ConvertDwgBody {
  inputUri?: string;
}

interface ConverterResponse {
  outputUri?: string;
  signedUrl?: string;
  sha256?: string;
  error?: string;
}

/**
 * POST /api/cad/convert-dwg
 *
 * Proxies a DWG → DXF conversion request to the isolated LibreDWG
 * Cloud Run service. The client must have already uploaded the .dwg to
 * Cloud Storage (e.g. via a signed PUT URL) and pass the resulting
 * `gs://bucket/path.dwg` URI here.
 *
 * Responses:
 *   • 200 `{ ok: true, dxfUri, dxfSignedUrl, sha256 }` on success
 *   • 400 `{ error: 'missing_input_uri' }` if `inputUri` absent
 *   • 401 (from verifyAuth) if the caller is not authenticated
 *   • 502 `{ error: 'converter_failed', status }` on upstream non-2xx
 *   • 503 `{ error: 'dwg_converter_not_configured' }` if env not set
 */
router.post('/convert-dwg', verifyAuth, async (req, res) => {
  const { inputUri } = (req.body ?? {}) as ConvertDwgBody;

  const fnUrl = process.env.DWG_CONVERTER_URL;
  const fnToken = process.env.DWG_CONVERTER_TOKEN;
  const outputBucket = process.env.CAD_OUTPUT_BUCKET;

  if (!fnUrl || !fnToken || !outputBucket) {
    return res.status(503).json({ error: 'dwg_converter_not_configured' });
  }
  if (!inputUri || typeof inputUri !== 'string') {
    return res.status(400).json({ error: 'missing_input_uri' });
  }

  let fnRes: Response;
  try {
    fnRes = await fetch(`${fnUrl.replace(/\/$/, '')}/convert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fnToken}`,
      },
      body: JSON.stringify({ inputUri, outputBucket }),
    });
  } catch (err) {
    return res
      .status(502)
      .json({ error: 'converter_unreachable', message: (err as Error).message });
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
  });
});

export default router;
