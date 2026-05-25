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
function ok(data: unknown, structuredContent?: Record<string, unknown>) {
  const result: { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown> } = {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
  if (structuredContent !== undefined) {
    result.structuredContent = structuredContent;
  }
  return result;
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

// ---------- shared output schemas ----------

const emailAddrOutputSchema = z.object({
  name: z.string().optional(),
  address: z.string(),
});

const accountSummaryOutputSchema = z.object({
  email: z.string(),
  provider: z.enum(["outlook", "imap", "gmail"]),
  displayName: z.string().optional(),
  addedAt: z.string(),
  hasSignature: z.boolean(),
  hasStyle: z.boolean(),
});

const emailSummaryOutputSchema = z.object({
  id: z.string(),
  subject: z.string(),
  from: emailAddrOutputSchema.optional(),
  to: z.array(emailAddrOutputSchema).optional(),
  receivedAt: z.string().optional(),
  preview: z.string().optional(),
  isRead: z.boolean().optional(),
  hasAttachments: z.boolean().optional(),
  folder: z.string().optional(),
});

const attachmentMetaOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  contentType: z.string().optional(),
  size: z.number().optional(),
});

const styleOutputSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.string().optional(),
  fontColor: z.string().optional(),
});

const folderInfoOutputSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  parentFolderId: z.string().optional(),
  childFolderCount: z.number(),
  totalItemCount: z.number(),
  unreadItemCount: z.number(),
});

export function registerTools(server: McpServer, opts: RegisterToolsOptions): void {
  const { store, registry, readOnly = false, draftOnly = false } = opts;

  // ---------- account management ----------

  const listAccountsOutputSchema = {
    accounts: z.array(accountSummaryOutputSchema),
  };

  server.registerTool(
    "list_accounts",
    {
      description:
        "List all email accounts known to this server (no secrets). " +
        "Use the returned `email` value as the `account` argument to other tools.",
      inputSchema: {},
      outputSchema: listAccountsOutputSchema,
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
      const data = { accounts: rows };
      return ok(data, data);
    },
  );

  const addAccountOutputSchema = z.discriminatedUnion("status", [
    z.object({
      status: z.literal("pending"),
      handle: z.string(),
      verification: z.object({
        userCode: z.string(),
        verificationUri: z.string(),
        expiresAt: z.string(),
        message: z.string(),
      }),
    }),
    z.object({
      status: z.literal("ready"),
      account: z.object({
        email: z.string(),
        provider: z.enum(["outlook", "imap", "gmail"]),
        displayName: z.string().optional(),
        tokens: z.record(z.unknown()),
        addedAt: z.string(),
        signature: z.string().optional(),
        style: styleOutputSchema.optional(),
      }),
    }),
  ]);

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
      outputSchema: addAccountOutputSchema,
    },
    async (args) => {
      if (readOnly) return fail("server is in --read-only mode; add_account is disabled");
      const provider = registry.get(args.provider as ProviderId);
      try {
        const res = await provider.addAccount({ email: args.email, config: args.config });
        return ok(res, res as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  const completeAddAccountOutputSchema = z.object({
    status: z.enum(["pending", "ready", "expired", "error"]),
    account: z
      .object({
        email: z.string(),
        provider: z.enum(["outlook", "imap", "gmail"]),
        displayName: z.string().optional(),
        tokens: z.record(z.unknown()),
        addedAt: z.string(),
        signature: z.string().optional(),
        style: styleOutputSchema.optional(),
      })
      .optional(),
    error: z.string().optional(),
  });

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
      outputSchema: completeAddAccountOutputSchema,
    },
    async (args) => {
      const provider = registry.get(args.provider as ProviderId);
      if (!provider.completeAddAccount) {
        return fail(`provider ${args.provider} has no async add-account flow`);
      }
      try {
        const res = await provider.completeAddAccount(args.handle);
        return ok(res, res as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  // ---------- account settings ----------

  const accountSettingsOutputSchema = {
    signature: z.string().nullable(),
    style: styleOutputSchema.nullable(),
  };

  server.registerTool(
    "get_account_settings",
    {
      description:
        "Get signature (HTML) and style preferences for an account.",
      inputSchema: { account: z.string().email() },
      outputSchema: accountSettingsOutputSchema,
    },
    async (args) => {
      try {
        const acct = store.getAccount(args.account);
        if (!acct) return fail(`no account registered for "${args.account}"`);
        const data = { signature: acct.signature ?? null, style: acct.style ?? null };
        return ok(data, data as Record<string, unknown>);
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
      outputSchema: accountSettingsOutputSchema,
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
        const data = { signature: updated.signature ?? null, style: updated.style ?? null };
        return ok(data, data as Record<string, unknown>);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  const removeAccountOutputSchema = {
    removed: z.boolean(),
    email: z.string(),
  };

  server.registerTool(
    "remove_account",
    {
      description: "Forget an account and delete its stored tokens. Disabled in --read-only mode.",
      inputSchema: { email: z.string().email() },
      outputSchema: removeAccountOutputSchema,
    },
    async (args) => {
      if (readOnly) return fail("server is in --read-only mode; remove_account is disabled");
      const removed = await store.removeAccount(args.email);
      const data = { removed, email: args.email };
      return ok(data, data);
    },
  );

  // ---------- email ops ----------

  const emailListOutputSchema = {
    account: z.string(),
    count: z.number(),
    items: z.array(emailSummaryOutputSchema),
    skip: z.number(),
    hasMore: z.boolean(),
  };

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
        skip: z.number().int().min(0).optional(),
      },
      outputSchema: emailListOutputSchema,
    },
    async (args) => {
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        const { items, hasMore } = await provider.listEmails(account, {
          folder: args.folder,
          limit: args.limit,
          unreadOnly: args.unreadOnly,
          skip: args.skip,
        });
        const data = { account: account.email, count: items.length, items, skip: args.skip ?? 0, hasMore };
        return ok(data, data);
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
      outputSchema: emailListOutputSchema,
    },
    async (args) => {
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        const items = await provider.searchEmails(account, args.query, {
          limit: args.limit,
        });
        const data = { account: account.email, count: items.length, items };
        return ok(data, data);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  const readEmailOutputSchema = {
    id: z.string(),
    subject: z.string(),
    from: emailAddrOutputSchema.optional(),
    to: z.array(emailAddrOutputSchema).optional(),
    cc: z.array(emailAddrOutputSchema).optional(),
    bcc: z.array(emailAddrOutputSchema).optional(),
    receivedAt: z.string().optional(),
    preview: z.string().optional(),
    isRead: z.boolean().optional(),
    hasAttachments: z.boolean().optional(),
    folder: z.string().optional(),
    attachments: z.array(attachmentMetaOutputSchema).optional(),
    body: z.string(),
    bodyFormat: z.enum(["markdown", "html", "text"]),
  };

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
      outputSchema: readEmailOutputSchema,
    },
    async (args) => {
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        const msg = await provider.readEmail(account, args.id);
        const format = args.format ?? "markdown";
        const body = selectBody(msg, format);
        const data = {
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
        };
        return ok(data, data as Record<string, unknown>);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  const readAttachmentOutputSchema = {
    name: z.string(),
    contentType: z.string().optional(),
    path: z.string(),
  };

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
      outputSchema: readAttachmentOutputSchema,
    },
    async (args) => {
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        const res = await provider.readAttachment(account, args.messageId, args.attachmentId);
        return ok(res, res as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  // ---------- move / archive ----------

  {
    const schema = {
      account: z.string().email(),
      id: z.string().min(1).describe("Message ID to move"),
    };

    const archiveOutputSchema = {
      archived: z.literal(true),
      id: z.string(),
    };

    server.registerTool(
      "archive_email",
      {
        description:
          "Move a message to the Archive folder. Disabled in --read-only mode.",
        inputSchema: schema,
        outputSchema: archiveOutputSchema,
      },
      async (args) => {
        if (readOnly) return fail("server is in --read-only mode; archive_email is disabled");
        try {
          const { provider, account } = registry.resolveByEmail(args.account);
          await provider.moveEmail(account, args.id, "archive");
          const data = { archived: true as const, id: args.id };
          return ok(data, data);
        } catch (err) {
          return fail(errMsg(err));
        }
      },
    );

    const trashOutputSchema = {
      trashed: z.literal(true),
      id: z.string(),
    };

    server.registerTool(
      "trash_email",
      {
        description:
          "Move a message to the Deleted Items (trash) folder. Disabled in --read-only mode.",
        inputSchema: schema,
        outputSchema: trashOutputSchema,
      },
      async (args) => {
        if (readOnly) return fail("server is in --read-only mode; trash_email is disabled");
        try {
          const { provider, account } = registry.resolveByEmail(args.account);
          await provider.moveEmail(account, args.id, "deleteditems");
          const data = { trashed: true as const, id: args.id };
          return ok(data, data);
        } catch (err) {
          return fail(errMsg(err));
        }
      },
    );
  }

  const moveEmailOutputSchema = {
    moved: z.literal(true),
    id: z.string(),
    destination: z.string(),
  };

  server.registerTool(
    "move_email",
    {
      description:
        "Move a message to any folder by well-known name (e.g. 'inbox', 'drafts', " +
        "'junkemail', 'sentitems', 'outbox') or custom folder ID. " +
        "Disabled in --read-only mode.",
      inputSchema: {
        account: z.string().email(),
        id: z.string().min(1).describe("Message ID to move"),
        destination: z
          .string()
          .min(1)
          .describe(
            "Destination folder — a well-known folder name " +
            "('archive', 'deleteditems', 'inbox', 'drafts', 'junkemail', " +
            "'sentitems', 'outbox') or a raw folder ID.",
          ),
      },
      outputSchema: moveEmailOutputSchema,
    },
    async (args) => {
      if (readOnly) return fail("server is in --read-only mode; move_email is disabled");
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        await provider.moveEmail(account, args.id, args.destination);
        const data = { moved: true as const, id: args.id, destination: args.destination };
        return ok(data, data);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  // ---------- read status ----------

  const markReadInputSchema = {
    account: z.string().email(),
    id: z.string().min(1).describe("Message ID to mark as read"),
  };

  const markReadOutputSchema = {
    marked: z.literal(true),
    id: z.string(),
    isRead: z.boolean(),
  };

  server.registerTool(
    "mark_read",
    {
      description:
        "Mark a message as read. Disabled in --read-only mode.",
      inputSchema: markReadInputSchema,
      outputSchema: markReadOutputSchema,
    },
    async (args) => {
      if (readOnly) return fail("server is in --read-only mode; mark_read is disabled");
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        await provider.markRead(account, args.id, true);
        const data = { marked: true as const, id: args.id, isRead: true };
        return ok(data, data);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "mark_unread",
    {
      description:
        "Mark a message as unread. Disabled in --read-only mode.",
      inputSchema: markReadInputSchema,
      outputSchema: markReadOutputSchema,
    },
    async (args) => {
      if (readOnly) return fail("server is in --read-only mode; mark_unread is disabled");
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        await provider.markRead(account, args.id, false);
        const data = { marked: true as const, id: args.id, isRead: false };
        return ok(data, data);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  // ---------- folder ops ----------

  const listFoldersOutputSchema = {
    account: z.string(),
    count: z.number(),
    items: z.array(folderInfoOutputSchema),
  };

  server.registerTool(
    "list_folders",
    {
      description:
        "List available mail folders. Returns top-level folders by default, " +
        "or child folders of the given parent when `parentFolderId` is provided.",
      inputSchema: {
        account: z.string().email(),
        parentFolderId: z
          .string()
          .optional()
          .describe(
            "When provided, lists child folders of this folder. " +
            "When omitted, lists top-level folders (children of the root).",
          ),
      },
      outputSchema: listFoldersOutputSchema,
    },
    async (args) => {
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        const items = await provider.listFolders(account, {
          parentFolderId: args.parentFolderId,
        });
        const data = { account: account.email, count: items.length, items };
        return ok(data, data);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  const createFolderOutputSchema = {
    created: z.literal(true),
    folder: folderInfoOutputSchema,
  };

  server.registerTool(
    "create_folder",
    {
      description:
        "Create a new mail folder. Creates under the root folder by default, " +
        "or under the specified parent when `parentFolderId` is provided. " +
        "Disabled in --read-only mode.",
      inputSchema: {
        account: z.string().email(),
        displayName: z.string().min(1).describe("Name of the new folder"),
        parentFolderId: z
          .string()
          .optional()
          .describe(
            "When provided, creates the folder as a child of this folder. " +
            "When omitted, creates under the root folder.",
          ),
      },
      outputSchema: createFolderOutputSchema,
    },
    async (args) => {
      if (readOnly) return fail("server is in --read-only mode; create_folder is disabled");
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        const folder = await provider.createFolder(account, {
          displayName: args.displayName,
          parentFolderId: args.parentFolderId,
        });
        const data = { created: true as const, folder };
        return ok(data, data);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  const deleteFolderOutputSchema = {
    deleted: z.literal(true),
    id: z.string(),
  };

  server.registerTool(
    "delete_folder",
    {
      description:
        "Delete a mail folder by ID. Disabled in --read-only mode.",
      inputSchema: {
        account: z.string().email(),
        folderId: z.string().min(1).describe("ID of the folder to delete"),
      },
      outputSchema: deleteFolderOutputSchema,
    },
    async (args) => {
      if (readOnly) return fail("server is in --read-only mode; delete_folder is disabled");
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        await provider.deleteFolder(account, args.folderId);
        const data = { deleted: true as const, id: args.folderId };
        return ok(data, data);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  const renameFolderOutputSchema = {
    renamed: z.literal(true),
    folder: folderInfoOutputSchema,
  };

  server.registerTool(
    "rename_folder",
    {
      description:
        "Rename an existing mail folder. Disabled in --read-only mode.",
      inputSchema: {
        account: z.string().email(),
        folderId: z.string().min(1).describe("ID of the folder to rename"),
        newName: z.string().min(1).describe("New display name for the folder"),
      },
      outputSchema: renameFolderOutputSchema,
    },
    async (args) => {
      if (readOnly) return fail("server is in --read-only mode; rename_folder is disabled");
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        const folder = await provider.renameFolder(account, args.folderId, args.newName);
        const data = { renamed: true as const, folder };
        return ok(data, data);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

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
        "Whether to append the account's saved HTML signature to the email. " +
        "If true, don't include a signature in the body param to avoid double signature. " +
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
      const result: Record<string, unknown> = { [resultKey]: true, ...res };
      // For draft_email, fetch the created draft back so the agent can
      // inspect the actual HTML content before deciding to send it.
      if (toolName === "draft_email" && res.id) {
        const draft = await provider.readEmail(account, res.id);
        result.draftHtml = draft.bodyHtml;
      }
      return ok(result, result);
    } catch (err) {
      return fail(errMsg(err));
    }
  }

  // ---------- send / draft ----------

  const sendEmailOutputSchema = {
    sent: z.literal(true),
    id: z.string(),
  };

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
        outputSchema: sendEmailOutputSchema,
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

  const draftEmailOutputSchema = {
    draft: z.literal(true),
    id: z.string(),
    draftHtml: z.string().optional(),
  };

  server.registerTool(
    "draft_email",
    {
      description:
        "Create a draft email from the given account without sending it. " +
        "Works identically to send_email — appends signature when " +
        "`include_signature` is true, applies style, and supports replies " +
        "and forwards — but saves the message to the Drafts folder " +
        "instead of sending. Returns the draft message ID and the draft's " +
        "HTML body content (`draftHtml`). Before sending the draft, " +
        "inspect `draftHtml` to verify the draft looks correct: no " +
        "duplicate signature blocks, no broken or missing inline images, " +
        "no malformed HTML, and no other formatting issues. " +
        "Disabled in --read-only mode.",
      inputSchema: sendEmailSchema,
      outputSchema: draftEmailOutputSchema,
    },
    async (args) =>
      handleSendOrDraft(
        args as SendEmailArgs,
        (p, a, m) => p.saveDraft(a, m),
        "draft",
        "draft_email",
      ),
  );

  // ---------- edit draft ----------

  const editDraftSchema = z.object({
    account: z.string().email(),
    id: z.string().min(1).describe("Draft message ID to edit"),
    to: z.array(emailAddrSchema).optional(),
    cc: z.array(emailAddrSchema).optional(),
    bcc: z.array(emailAddrSchema).optional(),
    subject: z.string().optional(),
    body: z.string().optional(),
    isHtml: z.boolean().optional(),
    include_signature: z
      .boolean()
      .optional()
      .describe(
        "Whether to re-apply the account's saved HTML signature to the body. " +
        "If true, don't include a signature in the body param. " +
        "Only meaningful when `body` is also provided. " +
        "Returns an error if true but no signature is configured for this account.",
      ),
  });

  type EditDraftArgs = z.infer<typeof editDraftSchema>;

  const editDraftOutputSchema = {
    edited: z.literal(true),
    id: z.string(),
    draftHtml: z.string().optional(),
  };

  server.registerTool(
    "edit_draft",
    {
      description:
        "Edit an existing draft email by ID. Only the fields you provide " +
        "are updated — unmentioned fields stay unchanged. When `body` is " +
        "provided and `include_signature` is true, the account's signature " +
        "is re-applied. Returns the draft ID and the draft's updated HTML " +
        "body content (`draftHtml`). Before sending, inspect `draftHtml` " +
        "to verify the draft looks correct. " +
        "Does not support changing `inReplyTo` or `forwardMessageId` — " +
        "those are set at creation time via `draft_email`. " +
        "Disabled in --read-only mode.",
      inputSchema: editDraftSchema,
      outputSchema: editDraftOutputSchema,
    },
    async (args) => {
      const a = args as EditDraftArgs;
      if (readOnly) return fail("server is in --read-only mode; edit_draft is disabled");
      try {
        const { provider, account } = registry.resolveByEmail(a.account);
        if (a.include_signature && !account.signature) {
          return fail(
            "include_signature is true but no signature is configured for this account. " +
            "Set up a signature first with set_account_settings.",
          );
        }
        let bodyPayload: string | undefined;
        let isHtmlPayload: boolean | undefined;
        if (a.body !== undefined) {
          const composed = composeBody({
            body: a.body,
            isHtml: a.isHtml,
            signature: account.signature,
            style: account.style,
            includeSignature: !!a.include_signature,
          });
          bodyPayload = composed.body;
          isHtmlPayload = composed.isHtml;
        }
        const res = await provider.updateDraft(account, a.id, {
          to: a.to,
          cc: a.cc,
          bcc: a.bcc,
          subject: a.subject,
          body: bodyPayload,
          isHtml: isHtmlPayload,
        });
        // Fetch the updated draft so the agent can inspect the HTML before sending.
        const draft = await provider.readEmail(account, res.id);
        const result: Record<string, unknown> = {
          edited: true as const,
          id: res.id,
          draftHtml: draft.bodyHtml,
        };
        return ok(result, result);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  // ---------- send draft ----------

  const sendDraftOutputSchema = {
    sent: z.literal(true),
    id: z.string(),
  };

  server.registerTool(
    "send_draft",
    {
      description:
        "Send an existing draft email by ID. " +
        "Use this with draft IDs returned by `draft_email` or `edit_draft`. " +
        "Disabled in --read-only mode.",
      inputSchema: {
        account: z.string().email(),
        id: z.string().min(1).describe("Draft message ID to send"),
      },
      outputSchema: sendDraftOutputSchema,
    },
    async (args) => {
      if (readOnly) return fail("server is in --read-only mode; send_draft is disabled");
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        const res = await provider.sendDraft(account, args.id);
        const data = { sent: true as const, id: res.id };
        return ok(data, data);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  // ---------- add attachment to draft ----------

  const addAttachmentOutputSchema = {
    attached: z.literal(true),
    id: z.string(),
    attachment: z.object({
      id: z.string(),
      name: z.string(),
      contentType: z.string().optional(),
    }),
  };

  server.registerTool(
    "add_attachment_to_draft",
    {
      description:
        "Add a file attachment to an existing draft email by ID. " +
        "`contentBytes` must be base64-encoded file content. " +
        "`contentType` is the MIME type (e.g. 'application/pdf'); " +
        "defaults to 'application/octet-stream' if omitted. " +
        "Disabled in --read-only mode.",
      inputSchema: {
        account: z.string().email(),
        id: z.string().min(1).describe("Draft message ID"),
        name: z.string().min(1).describe("Attachment filename (e.g. 'report.pdf')"),
        contentBytes: z.string().min(1).describe("Base64-encoded file content"),
        contentType: z.string().optional().describe("MIME type (e.g. 'application/pdf')"),
      },
      outputSchema: addAttachmentOutputSchema,
    },
    async (args) => {
      if (readOnly) return fail("server is in --read-only mode; add_attachment_to_draft is disabled");
      try {
        const { provider, account } = registry.resolveByEmail(args.account);
        const res = await provider.addAttachmentToDraft(
          account,
          args.id,
          args.name,
          args.contentBytes,
          args.contentType,
        );
        const data = { attached: true as const, id: res.id, attachment: res.attachment };
        return ok(data, data as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(errMsg(err));
      }
    },
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
