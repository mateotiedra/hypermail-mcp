FROM node:20-alpine

WORKDIR /app

# Install pnpm globally
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependency manifests
COPY package.json pnpm-lock.yaml ./

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
ENV HYPERMAIL_MCP_KEY=""
ENV HYPERMAIL_MCP_DATA_DIR="/data"
ENV HYPERMAIL_AGENTS_CONFIG="/data/agents.yaml"

EXPOSE 3000

# Create data directory and set up volumes
RUN mkdir -p /data

CMD ["node", "dist/cli.js", "--http", "--port", "3000", "--host", "0.0.0.0", "--data-dir", "/data"]
