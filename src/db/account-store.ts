import { query, queryOne } from "./connection.js";
import { encrypt, decrypt, resolveEncryptionKey } from "../store/crypto.js";
import type { IAccountStore } from "../mode/types.js";
import type { AccountRecord } from "../store/account-store.js";

interface AccountRow {
  email: string;
  provider: string;
  display_name: string | null;
  tokens_enc: Buffer;
  signature: string | null;
  style: Record<string, string> | null;
  added_at: string;
  last_seen_at: string | null;
  last_seen_ids: string[];
}

function rowToRecord(row: AccountRow, key: Buffer): AccountRecord {
  return {
    email: row.email,
    provider: row.provider as AccountRecord["provider"],
    displayName: row.display_name ?? undefined,
    tokens: decrypt<Record<string, unknown>>(row.tokens_enc, key),
    signature: row.signature ?? undefined,
    style: row.style ?? undefined,
    addedAt: row.added_at,
    lastSeenAt: row.last_seen_at ?? undefined,
    lastSeenIds: row.last_seen_ids,
  };
}

export class DbAccountStore implements IAccountStore {
  private key: Buffer;

  constructor() {
    this.key = resolveEncryptionKey();
  }

  async listAccounts(): Promise<AccountRecord[]> {
    const rows = await query<AccountRow>(
      `SELECT * FROM accounts ORDER BY added_at DESC`,
    );
    return rows.map((r) => rowToRecord(r, this.key));
  }

  async getAccount(email: string): Promise<AccountRecord | undefined> {
    const row = await queryOne<AccountRow>(
      `SELECT * FROM accounts WHERE email = $1`,
      [email.trim().toLowerCase()],
    );
    return row ? rowToRecord(row, this.key) : undefined;
  }

  async upsertAccount(rec: AccountRecord): Promise<AccountRecord> {
    const norm = rec.email.trim().toLowerCase();
    const tokensEnc = encrypt(rec.tokens, this.key);

    await query(
      `INSERT INTO accounts (email, provider, display_name, tokens_enc, signature, style, added_at, last_seen_at, last_seen_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (email) DO UPDATE SET
         provider = EXCLUDED.provider,
         display_name = EXCLUDED.display_name,
         tokens_enc = EXCLUDED.tokens_enc,
         signature = EXCLUDED.signature,
         style = EXCLUDED.style,
         last_seen_at = EXCLUDED.last_seen_at,
         last_seen_ids = EXCLUDED.last_seen_ids`,
      [
        norm,
        rec.provider,
        rec.displayName ?? null,
        tokensEnc,
        rec.signature ?? null,
        rec.style ? JSON.stringify(rec.style) : null,
        rec.addedAt,
        rec.lastSeenAt ?? null,
        JSON.stringify(rec.lastSeenIds ?? []),
      ],
    );

    return { ...rec, email: norm };
  }

  async removeAccount(email: string): Promise<boolean> {
    const result = await query<{ deleted: number }>(
      `WITH deleted AS (DELETE FROM accounts WHERE email = $1 RETURNING email)
       SELECT COUNT(*)::int AS deleted FROM deleted`,
      [email.trim().toLowerCase()],
    );
    return (result[0]?.deleted ?? 0) > 0;
  }
}
