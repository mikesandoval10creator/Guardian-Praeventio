# /canary — post-deploy monitoring

Run a canary monitoring window after a deploy. Wraps `npm run canary:monitor`
and provides interpretive analysis.

## Usage

```
/canary [duration-minutes] [baseline-sha]
```

- `duration-minutes` — defaults to 30.
- `baseline-sha` — defaults to current `HEAD`.

## What it does

1. Runs `node scripts/canary-monitor.cjs --duration <min> --baseline <sha>`.
2. Reads the markdown report from `reports/canary/<sha>.md`.
3. Interprets the decision:
   - **GREEN** → confirm release health, suggest closing the canary window.
   - **WATCH** → list the metrics that drifted (Sentry ratio, p95 latency).
     Recommend short remediation steps (toggle flag, narrow rollout %).
   - **ROLLBACK** → surface the rollback `gcloud run services update-traffic`
     command and ping the on-call.
   - **UNKNOWN** → call out which probe is missing config (Sentry / gcloud /
     health) and propose remediation.

## Required env

- `SENTRY_API_TOKEN`, `SENTRY_PROJECT_ID` (optional — script degrades to UNKNOWN otherwise).
- `gcloud` CLI authenticated (optional).
- `HEALTH_DEEP_URL` if the production endpoint differs from default.

## Notes

- Script is deliberately non-fatal: missing config → exit 0 with warnings.
- See `docs/runbooks/canary-monitoring.md` for full runbook.
