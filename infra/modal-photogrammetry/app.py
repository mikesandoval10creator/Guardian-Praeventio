# SPDX-License-Identifier: MIT
#
# Modal.run serverless GPU adapter for Praeventio Digital Twin photogrammetry.
#
# This file is the SERVER-SIDE counterpart of
# `src/services/digitalTwin/photogrammetry/modalAdapter.ts`. It is deployed to
# Modal.run's serverless infrastructure with a single command:
#
#     modal deploy app.py
#
# Modal then exposes two stable HTTPS endpoints (one POST submit, one GET
# status) with auto-scaling A10G GPUs and pay-per-second billing. The TS
# adapter calls these endpoints with a Bearer token. There is no other
# server to maintain.
#
# Engine:  Meshroom 2023.3.0 (MPL2 license — OK for internal SaaS use, no
#          obligation to release proprietary code that merely *uses* it).
# Hardware: A10G (24 GB VRAM) — sweet spot for AliceVision/Meshroom CUDA SfM.
# Timeout: 900 s (15 min) per job — videos > ~60 s should be rejected upstream.
# Memory:  16 GiB — Meshroom's `DepthMap` step is RAM-hungry on 4K input.
#
# Cost model: A10G @ $0.000533/sec × ~180s typical = ~$0.10/job. Compare to
# Cloud Run COLMAP CPU (~$0.40/job, 10-15 min). Trade-off: GPU is 4x faster
# and 4x cheaper at scale, but Modal cold-starts (~30 s) hurt occasional
# usage; Cloud Run keeps a warm pool.
#
# Deploy / iterate:
#     pip install modal
#     modal token new                    # one-time, stores token in ~/.modal.toml
#     cd infra/modal-photogrammetry
#     modal deploy app.py                # prints the two stable URLs
#     modal app logs praeventio-photogrammetry   # tail
#
# After `modal deploy` Modal prints two URLs of the form:
#     https://<workspace>--praeventio-photogrammetry-submit-job.modal.run
#     https://<workspace>--praeventio-photogrammetry-job-status.modal.run
# Copy them into MODAL_SUBMIT_URL / MODAL_STATUS_URL in `.env` (see
# `.env.example` and `docs/photogrammetry-modal.md`).
#
# Auth: every request must carry `Authorization: Bearer <MODAL_TOKEN>`.
# MODAL_TOKEN is a project-specific secret you generate in the Modal dashboard
# (Settings → Tokens → "Create token") and store as a Modal Secret named
# `praeventio-auth`. The function reads it via `modal.Secret.from_name(...)`.

import json
import os
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

import modal
from modal import Image, Stub, gpu, web_endpoint

# ---------------------------------------------------------------------------
# Image: Debian slim + Meshroom precompiled binary + GCS client.
# ---------------------------------------------------------------------------
# Meshroom releases a Linux x64 tarball that bundles all of AliceVision
# (the actual SfM/MVS engine), so we don't need to compile from source. We
# symlink `meshroom_batch` into PATH so it can be invoked without an absolute
# path. Meshroom's CUDA dependencies (libnvinfer, etc.) are loaded at runtime
# from the host driver Modal exposes when `gpu=` is set.
image = (
    Image.debian_slim(python_version="3.11")
    .apt_install(
        "wget",
        "build-essential",
        "ffmpeg",        # frame extraction from input video
        "libgomp1",      # OpenMP for AliceVision
        "libgl1-mesa-glx",  # Meshroom GUI deps that the headless build still links
        "libglib2.0-0",
    )
    .run_commands(
        # Meshroom precompiled (Linux x64). MPL2 license — see infra README.
        "wget -q https://github.com/alicevision/Meshroom/releases/download/"
        "v2023.3.0/Meshroom-2023.3.0-linux.tar.gz -O /tmp/meshroom.tar.gz",
        "tar -xzf /tmp/meshroom.tar.gz -C /opt/",
        "ln -s /opt/Meshroom-2023.3.0/meshroom_batch /usr/local/bin/meshroom_batch",
        "rm /tmp/meshroom.tar.gz",
    )
    .pip_install(
        "google-cloud-storage>=2.10",
        "fastapi[standard]>=0.110",
        "requests>=2.31",
    )
)

stub = Stub("praeventio-photogrammetry")

# ---------------------------------------------------------------------------
# Job state — persisted in a Modal Dict (key/value store, durable across
# function invocations). We use this instead of Firestore to keep the
# infra self-contained: the TS adapter polls Modal directly. If you prefer
# central observability through Firestore, swap this for a `firestore.Client()`
# and keep the same JSON shape.
# ---------------------------------------------------------------------------
job_states: modal.Dict = modal.Dict.from_name(
    "praeventio-photogrammetry-jobs",
    create_if_missing=True,
)

# Auth secret. Create with: `modal secret create praeventio-auth MODAL_TOKEN=<value>`
auth_secret = modal.Secret.from_name("praeventio-auth")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _check_auth(authorization_header: Optional[str]) -> None:
    """Bearer-token auth. Raises 401 if missing/wrong."""
    expected = os.environ.get("MODAL_TOKEN")
    if not expected:
        # Fail closed in deployments missing the secret — better than silently
        # accepting unauthenticated traffic.
        raise _http_error(500, "MODAL_TOKEN not configured on server")
    if not authorization_header or not authorization_header.startswith("Bearer "):
        raise _http_error(401, "Missing Authorization: Bearer token")
    presented = authorization_header.split(" ", 1)[1].strip()
    # Constant-time compare to avoid timing oracles on the token.
    import hmac
    if not hmac.compare_digest(presented, expected):
        raise _http_error(401, "Invalid token")


def _http_error(status: int, message: str) -> "Exception":
    from fastapi import HTTPException
    return HTTPException(status_code=status, detail=message)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _job_status_payload(state: Dict[str, Any]) -> Dict[str, Any]:
    """Shape the state into the JSON the TS adapter expects.
    Mirrors `PhotogrammetryJobResult` in
    `src/services/digitalTwin/photogrammetry/types.ts`."""
    return {
        "jobId": state["jobId"],
        "status": state["status"],
        "createdAt": state["createdAt"],
        "completedAt": state.get("completedAt"),
        "meshUri": state.get("meshUri") if state["status"] == "completed" else None,
        "meshFormat": state.get("meshFormat", "glb"),
        "meshSizeBytes": state.get("meshSizeBytes"),
        "errorMessage": state.get("errorMessage") if state["status"] == "failed" else None,
        "engine": "meshroom",
        "metrics": state.get("metrics") if state["status"] == "completed" else None,
    }


# ---------------------------------------------------------------------------
# Background processor — does the actual photogrammetry work.
# Spawned via `.spawn()` from `submit_job` so the HTTP request returns 202
# immediately and the GPU container runs to completion in the background.
# ---------------------------------------------------------------------------
@stub.function(
    image=image,
    gpu=gpu.A10G(),
    timeout=900,
    memory=16384,
    secrets=[auth_secret],
)
def process_video(job_id: str, video_uri: str, project_id: str) -> None:
    """
    Pipeline: download video → extract frames → meshroom_batch → upload mesh.
    Updates `job_states[job_id]` at each phase transition so polling clients
    see queued → processing → completed/failed.
    """
    state = job_states.get(job_id)
    if not state:
        return  # Cancelled before we got here; nothing to do.

    state["status"] = "processing"
    state["startedAt"] = _now_ms()
    job_states[job_id] = state

    try:
        with tempfile.TemporaryDirectory() as workdir:
            workdir_p = Path(workdir)
            video_path = workdir_p / "input.mp4"
            frames_dir = workdir_p / "frames"
            frames_dir.mkdir()
            output_dir = workdir_p / "output"
            output_dir.mkdir()

            # 1. Download video. Supports gs:// (Cloud Storage) and https://.
            if video_uri.startswith("gs://"):
                from google.cloud import storage as gcs
                bucket_name, blob_name = video_uri[5:].split("/", 1)
                client = gcs.Client()
                client.bucket(bucket_name).blob(blob_name).download_to_filename(
                    str(video_path)
                )
            else:
                import requests
                r = requests.get(video_uri, stream=True, timeout=120)
                r.raise_for_status()
                with open(video_path, "wb") as f:
                    for chunk in r.iter_content(chunk_size=1024 * 1024):
                        f.write(chunk)

            # 2. Frame extraction at 2 fps (Meshroom recommends 2-4 fps for
            # phone video; higher rates overload feature matching).
            subprocess.run(
                [
                    "ffmpeg", "-i", str(video_path),
                    "-vf", "fps=2,scale=1920:-1",
                    "-q:v", "2",
                    str(frames_dir / "frame_%04d.jpg"),
                ],
                check=True, capture_output=True,
            )
            frames_extracted = len(list(frames_dir.glob("*.jpg")))

            # 3. Run Meshroom. `meshroom_batch` chains: CameraInit → FeatureExtraction
            # → ImageMatching → FeatureMatching → StructureFromMotion →
            # PrepareDenseScene → DepthMap → DepthMapFilter → Meshing → MeshFiltering
            # → Texturing → output.obj+.mtl+texture. We then convert to GLB.
            subprocess.run(
                [
                    "meshroom_batch",
                    "--input", str(frames_dir),
                    "--output", str(output_dir),
                ],
                check=True, capture_output=True, timeout=750,
            )

            # 4. Locate output mesh — Meshroom writes `texturedMesh.obj`.
            obj_path = output_dir / "texturedMesh.obj"
            if not obj_path.exists():
                # Meshroom version < 2023.3 used `Texturing/texturedMesh.obj`.
                alt = next(output_dir.rglob("texturedMesh.obj"), None)
                if alt:
                    obj_path = alt
            if not obj_path.exists():
                raise RuntimeError("Meshroom completed but no mesh was produced")

            # 5. Upload result back to Cloud Storage. Path mirrors input scheme.
            mesh_size = obj_path.stat().st_size
            mesh_uri = _upload_result(obj_path, project_id, job_id)

            # 6. Mark complete. Metrics are populated where cheap to extract.
            state["status"] = "completed"
            state["completedAt"] = _now_ms()
            state["meshUri"] = mesh_uri
            state["meshFormat"] = "obj"  # meshroom default; conversion to GLB is downstream
            state["meshSizeBytes"] = mesh_size
            state["metrics"] = {
                "framesExtracted": frames_extracted,
                "processingDurationS": (state["completedAt"] - state["startedAt"]) / 1000.0,
            }
            job_states[job_id] = state

    except subprocess.TimeoutExpired:
        state["status"] = "failed"
        state["completedAt"] = _now_ms()
        state["errorMessage"] = "Meshroom exceeded 750 s timeout (video probably too long or too detailed)"
        job_states[job_id] = state
    except Exception as exc:
        state["status"] = "failed"
        state["completedAt"] = _now_ms()
        # Don't leak full stack to client; log it server-side instead.
        state["errorMessage"] = f"Photogrammetry failed: {type(exc).__name__}"
        job_states[job_id] = state
        # Re-raise so it shows in `modal app logs`.
        raise


def _upload_result(local_path: Path, project_id: str, job_id: str) -> str:
    """Upload the OBJ to GCS under `gs://praeventio-meshes/<project>/<jobId>.obj`.
    Returns the gs:// URI. Caller is responsible for converting to a signed URL
    if the consumer needs HTTP access."""
    from google.cloud import storage as gcs
    bucket_name = os.environ.get("MESH_OUTPUT_BUCKET", "praeventio-meshes")
    blob_name = f"{project_id}/{job_id}.obj"
    client = gcs.Client()
    client.bucket(bucket_name).blob(blob_name).upload_from_filename(str(local_path))
    return f"gs://{bucket_name}/{blob_name}"


# ---------------------------------------------------------------------------
# HTTP endpoints
# ---------------------------------------------------------------------------
@stub.function(
    image=image,
    timeout=60,
    secrets=[auth_secret],
)
@web_endpoint(method="POST", label="submit-job")
def submit_job(payload: Dict[str, Any], authorization: Optional[str] = None) -> Dict[str, Any]:
    """
    POST {submitUrl}
    Headers: Authorization: Bearer <token>
    Body: { videoUri, projectId, userId, outputFormat?, geoAnchor?, videoMeta? }
    Returns 202 with { jobId, status: 'queued' }.
    """
    _check_auth(authorization)

    # Validate minimum payload — match `PhotogrammetryJobInput` from the TS side.
    for required in ("videoUri", "projectId", "userId"):
        if required not in payload or not payload[required]:
            raise _http_error(400, f"Missing required field: {required}")

    job_id = f"modal-{uuid.uuid4().hex}"
    state = {
        "jobId": job_id,
        "status": "queued",
        "createdAt": _now_ms(),
        "engine": "meshroom",
        "meshFormat": payload.get("outputFormat", "glb"),
        "projectId": payload["projectId"],
        "userId": payload["userId"],
        "videoUri": payload["videoUri"],
    }
    job_states[job_id] = state

    # Spawn the heavy work in the background — `.spawn()` returns immediately.
    process_video.spawn(job_id, payload["videoUri"], payload["projectId"])

    return {"jobId": job_id, "status": "queued", "createdAt": state["createdAt"]}


@stub.function(image=image, timeout=30, secrets=[auth_secret])
@web_endpoint(method="GET", label="job-status")
def job_status(jobId: str, authorization: Optional[str] = None) -> Dict[str, Any]:
    """
    GET {statusUrl}?jobId=<id>
    Headers: Authorization: Bearer <token>
    Returns the current state. Shape matches `PhotogrammetryJobResult`.
    """
    _check_auth(authorization)
    state = job_states.get(jobId)
    if not state:
        raise _http_error(404, f"Job not found: {jobId}")
    return _job_status_payload(state)


@stub.function(image=image, timeout=30, secrets=[auth_secret])
@web_endpoint(method="POST", label="cancel-job")
def cancel_job(payload: Dict[str, Any], authorization: Optional[str] = None) -> Dict[str, Any]:
    """
    POST {cancelUrl}
    Headers: Authorization: Bearer <token>
    Body: { jobId }
    No-op if the job already finished. Modal does NOT support killing a
    running container by ID from inside another function, so a job already
    in `processing` will keep burning GPU until it finishes — we just mark
    the result so the client knows to discard it.
    """
    _check_auth(authorization)
    job_id = payload.get("jobId")
    if not job_id:
        raise _http_error(400, "Missing jobId")
    state = job_states.get(job_id)
    if not state:
        raise _http_error(404, f"Job not found: {job_id}")
    if state["status"] in ("completed", "failed", "cancelled"):
        return _job_status_payload(state)
    state["status"] = "cancelled"
    state["completedAt"] = _now_ms()
    job_states[job_id] = state
    return _job_status_payload(state)


# Local sanity check (`python app.py`) — does NOT run the GPU function.
if __name__ == "__main__":
    print(json.dumps({
        "stub": stub.name,
        "endpoints": ["submit-job", "job-status", "cancel-job"],
        "image": "debian_slim + meshroom 2023.3.0 + gcs",
        "gpu": "A10G",
        "timeout_s": 900,
        "deploy_command": "modal deploy app.py",
    }, indent=2))
