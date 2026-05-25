import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AccountStore } from "../store/account-store.js";
import type { Registry } from "../providers/registry.js";
import type { ResolvedTools } from "../config.js";
import { selectBody } from "../html-to-markdown.js";
import {
  ok,
  fail,
  errMsg,
  emailAddrOutputSchema,
  emailSummaryOutputSchema,
  attachmentMetaOutputSchema,
  shouldRegister,
} from "./shared.js";

export function registerBrowseTools(
  server: McpServer,
  ctx: {
    store: AccountStore;
    registry: Registry;
    tools: ResolvedTools;
  },
): void {
  const { registry, tools } = ctx;

  // ---------- email ops ----------

  const emailListOutputSchema = {
    account: z.string(),
    count: z.number(),
    items: z.array(emailSummaryOutputSchema),
    skip: z.number(),
    hasMore: z.boolean(),
  };

  if (shouldRegister("list_emails", tools)) {
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
          const data = {
            account: account.email,
            count: items.length,
            items,
            skip: args.skip ?? 0,
            hasMore,
          };
          return ok(data, data);
        } catch (err) {
          return fail(errMsg(err));
        }
      },
    );
  }

  if (shouldRegister("search_emails", tools)) {
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
          const data = {
            account: account.email,
            count: items.length,
            items,
          };
          return ok(data, data);
        } catch (err) {
          return fail(errMsg(err));
        }
      },
    );
  }

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

  if (shouldRegister("read_email", tools)) {
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
  }

  const readAttachmentOutputSchema = {
    name: z.string(),
    contentType: z.string().optional(),
    path: z.string(),
  };

  if (shouldRegister("read_attachment", tools)) {
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
          const res = await provider.readAttachment(
            account,
            args.messageId,
            args.attachmentId,
          );
          return ok(res, res as unknown as Record<string, unknown>);
        } catch (err) {
          return fail(errMsg(err));
        }
      },
    );
  }
}
