import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AccountRecord, AccountStore } from "../store/account-store.js";
import type { Registry } from "../providers/registry.js";
import type { EmailProvider, ProviderId, SendInput } from "../providers/types.js";
import { selectBody } from "../html-to-markdown.js";

export interface RegisterToolsOptions {
  store: AccountStore;
  registry: Registry;
  readOnly?: boolean;
  /** When true, send_email is not registered — only send_draft is available. */
  draftOnly?: boolean;
}

/** JSON-stringify a value into a single MCP text content block. */
function ok(data: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}
function fail(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

const emailAddrSchema = z.object({
  address: z.string().email(),
  name: z.string().optional(),
});

export function registerTools(server: McpServer, opts: RegisterToolsOptions): void {
  const { store, registry, readOnly = false, draftOnly = false } = opts;

  // ---------- account management ----------

  server.registerTool(
    "list_accounts",
    {
      description:
        "List all email accounts known to this server (no secrets). " +
        "Use the returned `email` value as the `account` argument to other tools.",
      inputSchema: {},
    },
    async () => {
      const rows = store.listAccounts().map((a) => ({
        email: a.email,
        provider: a.provider,
        displayName: a.displayName,
        addedAt: a.addedAt,
        hasSignature: !!a.signature,
        hasStyle: !!(a.style && (a.style.fontFamily || a.style.fontSize || a.style.fontColor)),
      }));
      return ok({ accounts: rows });
    },
  );

  server.registerTool(
    "add_account",
    {
      description:
        "Start adding an email account. For Outlook this returns a device code " +
        "the user must enter at the verification URL; then call `complete_add_account` " +
        "with the returned `handle` to finalize. Disabled in --read-only mode.",
      inputSchema: {
        provider: z
          .enum(["outlook", "imap", "gmail"])
          .describe("Email backend. v1 only fully implements 'outlook'."),
        email: z
          .string()
          .email()
          .optional()
          .describe("Optional hint — the provider will verify it against the auth result."),
        config: z
          .record(z.unknown())
          .optional()
          .describe("Provider-specific config (e.g. IMAP host/port). Unused for Outlook."),
      },
    },
    async (args) => {
      if (readOnly) return fail("server is in --read-only mode; add_account is disabled");
      const provider = registry.get(args.provider as ProviderId);
      try {
        const res = await provider.addAccount({ email: args.email, config: args.config });
        return ok(res);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "complete_add_account",
    {
      description:
        "Poll/finalize a pending add_account flow. Returns `pending` until the user " +
        "completes the device-code step, then `ready` with the persisted account.",
      inputSchema: {
        provider: z.enum(["outlook", "imap", "gmail"]),
        handle: z.string().min(1),
      },
    },
    async (args) => {
      const provider = registry.get(args.provider as ProviderId);
      if (!provider.completeAddAccount) {
        return fail(`provider ${args.provider} has no async add-account flow`);
      }
      try {
        const res = await provider.completeAddAccount(args.handle);
        return ok(res);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  // ---------- account settings ----------

  server.registerTool(
    "get_account_settings",
    {
      description:
        "Get signature (HTML) and style preferences for an account.",
      inputSchema: { account: z.string().email() },
    },
    async (args) => {
      try {
        const acct = store.getAccount(args.account);
        if (!acct) return fail(`no account registered for "${args.account}"`);
        return ok({ signature: acct.signature ?? null, style: acct.style ?? null });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "set_account_settings",
    {
      description:
        "Set signature (HTML snippet) and/or style preferences for an account. " +
        "Disabled in --read-only mode.",
      inputSchema: {
        account: z.string().email(),
        signature: z
          .string()
          .optional()
          .describe("HTML snippet — may contain formatting, images, links. Pass null to clear."),
        style: z
          .object({
            fontFamily: z.string().optional(),
            fontSize: z.string().optional(),
            fontColor: z.string().optional(),
          })
          .optional()
          .describe("Font preferences applied to outgoing HTML emails. Pass null to clear."),
      },
    },
    async (args) => {
      if (readOnly) return fail("server is in --read-only mode; set_account_settings is disabled");
      try {
        const acct = store.getAccount(args.account);
        if (!acct) return fail(`no account registered for "${args.account}"`);
        const updated = await store.upsertAccount({
          ...acct,
          signature: args.signature ?? acct.signature,
          style: args.style ?? acct.style,
        });
        return ok({ signature: updated.signature ?? null, style: updated.style ?? null });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "remove_account",
    {
      description: "Forget an account and delete its stored tokens. Disabled in --read-only mode.",
      inputSchema: { email: z.string().email() },
    },
    async (args) => {
      if (readOnly) return fail("server is in --read-only mode; remove_account is disabled");
      const removed = await store.removeAccount(args.email);
      return ok({ removed, email: args.email });
    },
  );

  // ---------- email ops ----------

  server.registerTool(
    "list_emails",
    {
      description:
        "List recent emails in a folder of the given account. Pass the user's email " +
        "address as `account`; the server routes to the correct backend automatically.",
      inputSchema: {
        account: z.string().email(),
        folder: z.string().default("inbox").optional(),
        limit: z.number().int().positive().max(100).optional(),
        unreadOnly: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        const items = await provider.listEmails(account, {
          folder: args.folder,
          limit: args.limit,
          unreadOnly: args.unreadOnly,
        });
        return ok({ account: account.email, count: items.length, items });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "search_emails",
    {
      description:
        "Search emails by free-text query (KQL on Outlook). Returns lightweight summaries.",
      inputSchema: {
        account: z.string().email(),
        query: z.string().min(1),
        limit: z.number().int().positive().max(100).optional(),
      },
    },
    async (args) => {
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        const items = await provider.searchEmails(account, args.query, {
          limit: args.limit,
        });
        return ok({ account: account.email, count: items.length, items });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "read_email",
    {
      description:
        "Fetch a single email with full body and recipients by id. " +
        "Body is returned as `body` with `bodyFormat` indicating the format. " +
        "Default format is 'markdown' — HTML is automatically converted to save context tokens.",
      inputSchema: {
        account: z.string().email(),
        id: z.string().min(1),
        format: z
          .enum(["markdown", "html", "text"])
          .default("markdown")
          .optional()
          .describe(
            "Output body format. 'markdown' converts HTML to Markdown (default), " +
              "'html' returns the raw HTML, 'text' returns plain text.",
          ),
      },
    },
    async (args) => {
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        const msg = await provider.readEmail(account, args.id);
        const format = args.format ?? "markdown";
        const body = selectBody(msg, format);
        return ok({
          id: msg.id,
          subject: msg.subject,
          from: msg.from,
          to: msg.to,
          cc: msg.cc,
          bcc: msg.bcc,
          receivedAt: msg.receivedAt,
          preview: msg.preview,
          isRead: msg.isRead,
          hasAttachments: msg.hasAttachments,
          folder: msg.folder,
          attachments: msg.attachments,
          body,
          bodyFormat: format,
        });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "read_attachment",
    {
      description:
        "Download an email attachment to a temporary file and return its path. " +
        "Use messageId and attachmentId from a prior read_email call.",
      inputSchema: {
        account: z.string().email(),
        messageId: z.string().min(1),
        attachmentId: z.string().min(1),
      },
    },
    async (args) => {
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        const res = await provider.readAttachment(account, args.messageId, args.attachmentId);
        return ok(res);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  // ---------- shared send/draft helpers ----------

  const sendEmailSchema = z.object({
    account: z.string().email(),
    to: z.array(emailAddrSchema).min(1),
    cc: z.array(emailAddrSchema).optional(),
    bcc: z.array(emailAddrSchema).optional(),
    subject: z.string(),
    body: z.string(),
    isHtml: z.boolean().optional(),
    include_signature: z
      .boolean()
      .describe(
        "Whether to append the account's HTML signature to the email. " +
          "Returns an error if true but no signature is configured for this account.",
      ),
    inReplyTo: z
      .string()
      .optional()
      .describe(
        "Message ID to reply to. When set, sends as a threaded reply " +
          "which includes the quoted thread history automatically.",
      ),
    replyAll: z
      .boolean()
      .default(false)
      .optional()
      .describe(
        "When true and `inReplyTo` is set, reply to all recipients " +
          "instead of just the sender.",
      ),
    forwardMessageId: z
      .string()
      .optional()
      .describe(
        "Message ID to forward. When set, sends as a forward of the " +
          "specified message, preserving the original content. " +
          "Mutually exclusive with `inReplyTo`.",
      ),
  });

  type SendEmailArgs = z.infer<typeof sendEmailSchema>;

  async function handleSendOrDraft(
    args: SendEmailArgs,
    action: (
      provider: EmailProvider,
      account: AccountRecord,
      msg: SendInput,
    ) => Promise<{ id: string }>,
    resultKey: string,
    toolName: string,
  ) {
    if (readOnly) return fail(`server is in --read-only mode; ${toolName} is disabled`);
    try {
      const { provider, account } = registry.resolveByEmail(args.account);
      if (args.include_signature && !account.signature) {
        return fail(
          "include_signature is true but no signature is configured for this account. " +
            "Set up a signature first with set_account_settings.",
        );
      }
      const composed = composeBody({
        body: args.body,
        isHtml: args.isHtml,
        signature: account.signature,
        style: account.style,
        includeSignature: args.include_signature,
      });
      if (args.inReplyTo && args.forwardMessageId) {
        return fail(
          "inReplyTo and forwardMessageId are mutually exclusive — use one or the other",
        );
      }
      const res = await action(provider, account, {
        to: args.to,
        cc: args.cc,
        bcc: args.bcc,
        subject: args.subject,
        body: composed.body,
        isHtml: composed.isHtml,
        inReplyTo: args.inReplyTo,
        replyAll: args.replyAll,
        forwardMessageId: args.forwardMessageId,
      });
      return ok({ [resultKey]: true, ...res });
    } catch (err) {
      return fail(errMsg(err));
    }
  }

  // ---------- send / draft ----------

  if (!draftOnly) {
    server.registerTool(
      "send_email",
      {
        description:
          "Send an email from the given account. Appends the " +
          "account's signature (HTML) and applies style preferences when " +
          "`include_signature` is true. Returns an error if " +
          "`include_signature` is true but no signature is configured. " +
          "When `inReplyTo` is set, sends as a reply (or reply-all) which " +
          "preserves thread history and conversation threading. " +
          "When `forwardMessageId` is set, sends as a forward of the " +
          "specified message, preserving the original content. " +
          "`inReplyTo` and `forwardMessageId` are mutually exclusive. " +
          "Disabled in --read-only mode.",
        inputSchema: sendEmailSchema,
      },
      async (args) =>
        handleSendOrDraft(
          args as SendEmailArgs,
          (p, a, m) => p.sendEmail(a, m),
          "sent",
          "send_email",
        ),
    );
  }

  server.registerTool(
    "draft_email",
    {
      description:
        "Create a draft email from the given account without sending it. " +
        "Works identically to send_email — appends signature when " +
        "`include_signature` is true, applies style, and supports replies " +
        "and forwards — but saves the message to the Drafts folder " +
        "instead of sending. Returns the draft message ID so you can " +
        "later find it, edit it, or send it manually. " +
        "Disabled in --read-only mode.",
      inputSchema: sendEmailSchema,
    },
    async (args) =>
      handleSendOrDraft(
        args as SendEmailArgs,
        (p, a, m) => p.saveDraft(a, m),
        "draft",
        "draft_email",
      ),
  );
}

// ---------- body composition helpers ----------

interface ComposeBodyInput {
  body: string;
  isHtml?: boolean;
  signature?: string;
  style?: { fontFamily?: string; fontSize?: string; fontColor?: string };
  includeSignature: boolean;
}

export function composeBody(input: ComposeBodyInput): { body: string; isHtml: boolean } {
  const { body, isHtml = false, signature, style, includeSignature } = input;
  const hasSignature = includeSignature && !!signature;
  const hasStyle = !!(style && (style.fontFamily || style.fontSize || style.fontColor));

  // Nothing to inject — pass through unchanged
  if (!hasSignature && !hasStyle) {
    return { body, isHtml };
  }

  // Need HTML for signature or style injection
  const styleAttr = hasStyle ? buildStyleAttr(style!) : "";

  if (isHtml) {
    let result = hasStyle ? `<div style="${styleAttr}">${body}</div>` : body;
    if (hasSignature) result += `\n<div class="signature">${signature}</div>`;
    return { body: result, isHtml: true };
  }

  // Auto-upgrade plain text to HTML
  const escaped = escapeHtml(body);
  let result = `<div style="${styleAttr}">${escaped}</div>`;
  if (hasSignature) result += `\n<div class="signature">${signature}</div>`;
  return { body: result, isHtml: true };
}

export function buildStyleAttr(style: { fontFamily?: string; fontSize?: string; fontColor?: string }): string {
  const parts: string[] = [];
  if (style.fontFamily) parts.push(`font-family: ${style.fontFamily}`);
  if (style.fontSize) parts.push(`font-size: ${style.fontSize}`);
  if (style.fontColor) parts.push(`color: ${style.fontColor}`);
  return parts.join("; ");
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
