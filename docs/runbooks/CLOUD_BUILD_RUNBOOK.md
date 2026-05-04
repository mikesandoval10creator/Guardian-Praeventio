# Cloud Build Runbook — Guardian Praeventio

> Status: Additive. Cloud Build runs **alongside** GitHub Actions
> `deploy.yml`. Either path can ship images; ops decides which to gate on.

## 1. Overview

This document describes the Google Cloud Build pipeline (`cloudbuild.yaml`
at the repo root) and the manual deploy / rollback flow that complements it.

| Path                                 | Trigger                          | Builds | Pushes | Deploys |
|--------------------------------------|----------------------------------|:------:|:------:|:-------:|
| `.github/workflows/deploy.yml`       | `workflow_run` after CI succeeds | yes    | yes    | yes     |
| `cloudbuild.yaml` (this runbook)     | manual `gcloud builds submit`    | yes    | yes    | **no**  |

### When to use each

- **GitHub Actions** — current default. PR-driven, tied to GitHub Actions
  minutes, deploys to `us-central1`.
- **Cloud Build** — preferred when:
  - You need build runners inside the GCP VPC (e.g. private Artifact
    Registry, internal CA bundles).
  - You want to anchor builds in `southamerica-west1` to match data-residency
    commitments (Chile).
  - You want to avoid burning GitHub Actions minutes for slow native-deps
    installs (Capacitor / sqlite / mediapipe).
  - You want fully GCP-native dashboards and IAM (no GitHub<->GCP federation
    required for the build runner).

The two paths produce DIFFERENT image names by design so they cannot
collide in Artifact Registry:

- GH Actions: `us-central1-docker.pkg.dev/praeventio-541ad/guardian-praeventio/guardian-praeventio:<sha>`
- Cloud Build: `southamerica-west1-docker.pkg.dev/<project>/praeventio/api:<sha>` and `.../frontend:<sha>`

## 2. Prereqs (one-time setup)

Run these once per GCP project. Replace `$PROJECT_ID` with your project
(e.g. `praeventio-541ad`).

```bash
# Enable required APIs.
gcloud services enable \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  --project="$PROJECT_ID"

# Create the Artifact Registry repository in southamerica-west1.
gcloud artifacts repositories create praeventio \
  --repository-format=docker \
  --location=southamerica-west1 \
  --description="Guardian Praeventio container images" \
  --project="$PROJECT_ID"

# Grant the Cloud Build service account the roles it needs. Cloud Build
# uses the per-project SA `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`
# by default in 2026 (post the legacy cloudbuild SA migration).
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for ROLE in roles/cloudbuild.builds.builder roles/artifactregistry.writer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${BUILD_SA}" \
    --role="$ROLE"
done
```

## 3. One-shot manual trigger

```bash
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions=_LOCATION=southamerica-west1,_REGION=southamerica-west1 \
  --project="$PROJECT_ID"
```

What it does:

1. `npm ci --legacy-peer-deps`
2. `npm run typecheck:ci`
3. `npm run test:ci -- --reporter=default`
4. `npm run build` (vite)
5. `docker build -f Dockerfile.api ...`
6. `docker build -f Dockerfile.frontend ...`
7. Pushes both images with `:${COMMIT_SHA}` and `:latest` tags.

Wall-clock target: ~5–7 min on `E2_HIGHCPU_8`, dominated by the
mediapipe / three / @huggingface install. The first build per branch will
be slower because there is no `:latest` cache layer to seed `--cache-from`.

### Optional: wire up an automatic trigger later

If you decide to move PR / push triggers from GitHub Actions to Cloud
Build, install the GitHub App once and create a trigger:

```bash
gcloud builds triggers create github \
  --name=praeventio-main \
  --repo-name=Guardian-Praeventio \
  --repo-owner=dahosandoval \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml \
  --region=southamerica-west1 \
  --project="$PROJECT_ID"
```

Until then the pipeline is manual-only.

## 4. Deploy step (separate, manual)

This stays out of `cloudbuild.yaml` on purpose: a misconfigured pipeline
must NEVER auto-deploy to production. You run this by hand once you have
verified the pushed image.

### 4.1 Deploy the API

```bash
SHA=$(gcloud builds list --limit=1 --format='value(substitutions.COMMIT_SHA)' --project="$PROJECT_ID")
LOCATION=southamerica-west1
REGION=southamerica-west1
IMAGE_API="${LOCATION}-docker.pkg.dev/${PROJECT_ID}/praeventio/api:${SHA}"

gcloud run deploy praeventio-api \
  --image="${IMAGE_API}" \
  --region="${REGION}" \
  --platform=managed \
  --port=3000 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10 \
  --no-allow-unauthenticated \
  --service-account="run-praeventio-api@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-env-vars="NODE_ENV=production,KMS_ADAPTER=cloud-kms" \
  --set-secrets="GEMINI_API_KEY=GEMINI_API_KEY:latest,SESSION_SECRET=SESSION_SECRET:latest,RESEND_API_KEY=RESEND_API_KEY:latest,IOT_WEBHOOK_SECRET=IOT_WEBHOOK_SECRET:latest" \
  --project="$PROJECT_ID"
```

### 4.2 Deploy the frontend (only if you split the SPA out)

```bash
IMAGE_FE="${LOCATION}-docker.pkg.dev/${PROJECT_ID}/praeventio/frontend:${SHA}"

gcloud run deploy praeventio-frontend \
  --image="${IMAGE_FE}" \
  --region="${REGION}" \
  --platform=managed \
  --port=8080 \
  --memory=256Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=20 \
  --allow-unauthenticated \
  --project="$PROJECT_ID"
```

> Note: the legacy Express server (`server.ts`) already serves the SPA
> from `/dist`. Splitting the frontend out is optional — you'd typically
> only do it once you put a CDN in front (Cloud CDN / Cloudflare).

### 4.3 Smoke check

```bash
URL=$(gcloud run services describe praeventio-api --region="${REGION}" --format='value(status.url)' --project="$PROJECT_ID")
curl -fsS --max-time 30 "$URL/api/health"
curl -fsS --max-time 30 -o /dev/null -w "root: %{http_code}\n" "$URL/"
```

## 5. Rollback

Every push tags `:${SHA}` AND moves `:latest`. To roll back:

```bash
PREV_SHA=<the commit you want to roll back to>
gcloud run deploy praeventio-api \
  --image="southamerica-west1-docker.pkg.dev/${PROJECT_ID}/praeventio/api:${PREV_SHA}" \
  --region=southamerica-west1 \
  --project="$PROJECT_ID"
```

Cloud Run keeps the previous revision warm; promoting traffic back is
also possible without a re-deploy:

```bash
gcloud run services update-traffic praeventio-api \
  --to-revisions=PREVIOUS_REVISION_NAME=100 \
  --region=southamerica-west1 \
  --project="$PROJECT_ID"
```

To find revision names:

```bash
gcloud run revisions list --service=praeventio-api --region=southamerica-west1 --project="$PROJECT_ID"
```

## 6. Cost estimate

Cloud Build pricing (2026, `southamerica-west1`, `E2_HIGHCPU_8`): around
USD 0.016 per build-minute (verify against the official page below — GCP
adjusts pricing periodically and South American regions occasionally
carry a small premium over `us-central1`).

A typical 6-minute pipeline therefore costs roughly **USD 0.10 per build**.

A high-traffic week (~50 builds) ≈ USD 5. A typical month ≈ USD 15–25.

Add Artifact Registry storage (≈ USD 0.10 / GB / month — two images,
~600 MB combined, with retention of last 20 SHAs ≈ 12 GB ≈ USD 1.20 / month).

Authoritative pricing: <https://cloud.google.com/build/pricing>

## 7. Trade-offs vs `.github/workflows/deploy.yml`

### Pros of Cloud Build

- Build runs inside GCP, can reach private VPC resources without WIF
  contortions.
- No GitHub Actions minutes consumption (helpful when GH minutes cap is
  a concern at the Free / Team tier).
- Logs and metrics flow to Cloud Logging / Cloud Monitoring — same place
  Cloud Run runtime logs land.
- Region-anchored in `southamerica-west1` (Chile) — relevant for
  data-residency narratives with regulated customers.
- IAM is GCP-native: easier to grant `roles/artifactregistry.writer` than
  to set up Workload Identity Federation for a GitHub repo.

### Cons of Cloud Build

- More IAM glue per project (build SA + Artifact Registry + Cloud Run
  deploy SA + Secret Manager accessor).
- Separate dashboard from PR checks — devs need to remember to look at
  Cloud Build console.
- No PR auto-trigger out of the box. The GitHub App install adds a
  per-PR check but is *additional* setup; default install gives main-branch
  triggers only.
- Local emulation is harder than a GitHub Actions runner (no `act`
  equivalent that perfectly matches Cloud Build's environment).
- `:latest`-based caching is weaker than GH Actions' `cache: 'npm'`
  (Cloud Build has no first-class npm cache step in this config — we lean
  on Docker layer caching instead).

## 8. Operational invariants

- `cloudbuild.yaml` does **not** contain a deploy step. Do not add one
  without ops sign-off — see the recurring "must NEVER auto-deploy"
  comment at the top of the file.
- `.github/workflows/deploy.yml` must remain functional. Cloud Build is
  additive until ops decides to retire one path.
- Every change to `Dockerfile.api`, `Dockerfile.frontend`, or
  `cloudbuild.yaml` should be smoke-tested with a manual
  `gcloud builds submit` before merging to main.
- Image tags are immutable per SHA; `:latest` floats and is only suitable
  for cache hints — never deploy `:latest` to production.

## 9. Known deviations from the textbook spec

- The API container does **not** run `node dist/server/index.js`. The
  project uses `tsx server.ts` at runtime (no separate API compile step
  exists). `Dockerfile.api` keeps the dependency tree containing `tsx`
  and runs it via `node ./node_modules/tsx/dist/cli.mjs server.ts`.
- The frontend container does **not** declare `USER nginx`. The base
  `nginx:alpine` image already drops worker processes to the `nginx`
  user via the main `user` directive; switching the *container* user
  breaks `/var/cache/nginx` writes. See
  <https://github.com/nginxinc/docker-nginx/issues/660>.
- nginx security headers omit a strict `script-src` CSP. Sentry and
  Firebase load scripts cross-origin and we do not yet emit per-request
  CSP nonces. `frame-ancestors 'none'` and the rest of the conservative
  set still apply.
