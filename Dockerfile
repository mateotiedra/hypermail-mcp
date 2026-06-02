FROM node:22-alpine

WORKDIR /app

# Install pnpm v10 (v11 breaks onlyBuiltDependencies config)
RUN corepack enable && corepack prepare pnpm@10 --activate

# Copy dependency manifests
COPY package.json pnpm-lock.yaml .npmrc ./

# Install production deps only (keytar is optional, skip native failures)
RUN pnpm install --prod --frozen-lockfile --ignore-scripts 2>/dev/null; \
    pnpm install --prod --frozen-lockfile || true

# Copy source and build
COPY tsconfig.json tsup.config.ts ./
COPY src/ ./src/
RUN pnpm install --frozen-lockfile && pnpm build

# Remove dev deps and source after build
RUN pnpm prune --prod

# Runtime
ENV NODE_ENV=production
EXPOSE 3000

# Create data directory and set up volumes
RUN mkdir -p /data

CMD ["node", "dist/cli.js", "--http", "--port", "3000", "--host", "0.0.0.0", "--data-dir", "/data"]
