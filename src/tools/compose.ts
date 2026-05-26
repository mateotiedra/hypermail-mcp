import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AccountRecord, AccountStore } from "../store/account-store.js";
import type { Registry } from "../providers/registry.js";
import type { EmailProvider, SendInput } from "../providers/types.js";
import type { ResolvedTools } from "../config.js";
import {
  ok,
  fail,
  errMsg,
  emailAddrSchema,
  composeBody,
  shouldRegister,
} from "./shared.js";

export function registerComposeTools(
  server: McpServer,
  ctx: {
    store: AccountStore;
    registry: Registry;
    tools: ResolvedTools;
  },
): void {
  const { store, registry, tools } = ctx;

  const sendEmailSchema = z.object({
    account: z.string().email(),
    to: z.array(emailAddrSchema).min(1),
    cc: z.array(emailAddrSchema).optional(),
    bcc: z.array(emailAddrSchema).optional(),
    subject: z.string(),
    body: z.string(),
    format: z
      .enum(["html", "markdown"])
      .describe(
        "Body format. 'html' sends the body as-is (must be valid HTML). " +
          "'markdown' converts the body from Markdown to HTML for clean rendering on the recipient side.",
      ),
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
        format: args.format,
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
      if (toolName === "draft_email" && res.id) {
        const draft = await provider.readEmail(account, res.id);
        result.draftHtml = draft.bodyHtml;
      }
      return ok(result, result);
    } catch (err) {
      return fail(errMsg(err));
    }
  }

  // ---------- send_email ----------

  const sendEmailOutputSchema = {
    sent: z.literal(true),
    id: z.string(),
  };

  if (shouldRegister("send_email", tools)) {
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

  // ---------- draft_email ----------

  const draftEmailOutputSchema = {
    draft: z.literal(true),
    id: z.string(),
    draftHtml: z.string().optional(),
  };

  if (shouldRegister("draft_email", tools)) {
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
  }

  // ---------- edit_draft ----------

  const editDraftSchema = z.object({
    account: z.string().email(),
    id: z.string().min(1).describe("Draft message ID to edit"),
    to: z.array(emailAddrSchema).optional(),
    cc: z.array(emailAddrSchema).optional(),
    bcc: z.array(emailAddrSchema).optional(),
    subject: z.string().optional(),
    body: z.string().optional(),
    format: z
      .enum(["html", "markdown"])
      .optional()
      .describe(
        "Body format. Only meaningful when `body` is also provided. " +
          "'html' sends the body as-is (must be valid HTML). " +
          "'markdown' converts the body from Markdown to HTML for clean rendering on the recipient side.",
      ),
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

  if (shouldRegister("edit_draft", tools)) {
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
              format: a.format ?? "html",
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
  }

  // ---------- send_draft ----------

  const sendDraftOutputSchema = {
    sent: z.literal(true),
    id: z.string(),
  };

  if (shouldRegister("send_draft", tools)) {
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
  }

  // ---------- add_attachment_to_draft ----------

  const addAttachmentOutputSchema = {
    attached: z.literal(true),
    id: z.string(),
    attachment: z.object({
      id: z.string(),
      name: z.string(),
      contentType: z.string().optional(),
    }),
  };

  if (shouldRegister("add_attachment_to_draft", tools)) {
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
          name: z
            .string()
            .min(1)
            .describe("Attachment filename (e.g. 'report.pdf')"),
          contentBytes: z
            .string()
            .min(1)
            .describe("Base64-encoded file content"),
          contentType: z
            .string()
            .optional()
            .describe("MIME type (e.g. 'application/pdf')"),
        },
        outputSchema: addAttachmentOutputSchema,
      },
      async (args) => {
        try {
          const { provider, account } = registry.resolveByEmail(args.account);
          const res = await provider.addAttachmentToDraft(
            account,
            args.id,
            args.name,
            args.contentBytes,
            args.contentType,
          );
          const data = {
            attached: true as const,
            id: res.id,
            attachment: res.attachment,
          };
          return ok(data, data as unknown as Record<string, unknown>);
        } catch (err) {
          return fail(errMsg(err));
        }
      },
    );
  }
}
