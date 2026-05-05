# SPDX-License-Identifier: Apache-2.0
# Praeventio Guard — Sprint 23 Bucket EE.
#
# GLB → USDZ conversion service. Apple's `usdzconvert` requires macOS
# (out for serverless Linux Cloud Run). This image builds Pixar OpenUSD
# (Apache-2.0 / Modified Apache-2.0 license) from source and exposes a
# tiny Flask wrapper around its glTF→USD plugin + ARKit USDZ packager.
#
# Why isolated Cloud Run service (mirrors infra/dwg-converter/ pattern):
#   - OpenUSD's build is heavy (~30 min, ~6 GB image) and pulls toolchains
#     (cmake, build-essential, python3-dev, X11 deps) we never want in
#     the main app image.
#   - The 17 GLBs ship pre-converted in public/models/ar/{kind}.usdz; this
#     service is invoked offline at build time via scripts/generate-ar-usdz.mjs
#     OR online for user-uploaded models.
#   - Auth is a static bearer token (USDZ_CONVERTER_TOKEN) shared with the
#     main app's server-side proxy, same model as the DWG converter.
#
# Build:
#   gcloud builds submit infra/usdz-converter/ --tag gcr.io/$PROJECT_ID/usdz-converter:latest
# Deploy:
#   See docs/usdz-converter-deploy.md
#
# NOTE: this Dockerfile is NOT validated in CI — the OpenUSD compile takes
# ~30 minutes and exceeds GitHub Actions runner budgets. The TS adapter
# `src/services/ar/usdzConverter.ts` IS unit-tested in CI.
#
# ---------------------------------------------------------------------------
# Stage 1 — Compile OpenUSD v24.05 (latest stable as of 2026-05) from source.
# ---------------------------------------------------------------------------
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    git build-essential cmake \
    python3-dev python3-pip python3-setuptools \
    libxrandr-dev libxinerama-dev libxcursor-dev libxi-dev \
    libgl1-mesa-dev libglu1-mesa-dev \
    zlib1g-dev libssl-dev ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --break-system-packages \
    PyOpenGL==3.1.7 \
    Pillow==10.3.0 \
    numpy==1.26.4 \
    PySide6==6.6.0

WORKDIR /build
RUN git clone --depth 1 --branch v24.05 https://github.com/PixarAnimationStudios/OpenUSD.git
WORKDIR /build/OpenUSD

# --build-monolithic: ship a single libusd_ms.so instead of dozens of .so's.
# Easier to copy across stages, smaller runtime image.
# --no-tests --no-examples --no-docs --no-tools: trim ~2 GB of artifacts we
# never invoke from the Flask wrapper.
RUN python3 build_scripts/build_usd.py /usr/local/usd \
    --no-tests --no-examples --no-docs --no-tools \
    --build-monolithic

# ---------------------------------------------------------------------------
# Stage 2 — Slim runtime image with only the OpenUSD libs + Python wrapper.
# ---------------------------------------------------------------------------
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    python3 python3-pip \
    libgl1 libxrandr2 libxinerama1 libxcursor1 libxi6 \
    ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages \
      flask==3.0.3 gunicorn==22.0.0 google-cloud-storage==2.18.2 \
      Pillow==10.3.0 numpy==1.26.4 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/usd /usr/local/usd

ENV PYTHONPATH=/usr/local/usd/lib/python
ENV LD_LIBRARY_PATH=/usr/local/usd/lib
ENV PATH=/usr/local/usd/bin:$PATH

COPY server.py glb_to_usdz.py /app/
WORKDIR /app

# Cloud Run injects PORT; default to 8080 for local docker run.
ENV PORT=8080
EXPOSE 8080

# Single worker fits the 4 GiB / 2 vCPU envelope (USD stages can be RAM-heavy).
# Timeout 120s matches the Cloud Run --timeout in the runbook.
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT} --workers 1 --timeout 120 server:app"]
