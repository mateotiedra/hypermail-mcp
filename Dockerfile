FROM node:22-alpine

WORKDIR /app

# Install pnpm v10 (v11 breaks onlyBuiltDependencies config)
RUN corepack enable && corepack prepare pnpm@10 --activate

# Install, build, and remove dev deps — all in one layer
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build && pnpm prune --prod

# Runtime
ENV NODE_ENV=production
EXPOSE 3000

# Create data directory
RUN mkdir -p /data

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/mcp',()=>process.exit(0)).on('error',()=>process.exit(1))"

CMD ["node", "dist/cli.js", "--http", "--port", "3000", "--host", "0.0.0.0", "--data-dir", "/data"]
