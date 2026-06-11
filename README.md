# hypermail-mcp

A **Model Context Protocol** server that lets an agent operate any of the user's
inboxes through a single, unified tool surface.

> **v0.7.4** — `inReplyTo` is now a required parameter on `send_email` and
> `draft_email` (was optional). Set it to `false` for a new email, or pass a
> message ID to thread a reply. This forces the agent to make an explicit choice
> instead of silently treating replies as new conversations.
>
> **v0.7.3** — `edit_draft` now preserves the quoted thread history when editing
> Outlook reply/forward drafts. Previously, editing a draft body would overwrite
> the entire content — including the quoted thread. Now only the answer part
> (above the spacer delimiter) is replaced.
>
> <!-- attachments moved into send_email/draft_email/edit_draft per v0.7.x -->
>> **v0.7.1** — Every config field is now settable via a dedicated
> `HYPERMAIL_*` env var. Legacy env vars (`MS_CLIENT_ID`, `MS_TENANT_ID`,
> `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) still work as fallbacks. See
> [Environment Variables](#environment-variables) for the full reference.
>
> **v0.7.0** — Email watch mode: background poll loop detects new inbox
> messages and POSTs them to a configurable webhook URL (e.g. Mastra). Opt-in —
> disabled by default, enabled via `HYPERMAIL_WATCH_ENABLED=true` or config.
> Works in both stdio and HTTP transport modes.
>
> **v0.6.3** — Unify stdio and HTTP modes into a single feature set. Removed
> email watch (inbox polling, SSE push, notification buffer), agent
> multi-tenancy (`agents.yaml`, `x-api-key` auth, per-agent allowlists), and
> the `check_notifications` tool. Dropped `js-yaml` dependency. Dockerfile
> simplified to a single `install → build → prune` step.
>
> **v0.6.2** — Version source-of-truth fix: `version.ts` now imports directly
> from `package.json` instead of hardcoding, preventing version drift between
> the two files.
>
> **v0.6.1** — Docker deployment (standalone Dockerfile with HEALTHCHECK),
> email notification bug fixes (ID-based dedup, pagination cap, dynamic
> re-scan), Node 22 base image, dropped docker-compose.
>
> **v0.5.0** — Replaced optional `isHtml` boolean with required `format`
> parameter (`"html"` | `"markdown"`) on `send_email`, `draft_email`, and
> `edit_draft`. Markdown bodies are converted to HTML via `marked` so
> recipients always see clean HTML.
>
> **v0.4.3** — Upgraded Zod to v4.4.3. Fixed MCP SDK v1.29.0 compatibility
> by wrapping all tool schemas in `z.object()` and replacing discriminated
> union output schemas that caused `validateToolOutput` crashes.

The agent doesn't care whether an address is a work Outlook account, a personal
Microsoft account, or (soon) a personal IMAP mailbox — it just calls
`list_emails`, `search_emails`, `read_email`, `send_email` and passes the email
address as the `account` argument. The server routes to the right backend.

**v1 status:** Outlook / Microsoft 365 (personal + work) fully supported via
Microsoft Graph. IMAP (any IMAP server) supported via `imapflow` + `nodemailer`.
Gmail supported via Google OAuth device-code flow.

## Why

- Existing Outlook/M365 MCP servers (e.g. `@softeria/ms-365-mcp-server`) expose
  ~200 raw Graph endpoints and are tied to a single signed-in user.
- This project wraps the same proven stack (`@azure/msal-node` for auth,
  `@microsoft/microsoft-graph-client` for HTTP) but exposes only a small,
  provider-agnostic email API and supports **multiple accounts at once**, keyed
  by email address.

## Install / run

```bash
npm install -g hypermail-mcp     # or pnpm / npx
hypermail-mcp --help
```

Run as a stdio MCP server (the default) — wire it into your MCP host:

### Claude Desktop / Claude Code

```jsonc
{
  "mcpServers": {
    "hyper-email": {
      "command": "npx",
      "args": ["-y", "hypermail-mcp"]
    }
  }
}
```

Or via the CLI:

```bash
claude mcp add hypermail -- npx -y hypermail-mcp
```

### As a hosted HTTP server

```bash
hypermail-mcp --http --port 3000 --host 0.0.0.0
# endpoint: http://<host>:3000/mcp  (Streamable HTTP transport, session-aware)
```

When hosted you **must** set `HYPERMAIL_MCP_KEY` so the account file is
reproducibly decryptable.

### Docker

```bash
# Build
docker build -t hypermail-mcp .

# Run
docker run -d \
  --name hypermail-mcp \
  -p 3000:3000 \
  -e HYPERMAIL_MCP_KEY=<32-byte-key> \
  -e MS_CLIENT_ID=<your-client-id> \
  -e MS_TENANT_ID=<your-tenant-id> \
  -v hypermail-data:/data \
  hypermail-mcp
```

The image runs the server in HTTP mode on port 3000 with a 30-second
HEALTHCHECK against `/mcp`. Data is persisted via a Docker volume at `/data`.

### Development

To test the HTTP server locally:

```bash
# Terminal 1: auto-rebuild TypeScript on save
pnpm dev

# Terminal 2: start HTTP server with dev config
pnpm dev:http
```

The server listens on `http://127.0.0.1:3000/mcp`. Pi connects via the
`.pi/mcp.json` config (read by `pi-mcp-adapter`). Tools appear as
`hypermail_http_*`.

## Add-account flow (Outlook)

| Env var | Purpose | Default |
| --- | --- | --- |
| `HYPERMAIL_MCP_DATA_DIR` | Where to keep the encrypted accounts blob | `~/.hypermail-mcp` |
| `HYPERMAIL_MCP_KEY` | 32-byte AES-256-GCM key (hex, base64, or any passphrase — derived via SHA-256). Required for hosted deployments. Auto-generated for stdio. | auto-generated, stored via OS keychain (`keytar`) or a local `master.key` file |
| `MS_CLIENT_ID` | Azure Entra public client (application) id used for device-code login | placeholder — **set your own for production** |
| `MS_TENANT_ID` | Tenant for the authority URL | `common` |

CLI flags: `--http`, `--port`, `--host`, `--data-dir`, `--read-only`, `--help`.

Subcommands: `hypermail-mcp generate-key` — generate an `hm_sk_` API key.

### Configuration

Instead of (or in addition to) CLI flags and env vars, you can configure the
server with a `hypermail-config.json` file next to the server binary. The server
looks for it in the same directory as `cli.js`.

```jsonc
{
  "http": { "enabled": true, "port": 3000, "host": "0.0.0.0" },
  "dataDir": "/path/to/data",
  "tools": {
    // allowlist: only these tools are registered
    "enabled": ["list_emails", "search_emails", "read_email", "send_email"],
    // blocklist: these tools are NOT registered
    // "disabled": ["add_account", "remove_account"]
  },
  "providers": {
    "outlook": { "clientId": "...", "tenantId": "..." }
  },
  "watch": {
    "enabled": true,
    "pollIntervalSeconds": 10,
    "webhook": {
      "url": "http://your-agent:3000/api/email-webhook",
      "retry": { "maxAttempts": 5, "baseDelayMs": 1000 }
    }
  }
}
```

Per-tool filtering (`tools.enabled` / `tools.disabled`) lets operators ship
minimal agent-facing surfaces — e.g. a read-only assistant that can only list
and read emails.

## Environment Variables

Every config field can be set via a dedicated `HYPERMAIL_*` env var, following
a dotted-path naming convention (`HYPERMAIL_HTTP_PORT`,
`HYPERMAIL_PROVIDERS_OUTLOOK_CLIENT_ID`, etc.). Legacy env vars
(`MS_CLIENT_ID`, `MS_TENANT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)
still work as fallbacks for backward compatibility.

| Env var | Config path | Type |
| --- | --- | --- |
| `HYPERMAIL_HTTP_ENABLED` | `http.enabled` | `bool` |
| `HYPERMAIL_HTTP_PORT` | `http.port` | `int` |
| `HYPERMAIL_HTTP_HOST` | `http.host` | `string` |
| `HYPERMAIL_TOOLS_ENABLED` | `tools.enabled` | comma-sep strings |
| `HYPERMAIL_TOOLS_DISABLED` | `tools.disabled` | comma-sep strings |
| `HYPERMAIL_PROVIDERS_OUTLOOK_CLIENT_ID` | `providers.outlook.clientId` | `string` |
| `HYPERMAIL_PROVIDERS_OUTLOOK_TENANT_ID` | `providers.outlook.tenantId` | `string` |
| `HYPERMAIL_PROVIDERS_GMAIL_CLIENT_ID` | `providers.gmail.clientId` | `string` |
| `HYPERMAIL_PROVIDERS_GMAIL_CLIENT_SECRET` | `providers.gmail.clientSecret` | `string` |
| `HYPERMAIL_WATCH_ENABLED` | `watch.enabled` | `bool` |
| `HYPERMAIL_WATCH_POLL_INTERVAL` | `watch.pollIntervalSeconds` | `int` |
| `HYPERMAIL_WATCH_WEBHOOK_URL` | `watch.webhook.url` | `string` |
| `HYPERMAIL_WATCH_WEBHOOK_RETRY_MAX_ATTEMPTS` | `watch.webhook.retry.maxAttempts` | `int` |
| `HYPERMAIL_WATCH_WEBHOOK_RETRY_BASE_DELAY_MS` | `watch.webhook.retry.baseDelayMs` | `int` |

**Priority order:** CLI flags > config file > `HYPERMAIL_*` env var > hardcoded default.

## Tools

All "email" tools take an `account` argument — the email address of the inbox
to operate on. The server resolves the right provider from the encrypted
account store.

| Tool | Inputs | Notes |
| --- | --- | --- |
| `list_accounts` | — | Returns registered emails + provider, no secrets. |
| `add_account` | `provider`, `email?`, `config?` | Starts device-code (Outlook). Returns `{handle, verification:{userCode, verificationUri, expiresAt}}`. |
| `complete_add_account` | `provider`, `handle` | Returns `pending` / `ready` / `expired` / `error`. |
| `get_account_settings` | `account` | Get signature (HTML) and style preferences for an account. |
| `set_account_settings` | `account`, `signature?`, `signaturePath?`, `style?` | Set signature HTML (inline or via file path) and font preferences. Disabled under `--read-only`. |
| `remove_account` | `email` | Deletes tokens for the account. |
| `list_emails` | `account`, `folder?`, `limit?`, `unreadOnly?`, `skip?` | Defaults: folder=`inbox`, limit=25. Supports pagination via `skip` — response includes `hasMore`. |
| `search_emails` | `account`, `query`, `limit?` | KQL on Outlook. |
| `read_email` | `account`, `id`, `format?` | Returns full body + recipients + attachment metadata. `format`: `markdown` (default), `html`, or `text`. |
| `read_attachment` | `account`, `messageId`, `attachmentId` | Download an attachment to a temporary file and return its path. |
| `archive_email` | `account`, `id` | Move a message to the Archive folder. Disabled under `--read-only`. |
| `trash_email` | `account`, `id` | Move a message to Deleted Items (trash). Disabled under `--read-only`. |
| `move_email` | `account`, `id`, `destination` | Move to any folder by well-known name (`inbox`, `drafts`, etc.) or custom folder ID. Disabled under `--read-only`. |
| `send_email` | `account`, `to[]`, `cc?`, `bcc?`, `subject`, `body`, `format`, `include_signature`, `inReplyTo`, `replyAll?`, `forwardMessageId?`, `attachments?` | Send an email. `format` (`"html"` or `"markdown"`) controls body format — Markdown is converted to HTML via `marked`. Appends signature when `include_signature` is true. `inReplyTo` sends as threaded reply; `forwardMessageId` sends as forward. `inReplyTo` is required — set to `false` for new emails. `attachments` is an optional array of `{filePath, name?}` — files are read from disk and encoded automatically. Disabled under `--read-only`. |
| `draft_email` | `account`, `to[]`, `cc?`, `bcc?`, `subject`, `body`, `format`, `include_signature`, `inReplyTo`, `replyAll?`, `forwardMessageId?`, `attachments?` | Save as draft instead of sending. Same params as `send_email` including `attachments`. Returns the draft message ID and HTML body (`draftHtml`). `inReplyTo` is required — set to `false` for new emails. Disabled under `--read-only`. |
| `edit_draft` | `account`, `id`, `to?`, `cc?`, `bcc?`, `subject?`, `body?`, `format?`, `include_signature?`, `new_attachments?`, `remove_attachments?` | Edit an existing draft by ID. Only provided fields are updated. `new_attachments` adds files (`{filePath, name?}[]`); `remove_attachments` removes by attachment ID (`string[]`). Returns the updated draft ID, HTML body (`draftHtml`), and attachment metadata. Disabled under `--read-only`. |
| `send_draft` | `account`, `id` | Send an existing draft email by ID. Use with draft IDs returned by `draft_email` or `edit_draft`. Disabled under `--read-only`. |
| `list_folders` | `account`, `parentFolderId?` | List available mail folders. Returns top-level folders by default, or children of `parentFolderId`. |
| `create_folder` | `account`, `displayName`, `parentFolderId?` | Create a new mail folder under root (default) or the given parent. Disabled under `--read-only`. |
| `delete_folder` | `account`, `folderId` | Delete a mail folder by ID. Disabled under `--read-only`. |
| `rename_folder` | `account`, `folderId`, `newName` | Rename an existing mail folder. Disabled under `--read-only`. |
| `mark_read` | `account`, `id` | Mark a message as read. Disabled under `--read-only`. |
| `mark_unread` | `account`, `id` | Mark a message as unread. Disabled under `--read-only`. |

## Email Watch

When enabled, hypermail-mcp runs a background poll loop that scans inboxes for
new messages and POSTs each one to a configurable webhook URL. Intended for
push-based email triage — downstream agents (e.g. Mastra) receive full email
content without polling.

```jsonc
{
  "watch": {
    "enabled": true,
    "pollIntervalSeconds": 10,
    "webhook": {
      "url": "http://localhost:3000/api/email-webhook",
      "retry": { "maxAttempts": 5, "baseDelayMs": 1000 }
    }
  }
}
```

| Setting | Default | Notes |
| --- | --- | --- |
| `watch.enabled` | `false` | Toggle via config or `HYPERMAIL_WATCH_ENABLED=true` env var |
| `watch.pollIntervalSeconds` | `10` | Min 10s, max 3600s |
| `watch.webhook.url` | — | Endpoint that receives `POST` with `EmailFull` JSON |
| `watch.webhook.retry.maxAttempts` | `5` | Max delivery attempts (1–10) |
| `watch.webhook.retry.baseDelayMs` | `1000` | Base backoff delay (× 2^attempt) |

**Behavior:**
- Polls **all accounts** in the store, **inbox only**.
- Detects new emails via `lastSeenIds` (capped at 200) stored in the encrypted
  account file — no duplicate emits across restarts.
- One `POST` per email (full body: subject, sender, text, HTML, attachments
  metadata, thread ID via `EmailFull`).
- Delivery uses exponential backoff (`baseDelay × 2^attempt`). Retries on
  non-2xx responses and connection errors. Logs and moves on after
  `maxAttempts` exhausted — never blocks the poll loop.
- Works in both **stdio** and **HTTP** transport modes — the poll interval
  fires normally alongside MCP message handling.

**Rate limits:** Polling every 10s on a single inbox = 6 req/min = 0.6% of
Microsoft Graph's 10,000 req/10min per-user limit. Safe for personal inboxes.

## Add-account flow (Outlook)

1. Agent calls `add_account({ provider: "outlook" })`.
2. Server returns:
   ```json
   {
     "status": "pending",
     "handle": "…uuid…",
     "verification": {
       "userCode": "ABCD-EFGH",
       "verificationUri": "https://microsoft.com/devicelogin",
       "expiresAt": "2025-…",
       "message": "To sign in, use a web browser to open …"
     }
   }
   ```
3. The user opens the URL and enters the code.
4. Agent polls `complete_add_account({ provider: "outlook", handle })` until
   it returns `{ "status": "ready", "account": {...} }`.
5. From then on, any tool can be called with `account: "<that-email>"`.

## Roadmap

- Threading / conversations.
- Calendar integration.

## Project layout

```
src/
  cli.ts                       # arg parsing + entry
  server.ts                    # MCP server, stdio + HTTP transports, session management
  version.ts                   # version constant
  config.ts                    # hypermail-config.json schema + resolution
  store/
    account-store.ts           # encrypted multi-account store (AES-256-GCM)
    crypto.ts                  # AES-256-GCM encrypt/decrypt, key resolution, atomic writes
  providers/
    types.ts                   # EmailProvider interface + shared DTOs
    registry.ts                # routes account email → provider
    outlook/
      auth.ts                  # msal-node device-code flow
      client.ts                # @microsoft/microsoft-graph-client factory
      index.ts                 # OutlookProvider implementation
    imap/index.ts              # IMAP provider (imapflow + nodemailer)
    gmail/
      auth.ts                  # Google OAuth device-code flow
      client.ts                # Gmail API (googleapis)
      index.ts                 # GmailProvider implementation
    shared/                    # shared utilities across providers
  watcher/
    manager.ts                 # WatcherManager — inbox poll loop + dedup
    webhook.ts                 # HTTP POST with exponential backoff retry
    index.ts                   # barrel export
  tools/
    index.ts                   # MCP tool registrations
    accounts.ts                # list/add/remove/complete-add account tools
    browse.ts                  # list/search/read email tools
    compose.ts                 # send/draft/edit/send-draft/add-attachment tools
    folders.ts                 # list/create/delete/rename folder tools
    organize.ts                # archive/trash/move/mark-read/mark-unread tools
    shared.ts                  # shared tool helpers
```

## License

MIT
