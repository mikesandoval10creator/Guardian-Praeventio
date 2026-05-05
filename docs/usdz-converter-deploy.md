# USDZ Converter — Deploy Runbook

Sprint 23 Bucket EE.9.

The `usdz-converter` is an isolated Cloud Run service that wraps Pixar
OpenUSD (`v24.05`) to convert glTF binary (`.glb`) into Apple's ARKit
USDZ package format (`.usdz`). iOS Safari requires `.usdz` for AR Quick
Look; Apple's `usdzconvert` only runs on macOS, so we cannot do this
conversion in-process on serverless Linux. This service exists for the
17 AR markers under `public/models/ar/` (and any future user-uploaded
GLBs).

It mirrors the `dwg-converter` deployment pattern — read `infra/dwg-converter/`
and `docs/architecture-decisions/0008-libredwg-cloud-function-isolation.md`
for the legal / architectural rationale shared between the two services.

> **NOTE** — the OpenUSD compile takes ~30 minutes inside Docker. CI does
> NOT validate this Dockerfile. Treat it as docs-as-code and validate at
> deploy time via the smoke tests below.

## 1. Prerequisites

- A GCP project with Cloud Run, Cloud Build, and Cloud Storage enabled.
- A staging bucket (e.g. `gs://praeventio-ar-usdz`) with:
  - Read+write IAM for the Cloud Run service identity.
  - A 7-day lifecycle rule on the `usdz-staging/` prefix to auto-clean
    intermediate uploads from `scripts/generate-ar-usdz.mjs`.
- A 32+ char random bearer token; store it in Secret Manager as
  `usdz-converter-token`.

## 2. Build the image

```bash
gcloud builds submit infra/usdz-converter/ \
  --tag gcr.io/$PROJECT_ID/usdz-converter:latest \
  --timeout=60m \
  --machine-type=e2-highcpu-32
```

The 60-minute timeout and high-CPU machine are required: OpenUSD's
`build_usd.py --build-monolithic` compiles the entire boost subset plus
USD's own ~1.2 M LOC. Expect 25–45 minutes.

## 3. Deploy to Cloud Run

```bash
gcloud run deploy usdz-converter \
  --image gcr.io/$PROJECT_ID/usdz-converter:latest \
  --region us-central1 \
  --memory 4Gi --cpu 2 \
  --timeout 120 --max-instances 5 \
  --no-allow-unauthenticated \
  --service-account usdz-converter@$PROJECT_ID.iam.gserviceaccount.com \
  --set-secrets "USDZ_CONVERTER_TOKEN=usdz-converter-token:latest"
```

Memory 4 GiB is the sweet spot — USD stages of even small markers can
allocate ~1.5 GiB transiently during the ARKit packager step.

## 4. Smoke test

```bash
URL=$(gcloud run services describe usdz-converter --region us-central1 --format='value(status.url)')
TOKEN=$(gcloud secrets versions access latest --secret=usdz-converter-token)

# Health
curl -s -H "Authorization: Bearer $TOKEN" "$URL/healthz"
# -> {"ok":true,"service":"usdz-converter"}

# End-to-end (pre-load any AR-friendly GLB into your staging bucket first)
curl -s -X POST "$URL/convert" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"inputUri":"gs://praeventio-ar-usdz/test/aed.glb","outputBucket":"praeventio-ar-usdz"}'
```

## 5. Generate the 17 production USDZs

After the service is live, run the build script from a workstation with
ADC for the staging bucket configured:

```bash
export USDZ_CONVERTER_URL="$URL"
export USDZ_CONVERTER_TOKEN="$TOKEN"
export USDZ_STAGING_BUCKET=praeventio-ar-usdz
node scripts/generate-ar-usdz.mjs
```

Re-run with `--force` to overwrite existing `.usdz` files. Commit the
resulting `public/models/ar/*.usdz` artifacts.

## 6. Wire the runtime client

Server-side code (or build scripts) instantiates the adapter via:

```ts
import { UsdzConverter } from '@/services/ar/usdzConverter';

const converter = UsdzConverter.fromEnv(); // null if env vars missing
if (converter) {
  const res = await converter.convertGlbToUsdz(inputUri, outputBucket);
}
```

The `ArQuickLookButton` UI does NOT call this directly — it loads
already-converted assets from `/models/ar/{kind}.usdz` and HEAD-probes
to gracefully hide the button if the file is missing.

## 7. Rotation & rollback

- Token rotation: `gcloud secrets versions add usdz-converter-token --data-file=-`
  followed by another `gcloud run deploy` to pick up the new version.
- Image rollback: deploy a previous tag instead of `:latest`. The
  service is stateless; no migrations.
