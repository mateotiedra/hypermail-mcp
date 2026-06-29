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

export interface NewEmailClaimCandidate {
  summaryId: string;
  receivedAt: string;
  ids: string[];
}

export interface OpenOptions {
  dataDir?: string;
  /** Inject the encryption key directly (mostly for tests). Otherwise resolved
   *  from `HYPERMAIL_KEY` env, then OS keychain, then auto-generated. */
  key?: Buffer;
}

const FILE_NAME = "accounts.json.enc";
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 25;

type NewEmailCheckpoint = NonNullable<AccountRecord["newEmailCheckpoint"]>;

export class AccountStore {
  private readonly writeLocks = new Map<string, Promise<void>>();
  private readonly lockPath: string;

  private constructor(
    private readonly filePath: string,
    private readonly key: Buffer,
    private data: StoreFile,
  ) {
    this.lockPath = `${filePath}.lock`;
  }

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
    return this.runSerial(rec.email, async () => this.updateLocked((data) => {
      const norm = rec.email.trim().toLowerCase();
      const idx = data.accounts.findIndex((a) => a.email.toLowerCase() === norm);
      const current = idx >= 0 ? data.accounts[idx] : undefined;
      const next: AccountRecord = { ...rec, email: norm };
      const mergedCheckpoint = mergeNewEmailCheckpoints(
        current?.newEmailCheckpoint,
        rec.newEmailCheckpoint,
      );
      if (mergedCheckpoint) next.newEmailCheckpoint = mergedCheckpoint;
      else delete next.newEmailCheckpoint;

      if (idx >= 0) data.accounts[idx] = next;
      else data.accounts.push(next);
      return { result: { ...next }, changed: true };
    }));
  }

  async updateTokens(
    email: string,
    tokens: AccountRecord["tokens"],
  ): Promise<AccountRecord | undefined> {
    return this.runSerial(email, async () => this.updateLocked((data) => {
      const norm = email.trim().toLowerCase();
      const idx = data.accounts.findIndex((a) => a.email.toLowerCase() === norm);
      if (idx < 0) return { result: undefined, changed: false };
      const current = data.accounts[idx]!;
      const next: AccountRecord = { ...current, tokens };
      data.accounts[idx] = next;
      return { result: { ...next }, changed: true };
    }));
  }

  async updateNewEmailCheckpoint(
    email: string,
    checkpoint: NewEmailCheckpoint,
  ): Promise<AccountRecord | undefined> {
    return this.runSerial(email, async () => this.updateLocked((data) => {
      const norm = email.trim().toLowerCase();
      const idx = data.accounts.findIndex((a) => a.email.toLowerCase() === norm);
      if (idx < 0) return { result: undefined, changed: false };

      const current = data.accounts[idx]!;
      const mergedCheckpoint = mergeNewEmailCheckpoints(
        current.newEmailCheckpoint,
        checkpoint,
      );
      if (!mergedCheckpoint) return { result: { ...current }, changed: false };

      const next: AccountRecord = {
        ...current,
        newEmailCheckpoint: mergedCheckpoint,
      };
      data.accounts[idx] = next;
      return { result: { ...next }, changed: true };
    }));
  }

  async claimNewEmails(
    email: string,
    candidates: NewEmailClaimCandidate[],
  ): Promise<string[]> {
    return this.runSerial(email, async () => this.updateLocked((data) => {
      const norm = email.trim().toLowerCase();
      const idx = data.accounts.findIndex((a) => a.email.toLowerCase() === norm);
      if (idx < 0 || candidates.length === 0) return { result: [], changed: false };

      const account = data.accounts[idx]!;
      let checkpoint = normalizeCheckpoint(account.newEmailCheckpoint);
      const claimed: string[] = [];
      const ordered = [...candidates].sort((a, b) => {
        const byTime = compareTimestamp(normalizeTimestamp(a.receivedAt) ?? a.receivedAt, normalizeTimestamp(b.receivedAt) ?? b.receivedAt);
        if (byTime !== 0) return byTime;
        return a.summaryId.localeCompare(b.summaryId);
      });

      for (const candidate of ordered) {
        const receivedAt = normalizeTimestamp(candidate.receivedAt);
        if (!receivedAt) continue;
        const ids = uniqueIds([candidate.summaryId, ...candidate.ids]);
        if (ids.length === 0) continue;
        if (isAlreadyDelivered(checkpoint, receivedAt, ids)) continue;

        claimed.push(candidate.summaryId);
        checkpoint = mergeNewEmailCheckpoints(checkpoint, {
          receivedAt,
          deliveredIdsAtReceivedAt: ids,
        });
      }

      if (claimed.length === 0 || !checkpoint) return { result: claimed, changed: false };

      const next: AccountRecord = {
        ...account,
        newEmailCheckpoint: checkpoint,
      };
      data.accounts[idx] = next;
      return { result: claimed, changed: true };
    }));
  }

  async removeAccount(email: string): Promise<boolean> {
    return this.runSerial(email, async () => this.updateLocked((data) => {
      const norm = email.trim().toLowerCase();
      const before = data.accounts.length;
      data.accounts = data.accounts.filter((a) => a.email.toLowerCase() !== norm);
      return { result: data.accounts.length !== before, changed: data.accounts.length !== before };
    }));
  }

  private async runSerial<T>(email: string, task: () => Promise<T>): Promise<T> {
    const norm = email.trim().toLowerCase();
    const previous = this.writeLocks.get(norm) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const lock = run.then(
      () => undefined,
      () => undefined,
    );
    this.writeLocks.set(norm, lock);
    try {
      return await run;
    } finally {
      if (this.writeLocks.get(norm) === lock) {
        this.writeLocks.delete(norm);
      }
    }
  }

  private async updateLocked<T>(
    task: (data: StoreFile) => { result: T; changed: boolean } | Promise<{ result: T; changed: boolean }>,
  ): Promise<T> {
    return this.withFileLock(async () => {
      this.data = await this.readLatest();
      const { result, changed } = await task(this.data);
      if (changed) await this.flush();
      return result;
    });
  }

  private async readLatest(): Promise<StoreFile> {
    try {
      const buf = await fs.readFile(this.filePath);
      return decrypt(buf, this.key);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, accounts: [] };
      }
      throw err;
    }
  }

  private async flush(): Promise<void> {
    const buf = encrypt(this.data, this.key);
    await writeAtomic(this.filePath, buf);
  }

  private async withFileLock<T>(task: () => Promise<T>): Promise<T> {
    await this.acquireFileLock();
    try {
      return await task();
    } finally {
      await fs.rm(this.lockPath, { recursive: true, force: true });
    }
  }

  private async acquireFileLock(): Promise<void> {
    const startedAt = Date.now();
    while (true) {
      try {
        await fs.mkdir(this.lockPath, { mode: 0o700 });
        await fs.writeFile(
          path.join(this.lockPath, "owner"),
          `${process.pid}\n${new Date().toISOString()}\n`,
          { mode: 0o600 },
        );
        return;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

        await this.removeStaleLock();
        if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
          throw new Error(`timed out waiting for account store lock: ${this.lockPath}`);
        }
        await delay(LOCK_RETRY_MS);
      }
    }
  }

  private async removeStaleLock(): Promise<void> {
    try {
      const stat = await fs.stat(this.lockPath);
      if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        await fs.rm(this.lockPath, { recursive: true, force: true });
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

function normalizeCheckpoint(
  checkpoint: AccountRecord["newEmailCheckpoint"],
): NewEmailCheckpoint | undefined {
  const receivedAt = normalizeTimestamp(checkpoint?.receivedAt);
  if (!receivedAt) return undefined;
  return {
    receivedAt,
    deliveredIdsAtReceivedAt: uniqueIds(checkpoint?.deliveredIdsAtReceivedAt ?? []),
  };
}

function mergeNewEmailCheckpoints(
  current: AccountRecord["newEmailCheckpoint"],
  incoming: AccountRecord["newEmailCheckpoint"],
): NewEmailCheckpoint | undefined {
  const normalizedCurrent = normalizeCheckpoint(current);
  const normalizedIncoming = normalizeCheckpoint(incoming);
  if (!normalizedIncoming) return normalizedCurrent;
  if (!normalizedCurrent) return normalizedIncoming;

  const comparison = compareTimestamp(normalizedIncoming.receivedAt, normalizedCurrent.receivedAt);
  if (comparison > 0) return normalizedIncoming;
  if (comparison < 0) return normalizedCurrent;

  return {
    receivedAt: normalizedCurrent.receivedAt,
    deliveredIdsAtReceivedAt: uniqueIds([
      ...(normalizedCurrent.deliveredIdsAtReceivedAt ?? []),
      ...(normalizedIncoming.deliveredIdsAtReceivedAt ?? []),
    ]),
  };
}

function isAlreadyDelivered(
  checkpoint: NewEmailCheckpoint | undefined,
  receivedAt: string,
  ids: string[],
): boolean {
  if (!checkpoint) return false;
  const comparison = compareTimestamp(receivedAt, checkpoint.receivedAt);
  if (comparison < 0) return true;
  if (comparison > 0) return false;
  const delivered = new Set(checkpoint.deliveredIdsAtReceivedAt ?? []);
  return ids.some((id) => delivered.has(id));
}

function normalizeTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

function compareTimestamp(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id.length > 0))];
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
