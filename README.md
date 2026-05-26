# hypermail-mcp

A **Model Context Protocol** server that lets an agent operate any of the user's
inboxes through a single, unified tool surface.

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

## Configuration

| Env var | Purpose | Default |
| --- | --- | --- |
| `HYPERMAIL_MCP_DATA_DIR` | Where to keep the encrypted accounts blob | `~/.hypermail-mcp` |
| `HYPERMAIL_MCP_KEY` | 32-byte AES-256-GCM key (hex, base64, or any passphrase — derived via SHA-256). Required for hosted deployments. | auto-generated, stored via OS keychain (`keytar`) or a local `master.key` file |
| `MS_CLIENT_ID` | Azure Entra public client (application) id used for device-code login | placeholder — **set your own for production** |
| `MS_TENANT_ID` | Tenant for the authority URL | `common` |

CLI flags: `--http`, `--port`, `--host`, `--data-dir`, `--read-only`, `--help`.

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
| `set_account_settings` | `account`, `signature?`, `style?` | Set signature HTML and font preferences. Disabled under `--read-only`. |
| `remove_account` | `email` | Deletes tokens for the account. |
| `list_emails` | `account`, `folder?`, `limit?`, `unreadOnly?`, `skip?` | Defaults: folder=`inbox`, limit=25. Supports pagination via `skip` — response includes `hasMore`. |
| `search_emails` | `account`, `query`, `limit?` | KQL on Outlook. |
| `read_email` | `account`, `id`, `format?` | Returns full body + recipients + attachment metadata. `format`: `markdown` (default), `html`, or `text`. |
| `read_attachment` | `account`, `messageId`, `attachmentId` | Download an attachment to a temporary file and return its path. |
| `archive_email` | `account`, `id` | Move a message to the Archive folder. Disabled under `--read-only`. |
| `trash_email` | `account`, `id` | Move a message to Deleted Items (trash). Disabled under `--read-only`. |
| `move_email` | `account`, `id`, `destination` | Move to any folder by well-known name (`inbox`, `drafts`, etc.) or custom folder ID. Disabled under `--read-only`. |
| `send_email` | `account`, `to[]`, `cc?`, `bcc?`, `subject`, `body`, `isHtml?`, `include_signature?`, `inReplyTo?`, `replyAll?`, `forwardMessageId?` | Send an email. Appends signature when `include_signature` is true. `inReplyTo` sends as threaded reply; `forwardMessageId` sends as forward. Disabled under `--read-only`. |
| `draft_email` | `account`, `to[]`, `cc?`, `bcc?`, `subject`, `body`, `isHtml?`, `include_signature?`, `inReplyTo?`, `replyAll?`, `forwardMessageId?` | Save as draft instead of sending. Returns the draft message ID and HTML body (`draftHtml`). Disabled under `--read-only`. |
| `edit_draft` | `account`, `id`, `to?`, `cc?`, `bcc?`, `subject?`, `body?`, `isHtml?`, `include_signature?` | Edit an existing draft by ID. Only provided fields are updated. Returns the updated draft ID and HTML body (`draftHtml`). Disabled under `--read-only`. |
| `send_draft` | `account`, `id` | Send an existing draft email by ID. Use with draft IDs returned by `draft_email` or `edit_draft`. Disabled under `--read-only`. |
| `add_attachment_to_draft` | `account`, `id`, `path` | Attach a local file to an existing draft email. Disabled under `--read-only`. |
| `list_folders` | `account`, `parentFolderId?` | List available mail folders. Returns top-level folders by default, or children of `parentFolderId`. |
| `create_folder` | `account`, `displayName`, `parentFolderId?` | Create a new mail folder under root (default) or the given parent. Disabled under `--read-only`. |
| `delete_folder` | `account`, `folderId` | Delete a mail folder by ID. Disabled under `--read-only`. |
| `rename_folder` | `account`, `folderId`, `newName` | Rename an existing mail folder. Disabled under `--read-only`. |
| `mark_read` | `account`, `id` | Mark a message as read. Disabled under `--read-only`. |
| `mark_unread` | `account`, `id` | Mark a message as unread. Disabled under `--read-only`. |

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
- Webhook / push notifications for new mail.

## Project layout

```
src/
  cli.ts                       # arg parsing + entry
  server.ts                    # MCP server, stdio + HTTP transports
  version.ts
  store/account-store.ts       # encrypted multi-account store (AES-256-GCM)
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
    shared/                    # Shared utilities across providers
  tools/index.ts               # MCP tool registrations
```

## License

MIT
