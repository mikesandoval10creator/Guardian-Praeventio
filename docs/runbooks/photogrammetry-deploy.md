# Photogrammetry Worker — Cloud Run Deploy Runbook

Sprint 38, Brecha C closure. This runbook covers manual deployment of the
COLMAP photogrammetry worker that lives at
[`cloud-run/photogrammetry-worker/`](../../cloud-run/photogrammetry-worker/).

The worker is the GCP-native sibling of the Modal.com path
(`src/services/digitalTwin/photogrammetry/modalAdapter.ts`). The local COLMAP
adapter (`src/services/digitalTwin/photogrammetry/colmapAdapter.ts`) already
speaks this worker's HTTP contract, so once deployed the orchestration code
needs no changes — only env vars.

## Prerequisites

- `gcloud` CLI authenticated against the Praeventio GCP project
  (`gcloud auth login` + `gcloud config set project <PROJECT_ID>`).
- Artifact Registry repo `praeventio` exists in region `southamerica-west1`.
  Create with:
  ```bash
  gcloud artifacts repositories create praeventio \
    --repository-format=docker \
    --location=southamerica-west1
  ```
- GCS output bucket `praeventio-photogrammetry` (or override
  `_OUTPUT_BUCKET` in `cloudbuild.yaml`).
- Secret Manager secret `photogrammetry-worker-token` populated with a long
  random string. Used for service-to-service auth between the API server
  (`src/server/routes/photogrammetry.ts`) and the worker.

## Deploy

From the repo root:

```bash
cd cloud-run/photogrammetry-worker
gcloud builds submit --config cloudbuild.yaml .
```

Expected timing: ~5-10 min for the multi-stage build (the COLMAP base layer
is ~2 GB).

The Cloud Build pipeline does three steps:

1. `docker build` — multi-stage; pulls `colmap/colmap:latest` and copies the
   binary into a `node:22-slim` runtime.
2. `docker push` — to Artifact Registry.
3. `gcloud run deploy` — with `--cpu=4 --memory=8Gi --timeout=1800
   --concurrency=1 --max-instances=5 --no-allow-unauthenticated`.

## Wire up the API server

Set on the API service (Cloud Run `praeventio-api` or equivalent):

```
PHOTOGRAMMETRY_WORKER_URL=https://photogrammetry-worker-<hash>-rj.a.run.app
PHOTOGRAMMETRY_WORKER_TOKEN=<from-secret-manager>
PHOTOGRAMMETRY_OUTPUT_BUCKET=praeventio-photogrammetry
```

When all three are set, `POST /api/photogrammetry/jobs` will dispatch new
jobs to the worker. When any is missing, the route still returns 201 with
`worker: 'not_configured'` and the job stays `queued` for later pickup.

## Smoke test

```bash
TOKEN=$(gcloud auth print-identity-token)
WORKER_URL=https://photogrammetry-worker-<hash>-rj.a.run.app
curl -H "Authorization: Bearer $TOKEN" "$WORKER_URL/health"
# -> { "ok": true, "service": "photogrammetry-worker", "version": "0.1.0" }
```

## Cost estimate

Per job (CPU-only, ~50 frames @ 1080p):

| Concept              | Cost (USD)    |
|----------------------|---------------|
| Cloud Run compute    | 0.05 – 0.10   |
| GCS storage (mesh)   | < 0.001       |
| Network egress       | < 0.01        |
| **Total per job**    | **~ 0.10**    |

Anchored to `DIGITAL_TWIN_GPU_FREE_PLAN.md` §5.3 (Phase C2). Stays under
the USD 50/mo cap at <500 jobs/mo. For higher throughput route to Modal
(GPU) instead — `modalAdapter.ts` already handles that path.

## Troubleshooting

| Symptom                                | Likely cause                                       | Fix                                                                |
|----------------------------------------|----------------------------------------------------|--------------------------------------------------------------------|
| `colmap: command not found` in logs    | Stage-1 copy missed the binary path                | Verify `colmap/colmap:latest` still ships `/usr/local/bin/colmap`. |
| Worker returns 401 on every request    | `PHOTOGRAMMETRY_WORKER_TOKEN` mismatch             | Re-sync the secret on both API and worker services.                |
| Job stuck in `queued`                  | API can't reach worker (URL unset)                 | Check `PHOTOGRAMMETRY_WORKER_URL` on the API service.              |
| `colmap_exit_1` in Firestore           | Insufficient memory or images don't overlap        | Bump `--memory` to 16Gi, or capture more images with overlap.      |
| Cloud Run 504 timeout                  | Job exceeded `--timeout=1800`                      | Reduce image count or split into two jobs.                         |
| `failed_precondition` from Firestore   | Missing composite index on `photogrammetry_jobs`   | Add index `(tenantId asc, status asc, createdAt desc)`.            |

## Rollback

```bash
gcloud run services update-traffic photogrammetry-worker \
  --region southamerica-west1 \
  --to-revisions <previous-revision-name>=100
```

Cloud Run keeps the last 10 revisions by default, so rollback is reversible
within ~30 s.
