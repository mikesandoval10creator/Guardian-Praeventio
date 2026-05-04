# Photogrammetry worker — deployment runbook (COLMAP / Cloud Run)

Open-source photogrammetry worker for the Digital Twin module. Ingests a
video from Cloud Storage, runs the COLMAP CPU pipeline, uploads a GLB
back to the same bucket, returns a v4 signed URL valid 7 days.

| Property | Value |
| --- | --- |
| Engine | COLMAP 3.7 (BSD-3-Clause) |
| Mesher | Open3D Poisson (depth 9) |
| Output | binary GLB (Three.js / R3F friendly) |
| Auth | `Authorization: Bearer <PHOTOGRAMMETRY_WORKER_TOKEN>` |
| Latency | ~10-15 min for a 30s 1080p clip (CPU-only) |
| Cost | ~$0.66 per job @ 8 GiB / 4 vCPU / 600 s |

The TS adapter lives in
`src/services/digitalTwin/photogrammetry/colmapAdapter.ts` and is wired
into `DigitalTwinFaena.tsx` when both `PHOTOGRAMMETRY_WORKER_URL` and
`PHOTOGRAMMETRY_WORKER_TOKEN` env vars are set; otherwise the page falls
back to the mock adapter.

## 1. One-time IAM setup

```bash
# Create dedicated service account for the worker.
gcloud iam service-accounts create photogrammetry-sa \
  --display-name="Photogrammetry worker"

# Grant access to the bucket where videos and meshes live.
# The bucket itself is created by the main app; storage.objectAdmin is
# enough — no need for storage.admin (we never create/delete buckets).
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member serviceAccount:photogrammetry-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --role roles/storage.objectAdmin

# Required so generate_signed_url() can sign without a JSON keyfile.
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member serviceAccount:photogrammetry-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --role roles/iam.serviceAccountTokenCreator

# Generate the shared secret the API and worker use to authenticate.
TOKEN=$(openssl rand -hex 32)
echo "$TOKEN" | gcloud secrets create photogrammetry-worker-token --data-file=-
```

Save `$TOKEN` somewhere safe (Secret Manager UI). The same value goes
into `PHOTOGRAMMETRY_WORKER_TOKEN` for the Cloud Run worker AND the API
backend that calls it.

## 2. Build the image

```bash
cd "D:/Guardian Praeventio/repo"

gcloud builds submit infra/photogrammetry-worker/ \
  --tag gcr.io/$PROJECT_ID/photogrammetry-worker:latest
```

First build is slow (~8 min) because of `apt install colmap` and
`pip install open3d`. Subsequent builds reuse cached layers.

## 3. Deploy to Cloud Run

```bash
gcloud run deploy photogrammetry-worker \
  --image gcr.io/$PROJECT_ID/photogrammetry-worker:latest \
  --region us-central1 \
  --memory 8Gi \
  --cpu 4 \
  --timeout 1800 \
  --max-instances 3 \
  --min-instances 0 \
  --concurrency 1 \
  --no-allow-unauthenticated \
  --service-account photogrammetry-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --set-secrets PHOTOGRAMMETRY_WORKER_TOKEN=photogrammetry-worker-token:latest
```

Notes:
- `--concurrency 1`: each pipeline saturates 4 vCPU; sharing a container
  between two jobs would just thrash the cache.
- `--max-instances 3`: cap the cost ceiling. Bump if the queue grows.
- `--min-instances 0`: cold-start is fine, jobs are never <60 s anyway.
- `--no-allow-unauthenticated`: bearer token + IAM both apply.

Grab the URL Cloud Run prints back — it goes into the API backend env
vars as `PHOTOGRAMMETRY_WORKER_URL`.

## 4. Wire into the API backend

The TS adapter (`colmapAdapter.ts`) reads two env vars:

```bash
PHOTOGRAMMETRY_WORKER_URL=https://photogrammetry-worker-xxx.run.app
PHOTOGRAMMETRY_WORKER_TOKEN=<the same TOKEN from step 1>
```

Set these on the API runtime (Cloud Run app or Functions). When both
are present, `ColmapAdapter.fromEnv()` returns a real adapter; if either
is missing the Digital Twin page falls back to the mock adapter and the
"Vista previa" badge stays on.

## 5. Local smoke test

```bash
# Start the worker locally (requires colmap/ffmpeg/python3 installed).
cd infra/photogrammetry-worker
PHOTOGRAMMETRY_WORKER_TOKEN=local-test python3 server.py
```

Then from another shell:

```bash
curl -X POST http://localhost:8080/jobs \
  -H "Authorization: Bearer local-test" \
  -H "Content-Type: application/json" \
  -d '{"videoUri":"gs://my-bucket/path/video.mp4","projectId":"proj-1"}'
```

For pure logic tests without GCS, point `videoUri` at a local file via a
custom build that bypasses `_download_video` — see `colmapAdapter.test.ts`
for the TS-side fetch mock pattern.

## 6. Cost & sizing

| Knob | Default | Effect |
| --- | --- | --- |
| `--cpu 4` | 4 | More CPUs ~= linear speedup until I/O-bound at ~6. |
| `--memory 8Gi` | 8 | `patch_match_stereo` peaks ~5 GiB on a 30s clip. Bump to 16 for >60s clips. |
| `--max-instances 3` | 3 | $0.66 × 3 = $1.98 worst-case concurrent. |
| `fps=1` in `run-pipeline.sh` | 1 | Halve to 0.5 for static scenes; double to 2 for dynamic. |

A 30s clip at 1 fps = 30 frames → ~600 s pipeline → $0.66.
A 60s clip at 1 fps = 60 frames → ~1500 s pipeline → ~$1.65.

For GPU-accelerated alternative (5x faster, ~$0.20 per job) see
**Bucket I — Modal.run worker**.

## 7. Observability

- Cloud Run logs include the per-stage `[pipeline] stage X/9` lines.
- Failed jobs end with a Python traceback in stdout.
- The TS client surfaces `errorMessage` to the UI as a toast + sets the
  job status badge to red.

## 8. Failure modes & mitigation

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `ERROR: need >= 5 frames` | Video shorter than 5 s at 1 fps | Bump `fps=2` in `run-pipeline.sh` |
| `sparse reconstruction produced no model` | Static camera, low parallax | Ask user for re-take with translation movement |
| 503 from `_check_auth` | Token env var missing | Set `PHOTOGRAMMETRY_WORKER_TOKEN` |
| 7-day signed URL expires | Long inspection cycle | Re-sign on demand via a new endpoint (TODO) |
