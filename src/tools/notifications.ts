import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ResolvedTools } from "../config.js";
import type { WatchNotification } from "../watcher/index.js";
import type { AgentContext } from "./agent-context.js";
import { ok, fail, errMsg, shouldRegister } from "./shared.js";

export interface NotificationToolContext {
  tools: ResolvedTools;
  /** Shared buffer the watcher writes to. Draining is the tool's job. */
  notificationBuffer: WatchNotification[];
  agentContext?: AgentContext | null;
}

export function registerNotificationTools(
  server: McpServer,
  ctx: NotificationToolContext,
): void {
  const { tools, notificationBuffer, agentContext } = ctx;

  const notifyOutputSchema = z.object({
    count: z.number(),
    items: z.array(
      z.object({
        type: z.enum(["new_emails", "auth_failure"]),
        account: z.string(),
        emails: z.array(z.unknown()).optional(),
        error: z.string().optional(),
        timestamp: z.string(),
      }),
    ),
  });

  if (shouldRegister("check_notifications", tools)) {
    server.registerTool(
      "check_notifications",
      {
        description:
          "Check for pending email watch notifications. " +
          "Returns new-email alerts and auth-failure warnings that the inbox watcher " +
          "has accumulated since the last call. Drains the notification buffer on read.",
        inputSchema: z.object({}),
        outputSchema: notifyOutputSchema,
      },
      async () => {
        try {
          // Drain atomically — splice returns removed items and clears them
          // from the array in one operation.
          const pending = notificationBuffer.splice(0);
          // Scope to agent's accounts in HTTP mode; unrestricted in stdio.
          const filtered = agentContext
            ? pending.filter((n) =>
                agentContext.accounts.some(
                  (a) => a.toLowerCase() === n.account.toLowerCase(),
                ),
              )
            : pending;
          const data = { count: filtered.length, items: filtered };
          return ok(data, data as Record<string, unknown>);
        } catch (err) {
          return fail(errMsg(err));
        }
      },
    );
  }
}
