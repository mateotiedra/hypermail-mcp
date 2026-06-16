# Hosting hypermail-mcp

This server runs either as a local stdio MCP (per-user) or as a hosted HTTP
service. This doc covers the HTTP case.

## Quick start

```bash
HYPERMAIL_KEY=$(hypermail-mcp generate-key) \
HYPERMAIL_DATA_DIR=/var/lib/mcp \
HYPERMAIL_OUTLOOK_CLIENT_ID=<your-entra-app-id> \
hypermail-mcp --http --host 0.0.0.0 --port 3000
```

Endpoint: `POST/GET/DELETE http://<host>:3000/mcp` (Streamable HTTP).

Sessions are tracked by the `Mcp-Session-Id` response header. Clients must echo
it back on subsequent requests; on `DELETE /mcp` with that header the session is
closed.

## Required environment

- `HYPERMAIL_KEY` — set explicitly when hosted. Use `hypermail-mcp generate-key`
  for a base64 32-byte key, or provide any passphrase (SHA-256 derives a key).
  Losing this key makes the existing accounts file unreadable.
- `HYPERMAIL_DATA_DIR` — a persistent, writable directory. The encrypted
  accounts blob lives at `${DIR}/accounts.json.enc`.
- Provider credentials only for providers you use. Outlook can use the built-in
  public client for local/device-code flows, but hosted operators should set
  `HYPERMAIL_OUTLOOK_CLIENT_ID` to an Entra app they control.

## Docker (minimal)

```dockerfile
FROM node:22-alpine
RUN npm install -g hypermail-mcp
RUN mkdir -p /var/lib/mcp
VOLUME /var/lib/mcp
EXPOSE 3000
CMD ["hypermail-mcp", "--http", "--host", "0.0.0.0", "--port", "3000", "--data-dir", "/var/lib/mcp"]
```

```bash
# Pass values through from your shell or deployment secret store.
docker run -d -p 3000:3000 \
  -e HYPERMAIL_KEY \
  -e HYPERMAIL_OUTLOOK_CLIENT_ID \
  -v hypermail-data:/var/lib/mcp \
  hypermail-mcp
```

## Reverse proxies

The HTTP transport is a thin layer over Node's `http`. Any reverse proxy that
preserves headers (`Mcp-Session-Id`, `Content-Type`) and supports SSE will work —
the server uses Server-Sent Events for streaming responses.
