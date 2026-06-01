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

## Structure

```
src/
├── cli.ts              # Entry point → dist/cli.js (bin: hypermail-mcp)
├── server.ts           # MCP server setup (stdio + HTTP), session management
├── version.ts          # Version constant
├── config.ts           # hypermail-config.json schema + resolution
├── config/
│   └── agents-config.ts  # agents.yaml schema, validation, live-reload watcher
├── providers/          # Email provider backends
│   ├── outlook/        # Microsoft Graph API (auth.ts, client.ts, index.ts)
│   ├── imap/           # IMAP provider (index.ts)
│   ├── gmail/          # Gmail API provider (auth.ts, client.ts, index.ts)
│   ├── registry.ts     # Provider registry/selection
│   └── types.ts        # Shared provider interfaces
├── store/              # Persistence
│   ├── account-store.ts  # AES-256-GCM encrypted multi-account store
│   ├── agent-store.ts    # Agent identity + credentials (HTTP multi-tenant)
│   └── crypto.ts         # encrypt/decrypt, key resolution, atomic writes
├── watcher/            # Email watch (HTTP mode only)
│   ├── manager.ts      # Inbox poller + notification buffer
│   └── index.ts        # Public API
└── tools/              # Per-tool handler implementations
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
- `HYPERMAIL_MCP_DATA_DIR` — directory for token/account storage

## Key Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol implementation
- `@microsoft/microsoft-graph-client` — Outlook/Microsoft 365 Graph API
- `@azure/msal-node` — OAuth device-code authentication
- `zod` — input validation for tool parameters
