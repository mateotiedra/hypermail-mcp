import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { IAccountStore, IAgentStore } from "../mode/types.js";
import type { Registry } from "../providers/registry.js";
import type { ResolvedTools } from "../config.js";
import type { AgentContext } from "./agent-context.js";

// Re-export compose helpers for tests
export { composeBody, escapeHtml, buildStyleAttr } from "./shared.js";
export { markdownToHtml } from "../markdown-to-html.js";

// Submodule registration functions
import { registerAccountTools } from "./accounts.js";
import { registerBrowseTools } from "./browse.js";
import { registerFolderTools } from "./folders.js";
import { registerOrganizeTools } from "./organize.js";
import { registerComposeTools } from "./compose.js";
import { registerNotificationTools } from "./notifications.js";
import type { WatchNotification } from "../watcher/index.js";

export interface RegisterToolsOptions {
  store: IAccountStore;
  agentStore?: IAgentStore | null;
  registry: Registry;
  tools: ResolvedTools;
  notificationBuffer?: WatchNotification[];
  /** Agent identity for access control. null = stdio mode (unrestricted). */
  agentContext?: AgentContext | null;
}

export function registerTools(
  server: McpServer,
  opts: RegisterToolsOptions,
): void {
  const { store, registry, tools, agentContext, agentStore } = opts;

  registerAccountTools(server, { store, registry, tools, agentContext, agentStore });
  registerBrowseTools(server, { registry, tools, agentContext });
  registerFolderTools(server, { registry, tools, agentContext });
  registerOrganizeTools(server, { registry, tools, agentContext });
  registerComposeTools(server, { store, registry, tools, agentContext });
  if (opts.notificationBuffer) {
    registerNotificationTools(server, {
      tools,
      notificationBuffer: opts.notificationBuffer,
      agentContext,
    });
  }
}
