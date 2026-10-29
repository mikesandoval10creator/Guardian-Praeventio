# ── Stage 1: build Vite frontend ──────────────────────────────────────────────
FROM node:24.22.1-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY vendor/ ./vendor/
COPY scripts/patch-artillery.mjs scripts/patch-stryker-vitest5.cjs ./scripts/
RUN npm ci --legacy-peer-deps

COPY . .

# Keep the deep-link association files fail-closed in image builds. The active
# deploy path uses Dockerfile.api; this legacy image gets the same contract so
# a manual build cannot serve an empty assetlinks.json either.
ARG ANDROID_CERT_SHA256
ARG REQUIRE_ANDROID_CERT=1
ENV ANDROID_CERT_SHA256=${ANDROID_CERT_SHA256} \
    REQUIRE_ANDROID_CERT=${REQUIRE_ANDROID_CERT}

RUN npm run build

# ── Stage 2: production server ────────────────────────────────────────────────
FROM node:24.22.1-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY vendor/ ./vendor/
COPY scripts/patch-artillery.mjs scripts/patch-stryker-vitest5.cjs ./scripts/
RUN npm ci --omit=dev --legacy-peer-deps

# Copy built frontend
COPY --from=builder /app/dist ./dist

# server.ts resolves .well-known/*, robots.txt and sitemap.xml from public/.
# Copy only those files; dist/ already carries the rest of the public assets.
COPY --from=builder /app/public/.well-known ./public/.well-known
COPY --from=builder /app/public/robots.txt ./public/robots.txt
COPY --from=builder /app/public/sitemap.xml ./public/sitemap.xml

# Copy server and backend services
COPY server.ts tsconfig.json ./
COPY src ./src

# DEPRECADO: este Dockerfile monolítico ya no es la fuente de verdad. El
# contrato canónico (docs/production/COOLIFY-DEPLOYMENT-CONTRACT.md) define
# Dockerfile.api (API + app) y Dockerfile.frontend (landing estática).
# CLASIFICACIÓN RESUELTA (2026-10-28): firebase-applet-config.json es la
# configuración PÚBLICA de cliente Firebase web (projectId/apiKey/authDomain/
# firestoreDatabaseId — sin credenciales admin; el admin real es ADC/Workload
# Identity). La nota histórica H3 (2026-05-17) que recomendaba montarlo como
# Secret Manager era doc-drift: se contradecía con Dockerfile.api y con el
# hecho de que el archivo vive en el repo. Esta imagen legada NO copia el
# archivo y por eso no debe usarse: sin él, server.ts cae al database
# `(default)` y no sirve datos. La imagen canónica lo hornea (ver Dockerfile.api).

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["npx", "tsx", "server.ts"]
