# hypermail-mcp

Unified email MCP server — operate any inbox (Outlook now, IMAP/Gmail later) by passing an email address.

## Purpose

Provides 26 tools to pi for email operations via the Model Context Protocol:
- `list_accounts` / `add_account` / `complete_add_account` / `remove_account` — account management
- `list_emails` / `search_emails` / `read_email` / `read_attachment` — browse and read
- `send_email` / `draft_email` / `edit_draft` / `send_draft` / `add_attachment_to_draft` — compose
- `archive_email` / `trash_email` / `move_email` / `mark_read` / `mark_unread` — organize
- `list_folders` / `create_folder` / `delete_folder` / `rename_folder` — folders
- `check_notifications` — email watch alerts (HTTP mode only)

## Modes

Two operation modes, selected via `--mode` flag (default: `solo`):

### Solo mode (`--mode solo`, default)
- File-based stores (accounts.json.enc, agents.yaml)
- Works over stdio or HTTP
- No authentication required
- No database needed

### Multi mode (`--mode multi`)
- PostgreSQL-backed stores (agents, accounts tables)
- HTTP only (implied `--http`)
- x-api-key authentication required for MCP sessions
- Admin API at `/admin` for managing agents and accounts
- Requires `DATABASE_URL` and `HYPERMAIL_ENCRYPTION_KEY` env vars

## Structure

```
src/
├── cli.ts              # Entry point → dist/cli.js (bin: hypermail-mcp)
├── server.ts           # MCP server setup (stdio + HTTP), session management
├── version.ts          # Version constant
├── config.ts           # hypermail-config.json schema + resolution
├── config/
│   └── agents-config.ts  # agents.yaml schema, validation, live-reload watcher (solo mode)
├── admin/
│   └── router.ts       # Admin API route handler (multi mode only)
├── db/                 # PostgreSQL layer (multi mode only, dynamic import)
│   ├── index.ts        # Public API: healthCheck, closePool, runMigrations
│   ├── connection.ts   # Connection pool manager (dynamic pg import)
│   ├── migrate.ts      # Versioned migration runner
│   ├── account-store.ts  # DB-backed account store (AES-256-GCM encryption)
│   └── agent-store.ts    # DB-backed agent store (scrypt API key hashing)
├── mode/               # Mode plugin abstraction
│   ├── types.ts        # ModePlugin interface + store interfaces
│   ├── solo.ts         # Solo plugin (file-based, no auth)
│   └── multi.ts        # Multi plugin (DB-backed, auth, admin API)
├── providers/          # Email provider backends
│   ├── outlook/        # Microsoft Graph API (auth.ts, client.ts, index.ts)
│   ├── imap/           # IMAP provider (index.ts)
│   ├── gmail/          # Gmail API provider (auth.ts, client.ts, index.ts)
│   ├── registry.ts     # Provider registry/selection
│   └── types.ts        # Shared provider interfaces
├── store/              # File-based persistence (solo mode)
│   ├── account-store.ts  # AES-256-GCM encrypted multi-account store
│   ├── agent-store.ts    # Agent identity + credentials
│   └── crypto.ts         # encrypt/decrypt, key resolution, atomic writes
├── watcher/            # Email watch (HTTP mode only)
│   ├── manager.ts      # Inbox poller + notification buffer
│   └── index.ts        # Public API
└── tools/              # Per-tool handler implementations (shared, mode-agnostic)
    ├── index.ts        # Tool registration
    ├── agent-context.ts  # Agent authorization guards
    ├── accounts.ts     # Account management tools
    ├── browse.ts       # List/search/read tools
    ├── compose.ts      # Send/draft/attachment tools
    ├── folders.ts      # Folder management tools
    ├── notifications.ts  # check_notifications (HTTP only)
    ├── organize.ts     # Archive/trash/move/mark tools
    └── shared.ts       # Shared helpers
```

## Dev Workflow

This MCP is configured in `.mcp.json` with `lifecycle: "lazy"` and `directTools: true`. This means:

1. **Edit** source files in `src/`
2. **Build:** `pnpm build` (TypeScript → `dist/` via tsup)
   - Or `pnpm dev` for watch mode (auto-rebuild on save)
3. **Test with pi (stdio):** use the `hyper_*` tools directly — the lazy server restarts on next invocation, picking up the rebuilt `dist/cli.js` automatically
4. **Test with pi (HTTP, email watch):** start `pnpm dev:http` in a separate terminal FIRST. This starts the server in persistent HTTP mode so the email watcher runs. Pi connects via `.pi/mcp.json` (read by `pi-mcp-adapter`). Tools appear as `hypermail_http_*`. On first session, run `/mcp reconnect hypermail-http` if tools don't appear — the adapter caches metadata after first connection.
5. **Iterate** — no manual restarts or re-registration needed

### Commands

```bash
pnpm build        # Compile TypeScript
pnpm dev          # Watch mode (auto-rebuild)
pnpm dev:http     # Build + start HTTP server for email-watch testing
pnpm typecheck    # TypeScript type checking
pnpm test         # Run vitest tests
pnpm start        # Run dist/cli.js directly
```

### Environment

Required env vars (set in `.mcp.json`):
- `MS_CLIENT_ID` — Azure/Entra ID app registration client ID
- `MS_TENANT_ID` — Azure/Entra ID tenant ID
- `HYPERMAIL_MCP_DATA_DIR` — directory for token/account storage (solo mode)

Multi mode env vars:
- `DATABASE_URL` — PostgreSQL connection string (required, e.g. `postgresql://user:pass@localhost:5432/hypermail`)
- `HYPERMAIL_ENCRYPTION_KEY` — 64 hex chars or base64-encoded 32 bytes for OAuth token encryption (required, generate with `openssl rand -hex 32`)
- `HYPERMAIL_ADMIN_KEY` — bearer token for admin API access (optional; admin API returns 404 if unset)

## Admin API (multi mode only)

Protected by `Authorization: Bearer <HYPERMAIL_ADMIN_KEY>` header.
Returns 404 if `HYPERMAIL_ADMIN_KEY` env var is not set.

```
GET    /admin/agents           → list agents (no api_key_hash exposed)
POST   /admin/agents           → create agent { id, api_key, name, accounts?, provisioning? }
DELETE /admin/agents/:id       → remove agent
GET    /admin/accounts          → list email accounts (no tokens exposed)
DELETE /admin/accounts/:email  → remove email account (URL-encode the email)
```

Agent creation example:
```bash
curl -X POST http://localhost:3000/admin/agents \
  -H "Authorization: Bearer $HYPERMAIL_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-agent",
    "api_key": "hm_sk_$(openssl rand -hex 32)",
    "name": "My Agent",
    "accounts": ["user@example.com"],
    "provisioning": true
  }'
```

## Key Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol implementation
- `@microsoft/microsoft-graph-client` — Outlook/Microsoft 365 Graph API
- `@azure/msal-node` — OAuth device-code authentication
- `zod` — input validation for tool parameters
