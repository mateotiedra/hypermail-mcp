# Hosting hypermail-mcp

This server is designed to run either as a local stdio MCP (per-user) or as a
multi-tenant HTTP service. This doc covers the HTTP case.

## Quick start

```bash
HYPERMAIL_MCP_KEY=$(openssl rand -base64 32) \
HYPERMAIL_MCP_DATA_DIR=/var/lib/hypermail-mcp \
MS_CLIENT_ID=<your-entra-app-id> \
hypermail-mcp --http --host 0.0.0.0 --port 3000
```

Endpoint: `POST/GET/DELETE http://<host>:3000/mcp` (Streamable HTTP).

Sessions are tracked by the `Mcp-Session-Id` response header. Clients must
echo it back on subsequent requests; on `DELETE /mcp` with that header the
session is closed.

## Required environment

- `HYPERMAIL_MCP_KEY` — **must** be set explicitly when hosted. 32 bytes
  encoded as base64 or hex, or any passphrase (SHA-256 will derive a key).
  Losing this key makes the existing accounts file unreadable.
- `HYPERMAIL_MCP_DATA_DIR` — a persistent, writable directory. The encrypted
  accounts blob lives at `${DIR}/accounts.json.enc`.
- `MS_CLIENT_ID` — register your own Entra public client (Mobile & desktop
  application) with redirect URI `https://login.microsoftonline.com/common/oauth2/nativeclient`
  and these delegated scopes:
  - `offline_access`
  - `User.Read`
  - `Mail.ReadWrite`
  - `Mail.Send`

## Docker (minimal)

```dockerfile
FROM node:20-slim
RUN npm install -g hypermail-mcp
ENV HYPERMAIL_MCP_DATA_DIR=/data
VOLUME /data
EXPOSE 3000
CMD ["hypermail-mcp", "--http", "--host", "0.0.0.0", "--port", "3000"]
```

```bash
docker run -d -p 3000:3000 \
  -e HYPERMAIL_MCP_KEY=... \
  -e MS_CLIENT_ID=... \
  -v hypermail-data:/data \
  hypermail-mcp
```

## Read-only mode

Pass `--read-only` (or set it in the CLI) to disable `add_account`,
`remove_account`, and `send_email` — useful when exposing a shared inbox to an
agent that should only ingest, not act.

## Reverse proxies

The HTTP transport is a thin layer over Node's `http`. Any reverse proxy that
preserves headers (`Mcp-Session-Id`, `Content-Type`) and supports SSE will
work — the server uses Server-Sent Events for streaming responses.
