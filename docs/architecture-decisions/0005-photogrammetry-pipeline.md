# ADR 0005 — Photogrammetry pipeline (Modal GPU primary, Cloud Run COLMAP fallback)

* **Status:** Accepted (Sprint 21 Bucket Λ) — codified retroactively 2026-05-19
* **Date:** 2026-05-19 (retroactive — original implementation Sprint 21–38)
* **Deciders:** Sprint 21 backend WG (Modal adapter), Sprint 38 Brecha C (COLMAP fallback)
* **Related:** ADR 0011 (Digital Twin triple-gate auth — photogrammetry feeds the twin), ADR 0008 (DWG converter — same isolation-via-HTTP-boundary pattern)

## Context

Praeventio Digital Twin needs to turn a worker's smartphone video (or a sequence of stills) of a faena scene into a 3D mesh that the React frontend can render with `<TwinScene />`. Two constraints made this non-trivial:

1. **Compute envelope** — Structure-from-Motion (SfM) workloads are minutes-long, GPU-friendly, and memory-hungry. Running them inline inside our Cloud Run main app would block worker threads for 5–15 minutes per request, blow the request timeout, and force us onto GPU-equipped main-app instances we cannot justify cost-wise (most requests are tiny REST calls).
2. **Library licensing** — The two dominant open-source SfM stacks are:
   * **AliceVision / Meshroom** — MPL-2.0 (compatible with proprietary SaaS use; obligations are file-level, not bundle-level).
   * **COLMAP** — BSD-3-Clause (fully permissive).
   Both are MIT-app-friendly via "mere aggregation" if invoked as a separate subprocess or HTTP service. Neither can be linked into our backend Node bundle without engineering pain (native deps, CUDA toolchain).

We also chose **not** to fold this into the existing `infra/dwg-converter` pattern because:
* DWG conversion is bounded (≤ 30 s, CPU-only); a single Flask + gunicorn container is enough.
* SfM is variance-heavy (180 s GPU vs 10–15 min CPU). We want pay-per-second GPU pricing for the fast path and a budget CPU fallback that doesn't burn money idling.

## Decision

The photogrammetry pipeline is **two services running side by side**, both invoked from the same TypeScript adapter `src/services/digitalTwin/photogrammetry/`:

### 1. Primary — Modal.run serverless GPU (`infra/modal-photogrammetry/app.py`)

* **Engine** — Meshroom 2023.3.0 (MPL-2.0). The full AliceVision SfM/MVS pipeline runs as one Modal function call.
* **Hardware** — A10G (24 GB VRAM). Sweet spot for AliceVision's `DepthMap` step on 4K input.
* **Cost** — ~$0.10 per typical 180 s job (A10G @ $0.000533/sec). 4× cheaper than the Cloud Run COLMAP path at scale.
* **Latency** — ~30 s cold start + ~180 s typical. We accept the cold-start hit because the alternative (a warm GPU pool) costs more than we save.
* **Auth** — `Authorization: Bearer <MODAL_TOKEN>` per request. The token is a Modal-side secret stored in `modal.Secret.from_name('praeventio-auth')` and on our side as the `MODAL_TOKEN` env var.
* **Client** — `src/services/digitalTwin/photogrammetry/modalAdapter.ts`.

### 2. Fallback — Cloud Run COLMAP CPU (`infra/photogrammetry-worker/` Python Flask)

* **Engine** — COLMAP `automatic_reconstructor` (BSD-3-Clause). Same SfM + MVS pipeline, CPU only.
* **Hardware** — Cloud Run CPU-bound container, no GPU. Cost ~$0.40 per typical 10–15 min job.
* **Why it exists** — Modal outages, regions where Modal is restricted, and the local dev story (a developer who can `docker run` the worker on their laptop can iterate without a Modal account). The fallback is also what we point at if a customer flags Modal-the-vendor as a data-residency concern.
* **Auth** — `Authorization: Bearer <PHOTOGRAMMETRY_WORKER_TOKEN>` with constant-time comparison (`hmac.compare_digest`).
* **Client** — `src/services/digitalTwin/photogrammetry/colmapAdapter.ts`.

### 3. Selection logic

`src/services/digitalTwin/photogrammetry/index.ts` exposes a single `submitPhotogrammetryJob()` that picks the adapter based on `PHOTOGRAMMETRY_ENGINE` env var (`modal` default, `colmap` fallback). The two adapters share an interface (`videoUri → jobId`, `jobId → { status, meshUri }`) so the call sites in Digital Twin don't care which engine runs.

### 4. Boundary (mirrors ADR 0008 DWG isolation pattern)

* The main Cloud Run app NEVER imports COLMAP, Meshroom, AliceVision, OpenCV, or any native CV library directly. Communication is HTTPS-only with a single `videoUri` (gs://) in and `meshUri` (gs://) out.
* Both engines run in their own Cloud projects/services and can be redeployed independently of the main app — license review for each engine is scoped to its own image.
* Job records (`tenants/{tenantId}/photogrammetry_jobs/{jobId}`) live in our Firestore. Both engines write status transitions back through `firebase-admin`; the main app polls Firestore (not the engines directly) so cancelled/failed states reach the UI even if the engine container is recycled mid-job.

## Open question — TypeScript variant `cloud-run/photogrammetry-worker/` (Sprint 38 Brecha C)

Sprint 38 added a **second** Cloud Run COLMAP worker at `cloud-run/photogrammetry-worker/src/index.ts`, written in TypeScript on Express. It is currently a near-duplicate of the Python `infra/photogrammetry-worker/server.py` (same COLMAP CLI, same Firestore status writes, same Cloud Run shape). The auth bypass fix in commit `df5cb9e7` (Bloque 1.6) hardened the TypeScript variant; the Python variant already had `hmac.compare_digest`.

Status: **two implementations coexist**. This is technical debt flagged at master plan §8.1 (Bloque 8.1 — "Photogrammetry worker dedup decision"). Either:
* **Option A** — keep the Python variant (`infra/`) as the canonical fallback. Delete the TypeScript variant. Justification: shorter image (no Node runtime), exact mirror of how the engine is invoked from CLI docs.
* **Option B** — keep the TypeScript variant (`cloud-run/`). Delete the Python variant. Justification: language parity with the main app means one less stack for our team to maintain; the Sprint 38 hardened version has structured logs that align with our other Cloud Run services.
* **Option C** — keep both, document one as the active production fallback and the other as the "language reference" / staging variant.

The decision is deferred to Bloque 8.1 in the master plan because it requires (a) a cost/latency benchmark on identical inputs and (b) a check that neither variant is wired into a production cron that the other isn't.

## Consequences

* **Positive** — main app stays MIT-only and free of CUDA/native CV deps. Modal handles GPU autoscaling without us managing a node pool. Costs scale per-job, not per-instance. Failure modes are isolated: Modal outage degrades to slower COLMAP path, not a full Digital Twin outage.
* **Negative** — three implementations exist in-tree (Modal Python, Cloud Run Python, Cloud Run TypeScript), and two engines must be license-reviewed independently when bumped. Modal vendor lock-in on the fast path: replacing Modal means a non-trivial migration to Replicate / RunPod / Banana / a self-hosted Beam stack.
* **Operational** — runbooks at `docs/photogrammetry-modal.md` (Modal deploy) and `cloud-run/photogrammetry-worker/README.md` (Cloud Run COLMAP). Job timeouts: 15 min Modal, 30 min Cloud Run. Jobs older than that are marked stale by the orchestrator.

## Alternatives considered

* **Run COLMAP inside the main Cloud Run app** — rejected per Context #1 (GPU pricing, request-timeout contamination).
* **Use Google Cloud's Vertex AI Vision SfM** — no published Praeventio-compatible API at decision time; revisit when GA.
* **Reality Capture (Epic Games)** — proprietary, per-seat licensing not compatible with B2B SaaS distribution.
* **Embed Meshroom in a Lambda layer** — image size exceeds Lambda's 250 MB unzipped limit; the AliceVision binaries alone are ~600 MB.

## References

* `infra/modal-photogrammetry/app.py` — Modal entrypoint
* `infra/photogrammetry-worker/server.py` — Cloud Run COLMAP (Python, canonical fallback)
* `cloud-run/photogrammetry-worker/src/index.ts` — Cloud Run COLMAP (TypeScript, Sprint 38 duplicate, B1.6-hardened)
* `src/services/digitalTwin/photogrammetry/` — TS adapters consumed by the main app
* `docs/photogrammetry-modal.md` — Modal deploy runbook
* `docs/audits/AUDIT_EXHAUSTIVA_2026-05-19.md` §8.1 — dedup decision deferred
* ADR 0008 — DWG converter (same HTTP-boundary licensing pattern)
* ADR 0011 — Digital Twin triple-gate auth
