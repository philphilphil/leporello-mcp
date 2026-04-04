# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────────
# Debian-based image required for Playwright Chromium
FROM node:22-slim AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
# Install Playwright Chromium + its OS dependencies
RUN npx playwright install --with-deps chromium
COPY --from=builder /app/dist ./dist
# Web dependencies + source needed for runtime rebuild after scrape
COPY web/package*.json ./web/
RUN cd web && npm ci
COPY web/astro.config.ts web/tsconfig.json ./web/
COPY web/public ./web/public
COPY web/src ./web/src
RUN mkdir -p data
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
