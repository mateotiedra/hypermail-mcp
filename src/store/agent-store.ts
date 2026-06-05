import path from "node:path";
import { promises as fs } from "node:fs";

import {
  encrypt,
  decrypt,
  resolveDataDir,
  resolveKey,
  writeAtomic,
  hashApiKey,
  verifyApiKey,
} from "./crypto.js";

/**
 * One stored agent. API keys are hashed at rest (scrypt) — the plaintext key
 * is never stored. The `id` is a human-readable slug; `accounts` lists the
 * email addresses this agent is authorized to operate on.
 */
export type UpsertAgentInput = Omit<AgentRecord, "apiKeyHash" | "createdAt"> & {
  plaintextApiKey?: string;
};

export interface AgentRecord {
  id: string;
  /** scrypt hash of the agent's API key (format: "salt:hash", both hex). */
  apiKeyHash: string;
  name: string;
  /** Email addresses assigned to this agent. */
  accounts: string[];
  /** Whether this agent can provision/remove accounts. */
  provisioning: boolean;
  createdAt: string;
}

interface AgentStoreFile {
  version: 1;
  agents: AgentRecord[];
}

export interface AgentStoreOpenOptions {
  dataDir?: string;
  /** Inject the encryption key directly (mostly for tests). */
  key?: Buffer;
}

const FILE_NAME = "agents.json.enc";

export class AgentStore {
  private constructor(
    private readonly filePath: string,
    private readonly key: Buffer,
    private data: AgentStoreFile,
  ) {}

  static async open(opts: AgentStoreOpenOptions = {}): Promise<AgentStore> {
    const dataDir = resolveDataDir(opts.dataDir);
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
    const filePath = path.join(dataDir, FILE_NAME);
    const key = opts.key ?? (await resolveKey(dataDir));

    let data: AgentStoreFile;
    try {
      const buf = await fs.readFile(filePath);
      data = decrypt<AgentStoreFile>(buf, key);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        data = { version: 1, agents: [] };
      } else {
        throw err;
      }
    }
    return new AgentStore(filePath, key, data);
  }

  // ── queries ──

  async listAgents(): Promise<AgentRecord[]> {
    return this.data.agents.map((a) => ({ ...a }));
  }

  async getAgent(id: string): Promise<AgentRecord | undefined> {
    const rec = this.data.agents.find((a) => a.id === id);
    return rec ? { ...rec } : undefined;
  }

  /**
   * Look up an agent by plaintext API key. Hashes the incoming key and
   * compares against stored hashes with constant-time comparison.
   * Returns undefined if no agent matches.
   */
  async findAgentByApiKey(apiKey: string): Promise<AgentRecord | undefined> {
    for (const agent of this.data.agents) {
      if (verifyApiKey(apiKey, agent.apiKeyHash)) {
        return { ...agent };
      }
    }
    return undefined;
  }

  // ── mutations ──

  /**
   * Add or update an agent. If `plaintextApiKey` is provided, it is hashed
   * and stored; if omitted, the existing hash is preserved (useful for
   * updates that don't change the key).
   */
  async upsertAgent(
    rec: Omit<AgentRecord, "apiKeyHash" | "createdAt"> & {
      plaintextApiKey?: string;
    },
  ): Promise<AgentRecord> {
    const idx = this.data.agents.findIndex((a) => a.id === rec.id);
    const existing = idx >= 0 ? this.data.agents[idx] : undefined;
    const apiKeyHash = rec.plaintextApiKey
      ? hashApiKey(rec.plaintextApiKey)
      : existing?.apiKeyHash;
    if (!apiKeyHash) {
      throw new Error(
        `agent ${rec.id}: must provide plaintextApiKey for new agents`,
      );
    }

    const next: AgentRecord = {
      id: rec.id,
      apiKeyHash,
      name: rec.name,
      accounts: [...(rec.accounts ?? [])],
      provisioning: rec.provisioning ?? false,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    if (idx >= 0) {
      this.data.agents[idx] = next;
    } else {
      this.data.agents.push(next);
    }
    await this.flush();
    return { ...next };
  }

  async removeAgent(id: string): Promise<boolean> {
    const before = this.data.agents.length;
    this.data.agents = this.data.agents.filter((a) => a.id !== id);
    if (this.data.agents.length === before) return false;
    await this.flush();
    return true;
  }

  /**
   * Assign an email account to an agent. Idempotent — no error if already
   * assigned. Auto-assignment from `add_account` in HTTP mode calls this.
   */
  async assignAccount(agentId: string, email: string): Promise<AgentRecord> {
    const norm = email.trim().toLowerCase();
    const agent = this.data.agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`agent ${agentId} not found`);
    if (!agent.accounts.includes(norm)) {
      agent.accounts.push(norm);
      await this.flush();
    }
    return { ...agent };
  }

  /**
   * Remove an email account from an agent's assignments. Idempotent.
   */
  async unassignAccount(agentId: string, email: string): Promise<AgentRecord> {
    const norm = email.trim().toLowerCase();
    const agent = this.data.agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`agent ${agentId} not found`);
    agent.accounts = agent.accounts.filter((a) => a !== norm);
    await this.flush();
    return { ...agent };
  }

  // ── persistence ──

  private async flush(): Promise<void> {
    const buf = encrypt(this.data, this.key);
    await writeAtomic(this.filePath, buf);
  }
}
