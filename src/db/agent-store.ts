import { query, queryOne } from "./connection.js";
import { hashApiKey, verifyApiKey } from "../store/crypto.js";
import type { IAgentStore } from "../mode/types.js";
import type { AgentRecord, UpsertAgentInput } from "../store/agent-store.js";

interface AgentRow {
  id: string;
  api_key_hash: string;
  name: string;
  accounts: string[];
  provisioning: boolean;
  created_at: string;
}

function rowToRecord(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    apiKeyHash: row.api_key_hash,
    name: row.name,
    accounts: row.accounts,
    provisioning: row.provisioning,
    createdAt: row.created_at,
  };
}

export class DbAgentStore implements IAgentStore {
  async listAgents(): Promise<AgentRecord[]> {
    const rows = await query<AgentRow>(
      `SELECT * FROM agents ORDER BY created_at DESC`,
    );
    return rows.map(rowToRecord);
  }

  async getAgent(id: string): Promise<AgentRecord | undefined> {
    const row = await queryOne<AgentRow>(
      `SELECT * FROM agents WHERE id = $1`,
      [id],
    );
    return row ? rowToRecord(row) : undefined;
  }

  async findAgentByApiKey(apiKey: string): Promise<AgentRecord | undefined> {
    // We must fetch all agents and compare hashes — scrypt hashing is per-agent
    // (each has its own salt), so we can't query by hash prefix.
    const rows = await query<AgentRow>(`SELECT * FROM agents`);
    for (const row of rows) {
      if (verifyApiKey(apiKey, row.api_key_hash)) {
        return rowToRecord(row);
      }
    }
    return undefined;
  }

  async upsertAgent(rec: UpsertAgentInput): Promise<AgentRecord> {
    const existing = await this.getAgent(rec.id);
    const apiKeyHash = rec.plaintextApiKey
      ? hashApiKey(rec.plaintextApiKey)
      : existing?.apiKeyHash;

    if (!apiKeyHash) {
      throw new Error(
        `agent ${rec.id}: must provide plaintextApiKey for new agents`,
      );
    }

    const row = await queryOne<AgentRow>(
      `INSERT INTO agents (id, api_key_hash, name, accounts, provisioning, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         api_key_hash = EXCLUDED.api_key_hash,
         name = EXCLUDED.name,
         accounts = EXCLUDED.accounts,
         provisioning = EXCLUDED.provisioning
       RETURNING *`,
      [
        rec.id,
        apiKeyHash,
        rec.name,
        JSON.stringify(rec.accounts ?? []),
        rec.provisioning ?? false,
        existing?.createdAt ?? new Date().toISOString(),
      ],
    );

    return rowToRecord(row!);
  }

  async removeAgent(id: string): Promise<boolean> {
    const result = await query<{ deleted: number }>(
      `WITH deleted AS (DELETE FROM agents WHERE id = $1 RETURNING id)
       SELECT COUNT(*)::int AS deleted FROM deleted`,
      [id],
    );
    return (result[0]?.deleted ?? 0) > 0;
  }

  async assignAccount(agentId: string, email: string): Promise<AgentRecord> {
    const norm = email.trim().toLowerCase();
    // Use PostgreSQL to atomically append to the JSONB array if not already present
    const row = await queryOne<AgentRow>(
      `UPDATE agents
       SET accounts = CASE
         WHEN accounts @> $2::jsonb THEN accounts
         ELSE accounts || $2::jsonb
       END
       WHERE id = $1
       RETURNING *`,
      [agentId, JSON.stringify([norm])],
    );
    if (!row) throw new Error(`agent ${agentId} not found`);
    return rowToRecord(row);
  }

  async unassignAccount(agentId: string, email: string): Promise<AgentRecord> {
    const norm = email.trim().toLowerCase();
    const row = await queryOne<AgentRow>(
      `UPDATE agents
       SET accounts = accounts - $2
       WHERE id = $1
       RETURNING *`,
      [agentId, norm],
    );
    if (!row) throw new Error(`agent ${agentId} not found`);
    return rowToRecord(row);
  }
}
