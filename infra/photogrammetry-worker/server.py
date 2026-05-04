"""HTTP server for the COLMAP photogrammetry worker.

Endpoints:
    POST   /jobs               -> 202 { jobId }
    GET    /jobs/<jobId>       -> 200 { status, meshUri?, errorMessage?, ... }
    POST   /jobs/<jobId>/cancel -> 204
    GET    /healthz            -> 200 (Cloud Run health probe)

Auth:
    All /jobs* endpoints require `Authorization: Bearer <PHOTOGRAMMETRY_WORKER_TOKEN>`
    matching the env var of the same name. Constant-time comparison.

Storage contract:
    POST /jobs body { videoUri, projectId, jobId? }
    - videoUri must be a `gs://bucket/object` URL.
    - On completion, the GLB is uploaded to the same bucket at
      `<bucket>/photogrammetry/<jobId>/mesh.glb`. The job record holds a
      v4 signed URL valid 7 days that the client can use directly.

Concurrency:
    Jobs are tracked in an in-memory dict + a per-process subprocess.
    Cloud Run instances are stateless — if an instance is recycled while
    a job is running the client gets `failed`. The orchestrator should
    treat any `processing` state older than 30 min as stale and retry.
"""

from __future__ import annotations

import hmac
import logging
import os
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from datetime import timedelta
from typing import Any, Dict, Optional

from flask import Flask, jsonify, request
from google.cloud import storage as gcs

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("photogrammetry-worker")

app = Flask(__name__)

WORKER_TOKEN = os.environ.get("PHOTOGRAMMETRY_WORKER_TOKEN", "")
PIPELINE_PATH = os.environ.get("PIPELINE_PATH", "/app/run-pipeline.sh")
SIGNED_URL_TTL_DAYS = int(os.environ.get("SIGNED_URL_TTL_DAYS", "7"))

# In-memory job registry. Each entry:
#   {
#     "status": "queued" | "processing" | "completed" | "failed" | "cancelled",
#     "createdAt": ms epoch,
#     "completedAt": ms epoch | None,
#     "meshUri": str | None,
#     "errorMessage": str | None,
#     "projectId": str,
#     "videoUri": str,
#     "process": subprocess.Popen | None,
#     "thread": threading.Thread | None,
#   }
JOBS: Dict[str, Dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()

_gcs_client: Optional[gcs.Client] = None


def gcs_client() -> gcs.Client:
    global _gcs_client
    if _gcs_client is None:
        _gcs_client = gcs.Client()
    return _gcs_client


def _now_ms() -> int:
    return int(time.time() * 1000)


def _check_auth() -> Optional[Any]:
    if not WORKER_TOKEN:
        log.error("PHOTOGRAMMETRY_WORKER_TOKEN not set; refusing requests")
        return jsonify({"error": "worker not configured"}), 503
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return jsonify({"error": "missing Bearer token"}), 401
    presented = header[len("Bearer "):]
    if not hmac.compare_digest(presented, WORKER_TOKEN):
        return jsonify({"error": "invalid token"}), 401
    return None


def _parse_gs_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith("gs://"):
        raise ValueError(f"expected gs:// URI, got {uri!r}")
    rest = uri[len("gs://"):]
    bucket, _, path = rest.partition("/")
    if not bucket or not path:
        raise ValueError(f"malformed gs:// URI: {uri!r}")
    return bucket, path


def _download_video(video_uri: str, dest_path: str) -> None:
    bucket_name, object_name = _parse_gs_uri(video_uri)
    log.info("downloading gs://%s/%s -> %s", bucket_name, object_name, dest_path)
    bucket = gcs_client().bucket(bucket_name)
    bucket.blob(object_name).download_to_filename(dest_path)


def _upload_glb_and_sign(local_glb: str, bucket_name: str, job_id: str) -> str:
    bucket = gcs_client().bucket(bucket_name)
    object_name = f"photogrammetry/{job_id}/mesh.glb"
    blob = bucket.blob(object_name)
    log.info("uploading %s -> gs://%s/%s", local_glb, bucket_name, object_name)
    blob.upload_from_filename(local_glb, content_type="model/gltf-binary")
    return blob.generate_signed_url(
        version="v4",
        expiration=timedelta(days=SIGNED_URL_TTL_DAYS),
        method="GET",
    )


def _run_job(job_id: str, video_uri: str) -> None:
    """Worker thread body. Updates JOBS[job_id] in-place."""
    work_dir = tempfile.mkdtemp(prefix=f"job-{job_id}-")
    local_video = os.path.join(work_dir, "input.mp4")
    local_glb = os.path.join(work_dir, "output.glb")

    try:
        _download_video(video_uri, local_video)

        with JOBS_LOCK:
            JOBS[job_id]["status"] = "processing"

        log.info("[%s] launching pipeline", job_id)
        proc = subprocess.Popen(
            [PIPELINE_PATH, local_video, local_glb],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        with JOBS_LOCK:
            JOBS[job_id]["process"] = proc
        rc = proc.wait()
        with JOBS_LOCK:
            JOBS[job_id]["process"] = None
            if JOBS[job_id]["status"] == "cancelled":
                return  # cancel handler already set state
        if rc != 0:
            raise RuntimeError(f"pipeline exited with code {rc}")

        bucket_name, _ = _parse_gs_uri(video_uri)
        signed = _upload_glb_and_sign(local_glb, bucket_name, job_id)

        with JOBS_LOCK:
            JOBS[job_id].update(
                status="completed",
                completedAt=_now_ms(),
                meshUri=signed,
            )
        log.info("[%s] completed", job_id)
    except Exception as exc:  # noqa: BLE001
        log.exception("[%s] pipeline failed: %s", job_id, exc)
        with JOBS_LOCK:
            if JOBS[job_id]["status"] != "cancelled":
                JOBS[job_id].update(
                    status="failed",
                    completedAt=_now_ms(),
                    errorMessage=str(exc),
                )
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


@app.get("/healthz")
def healthz() -> Any:
    return ("ok", 200)


@app.post("/jobs")
def submit_job() -> Any:
    auth_err = _check_auth()
    if auth_err is not None:
        return auth_err

    body = request.get_json(force=True, silent=True) or {}
    video_uri = body.get("videoUri")
    project_id = body.get("projectId")
    if not video_uri or not project_id:
        return jsonify({"error": "videoUri and projectId required"}), 400
    try:
        _parse_gs_uri(video_uri)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    # Caller may pre-assign a jobId (e.g. Firestore doc id) to make the
    # worker's signed URL deterministic. Fall back to a server uuid.
    job_id = body.get("jobId") or f"colmap-{uuid.uuid4().hex[:12]}-{secrets.token_hex(2)}"

    with JOBS_LOCK:
        if job_id in JOBS:
            return jsonify({"error": "jobId already exists"}), 409
        JOBS[job_id] = {
            "status": "queued",
            "createdAt": _now_ms(),
            "completedAt": None,
            "meshUri": None,
            "errorMessage": None,
            "projectId": project_id,
            "videoUri": video_uri,
            "process": None,
            "thread": None,
        }

    thread = threading.Thread(target=_run_job, args=(job_id, video_uri), daemon=True)
    JOBS[job_id]["thread"] = thread
    thread.start()
    return jsonify({"jobId": job_id, "status": "queued"}), 202


@app.get("/jobs/<job_id>")
def get_job(job_id: str) -> Any:
    auth_err = _check_auth()
    if auth_err is not None:
        return auth_err
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            return jsonify({"error": "not found"}), 404
        # Strip non-serializable fields.
        public = {
            "jobId": job_id,
            "status": job["status"],
            "createdAt": job["createdAt"],
            "completedAt": job["completedAt"],
            "meshUri": job["meshUri"],
            "errorMessage": job["errorMessage"],
        }
    return jsonify(public), 200


@app.post("/jobs/<job_id>/cancel")
def cancel_job(job_id: str) -> Any:
    auth_err = _check_auth()
    if auth_err is not None:
        return auth_err
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            return jsonify({"error": "not found"}), 404
        if job["status"] in ("completed", "failed", "cancelled"):
            return ("", 204)
        job["status"] = "cancelled"
        job["completedAt"] = _now_ms()
        proc = job.get("process")
    if proc is not None:
        try:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        except Exception:  # noqa: BLE001
            log.warning("[%s] failed to terminate subprocess", job_id, exc_info=True)
    return ("", 204)


if __name__ == "__main__":
    # Local dev only — Cloud Run uses gunicorn from the Dockerfile CMD.
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8080")), debug=False)
