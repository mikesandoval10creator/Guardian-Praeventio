# ── Stage 1: build Vite frontend ──────────────────────────────────────────────
FROM node:22.23.4-alpine AS builder
WORKDIR /app

COPY package*.json ./
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
FROM node:22.23.4-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
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

# H3 (2026-05-17): firebase-applet-config.json NO se hornea en la imagen.
# Se monta como Secret Manager en runtime de Cloud Run.
# Ver docs/runbooks/SECRETS_RUNBOOK.md.

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["npx", "tsx", "server.ts"]
