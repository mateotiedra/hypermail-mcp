import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

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

  const MIME_TYPES: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".txt": "text/plain",
    ".html": "text/html",
    ".css": "text/css",
    ".csv": "text/csv",
    ".json": "application/json",
    ".xml": "application/xml",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".tar": "application/x-tar",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
  };

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
      .union([z.string(), z.literal(false)])
      .describe(
        "Message ID to reply to. When set, sends as a threaded reply " +
          "which includes the quoted thread history automatically. " +
          "Set to `false` for a new email (not a reply).",
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
    attachments: z
      .array(
        z.object({
          filePath: z
            .string()
            .min(1)
            .describe("Absolute path to a local file"),
          name: z
            .string()
            .optional()
            .describe(
              "Attachment filename. Defaults to the file's basename.",
            ),
        }),
      )
      .optional()
      .describe(
        "File attachments to include. The server reads the files from " +
          "disk and base64-encodes them automatically.",
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

      // Process file attachments: read + encode each file
      let processedAttachments: SendInput["attachments"] = undefined;
      if (args.attachments && args.attachments.length > 0) {
        processedAttachments = args.attachments.map((att) => {
          const fileData = readFileSync(att.filePath);
          const ext = extname(att.filePath).toLowerCase();
          return {
            name: att.name ?? basename(att.filePath),
            contentBytes: fileData.toString("base64"),
            contentType: MIME_TYPES[ext] ?? "application/octet-stream",
          };
        });
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
        attachments: processedAttachments,
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
    new_attachments: z
      .array(
        z.object({
          filePath: z
            .string()
            .min(1)
            .describe("Absolute path to a local file"),
          name: z
            .string()
            .optional()
            .describe(
              "Attachment filename. Defaults to the file's basename.",
            ),
        }),
      )
      .optional()
      .describe(
        "New file attachments to add to the draft. The server reads " +
          "the files from disk and base64-encodes them automatically.",
      ),
    remove_attachments: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Attachment IDs to remove from the draft. Get attachment IDs " +
          "from read_email.",
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

          // Preserve quoted thread when editing reply/forward drafts.
          // Outlook's buildDraftFromReference inserts a known spacer between
          // the answer and the quoted thread. Split on its first occurrence:
          // replace only the answer part, keep the spacer + quoted thread.
          if (bodyPayload !== undefined) {
            const spacer = '<div style="line-height:12px"><br></div>';
            try {
              const existing = await provider.readEmail(account, a.id);
              const existingHtml = existing.bodyHtml ?? "";
              const spacerIdx = existingHtml.indexOf(spacer);
              if (spacerIdx !== -1) {
                bodyPayload = bodyPayload + existingHtml.slice(spacerIdx);
              }
            } catch {
              // If we can't read the existing draft, proceed with the new
              // body as-is (no thread to preserve).
            }
          }

          const res = await provider.updateDraft(account, a.id, {
            to: a.to,
            cc: a.cc,
            bcc: a.bcc,
            subject: a.subject,
            body: bodyPayload,
            isHtml: isHtmlPayload,
          });

          // Handle new attachments
          const newAttachmentIds: string[] = [];
          if (a.new_attachments && a.new_attachments.length > 0) {
            for (const att of a.new_attachments) {
              const fileData = readFileSync(att.filePath);
              const ext = extname(att.filePath).toLowerCase();
              const contentType =
                MIME_TYPES[ext] ?? "application/octet-stream";
              const attRes = await provider.addAttachmentToDraft(
                account,
                res.id,
                att.name ?? basename(att.filePath),
                fileData.toString("base64"),
                contentType,
              );
              newAttachmentIds.push(attRes.attachment.id);
            }
          }

          // Handle attachment removal
          const removedIds: string[] = [];
          if (a.remove_attachments && a.remove_attachments.length > 0) {
            for (const attId of a.remove_attachments) {
              await provider.removeAttachmentFromDraft(
                account,
                res.id,
                attId,
              );
              removedIds.push(attId);
            }
          }

          const draft = await provider.readEmail(account, res.id);
          const result = {
            edited: true as const,
            id: res.id,
            draftHtml: draft.bodyHtml ?? "",
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
}
