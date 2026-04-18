# Builder stage
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# SDK is now on npm (@percolatorct/sdk) — no vendor directory needed

# Install all dependencies (including devDeps for TypeScript compilation)
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Build
RUN pnpm build

# Runner stage
FROM node:22-alpine AS runner

# Install curl for health checks
RUN apk add --no-cache curl

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Copy package files for prod-only install
COPY package.json pnpm-lock.yaml ./

# K-NEW-1: install production deps only — excludes vitest, vite, tsx, @types/*
# and their associated CVEs from the final image. (pnpm install --prod is deprecated;
# use --prod flag which maps to --only=prod in pnpm v10)
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Change ownership to node user
RUN chown -R node:node /app

# Switch to non-root user
USER node

EXPOSE 8081

# Health check — start-period must exceed worst-case startup discovery
# (4 retries × escalating delays = ~110s, plus inter-program spacing)
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD curl -f http://localhost:${KEEPER_HEALTH_PORT:-8081}/health || exit 1

CMD ["node", "dist/index.js"]
