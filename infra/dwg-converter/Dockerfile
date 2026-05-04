# SPDX-License-Identifier: GPL-3.0-only
# Praeventio Guard — Sprint 21 Bucket Q
#
# DWG → DXF conversion service. This image is deliberately ISOLATED from the
# main application repo (which is MIT). LibreDWG is GPL-3.0-licensed and runs
# here only as a standalone HTTP service; the GPL obligation is scoped to the
# conversion binary plus this image, and does NOT propagate to the
# Praeventio Guard frontend/backend bundle that talks to it over HTTP.
#
# See docs/architecture-decisions/0008-libredwg-cloud-function-isolation.md
# for the full legal rationale (HTTP boundary = aggregation, not derivative
# work — the standard interpretation under GPL-3.0 §5).
#
# Build:
#   docker build -t gcr.io/$PROJECT_ID/dwg-converter:latest infra/dwg-converter/
# Deploy:
#   See docs/dwg-converter-deploy.md
#
# ---------------------------------------------------------------------------
# Stage 1 — Compile LibreDWG 0.13.3 (latest stable as of 2026-05) from source.
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS builder
RUN apt-get update && apt-get install -y \
    git build-essential autoconf automake libtool \
    pkg-config libxml2-dev libpcre2-dev swig python3-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git clone --depth 1 --branch 0.13.3 https://github.com/LibreDWG/libredwg.git
WORKDIR /build/libredwg
RUN sh autogen.sh \
 && ./configure --disable-bindings --enable-release \
 && make -j4 \
 && make install

# ---------------------------------------------------------------------------
# Stage 2 — Runtime image with only the dwg2dxf binary + libredwg.so.
# Bindings are disabled in the builder stage to keep the runtime tiny.
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim
COPY --from=builder /usr/local/bin/dwg2dxf /usr/local/bin/
COPY --from=builder /usr/local/lib/libredwg.so* /usr/local/lib/
RUN ldconfig

# Minimal Python runtime for the Flask wrapper. `--break-system-packages`
# is required on Debian Bookworm to install into the system site-packages
# (PEP 668). Acceptable here because the container is single-purpose.
RUN apt-get update && apt-get install -y \
    python3 python3-pip ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages \
      flask==3.0.3 gunicorn==22.0.0 google-cloud-storage==2.18.2 \
 && rm -rf /var/lib/apt/lists/*

COPY server.py /app/
WORKDIR /app

# Cloud Run injects PORT; default to 8080 for local docker run.
ENV PORT=8080
EXPOSE 8080

# Two workers fits the 1Gi memory envelope. Timeout 300s matches the
# Cloud Run --timeout in docs/dwg-converter-deploy.md.
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT} --workers 2 --timeout 300 server:app"]
