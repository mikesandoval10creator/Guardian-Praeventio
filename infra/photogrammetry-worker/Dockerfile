# Photogrammetry worker — COLMAP (BSD-3-Clause) open-source pipeline.
#
# CPU-only build to minimize Cloud Run cost. Trade-off: slow (~10-15 min for
# a 30s video at 1fps frame extraction) but free of GPU egress fees and
# proprietary licenses.
#
# Pipeline stages handled by /app/run-pipeline.sh:
#   1. ffmpeg extract frames (1 fps, 1280px wide)
#   2. colmap feature_extractor (SIFT, CPU)
#   3. colmap exhaustive_matcher (CPU)
#   4. colmap mapper (sparse reconstruction)
#   5. colmap image_undistorter
#   6. colmap patch_match_stereo (CPU, slowest stage)
#   7. colmap stereo_fusion -> fused.ply
#   8. Open3D Poisson surface reconstruction -> mesh.ply
#   9. trimesh PLY -> GLB conversion
#
# The HTTP server (server.py) wraps this script: receives a job, downloads
# the video from GCS, runs the pipeline, uploads the GLB back, returns a
# signed URL valid 7 days.

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Ubuntu 22.04 ships colmap 3.7 in the universe repo. ffmpeg from main.
# build-essential + python3-dev are needed for open3d wheel fallbacks.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        colmap \
        ffmpeg \
        python3 \
        python3-pip \
        python3-dev \
        curl \
        gnupg \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# Google Cloud SDK (for `gsutil` download/upload of videos and GLBs).
RUN echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
        | tee /etc/apt/sources.list.d/google-cloud-sdk.list \
    && curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
        | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
    && apt-get update && apt-get install -y --no-install-recommends google-cloud-cli \
    && rm -rf /var/lib/apt/lists/*

# Python deps:
#   open3d   — Poisson meshing
#   trimesh  — PLY -> GLB
#   pygltflib — backup GLB writer
#   flask + gunicorn — HTTP server
#   google-cloud-storage — signed URLs (alternative to gsutil)
RUN pip3 install --upgrade pip \
    && pip3 install \
        open3d==0.18.0 \
        trimesh==4.4.3 \
        pygltflib==1.16.2 \
        flask==3.0.3 \
        gunicorn==22.0.0 \
        google-cloud-storage==2.18.2 \
        numpy==1.26.4

WORKDIR /app

COPY run-pipeline.sh /app/run-pipeline.sh
COPY poisson-mesh.py /app/poisson-mesh.py
COPY ply-to-glb.py /app/ply-to-glb.py
COPY server.py /app/server.py

RUN chmod +x /app/run-pipeline.sh

# Cloud Run injects PORT (default 8080).
ENV PORT=8080
EXPOSE 8080

# Single worker, generous timeout — pipeline can take 15+ min for a 30s
# video. Concurrency 1 because the pipeline is heavy on CPU + disk; let
# Cloud Run scale by spawning more instances rather than threads.
CMD exec gunicorn --bind 0.0.0.0:${PORT} \
        --workers 1 \
        --threads 4 \
        --timeout 1800 \
        --graceful-timeout 60 \
        server:app
