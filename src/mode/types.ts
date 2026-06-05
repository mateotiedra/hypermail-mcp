import type { IncomingMessage, ServerResponse } from "node:http";

// ── Store interfaces (structural — implemented by both file and DB stores) ──

import type { AccountRecord } from "../store/account-store.js";
import type { AgentRecord, UpsertAgentInput } from "../store/agent-store.js";

export type { AccountRecord, AgentRecord, UpsertAgentInput };

export interface IAccountStore {
  listAccounts(): Promise<AccountRecord[]>;
  getAccount(email: string): Promise<AccountRecord | undefined>;
  upsertAccount(rec: AccountRecord): Promise<AccountRecord>;
  removeAccount(email: string): Promise<boolean>;
}

export interface IAgentStore {
  listAgents(): Promise<AgentRecord[]>;
  getAgent(id: string): Promise<AgentRecord | undefined>;
  findAgentByApiKey(apiKey: string): Promise<AgentRecord | undefined>;
  upsertAgent(rec: UpsertAgentInput): Promise<AgentRecord>;
  removeAgent(id: string): Promise<boolean>;
  assignAccount(agentId: string, email: string): Promise<AgentRecord>;
  unassignAccount(agentId: string, email: string): Promise<AgentRecord>;
}

// ── Agent context (re-exported — same as current) ──

export type { AgentContext } from "../tools/agent-context.js";

// ── Auth error ──

export class AuthError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

// ── ModePlugin ──

export interface ModePlugin {
  readonly mode: "solo" | "multi";

  /** One-time init. Multi: DB connect + migrate. Solo: no-op. */
  init(): Promise<void>;

  /** Cleanup. Multi: close DB pool. Solo: no-op. */
  close(): Promise<void>;

  /** Create the account store for this mode. */
  createAccountStore(dataDir?: string): Promise<IAccountStore>;

  /** Create the agent store for this mode, or null if no multi-agent support. */
  createAgentStore(dataDir?: string): Promise<IAgentStore | null>;

  /**
   * Authenticate an HTTP request for MCP session init.
   * Returns AgentContext (authenticated), null (no auth), or throws AuthError.
   */
  authenticate(req: IncomingMessage): Promise<import("../tools/agent-context.js").AgentContext | null>;

  /**
   * Handle /admin/* HTTP requests. Return true if handled.
   * Undefined = no admin support (solo).
   */
  handleAdminRequest?(req: IncomingMessage, res: ServerResponse): Promise<boolean>;

  /**
   * Compute watcher account filter from agent store.
   * Undefined = no agent store, poll all accounts.
   */
  getWatcherAccountFilter?(): Promise<string[] | undefined>;
}
