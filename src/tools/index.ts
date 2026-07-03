import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AccountStore } from "../store/account-store.js";
import type { Registry } from "../providers/registry.js";
import type { ResolvedTools } from "../config.js";
import type { Logger } from "../logger.js";

// Re-export compose helpers for tests
export { composeBody, escapeHtml, buildStyleAttr } from "./shared.js";
export { markdownToHtml } from "../markdown-to-html.js";

// Submodule registration functions
import { registerAccountTools } from "./accounts.js";
import { registerBrowseTools } from "./browse.js";
import { registerFolderTools } from "./folders.js";
import { registerOrganizeTools } from "./organize.js";
import { registerComposeTools } from "./compose.js";


export interface RegisterToolsOptions {
  store: AccountStore;
  registry: Registry;
  tools: ResolvedTools;
  logger?: Logger;
}

export function registerTools(
  server: McpServer,
  opts: RegisterToolsOptions,
): void {
  const { store, registry, tools, logger } = opts;

  registerAccountTools(server, { store, registry, tools });
  registerBrowseTools(server, { store, registry, tools, logger });
  registerFolderTools(server, { registry, tools });
  registerOrganizeTools(server, { registry, tools });
  registerComposeTools(server, { store, registry, tools, logger });
}
