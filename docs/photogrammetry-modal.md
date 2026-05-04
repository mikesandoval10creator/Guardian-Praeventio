# Photogrammetry on Modal.run (GPU branch)

This is the **GPU** alternative to the COLMAP-on-Cloud-Run worker (Bucket H).
Use Modal when you want low-ops serverless GPUs with sub-5-minute latency per
video; use COLMAP/Cloud Run when you want predictable cost on steady traffic.

| Dimension              | Modal + Meshroom (GPU)               | Cloud Run + COLMAP (CPU)               |
| ---------------------- | ------------------------------------ | -------------------------------------- |
| Hardware               | A10G, 24 GB VRAM                     | 8 vCPU / 32 GB RAM                     |
| Wall time per ~30 s vid| ~2-5 min                             | ~10-15 min                             |
| Cold start             | ~30 s                                | ~5 s (warm pool)                       |
| Cost (typical job)     | ~$0.10                               | ~$0.40                                 |
| Engine license         | Meshroom (MPL2)                      | COLMAP (BSD)                           |
| Operations footprint   | None — Modal scales to zero          | Manage Cloud Run service + autoscaler  |
| Best for               | Spiky / on-demand                    | Steady throughput                      |

The UI toggle in `DigitalTwinFaena` ("GPU rápido / CPU económico") drives
which adapter the orchestrator selects at submit time. Both adapters
implement the same `PhotogrammetryAdapter` interface — wiring is just env
vars.

## 1. One-time setup

```bash
# 1. Install Modal client and authenticate.
pip install modal
modal token new        # opens browser; stores token in ~/.modal.toml

# 2. Create the auth secret. The TS adapter sends this as Bearer token;
#    the deployed function reads it as MODAL_TOKEN to validate requests.
#    Generate a strong random value once and keep both copies in sync.
modal secret create praeventio-auth MODAL_TOKEN=<paste-strong-random-here>

# 3. (Optional) Create the GCS output bucket if it doesn't exist.
gcloud storage buckets create gs://praeventio-meshes --location=us-central1
```

## 2. Deploy

```bash
cd infra/modal-photogrammetry
modal deploy app.py
```

Modal prints three stable URLs of the form

```
https://<your-workspace>--praeventio-photogrammetry-submit-job.modal.run
https://<your-workspace>--praeventio-photogrammetry-job-status.modal.run
https://<your-workspace>--praeventio-photogrammetry-cancel-job.modal.run
```

Copy them into `.env`:

```env
MODAL_SUBMIT_URL=https://<workspace>--praeventio-photogrammetry-submit-job.modal.run
MODAL_STATUS_URL=https://<workspace>--praeventio-photogrammetry-job-status.modal.run
MODAL_CANCEL_URL=https://<workspace>--praeventio-photogrammetry-cancel-job.modal.run
MODAL_TOKEN=<same-token-you-passed-to-modal-secret-create>
```

## 3. Verify

```bash
# Smoke-test that the function is alive (will return 401 — that's good).
curl -i -X POST $MODAL_SUBMIT_URL -H 'content-type: application/json' -d '{}'

# Authenticated round-trip with a fake video URL — observe 400 (validation).
curl -i -X POST $MODAL_SUBMIT_URL \
  -H "Authorization: Bearer $MODAL_TOKEN" \
  -H 'content-type: application/json' \
  -d '{}'
```

In the app, flip the toggle to "GPU rápido" and submit a job. The adapter
returned by `ModalAdapter.fromEnv()` will be picked. If any of the four
env vars is missing, `fromEnv` returns `null` and the orchestrator falls
back to mock (dev) or COLMAP (prod, if Bucket H is configured).

## 4. Cost & quotas

A10G is billed at $0.000533/sec (Modal's published rate at time of
writing). Typical ~30 s smartphone video → ~180 s of GPU runtime →
**~$0.10/job**. Account-level quota defaults are generous (100
concurrent containers); raise via Modal dashboard if you push past
that on an event.

To put a hard ceiling on runaway costs, set `concurrency_limit=` on the
`@stub.function(...)` decorator inside `app.py`.

## 5. Observability

```bash
# Live logs while a job runs.
modal app logs praeventio-photogrammetry

# Container metrics (CPU/GPU utilisation, memory, container minutes).
# Open https://modal.com/apps/<workspace>/praeventio-photogrammetry
```

Errors raised inside `process_video` propagate to Sentry via the
orchestrator that consumes the failed status — the Modal function itself
re-raises on failure so the stacktrace shows up in `modal app logs`.

## 6. Failure modes & playbook

- **401 Invalid token** — `MODAL_TOKEN` env doesn't match the value passed
  to `modal secret create praeventio-auth`. Re-run the secret command (it
  upserts) and ensure both sides use the same string.
- **404 from getJobStatus** — Modal Dict was wiped (manual operation in
  dashboard) or job was never persisted. Check submit succeeded (jobId
  returned). The TS adapter throws `not found` which the orchestrator
  treats as a permanent failure.
- **Meshroom timeout (750 s inside the function)** — input video is too
  long or too detailed. Reject videos > 60 s upstream, or downscale frames.
- **Cold start hurts UX** — keep one container warm with
  `keep_warm=1` on `process_video`. Costs ~$0.05/hr per warm container.

## 7. Why Meshroom instead of COLMAP on the GPU side?

Both run on GPU; the deciding factor was **license** for the SaaS model.
COLMAP is BSD (no obligations) but slower at default settings; Meshroom
is MPL2 which lets us use it as an internal service without releasing
the rest of Praeventio's source. Meshroom's `meshroom_batch` also
encapsulates the full SfM→meshing→texturing pipeline in one CLI, which
is friendlier to a serverless function that has no persistent state to
chain stages with.

## 8. Local development

You don't need Modal at all in dev. Leave the four env vars empty —
`ModalAdapter.fromEnv()` returns `null` and the orchestrator falls back
to `MockPhotogrammetryAdapter`, which simulates the queued → processing
→ completed cycle with configurable timing. Tests in
`src/services/digitalTwin/photogrammetry/modalAdapter.test.ts` mock
`fetch` directly — no network dependency.

## 9. Coordination with Bucket H (COLMAP CPU)

The two adapters are mutually exclusive at the env-var level: presence of
`MODAL_*` selects GPU, presence of `COLMAP_*` selects CPU. The selector
that lives in `DigitalTwinFaena` (or — once Bucket J unifies the wiring —
in a dedicated `selectPhotogrammetryAdapter` helper) inspects both sets
and chooses based on the user's UI toggle, falling through to mock if
neither is configured. There is no shared state between the two adapters.
