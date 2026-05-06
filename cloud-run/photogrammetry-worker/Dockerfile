# Sprint 38 — Brecha C (photogrammetry pipeline auto)
#
# Multi-stage Dockerfile for the Cloud Run COLMAP photogrammetry worker.
# This is the Cloud Run-deployable counterpart of the LOCAL adapter at
# `src/services/digitalTwin/photogrammetry/colmapAdapter.ts`. The adapter
# already speaks the worker contract (`POST /jobs`, `GET /jobs/:id`, etc.).
# Modal.com remains an alternative routing target (`modalAdapter.ts`); this
# image is the GCP-native Cloud Run path tracked in DIGITAL_TWIN_GPU_FREE_PLAN
# Phase C → C2.
#
# Stage 1 — colmap-base: pulls the official COLMAP CLI image. We piggyback
# on `colmap/colmap:latest` which ships COLMAP plus its native deps
# (Ceres, Eigen, FreeImage, Glog) on Ubuntu 22.04. ffmpeg is added so the
# worker can also accept video input (extract frames -> COLMAP feature
# extractor) — same shape as Modal adapter's videoUri.
#
# Stage 2 — node-runtime: Node.js 22-slim with the Express server. The final
# image copies `/usr/local/bin/colmap` + libs from stage 1 and ffmpeg from
# the Debian repos. We deliberately keep the Node and COLMAP layers
# separate so iterating on the Node code does not invalidate the (large)
# COLMAP layer.
#
# === Resource budget (Cloud Run --cpu=4 --memory=8Gi --timeout=1800) ===
#   Sparse + dense reconstruction of ~50 frames @ 1080p:
#     • feature_extractor : ~30 s
#     • exhaustive_matcher: ~90 s
#     • mapper            : ~120 s
#     • image_undistorter : ~20 s
#     • patch_match_stereo: ~600–900 s  (CPU-only, the bottleneck)
#     • stereo_fusion     : ~60 s
#   Total: ~15–20 min. Cost @ Cloud Run CPU = ~USD 0.05–0.10 / job.

# -----------------------------------------------------------------------------
# Stage 1 — COLMAP binaries. `colmap/colmap` is published by the COLMAP team
# and is the same image referenced in DIGITAL_TWIN_GPU_FREE_PLAN.md §5.3.
# -----------------------------------------------------------------------------
FROM colmap/colmap:latest AS colmap-base

# -----------------------------------------------------------------------------
# Stage 2 — Node runtime. We copy the COLMAP binary + its shared libs from
# stage 1 and add ffmpeg for video → frame extraction.
# -----------------------------------------------------------------------------
FROM node:22-slim AS runtime

# COLMAP runtime deps (Ubuntu/Debian package names; matches what colmap-base
# expects). ffmpeg covers the video-to-frames branch.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      libboost-program-options1.74.0 \
      libboost-graph1.74.0 \
      libboost-system1.74.0 \
      libboost-filesystem1.74.0 \
      libceres2 \
      libfreeimage3 \
      libgoogle-glog0v5 \
      libgflags2.2 \
      libsqlite3-0 \
      libqt5core5a \
      libqt5gui5 \
      libqt5widgets5 \
      libcgal-dev \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

# Copy COLMAP binary from stage 1.
COPY --from=colmap-base /usr/local/bin/colmap /usr/local/bin/colmap

WORKDIR /app

# Install Node deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Worker source.
COPY tsconfig.json ./
COPY src ./src

# Compile TS -> dist.
RUN npx tsc --outDir dist

# Cloud Run sets PORT; default to 8080 for local docker run.
ENV PORT=8080
ENV NODE_ENV=production

# /tmp is writable scratch for COLMAP intermediate workspaces.
ENV COLMAP_WORK_DIR=/tmp/colmap

EXPOSE 8080
CMD ["node", "dist/index.js"]
