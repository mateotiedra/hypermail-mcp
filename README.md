# hypermail-mcp

A **Model Context Protocol** server that lets an agent operate any of the user's
inboxes through a single, unified tool surface.

> **v0.6.2** — Version source-of-truth fix: `version.ts` now imports directly
> from `package.json` instead of hardcoding, preventing version drift between
> the two files.
>
> **v0.6.1** — Docker deployment (standalone Dockerfile with HEALTHCHECK),
> email notification bug fixes (ID-based dedup, pagination cap, dynamic
> re-scan), Node 22 base image, dropped docker-compose.
>
> **v0.6.0** — Email watch notifications (polling-based), `signaturePath`
> support in `set_account_settings` for loading signatures from files,
> and a `check_notifications` tool for draining pending alerts.
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
Pass `HYPERMAIL_AGENTS_CONFIG` and mount a config file for agent multi-tenancy.

### Development (HTTP mode + email watch)

To test the email watch feature locally:

```bash
# Terminal 1: auto-rebuild TypeScript on save
pnpm dev

# Terminal 2: start HTTP server with dev config (10s poll, separate data dir)
pnpm dev:http
```

The server listens on `http://127.0.0.1:3000/mcp`. Pi connects via the
`.pi/mcp.json` config (read by `pi-mcp-adapter`). Tools appear as
`hypermail_http_*` (e.g. `hypermail_http_check_notifications`).

The dev config (`hypermail-config.http.json`) uses a separate data dir
(`~/.hypermail-mcp-dev`) and a 10-second poll interval for fast feedback.

## Modes: stdio vs HTTP

The server runs in one of two modes — the choice affects session management,
security, and which features are available.

| | stdio (default) | HTTP (`--http`) |
| --- | --- | --- |
| **Transport** | stdin/stdout | HTTP (Streamable HTTP MCP) |
| **Lifecycle** | Per-invocation (lazy) — spawned on demand by the MCP host | Long-lived server process |
| **Session model** | One `McpServer` instance for all invocations | One `McpServer` per MCP session (multi-tenant) |
| **Key management** | Auto-generated, stored in OS keychain or `master.key` file | Requires `HYPERMAIL_MCP_KEY` env var (32-byte key for AES-256-GCM) |
| **Email watch** | ❌ Not available | ✅ Polls inbox every N seconds for new mail |
| **`check_notifications`** | ❌ Not registered | ✅ Drains pending new-mail alerts |
| **Agent multi-tenancy** | ❌ Unrestricted access | ✅ Per-agent API keys, account allowlists, provisioning control (via `agents.yaml`) |
| **Pi tool naming** | `hyper_*` | `hypermail_http_*` |

**When to use HTTP mode:**
- You need email watch / push notifications
- You want to expose the server to multiple agents with different permissions
- You're hosting the server as a service (Docker, cloud)

**When to use stdio mode:**
- Single-user local development with a desktop MCP client (Claude, Pi)
- You don't need email watch or multi-agent access control

## Agent multi-tenancy

In HTTP mode, the server can be shared across multiple agents with
different permissions. Agent identity and authorization are defined in an
`agents.yaml` file.

### agents.yaml

```yaml
agents:
  - id: my-assistant
    api_key: hm_sk_<64-hex-chars>
    name: My Email Assistant
    accounts:                          # which email addresses this agent can access
      - alice@example.com
      - bob@example.com
    provisioning: false                # can this agent add/remove accounts?

  - id: admin-agent
    api_key: hm_sk_<64-hex-chars>
    name: Admin Agent
    accounts: []                       # empty = all accounts
    provisioning: true

# Optional: pre-declare email accounts with provider hints
email_accounts:
  alice@example.com:
    provider: outlook
```

**Agent ID:** lowercase letters, digits, hyphens, underscores. No spaces.

**API key format:** `hm_sk_` prefix + 64 hex characters. Generate with:

```bash
hypermail-mcp generate-key
# => hm_sk_a1b2c3d4...
```

The API key is hashed (SHA-256) before storage — the plaintext is never
written to disk. Agents authenticate by passing the key in the
`Authorization: Bearer hm_sk_...` header.

**accounts:** An allowlist of email addresses the agent can operate on.
If empty or omitted, the agent can access all configured accounts.

**provisioning:** When `true`, the agent can call `add_account` and
`remove_account`. Defaults to `false`.

### Configuration

Point the server at your agents.yaml:

```bash
# Via CLI flag
hypermail-mcp --http --agents-config ./agents.yaml

# Via env var
export HYPERMAIL_AGENTS_CONFIG=/etc/hypermail/agents.yaml
```

The server watches `agents.yaml` for changes and reloads automatically
(live reload — no restart needed). Agents removed from the file lose
access on their next request.

In **stdio mode**, agent multi-tenancy is not available — the server runs
with unrestricted access (the local user _is_ the agent).

## Configuration

| Env var | Purpose | Default |
| --- | --- | --- |
| `HYPERMAIL_MCP_DATA_DIR` | Where to keep the encrypted accounts blob | `~/.hypermail-mcp` |
| `HYPERMAIL_MCP_KEY` | 32-byte AES-256-GCM key (hex, base64, or any passphrase — derived via SHA-256). Required for hosted deployments. | auto-generated, stored via OS keychain (`keytar`) or a local `master.key` file |
| `HYPERMAIL_AGENTS_CONFIG` | Path to `agents.yaml` for HTTP multi-tenant mode (see Agent multi-tenancy above). | — (multi-tenancy disabled) |
| `MS_CLIENT_ID` | Azure Entra public client (application) id used for device-code login | placeholder — **set your own for production** |
| `MS_TENANT_ID` | Tenant for the authority URL | `common` |

CLI flags: `--http`, `--port`, `--host`, `--data-dir`, `--agents-config`, `--read-only`, `--help`.

Subcommands: `hypermail-mcp generate-key` — generate an `hm_sk_` API key for agents.yaml.

### Config file (`hypermail-config.json`)

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
  }
}
```

Per-tool filtering (`tools.enabled` / `tools.disabled`) lets operators ship
minimal agent-facing surfaces — e.g. a read-only assistant that can only list
and read emails.

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
| `send_email` | `account`, `to[]`, `cc?`, `bcc?`, `subject`, `body`, `format`, `include_signature?`, `inReplyTo?`, `replyAll?`, `forwardMessageId?` | Send an email. `format` (`"html"` or `"markdown"`) controls body format — Markdown is converted to HTML via `marked`. Appends signature when `include_signature` is true. `inReplyTo` sends as threaded reply; `forwardMessageId` sends as forward. Disabled under `--read-only`. |
| `draft_email` | `account`, `to[]`, `cc?`, `bcc?`, `subject`, `body`, `format`, `include_signature?`, `inReplyTo?`, `replyAll?`, `forwardMessageId?` | Save as draft instead of sending. `format` (`"html"` or `"markdown"`) controls body format — Markdown is converted to HTML via `marked`. Returns the draft message ID and HTML body (`draftHtml`). Disabled under `--read-only`. |
| `edit_draft` | `account`, `id`, `to?`, `cc?`, `bcc?`, `subject?`, `body?`, `format?`, `include_signature?` | Edit an existing draft by ID. Only provided fields are updated. `format` only meaningful when `body` is provided. Returns the updated draft ID and HTML body (`draftHtml`). Disabled under `--read-only`. |
| `send_draft` | `account`, `id` | Send an existing draft email by ID. Use with draft IDs returned by `draft_email` or `edit_draft`. Disabled under `--read-only`. |
| `add_attachment_to_draft` | `account`, `id`, `name`, `contentBytes`, `contentType?` | Attach a base64-encoded file to an existing draft email by ID. Disabled under `--read-only`. |
| `list_folders` | `account`, `parentFolderId?` | List available mail folders. Returns top-level folders by default, or children of `parentFolderId`. |
| `create_folder` | `account`, `displayName`, `parentFolderId?` | Create a new mail folder under root (default) or the given parent. Disabled under `--read-only`. |
| `delete_folder` | `account`, `folderId` | Delete a mail folder by ID. Disabled under `--read-only`. |
| `rename_folder` | `account`, `folderId`, `newName` | Rename an existing mail folder. Disabled under `--read-only`. |
| `mark_read` | `account`, `id` | Mark a message as read. Disabled under `--read-only`. |
| `mark_unread` | `account`, `id` | Mark a message as unread. Disabled under `--read-only`. |
| `check_notifications` | — | Returns pending email-watch notifications (new-email alerts, auth failures). Drains the buffer on read. Only registered in HTTP mode. |

## Email Watch

When running in **HTTP mode** (`--http`), the server polls all configured
accounts every N seconds for new inbox mail. Detected emails and auth failures
are delivered through two channels:

- **Push** — `notifications/message` sent over the MCP stream. Compatible
  clients (e.g. Mastra) receive these in real time.
- **Poll** — `check_notifications` tool drains an in-memory buffer. Works with
  **any** MCP client, even those that don't maintain an SSE listener.

**Configuration** (in `hypermail-config.json`):

```jsonc
{
  "watch": {
    "enabled": true,            // default true
    "pollIntervalSeconds": 60   // default 60 (min 10, max 3600)
  }
}
```

**Behavior:**

- Only the **inbox** folder is watched. All stored accounts are polled by default.
- On first poll per account, the server records the newest email as a baseline
  (no notifications). Only emails arriving after baseline trigger alerts.
- Baselines (`lastSeenAt`) persist in the account store — they survive server
  restarts.
- Each poll paginates through the inbox (25 items per page) to catch email
  bursts without missing messages.
- Auth failures (e.g. expired OAuth tokens) generate immediate notifications.

**Not supported in stdio mode.** The watcher requires a long-lived server
process. In stdio mode the `check_notifications` tool is not registered.

### Add-account flow (Outlook)

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
  config/
    agents-config.ts           # agents.yaml schema, validation, live-reload watcher
  store/
    account-store.ts           # encrypted multi-account store (AES-256-GCM)
    agent-store.ts             # agent identity + credentials store (HTTP multi-tenant)
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
    manager.ts                 # inbox poller + notification buffer
    index.ts                   # watcher public API
  tools/
    index.ts                   # MCP tool registrations
    agent-context.ts           # agent authorization guards (checkAccountAccess, checkProvisioning)
    accounts.ts                # list/add/remove/complete-add account tools
    browse.ts                  # list/search/read email tools
    compose.ts                 # send/draft/edit/send-draft/add-attachment tools
    folders.ts                 # list/create/delete/rename folder tools
    notifications.ts           # check_notifications tool (HTTP only)
    organize.ts                # archive/trash/move/mark-read/mark-unread tools
    shared.ts                  # shared tool helpers
```

## License

MIT
