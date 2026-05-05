# SPDX-License-Identifier: Apache-2.0
# Praeventio Guard — Sprint 23 Bucket EE.4.
#
# Flask wrapper around the OpenUSD `glb_to_usdz.py` CLI. Mirrors the
# DWG converter pattern (infra/dwg-converter/server.py).
#
#   POST /convert  -> { inputUri: 'gs://bucket/path.glb',
#                       outputBucket: 'praeventio-ar-usdz' }
#                  -> { ok, outputUri, signedUrl, sha256 }
#   GET  /healthz  -> liveness probe for Cloud Run
#
# Auth: static bearer token via USDZ_CONVERTER_TOKEN env var. The service
# is deployed `--no-allow-unauthenticated`; only our own backend (which
# already runs verifyAuth on every user request) calls this. See ADR
# 0008 for the rationale shared with the DWG service.

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
EXPECTED_TOKEN = os.environ.get("USDZ_CONVERTER_TOKEN", "")
MAX_BODY_BYTES = 50 * 1024 * 1024  # 50 MB — AR markers are tiny
CONVERT_TIMEOUT_SEC = 110          # leave 10s headroom under Cloud Run 120s
SIGNED_URL_TTL = timedelta(days=7)  # AR assets are rebuilt at deploy cadence

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("usdz-converter")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES

# Lazy GCS client so /healthz works without ADC during smoke tests.
_storage_client = None


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
        log.error("USDZ_CONVERTER_TOKEN env var is not set")
        return False
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False
    return auth[len("Bearer "):] == EXPECTED_TOKEN


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _parse_gs_uri(uri: str):
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
    return jsonify({"ok": True, "service": "usdz-converter"}), 200


@app.post("/convert")
def convert():
    if not _check_bearer():
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    body = request.get_json(silent=True) or {}
    input_uri = body.get("inputUri")
    output_bucket = body.get("outputBucket")
    if not input_uri or not output_bucket:
        return jsonify({
            "ok": False,
            "error": "missing_fields",
            "required": ["inputUri", "outputBucket"],
        }), 400

    try:
        in_bucket, in_object = _parse_gs_uri(input_uri)
    except ValueError as e:
        return jsonify({"ok": False, "error": "bad_input_uri", "message": str(e)}), 400

    if not in_object.lower().endswith(".glb"):
        return jsonify({"ok": False, "error": "input_must_be_glb"}), 400

    with tempfile.TemporaryDirectory(prefix="usdzconv-") as tmp:
        in_path = os.path.join(tmp, "input.glb")
        out_path = os.path.join(tmp, "output.usdz")

        # 1. Download .glb from GCS
        try:
            gcs().bucket(in_bucket).blob(in_object).download_to_filename(in_path)
        except Exception as e:
            log.exception("download failed")
            return jsonify({"ok": False, "error": "download_failed", "message": str(e)}), 502

        # 2. Convert via OpenUSD
        try:
            proc = subprocess.run(
                ["python3", "/app/glb_to_usdz.py", in_path, out_path],
                capture_output=True,
                timeout=CONVERT_TIMEOUT_SEC,
                check=False,
            )
        except subprocess.TimeoutExpired:
            log.error("glb_to_usdz timed out after %ss", CONVERT_TIMEOUT_SEC)
            return jsonify({"ok": False, "error": "convert_timeout"}), 504

        if proc.returncode != 0 or not os.path.exists(out_path):
            stderr_text = proc.stderr.decode("utf-8", "replace")[:2000]
            log.error("glb_to_usdz failed rc=%s stderr=%s", proc.returncode, stderr_text)
            return jsonify({
                "ok": False,
                "error": "convert_failed",
                "returncode": proc.returncode,
                "stderr": stderr_text,
            }), 502

        # 3. Compute integrity hash
        sha256 = _sha256_file(out_path)

        # 4. Upload .usdz — derive object name from input
        out_object = os.path.splitext(in_object)[0] + ".usdz"
        try:
            blob = gcs().bucket(output_bucket).blob(out_object)
            blob.upload_from_filename(
                out_path,
                content_type="model/vnd.usdz+zip",
            )
            signed_url = blob.generate_signed_url(
                version="v4",
                expiration=SIGNED_URL_TTL,
                method="GET",
            )
        except Exception as e:
            log.exception("upload/sign failed")
            return jsonify({"ok": False, "error": "upload_failed", "message": str(e)}), 502

    return jsonify({
        "ok": True,
        "outputUri": f"gs://{output_bucket}/{out_object}",
        "signedUrl": signed_url,
        "sha256": sha256,
    }), 200


if __name__ == "__main__":
    # Local dev only; Cloud Run uses gunicorn (see Dockerfile CMD).
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
