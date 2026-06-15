# Deploy hypermail-mcp to Dokploy

Dockerfile-only deployment — no compose file, no port bindings, no manual labels. Everything is configured in the Dokploy UI.

## Prerequisites

- A domain pointed at your VPS (e.g. `mail-api.example.com`)
- Dokploy installed and connected to your Git provider

## Step-by-step

### 1. Create the Application

1. **Create Service** → **Application**
2. Select your Git provider, repository, and branch
3. **Build Path**: `/` (root of repo — that's where the Dockerfile lives)
4. **Save**

### 2. Set the encryption key

Go to the **Environment** tab and add:

| Variable | Value |
|----------|-------|
| `HYPERMAIL_MCP_KEY` | Run `openssl rand -hex 32` and paste the output |

This key encrypts your OAuth tokens at rest. Back it up — if lost, you'll need to re-authenticate every email account.

### 3. Configure persistent storage

Go to **Advanced** → **Mounts** → add a bind mount:

| Host path | Container path |
|-----------|---------------|
| `../files/data` | `/data` |

This persists your encrypted tokens across redeploys. Dokploy creates the host path automatically on first deploy.

> `../files/` is Dokploy's persistent directory for this application. Anything there survives redeploys.

### 4. Add a domain

Go to the **Domains** tab → **Add Domain** → enter your domain (e.g. `mail-api.example.com`).

Dokploy auto-generates Traefik routing and provisions a Let's Encrypt TLS certificate on deploy. No manual config needed.

### 5. Deploy

Click **Deploy**. Check **Logs** — you should see:

```
[hypermail-mcp] listening on http://0.0.0.0:3000/mcp
```

### 6. Verify

```bash
curl https://your-domain.com/mcp
```

## Connecting clients

```json
{
  "mcpServers": {
    "hypermail-http": {
      "type": "streamableHttp",
      "url": "https://mail-api.example.com/mcp"
    }
  }
}
```

## Provider credentials (optional)

Set these in the **Environment** tab — only for providers you use:

| Variable | Provider |
|----------|----------|
| `HYPERMAIL_PROVIDERS_OUTLOOK_CLIENT_ID` | Outlook |
| `HYPERMAIL_PROVIDERS_OUTLOOK_TENANT_ID` | Outlook |
| `HYPERMAIL_PROVIDERS_GMAIL_CLIENT_ID` | Gmail |
| `HYPERMAIL_PROVIDERS_GMAIL_CLIENT_SECRET` | Gmail |

## What's in the Dockerfile

| Instruction | Purpose |
|-------------|---------|
| `COPY . .` | Copies entire repo into `/app` |
| `pnpm install && pnpm build && pnpm prune --prod` | Single install + build + dev dep cleanup |
| `EXPOSE 3000` | Internal port (Dokploy uses this for routing) |
| `HEALTHCHECK` | Docker checks `localhost:3000/mcp` every 30s |
| `ENV NODE_ENV=production` | Production mode |
| `CMD node dist/cli.js --http ...` | Starts MCP server on `0.0.0.0:3000` |
