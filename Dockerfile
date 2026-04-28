# ── Stage 1: build Vite frontend ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

# ── Stage 2: production server ────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Copy server and backend services
COPY server.ts tsconfig.json ./
COPY src/services ./src/services
COPY src/types ./src/types

# Optional: Firebase Admin config (mount as secret in Cloud Run instead)
COPY firebase-applet-config.json* ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["npx", "tsx", "server.ts"]
