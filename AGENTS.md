# hypermail-mcp

Unified email MCP server — operate any inbox (Outlook now, IMAP/Gmail later) by passing an email address.

## Purpose

Provides 8 tools to pi for email operations via the Model Context Protocol:
- `list_accounts` — list configured email accounts
- `add_account` / `complete_add_account` — OAuth device-code flow for adding accounts
- `remove_account` — forget an account and delete stored tokens
- `list_emails` — browse emails by folder (inbox, archive, sent, drafts, etc.)
- `search_emails` — full-text search via Outlook KQL
- `read_email` — fetch full email body (HTML), headers, and attachments metadata
- `send_email` — compose and send from a configured account

## Structure

```
src/
├── cli.ts              # Entry point → dist/cli.js (bin: hypermail-mcp)
├── server.ts           # MCP server setup, tool registration via @modelcontextprotocol/sdk
├── version.ts          # Version constant
├── providers/          # Email provider backends
│   ├── outlook/        # Microsoft Graph API (auth.ts, client.ts, index.ts)
│   ├── imap/           # IMAP/Gmail (future)
│   ├── registry.ts     # Provider registry/selection
│   └── types.ts        # Shared provider interfaces
├── store/              # Token and account persistence
│   └── account-store.ts
└── tools/              # Per-tool handler implementations
    └── index.ts
```

## Dev Workflow

This MCP is configured in `.mcp.json` with `lifecycle: "lazy"` and `directTools: true`. This means:

1. **Edit** source files in `src/`
2. **Build:** `pnpm build` (TypeScript → `dist/` via tsup)
   - Or `pnpm dev` for watch mode (auto-rebuild on save)
3. **Test with pi:** use the `hyper_email_*` tools directly — the lazy server restarts on next invocation, picking up the rebuilt `dist/cli.js` automatically
4. **Iterate** — no manual restarts or re-registration needed

### Commands

```bash
pnpm build        # Compile TypeScript
pnpm dev          # Watch mode (auto-rebuild)
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
