# File ledger — I-BUILD (132 files)

Mechanical per-file extraction (purpose = file's own header comment; exports from source). Part of the file-by-file context audit.

| Archivo | Bloque | LOC | Test | Propósito / exports |
|---|---|---:|:--:|---|
| `.claude/settings.json` |  | 17 |  |  |
| `.dockerignore` |  |  |  |  |
| `.env.example` |  |  |  |  |
| `.gcloudignore` |  |  |  |  |
| `.gitattributes` |  |  |  |  |
| `.github/workflows/check-mobile-signing.yml` |  | 126 |  | Fails the build if `public/.well-known/assetlinks.json` or |
| `.github/workflows/ci.yml` |  | 222 |  | Global safety cap (2026-05-29): a flaky vitest hang previously ran to |
| `.github/workflows/codeql.yml` |  | 109 |  | For most projects, this workflow file will not need changing; you simply need |
| `.github/workflows/deploy.yml` |  | 282 |  | H16: alineado con cloudbuild.yaml (data residency Chile, Ley 19.628) |
| `.github/workflows/dr-dryrun.yml` |  | 110 |  | Sprint 35 — Brecha del usuario: |
| `.github/workflows/e2e.yml` |  | 156 |  | --with-deps installs system libs needed on Ubuntu runner |
| `.github/workflows/firestore-backup.yml` |  | 120 |  | Bucket W.1 — Sprint 22 prod hardening. |
| `.github/workflows/loadtest.yml` |  | 60 |  | SOS 1k load test — manual trigger only. |
| `.github/workflows/mobile-build-check.yml` |  | 89 |  | Sprint 20 Brecha A — Capacitor mobile preparation. |
| `.github/workflows/mobile-release.yml` |  | 253 |  | Sprint 21 Ola 6 — Bucket S (Android) |
| `.github/workflows/mutation.yml` |  | 79 |  | Sprint 39 (Fase B.1) — promoted to **required check** by removing |
| `.github/workflows/ossar.yml` |  | 57 |  | This workflow uses actions that are not certified by GitHub. |
| `.github/workflows/perf.yml` |  | 68 |  | 2026-05-15 estabilización CI: `andresz1/size-limit-action@v1` |
| `.github/workflows/prepackage-slm.yml` | B14-IA | 105 |  | Sprint 54 release pipeline. Runs the script that downloads, verifies, |
| `.github/workflows/smoke.yml` |  | 23 |  |  |
| `.gitignore` |  |  |  |  |
| `.husky/pre-commit` |  |  |  |  |
| `.mcp.json` |  | 9 |  |  |
| `.npmrc` |  |  |  |  |
| `.size-limit.json` |  | 63 |  |  |
| `.telemetry/current-state.yaml` | B7-Salud | 106 |  | Current State: Guardian Praeventio tracking inventory |
| `.telemetry/proposed-events.yaml` | B7-Salud | 474 |  | Proposed events — machine-readable manifest. |
| `bin/mcp-server.mjs` |  | 134 |  |  |
| `cloudbuild.yaml` |  | 121 |  | Guardian Praeventio — Google Cloud Build configuration. |
| `Dockerfile` |  |  |  |  |
| `Dockerfile.api` |  |  |  |  |
| `Dockerfile.frontend` |  |  |  |  |
| `eslint.config.js` |  | 134 |  | Praeventio Guard — ESLint flat config (ESLint 9+). |
| `firebase-applet-config.json` | B3-Ergonomia | 10 |  |  |
| `firebase-blueprint.json` | B3-Ergonomia | 385 |  |  |
| `firebase.emulator-tests.json` | B3-Ergonomia | 12 |  |  |
| `firebase.json` | B3-Ergonomia | 37 |  |  |
| `firestore.indexes.json` |  | 598 |  |  |
| `firestore.rules` |  | 1183 |  | Role identifiers (admin/gerente/supervisor/medico_ocupacional/worker/etc.) |
| `Gemfile` |  |  |  |  |
| `infra/dwg-converter/Dockerfile` |  |  |  |  |
| `infra/dwg-converter/server.py` |  |  |  |  |
| `infra/modal-photogrammetry/app.py` |  |  |  |  |
| `infra/photogrammetry-worker/Dockerfile` |  |  |  |  |
| `infra/photogrammetry-worker/ply-to-glb.py` |  |  |  |  |
| `infra/photogrammetry-worker/poisson-mesh.py` | B16-Offline |  |  |  |
| `infra/photogrammetry-worker/run-pipeline.sh` |  | 97 |  |  |
| `infra/photogrammetry-worker/server.py` |  |  |  |  |
| `infra/usdz-converter/Dockerfile` |  |  |  |  |
| `infra/usdz-converter/glb_to_usdz.py` |  |  |  |  |
| `infra/usdz-converter/server.py` |  |  |  |  |
| `infrastructure/cloud-scheduler.yaml` |  | 207 |  | ============================================================================= |
| `infrastructure/terraform/.gitignore` |  |  |  |  |
| `infrastructure/terraform/cloudrun.tf` |  |  |  |  |
| `infrastructure/terraform/dashboards/business.json` | B18-Analitica | 180 |  |  |
| `infrastructure/terraform/dashboards/operational.json` | B18-Analitica | 234 |  |  |
| `infrastructure/terraform/example.tfvars` |  |  |  |  |
| `infrastructure/terraform/iam.tf` |  |  |  |  |
| `infrastructure/terraform/kms.tf` |  |  |  |  |
| `infrastructure/terraform/main.tf` |  |  |  |  |
| `infrastructure/terraform/monitoring.tf` |  |  |  |  |
| `infrastructure/terraform/outputs.tf` |  |  |  |  |
| `infrastructure/terraform/scheduler.tf` |  |  |  |  |
| `infrastructure/terraform/secrets.tf` |  |  |  |  |
| `infrastructure/terraform/storage.tf` |  |  |  |  |
| `infrastructure/terraform/variables.tf` |  |  |  |  |
| `infrastructure/terraform/versions.tf` |  |  |  |  |
| `lighthouserc.json` |  | 37 |  |  |
| `metadata.json` |  | 6 |  |  |
| `nginx.conf` |  | 72 |  | Guardian Praeventio — minimal nginx site config for the static SPA image. |
| `package-lock.json` |  | 36228 |  |  |
| `package.json` |  | 228 |  |  |
| `playwright.config.ts` |  | 122 |  | _exports:_ default |
| `scripts/analyze-coverage.cjs` |  | 35 |  |  |
| `scripts/any-ratchet-baseline.json` |  | 102 |  |  |
| `scripts/audit-coverage-census.cjs` |  | 197 |  |  |
| `scripts/backfill_bcn_norma_id.cjs` |  | 206 |  |  |
| `scripts/backup-firestore.cjs` |  | 259 |  |  |
| `scripts/biorender-references.json` |  | 45 |  |  |
| `scripts/canary-monitor.cjs` |  | 200 |  |  |
| `scripts/check-any-ratchet.cjs` |  | 170 |  |  |
| `scripts/check-convention-guard.cjs` |  | 176 |  |  |
| `scripts/check-coverage-ratchet.cjs` |  | 148 |  |  |
| `scripts/check-frozen.cjs` |  | 78 |  |  |
| `scripts/check-mutation-thresholds.cjs` |  | 229 |  |  |
| `scripts/cli/praeventio.mjs` |  | 348 |  |  |
| `scripts/compute-slm-sha256.mjs` | B14-IA | 140 |  |  |
| `scripts/convention-guard-baseline.json` |  | 34 |  |  |
| `scripts/convert-to-webp.mjs` |  | 127 |  |  |
| `scripts/coverage-floors.json` |  | 11 |  |  |
| `scripts/debug_browser.mjs` |  | 30 |  |  |
| `scripts/download-mediapipe-models.mjs` | B14-IA | 274 |  | _exports:_ downloadIfMissing, main, MODELS, sha256File |
| `scripts/download-slm-model.mjs` | B14-IA | 192 |  |  |
| `scripts/dr-failover.sh` |  | 116 |  |  |
| `scripts/dr-simulate.sh` |  | 108 |  |  |
| `scripts/fill-android-assetlinks.mjs` | B10-EPP | 298 |  | _exports:_ parseArgs, extractSha256, applyFingerprint, validateAssetlinks, runKeytool, main |
| `scripts/fill-ios-aasa.mjs` |  | 204 |  | _exports:_ parseArgs, applyTeamId, validateAasa, main |
| `scripts/firestore-pentest.mjs` |  | 66 |  |  |
| `scripts/fix-mojibake.mjs` |  | 221 |  |  |
| `scripts/generate-ar-models.mjs` |  | 229 |  |  |
| `scripts/generate-ar-usdz.mjs` |  | 151 |  |  |
| `scripts/generate-medical-icons.mjs` | B7-Salud | 282 |  |  |
| `scripts/generateZettelkastenMarkdown.ts` |  | 53 |  | One-shot generator for ZETTELKASTEN_V2_NODES_FULL.md from family registries. |
| `scripts/i18n-parity-baseline.json` | B12-CPHS | 69 |  |  |
| `scripts/migrate-auth-headers.mjs` | B17-Admin | 218 |  | §2.20 migration script (2026-05-21). |
| `scripts/migrate-oauth-tokens-to-envelope.cjs` | B17-Admin | 190 |  |  |
| `scripts/pinecone-bootstrap.mjs` |  | 173 |  |  |
| `scripts/ply_to_glb.py` |  |  |  |  |
| `scripts/precommit-allowbackup-guard.cjs` |  | 105 |  |  |
| `scripts/precommit-medical-guard.cjs` | B7-Salud | 172 |  |  |
| `scripts/precommit-stub-guard.cjs` |  | 121 |  |  |
| `scripts/prepackage-slm-models.mjs` | B14-IA | 384 |  |  |
| `scripts/reconstruct_faena.py` |  |  |  |  |
| `scripts/render-well-known.mjs` |  | 108 |  |  |
| `scripts/restore-firestore.cjs` |  | 219 |  |  |
| `scripts/retro-weekly.cjs` |  | 402 |  |  |
| `scripts/rotate-secrets.sh` |  | 84 |  |  |
| `scripts/secrets-bootstrap.sh` |  | 86 |  |  |
| `scripts/security-review.cjs` |  | 174 |  |  |
| `scripts/test-backup-integrity.cjs` |  | 239 |  |  |
| `scripts/test-mobile-pipeline.sh` |  | 98 |  |  |
| `scripts/validate-env.cjs` |  | 321 |  |  |
| `scripts/validate-i18n.cjs` |  | 155 |  |  |
| `scripts/verify-roles-sync.cjs` |  | 310 |  | _exports:_ ADMIN_ROLES, SUPERVISOR_ROLES, DOCTOR_ROLES, WORKER_ROLES, ALL_ROLES, AdminRole, isAdminRole |
| `storage.rules` |  | 164 |  | Praeventio Guard — Sprint 39 Fase D.6: Storage rules estrictas. |
| `stryker.config.json` |  | 43 |  |  |
| `tsconfig.json` |  | 42 |  |  |
| `vite.config.ts` |  | 362 |  | _exports:_ default |
| `vitest.config.ts` |  | 94 |  | _exports:_ default |
| `vitest.dr.config.ts` |  | 35 |  | Praeventio Guard — Sprint 35 DR dry-run. |
| `vitest.firestore.config.ts` |  | 68 |  | _exports:_ default |
| `vitest.rules.config.ts` |  | 43 |  | _exports:_ default |
