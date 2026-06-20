import { promises as fs } from "node:fs";
import path from "node:path";

import {
  encrypt,
  decrypt,
  resolveDataDir,
  resolveKey,
  writeAtomic,
} from "./crypto.js";

/**
 * One stored account. `tokens` is provider-specific (e.g. serialized MSAL cache
 * for Outlook, host/port/password blob for IMAP) — the store is opaque to it.
 */
export interface AccountRecord {
  email: string;
  provider: "outlook" | "imap" | "gmail";
  displayName?: string;
  tokens: Record<string, unknown>;
  addedAt: string;
  /** HTML snippet — may contain formatting, images, links. Injected at end of outgoing emails. */
  signature?: string;
  /** Font/style preferences applied to outgoing HTML emails. */
  style?: { fontFamily?: string; fontSize?: string; fontColor?: string };
  /** Pull-based new-mail checkpoint for `get_new_emails`.
   *  `receivedAt` is the high-water timestamp. `deliveredIdsAtReceivedAt`
   *  contains message IDs already returned at exactly that timestamp so
   *  same-timestamp batches do not skip or repeat messages. */
  newEmailCheckpoint?: {
    receivedAt: string;
    deliveredIdsAtReceivedAt?: string[];
  };
  /** Legacy watcher state from older versions. Not used by `get_new_emails`. */
  lastSeenAt?: string;
  /** Legacy watcher state from older versions. Not used by `get_new_emails`. */
  lastSeenIds?: string[];
}

interface StoreFile {
  version: 1;
  accounts: AccountRecord[];
}

export interface OpenOptions {
  dataDir?: string;
  /** Inject the encryption key directly (mostly for tests). Otherwise resolved
   *  from `HYPERMAIL_KEY` env, then OS keychain, then auto-generated. */
  key?: Buffer;
}

const FILE_NAME = "accounts.json.enc";

export class AccountStore {
  private constructor(
    private readonly filePath: string,
    private readonly key: Buffer,
    private data: StoreFile,
  ) {}

  static async open(opts: OpenOptions = {}): Promise<AccountStore> {
    const dataDir = resolveDataDir(opts.dataDir);
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
    const filePath = path.join(dataDir, FILE_NAME);
    const key = opts.key ?? (await resolveKey(dataDir));

    let data: StoreFile;
    try {
      const buf = await fs.readFile(filePath);
      data = decrypt(buf, key);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        data = { version: 1, accounts: [] };
      } else {
        throw err;
      }
    }
    return new AccountStore(filePath, key, data);
  }

  listAccounts(): AccountRecord[] {
    // Return shallow clones without tokens leaking out unintentionally is the
    // caller's job; here we expose the full record for provider use.
    return this.data.accounts.map((a) => ({ ...a }));
  }

  getAccount(email: string): AccountRecord | undefined {
    const norm = email.trim().toLowerCase();
    const rec = this.data.accounts.find((a) => a.email.toLowerCase() === norm);
    return rec ? { ...rec } : undefined;
  }

  async upsertAccount(rec: AccountRecord): Promise<AccountRecord> {
    const norm = rec.email.trim().toLowerCase();
    const next: AccountRecord = { ...rec, email: norm };
    const idx = this.data.accounts.findIndex((a) => a.email.toLowerCase() === norm);
    if (idx >= 0) this.data.accounts[idx] = next;
    else this.data.accounts.push(next);
    await this.flush();
    return { ...next };
  }

  async removeAccount(email: string): Promise<boolean> {
    const norm = email.trim().toLowerCase();
    const before = this.data.accounts.length;
    this.data.accounts = this.data.accounts.filter((a) => a.email.toLowerCase() !== norm);
    if (this.data.accounts.length === before) return false;
    await this.flush();
    return true;
  }

  private async flush(): Promise<void> {
    const buf = encrypt(this.data, this.key);
    await writeAtomic(this.filePath, buf);
  }
}
