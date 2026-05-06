# photogrammetry-worker (Cloud Run)

Sprint 38 — Brecha C closure: deployable Cloud Run worker for COLMAP
photogrammetry. Consumed by `src/server/routes/photogrammetry.ts` via Cloud
Tasks. The local `colmapAdapter.ts` already speaks this worker's contract.

## Endpoints

- `GET  /health`
- `POST /process` — body `{ projectId, jobId, imageUrls, outputBucket, tenantId? }`
- `GET  /jobs/:jobId?tenantId=...`

## Deploy

See [`docs/runbooks/photogrammetry-deploy.md`](../../docs/runbooks/photogrammetry-deploy.md).

## Notes

- This worker is **not** part of the repo `tsconfig` build. It has its own
  `package.json` and `tsconfig.json` and ships as a standalone container.
- COLMAP runs CPU-only here. For GPU jobs, route via the Modal adapter.
