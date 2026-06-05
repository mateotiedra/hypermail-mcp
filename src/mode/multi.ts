import type { IncomingMessage } from "node:http";

import { healthCheck, runMigrations, closePool } from "../db/index.js";
import { DbAccountStore } from "../db/account-store.js";
import { DbAgentStore } from "../db/agent-store.js";
import { createAdminRouter } from "../admin/router.js";
import type { ModePlugin, IAccountStore, IAgentStore } from "./types.js";
import { AuthError } from "./types.js";
import type { AgentContext } from "../tools/agent-context.js";

export function createMultiPlugin(): ModePlugin {
  let accountStore: DbAccountStore | null = null;
  let agentStore: DbAgentStore | null = null;

  return {
    mode: "multi",

    async init() {
      // Crash-fast: verify DB is reachable
      await healthCheck();
      // Auto-create tables on first run (idempotent)
      await runMigrations();
    },

    async close() {
      await closePool();
    },

    async createAccountStore(_dataDir?: string): Promise<IAccountStore> {
      if (!accountStore) {
        accountStore = new DbAccountStore();
      }
      return accountStore;
    },

    async createAgentStore(_dataDir?: string): Promise<IAgentStore | null> {
      if (!agentStore) {
        agentStore = new DbAgentStore();
      }
      return agentStore;
    },

    async authenticate(req: IncomingMessage): Promise<AgentContext | null> {
      const apiKey = (req.headers["x-api-key"] as string | undefined)?.trim();
      if (!apiKey) {
        throw new AuthError(401, "Missing x-api-key header");
      }
      const store = await this.createAgentStore();
      if (!store) {
        throw new AuthError(401, "No agent store available");
      }
      const agent = await store.findAgentByApiKey(apiKey);
      if (!agent) {
        throw new AuthError(401, "Invalid API key");
      }
      return {
        agentId: agent.id,
        accounts: agent.accounts,
        provisioning: agent.provisioning,
      };
    },

    async getWatcherAccountFilter(): Promise<string[] | undefined> {
      const store = await this.createAgentStore();
      if (!store) return undefined;
      const agents = await store.listAgents();
      const all = new Set<string>();
      for (const agent of agents) {
        for (const email of agent.accounts) {
          all.add(email.toLowerCase());
        }
      }
      return all.size > 0 ? [...all] : undefined;
    },

    async handleAdminRequest(req, res): Promise<boolean> {
      const agentStore = await this.createAgentStore();
      const accountStore = await this.createAccountStore();
      if (!agentStore) return false;
      const router = createAdminRouter(agentStore, accountStore);
      return router(req, res);
    },
  };
}
