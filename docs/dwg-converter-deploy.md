# DWG Converter — Deploy Runbook (Sprint 21 Bucket Q · verificado 2026-05-26)

The DWG → DXF converter runs as an isolated Cloud Run service so the
GPL-3.0-licensed LibreDWG binary stays scoped to its own image. See
[ADR 0008](./architecture-decisions/0008-libredwg-cloud-function-isolation.md)
for the licensing rationale.

## Prereqs

* `gcloud` CLI authenticated against the Praeventio Guard GCP project.
* `PROJECT_ID` exported in your shell.
* `gcr.io` (or `artifactregistry`) bucket reachable by Cloud Build.
* A GCS bucket for converter outputs (e.g. `praeventio-cad`) with a
  lifecycle rule deleting `*.dxf` after 30 days.
* A service account `dwg-sa@$PROJECT_ID.iam.gserviceaccount.com` with
  `roles/storage.objectAdmin` on the input + output buckets.
* A long random secret for the bearer token. Generate with
  `openssl rand -hex 48` and store in Secret Manager:
  ```bash
  echo -n "$TOKEN" | gcloud secrets create dwg-converter-token --data-file=-
  ```

## 1. Build & push the image

```bash
gcloud builds submit infra/dwg-converter/ \
  --tag gcr.io/$PROJECT_ID/dwg-converter:latest
```

The Dockerfile compiles LibreDWG 0.13.3 from source in a builder stage
(autotools + make -j4, ~6 minutes) and copies only `dwg2dxf` +
`libredwg.so` into the runtime stage. Final image is ~150 MB.

## 2. Deploy Cloud Run gen2 service

```bash
TOKEN=$(gcloud secrets versions access latest --secret=dwg-converter-token)

gcloud run deploy dwg-converter \
  --image gcr.io/$PROJECT_ID/dwg-converter:latest \
  --service-account dwg-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --memory 1Gi --cpu 1 \
  --timeout 300 \
  --max-instances 10 --min-instances 0 \
  --no-allow-unauthenticated \
  --set-env-vars DWG_CONVERTER_TOKEN=$TOKEN \
  --region us-central1
```

Notes:
* `--no-allow-unauthenticated` keeps the service reachable only from
  inside the project; the bearer token is a defense-in-depth layer.
* `--min-instances 0` means we pay nothing while idle. Cold-start is
  ~3s, acceptable because conversion is a foreground operation.
* `--timeout 300` aligns with the gunicorn `--timeout 300` in the
  Dockerfile and the 290s `subprocess.run(timeout=...)` inside
  `server.py` (10s headroom).

## 3. IAM bindings

```bash
# Converter SA needs read on inputs and write on outputs.
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member serviceAccount:dwg-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --role roles/storage.objectAdmin

# Main app SA needs invoke on the converter service.
gcloud run services add-iam-policy-binding dwg-converter \
  --member serviceAccount:praeventio-app-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --role roles/run.invoker \
  --region us-central1
```

## 4. Wire env vars into the main app

```bash
CONVERTER_URL=$(gcloud run services describe dwg-converter \
  --region us-central1 --format='value(status.url)')

gcloud run services update praeventio-app \
  --region us-central1 \
  --update-env-vars \
DWG_CONVERTER_URL=$CONVERTER_URL,\
DWG_CONVERTER_TOKEN=$TOKEN,\
CAD_OUTPUT_BUCKET=praeventio-cad
```

After this the main app's `/api/cad/convert-dwg` route stops returning
503 `dwg_converter_not_configured` and begins proxying real
conversions.

## 5. Smoke test

```bash
# Health check (reachable only from inside the VPC / via auth proxy):
gcloud run services proxy dwg-converter --region us-central1 &
curl -fsS http://localhost:8080/healthz
# {"ok": true, "service": "dwg-converter"}

# End-to-end via the main app (requires a Firebase ID token):
curl -X POST https://praeventio-app-xxx.run.app/api/cad/convert-dwg \
  -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"inputUri":"gs://praeventio-cad/test/sample.dwg"}'
# { "ok": true, "dxfUri": "...", "dxfSignedUrl": "...", "sha256": "..." }
```

## 6. Rotation & teardown

* **Token rotation (every Sprint or on suspected leak):**
  ```bash
  NEW=$(openssl rand -hex 48)
  echo -n "$NEW" | gcloud secrets versions add dwg-converter-token --data-file=-
  gcloud run services update dwg-converter --region us-central1 \
    --update-env-vars DWG_CONVERTER_TOKEN=$NEW
  gcloud run services update praeventio-app --region us-central1 \
    --update-env-vars DWG_CONVERTER_TOKEN=$NEW
  ```
* **Image rebuild (monthly, for LibreDWG / Debian patches):** rerun
  step 1 then `gcloud run services update dwg-converter --image=...`.
* **Teardown:** `gcloud run services delete dwg-converter --region us-central1`.
  Then unset the three env vars on `praeventio-app` to cleanly fall
  back to the 503 `dwg_converter_not_configured` response.

## Cost expectations

* ~$0.00013 per conversion on Cloud Run Gen2 (1 vCPU + 1 GiB, 5s avg).
* GCS storage of converted DXFs: negligible (lifecycle deletes at 30 days).
* See ADR 0008 § "Cost estimate" for the full math.
