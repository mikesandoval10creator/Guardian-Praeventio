# SPDX-License-Identifier: GPL-3.0-only
# Praeventio Guard — Sprint 21 Bucket Q
#
# Flask wrapper around the LibreDWG `dwg2dxf` CLI. Exposes:
#
#   POST /convert  — { inputUri: 'gs://bucket/file.dwg',
#                     outputBucket: 'praeventio-cad' }
#                  → { outputUri, signedUrl, sha256 }
#   GET  /healthz  — liveness probe for Cloud Run
#
# This service is intentionally DECOUPLED from the Praeventio Guard MIT
# repo. It runs in its own Cloud Run service, signs DXF outputs with a
# 1-hour signed URL, and never sees user JWTs (auth is a static bearer
# token shared with the main app's server-side proxy).
#
# Why bearer token + private Cloud Run instead of IAM-OIDC:
#   The main app already proxies through `verifyAuth`. Adding a second
#   auth layer with OIDC service-to-service tokens would require the
#   main app to mint Google-signed identity tokens per request. A long
#   shared secret (DWG_CONVERTER_TOKEN) is sufficient because the only
#   caller is our own backend, the service is `--no-allow-unauthenticated`
#   at the network layer, and the token is rotated on a Sprint cadence.

import hashlib
import logging
import os
import subprocess
import tempfile
from datetime import timedelta
from urllib.parse import urlparse

from flask import Flask, jsonify, request
from google.cloud import storage

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
EXPECTED_TOKEN = os.environ.get("DWG_CONVERTER_TOKEN", "")
MAX_BODY_BYTES = 100 * 1024 * 1024  # 100 MB
CONVERT_TIMEOUT_SEC = 290  # leave 10s headroom under Cloud Run's 300s
SIGNED_URL_TTL = timedelta(hours=1)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dwg-converter")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES

# Lazy GCS client so /healthz works without ADC during smoke tests.
_storage_client: storage.Client | None = None


def gcs() -> storage.Client:
    global _storage_client
    if _storage_client is None:
        _storage_client = storage.Client()
    return _storage_client


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def _check_bearer() -> bool:
    """Return True if the request carries the expected bearer token."""
    if not EXPECTED_TOKEN:
        # Misconfigured deployment — refuse rather than allow-all.
        log.error("DWG_CONVERTER_TOKEN env var is not set")
        return False
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False
    return auth[len("Bearer "):] == EXPECTED_TOKEN


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _parse_gs_uri(uri: str) -> tuple[str, str]:
    """Split 'gs://bucket/path/to/object' into (bucket, object_name)."""
    if not uri.startswith("gs://"):
        raise ValueError("inputUri must start with gs://")
    parsed = urlparse(uri)
    if not parsed.netloc or not parsed.path:
        raise ValueError("inputUri is missing bucket or object path")
    return parsed.netloc, parsed.path.lstrip("/")


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/healthz")
def healthz():
    return jsonify({"ok": True, "service": "dwg-converter"}), 200


@app.post("/convert")
def convert():
    if not _check_bearer():
        return jsonify({"error": "unauthorized"}), 401

    body = request.get_json(silent=True) or {}
    input_uri = body.get("inputUri")
    output_bucket = body.get("outputBucket")
    if not input_uri or not output_bucket:
        return jsonify({"error": "missing_fields",
                        "required": ["inputUri", "outputBucket"]}), 400

    try:
        in_bucket, in_object = _parse_gs_uri(input_uri)
    except ValueError as e:
        return jsonify({"error": "bad_input_uri", "message": str(e)}), 400

    with tempfile.TemporaryDirectory(prefix="dwgconv-") as tmp:
        in_path = os.path.join(tmp, "input.dwg")
        out_path = os.path.join(tmp, "input.dxf")  # dwg2dxf -o ARG

        # 1. Download .dwg from GCS
        try:
            gcs().bucket(in_bucket).blob(in_object).download_to_filename(in_path)
        except Exception as e:
            log.exception("download failed")
            return jsonify({"error": "download_failed", "message": str(e)}), 502

        # 2. Convert via dwg2dxf
        try:
            proc = subprocess.run(
                ["dwg2dxf", in_path, "-o", out_path],
                capture_output=True,
                timeout=CONVERT_TIMEOUT_SEC,
                check=False,
            )
        except subprocess.TimeoutExpired:
            log.error("dwg2dxf timed out after %ss", CONVERT_TIMEOUT_SEC)
            return jsonify({"error": "convert_timeout"}), 504

        if proc.returncode != 0 or not os.path.exists(out_path):
            log.error("dwg2dxf failed rc=%s stderr=%s",
                      proc.returncode, proc.stderr.decode("utf-8", "replace")[:2000])
            return jsonify({
                "error": "convert_failed",
                "returncode": proc.returncode,
                "stderr": proc.stderr.decode("utf-8", "replace")[:2000],
            }), 502

        # 3. Compute integrity hash
        sha256 = _sha256_file(out_path)

        # 4. Upload .dxf — derive object name from input
        out_object = os.path.splitext(in_object)[0] + ".dxf"
        try:
            blob = gcs().bucket(output_bucket).blob(out_object)
            blob.upload_from_filename(out_path, content_type="application/dxf")
            signed_url = blob.generate_signed_url(
                version="v4",
                expiration=SIGNED_URL_TTL,
                method="GET",
            )
        except Exception as e:
            log.exception("upload/sign failed")
            return jsonify({"error": "upload_failed", "message": str(e)}), 502

    return jsonify({
        "outputUri": f"gs://{output_bucket}/{out_object}",
        "signedUrl": signed_url,
        "sha256": sha256,
    }), 200


if __name__ == "__main__":
    # Local dev only; Cloud Run uses gunicorn (see Dockerfile CMD).
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
