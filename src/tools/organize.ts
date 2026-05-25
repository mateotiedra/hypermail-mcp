import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Registry } from "../providers/registry.js";
import type { ResolvedTools } from "../config.js";
import { ok, fail, errMsg, shouldRegister } from "./shared.js";

export function registerOrganizeTools(
  server: McpServer,
  ctx: {
    registry: Registry;
    tools: ResolvedTools;
  },
): void {
  const { registry, tools } = ctx;

  // ---------- archive ----------

  const archiveMoveSchema = {
    account: z.string().email(),
    id: z.string().min(1).describe("Message ID to move"),
  };

  const archiveOutputSchema = {
    archived: z.literal(true),
    id: z.string(),
  };

  if (shouldRegister("archive_email", tools)) {
    server.registerTool(
      "archive_email",
      {
        description:
          "Move a message to the Archive folder. Disabled in --read-only mode.",
        inputSchema: archiveMoveSchema,
        outputSchema: archiveOutputSchema,
      },
      async (args) => {
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
  }

  // ---------- trash ----------

  const trashOutputSchema = {
    trashed: z.literal(true),
    id: z.string(),
  };

  if (shouldRegister("trash_email", tools)) {
    server.registerTool(
      "trash_email",
      {
        description:
          "Move a message to the Deleted Items (trash) folder. Disabled in --read-only mode.",
        inputSchema: archiveMoveSchema,
        outputSchema: trashOutputSchema,
      },
      async (args) => {
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

  // ---------- move ----------

  const moveEmailOutputSchema = {
    moved: z.literal(true),
    id: z.string(),
    destination: z.string(),
  };

  if (shouldRegister("move_email", tools)) {
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
        try {
          const { provider, account } = registry.resolveByEmail(args.account);
          await provider.moveEmail(account, args.id, args.destination);
          const data = {
            moved: true as const,
            id: args.id,
            destination: args.destination,
          };
          return ok(data, data);
        } catch (err) {
          return fail(errMsg(err));
        }
      },
    );
  }

  // ---------- mark_read / mark_unread ----------

  const markReadInputSchema = {
    account: z.string().email(),
    id: z.string().min(1).describe("Message ID to mark as read"),
  };

  const markReadOutputSchema = {
    marked: z.literal(true),
    id: z.string(),
    isRead: z.boolean(),
  };

  if (shouldRegister("mark_read", tools)) {
    server.registerTool(
      "mark_read",
      {
        description:
          "Mark a message as read. Disabled in --read-only mode.",
        inputSchema: markReadInputSchema,
        outputSchema: markReadOutputSchema,
      },
      async (args) => {
        try {
          const { provider, account } = registry.resolveByEmail(args.account);
          await provider.markRead(account, args.id, true);
          const data = {
            marked: true as const,
            id: args.id,
            isRead: true,
          };
          return ok(data, data);
        } catch (err) {
          return fail(errMsg(err));
        }
      },
    );
  }

  if (shouldRegister("mark_unread", tools)) {
    server.registerTool(
      "mark_unread",
      {
        description:
          "Mark a message as unread. Disabled in --read-only mode.",
        inputSchema: markReadInputSchema,
        outputSchema: markReadOutputSchema,
      },
      async (args) => {
        try {
          const { provider, account } = registry.resolveByEmail(args.account);
          await provider.markRead(account, args.id, false);
          const data = {
            marked: true as const,
            id: args.id,
            isRead: false,
          };
          return ok(data, data);
        } catch (err) {
          return fail(errMsg(err));
        }
      },
    );
  }
}
