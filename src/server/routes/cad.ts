// SPDX-License-Identifier: MIT
// Sprint 17a — CAD conversion endpoints.
//
// Mounted via `app.use('/api/cad', cadRouter)`.
//
// On-the-wire paths:
//   • POST /api/cad/convert-dwg  — STUB (Sprint 18 will wire ODA File Converter)
//
// === Why a server-side DWG converter ===
//
// AutoCAD's DWG is a binary, proprietary format. The most popular open
// implementation, GNU LibreDWG, is GPL-3.0 — bundling it into the
// frontend would contaminate the entire client bundle with GPL
// obligations (see ADR 0002). The strategy adopted in Sprint 17a is:
//
//   1. Frontend stays MIT-only (`dxf-parser` + `@mlightcad/three-renderer`).
//   2. DWG → DXF conversion happens on the server, using the **ODA File
//      Converter** binary distributed by the Open Design Alliance. ODA File
//      Converter is closed-source but free, and we never ship it to the
//      client — it runs as a child process on our deploy image only.
//   3. Frontend uploads `multipart/form-data` to `POST /api/cad/convert-dwg`,
//      gets back the converted DXF as `text/plain`, and renders that with
//      its existing pipeline.
//
// === Sprint 18 production wire-up plan (NOT in this stub) ===
//
//   • Deploy image: a Cloud Run service with the ODA File Converter binary
//     baked in (Debian package or extracted tarball under /opt/oda).
//   • `min-instances=0` so we pay nothing while idle; cold-start is fine
//     because conversion is a foreground operation the user is already
//     waiting on.
//   • Implementation: stream uploaded DWG to /tmp, invoke
//     `child_process.spawn('/opt/oda/ODAFileConverter', [inDir, outDir,
//     'ACAD2018', 'DXF', '0', '1'])`, read the converted DXF back, stream
//     to client, then `fs.unlink` both files.
//   • Limit: 50 MB upload + 30 s timeout per conversion (matches our
//     existing rate-limit envelope on /api/processes).
//   • Auth: `verifyAuth` + `assertProjectMember` since blueprints are
//     project-confidential.
//
// This file ships only the auth + stub-501 plumbing so the route exists
// and the typecheck is green; the spawn() invocation lands in Sprint 18.

import { Router } from 'express';
import { verifyAuth } from '../middleware/verifyAuth.js';

const router = Router();

/**
 * POST /api/cad/convert-dwg
 *
 * STUB — returns 501 Not Implemented. The real implementation arrives in
 * Sprint 18 once the deploy image bakes in ODA File Converter. See file
 * header for the full plan.
 *
 * Request: `multipart/form-data` with a single `file` field containing
 * the DWG payload (max 50 MB).
 *
 * Future response (Sprint 18): `text/plain; charset=utf-8` containing the
 * converted DXF source.
 *
 * Current response (Sprint 17a): JSON `{ error, message, sprint }`.
 */
router.post('/convert-dwg', verifyAuth, (_req, res) => {
  res.status(501).json({
    error: 'not_implemented',
    message: 'DWG conversion coming Sprint 18',
    sprint: 18,
  });
});

export default router;
