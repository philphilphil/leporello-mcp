# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Web build stage ───────────────────────────────────────────────────────────
FROM node:22-alpine AS web-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=web-builder /app/web/dist ./web/dist
# Web dependencies needed for rebuild after scrape
COPY web/package*.json ./web/
RUN cd web && npm ci
COPY web/astro.config.ts web/tsconfig.json ./web/
COPY web/src ./web/src
RUN mkdir -p data
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/index.js"]
