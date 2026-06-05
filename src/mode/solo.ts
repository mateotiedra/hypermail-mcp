import type { IncomingMessage } from "node:http";
import path from "node:path";

import { AccountStore } from "../store/account-store.js";
import { AgentStore } from "../store/agent-store.js";
import {
  loadAgentsConfig,
  watchAgentsConfig,
} from "../config/agents-config.js";
import type { ModePlugin, IAccountStore, IAgentStore } from "./types.js";
import type { AgentContext } from "../tools/agent-context.js";

export interface SoloPluginOptions {
  /** Path to agents.yaml (optional — only needed for account auto-assignment). */
  agentsConfigPath?: string;
}

export function createSoloPlugin(opts: SoloPluginOptions = {}): ModePlugin {
  let liveReloadHandle: { close(): void } | undefined;

  return {
    mode: "solo",

    async init() {
      // Solo mode: nothing to initialize
    },

    async close() {
      liveReloadHandle?.close();
    },

    async createAccountStore(dataDir?: string): Promise<IAccountStore> {
      return AccountStore.open({ dataDir });
    },

    async createAgentStore(dataDir?: string): Promise<IAgentStore | null> {
      if (!opts.agentsConfigPath) return null;

      const store = await AgentStore.open({ dataDir });

      // Live-reload agents.yaml into the store (kept for internal tracking,
      // NOT for auth — solo mode has no auth).
      liveReloadHandle = watchAgentsConfig(
        path.resolve(opts.agentsConfigPath),
        store,
        () => {
          // Store updated — no session invalidation needed in solo mode
          // since there's no auth.
        },
        (err) => {
          // eslint-disable-next-line no-console
          console.error(
            "[hypermail-mcp] agents.yaml reload error:",
            err.message,
          );
        },
      );

      return store;
    },

    // Solo mode: no authentication required.
    async authenticate(_req: IncomingMessage): Promise<AgentContext | null> {
      return null;
    },

    // Solo mode: no admin routes.
    // handleAdminRequest is undefined (not implemented).
  };
}
