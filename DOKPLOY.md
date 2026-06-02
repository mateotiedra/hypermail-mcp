# Deploy hypermail-mcp to Dokploy

Minimal compose file, provider-agnostic. Everything provider-specific is configured in the Dokploy UI, not baked into the compose file.

## docker-compose.yml — what's in it

```yaml
services:
  hypermail-mcp:
    build: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:${HYPERMAIL_PORT:-3090}:3000"
    environment:
      - HYPERMAIL_MCP_KEY=${HYPERMAIL_MCP_KEY}
    volumes:
      - hypermail-data:/data
```

That's it. No provider references, no network config, no auth boilerplate.

| Element | Purpose |
|---------|---------|
| `HYPERMAIL_MCP_KEY` | AES-256-GCM key for encrypting stored OAuth tokens. **Required.** |
| `HYPERMAIL_PORT` | Host port to bind. Defaults to `3090`. Set in Environment tab to override. |
| `hypermail-data:/data` | Persistent volume for `accounts.json.enc` (tokens) and `agents.json.enc` (hashed API keys). |

## Step-by-step deployment

### 1. Push to a Git repository

```bash
git remote add origin git@github.com:you/hypermail-mcp.git
git push -u origin main
```

### 2. Connect Git provider in Dokploy

Dokploy dashboard → **Settings** → **Git Sources** → connect provider.

### 3. Create a Compose service

1. **Create Service** → **Compose** → **Docker Compose**
2. Select your repo + branch
3. **Compose Path**: `./docker-compose.yml`
4. **Save**

### 4. Set required env var

Go to the **Environment** tab:

| Variable | Value |
|----------|-------|
| `HYPERMAIL_MCP_KEY` | `openssl rand -hex 32` — back this up, if lost all stored tokens become unreadable |

### 5. Add provider credentials (optional)

Set these in the **Environment** tab — only for providers you use. The compose file doesn't need to know about them; the auth modules read them from `process.env` directly.

| Variable | Provider | How to get it |
|----------|----------|---------------|
| `MS_CLIENT_ID` | Outlook | Azure Entra ID → app registration → Application (client) ID |
| `MS_TENANT_ID` | Outlook | Azure Entra ID → Directory (tenant) ID |
| `GOOGLE_CLIENT_ID` | Gmail | Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_CLIENT_SECRET` | Gmail | Same as client ID |

If you skip Outlook credentials, the server falls back to a shared public client ID — fine for personal use, but register your own app for production.

### 6. Deploy

Click **Deploy**. Check **Logs** — you should see:

```
[hypermail-mcp] listening on http://0.0.0.0:3000/mcp
```

### 7. Verify

```bash
curl http://localhost:${HYPERMAIL_PORT:-3090}/mcp
```

Should return an HTTP response (not connection refused).

## How agents connect

### Default: direct localhost

The server binds to `127.0.0.1` on the VPS. Only processes on the VPS can reach it.

```json
{
  "mcpServers": {
    "hypermail-http": {
      "type": "streamableHttp",
      "url": "http://localhost:3090/mcp"
    }
  }
}
```

Change the port if you set `HYPERMAIL_PORT` to something else.

### Optional: public domain via Dokploy Domains UI

1. In your Compose service → **Domains** tab → **Add Domain**
2. Configure your domain (e.g. `mail-api.example.com`)
3. Set up a DNS A record pointing to your VPS

Dokploy auto-generates the Traefik labels and TLS certificate at deploy time. No changes needed in `docker-compose.yml`.

Then connect via:

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

## Authentication (optional)

By default the server runs **without** API key auth — anyone who can reach the port can use it. This is correct when only you use it on an internal VPS.

To enable auth:

1. Create an `agents.yaml` file:

```yaml
agents:
  - id: pi
    api_key: hm_sk_<64-hex-chars>    # generate with: openssl rand -hex 32 | sed 's/^/hm_sk_/'
    name: "Pi Coding Agent"
    accounts: []                       # auto-assigned when you run add_account
    provisioning: true                 # allow adding/removing accounts
```

2. Upload it to your VPS, e.g. `/etc/hypermail/agents.yaml`

3. In Dokploy: your service → **Advanced** → **Mounts** → add a File Mount:
   - **Host path**: `/etc/hypermail/agents.yaml`
   - **Container path**: `/data/agents.yaml`

4. Uncomment `ENV HYPERMAIL_AGENTS_CONFIG="/data/agents.yaml"` in the **Dockerfile**

5. Set `HYPERMAIL_AGENTS_CONFIG=/data/agents.yaml` in the **Environment** tab

6. Redeploy

Now every connection needs an `x-api-key` header matching an agent in `agents.yaml`. Each agent only sees the accounts assigned to them.

> `agents.yaml` is **live-reloaded** — add or remove agents without restarting.

## Customizing the port

Set `HYPERMAIL_PORT` in the Environment tab. The default is `3090`.

```yaml
# In docker-compose.yml:
ports:
  - "127.0.0.1:${HYPERMAIL_PORT:-3090}:3000"
```

The container port (`3000`) never changes — that's the server's internal listener.

## Volumes & data persistence

The `hypermail-data` named volume at `/data` persists:

| File | Contents |
|------|----------|
| `accounts.json.enc` | AES-256-GCM encrypted OAuth tokens for all connected email accounts |
| `agents.json.enc` | scrypt-hashed API keys (only when `agents.yaml` is loaded) |

**No additional volumes are needed.**

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Build fails on `pnpm install` | Ensure `pnpm-lock.yaml` is committed and up to date |
| Container starts then exits | Check logs — likely missing `HYPERMAIL_MCP_KEY` |
| `curl: connection refused` on the port | Verify `HYPERMAIL_PORT` matches. Check logs for bind errors. |
| `[hypermail-mcp] agents.yaml reload error` | Ignore if not using auth. To suppress, ensure `HYPERMAIL_AGENTS_CONFIG` is not set. |
| Healthcheck failing | The server isn't starting — check logs for errors |
