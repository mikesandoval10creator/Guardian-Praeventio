# Canary monitoring runbook

Post-deploy monitoring for Praeventio Cloud Run services. Replicates the
behaviour of `gstack /canary` as a local pirate artefact (no toolkit install).

## When to run

Right after every prod deploy (`gcloud run services replace ...`), and any
time you ship a hotfix to `main`. Suggested window: 30 minutes.

## How to run

```bash
# Default: 30-min window, baseline = current HEAD
npm run canary:monitor

# Custom window + explicit baseline sha
node scripts/canary-monitor.cjs --duration 45 --baseline abc1234
```

The slash-command wrapper `/canary` does the same plus interpretive analysis.

## Configuration

The script is informative-non-fatal. Missing config produces a clear warning
and a `UNKNOWN` decision; it never blocks CI.

### Sentry (recommended)

Set in your shell or `.env`:

```bash
export SENTRY_API_TOKEN="<token-with-project:read>"
export SENTRY_ORG="praeventio"
export SENTRY_PROJECT_ID="<numeric-id-or-slug>"
```

Token must have `project:read` scope. Generate at
`https://sentry.io/settings/account/api/auth-tokens/`.

### Cloud Run (recommended)

Authenticated `gcloud` CLI on the host machine:

```bash
gcloud auth login
gcloud config set project praeventio
export CLOUD_RUN_SERVICE="praeventio-api"
export CLOUD_RUN_REGION="southamerica-west1"
```

### Health endpoint

```bash
export HEALTH_DEEP_URL="https://api.praeventio.com/api/health/deep"
```

Defaults to `https://praeventio-api.run.app/api/health/deep`.

## Decision matrix

| Errors vs baseline | p95 latency delta | Outcome |
| --- | --- | --- |
| > 2x | any | `ROLLBACK` |
| 1.5x — 2x | any | `WATCH` |
| any | > +30% | `WATCH` |
| stable / down | <= +30% | `GREEN` |
| no data | n/a | `UNKNOWN` |

The baseline is "same time-of-day, 7 days ago" so weekly traffic patterns do
not skew comparison.

## Rollback procedure (when DECISION = ROLLBACK)

1. Identify the previous stable revision:
   ```bash
   gcloud run revisions list --service praeventio-api --region southamerica-west1
   ```
2. Shift 100% of traffic back:
   ```bash
   gcloud run services update-traffic praeventio-api \
     --to-revisions=<PREVIOUS_REVISION>=100 \
     --region southamerica-west1
   ```
3. Re-run `npm run canary:monitor` to confirm error rate normalises.
4. File a Sentry-linked incident note in `docs/runbooks/INCIDENT_RESPONSE.md`.

## Output

Human-readable terminal output plus a markdown report at
`reports/canary/<sha>.md`. Reports are append-only and safe to commit if you
want a historical audit trail (currently gitignored — verify before committing).

## Brand / UX note

If you build a future dashboard on top of these reports, follow the brand
palette: teal `#4db6ac` (primary, per `user_color_preferences`), petroleum,
gold `#d4af37`. Coral is alerts only.
