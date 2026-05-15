import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

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
}

interface StoreFile {
  version: 1;
  accounts: AccountRecord[];
}

export interface OpenOptions {
  dataDir?: string;
  /** Inject the encryption key directly (mostly for tests). Otherwise resolved
   *  from `HYPER_EMAIL_MCP_KEY` env, then OS keychain, then auto-generated. */
  key?: Buffer;
}

const FILE_NAME = "accounts.json.enc";
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;

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
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, buf, { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
}

// ---------- encryption helpers ----------

function encrypt(data: StoreFile, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), "utf8");
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // layout: [1-byte version=1][12 iv][16 tag][ct...]
  return Buffer.concat([Buffer.from([1]), iv, tag, ct]);
}

function decrypt(buf: Buffer, key: Buffer): StoreFile {
  if (buf.length < 1 + 12 + 16 + 1) throw new Error("accounts file truncated");
  const v = buf[0];
  if (v !== 1) throw new Error(`unsupported accounts file version: ${v}`);
  const iv = buf.subarray(1, 13);
  const tag = buf.subarray(13, 29);
  const ct = buf.subarray(29);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  const parsed = JSON.parse(pt.toString("utf8")) as StoreFile;
  if (parsed.version !== 1 || !Array.isArray(parsed.accounts)) {
    throw new Error("accounts file is malformed");
  }
  return parsed;
}

// ---------- key + path resolution ----------

function resolveDataDir(explicit?: string): string {
  if (explicit && explicit.length > 0) return path.resolve(explicit);
  const env = process.env.HYPER_EMAIL_MCP_DATA_DIR;
  if (env && env.length > 0) return path.resolve(env);
  return path.join(homedir(), ".hyper-email-mcp");
}

function parseEnvKey(raw: string): Buffer | undefined {
  const s = raw.trim();
  // hex (64 chars)
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, "hex");
  // base64 — accept any length, then check
  try {
    const buf = Buffer.from(s, "base64");
    if (buf.length === KEY_LEN) return buf;
  } catch {
    /* ignore */
  }
  // last-resort: derive 32 bytes via SHA-256 over the raw string. This lets
  // users pass any passphrase; not ideal but predictable.
  return createHash("sha256").update(s, "utf8").digest();
}

async function resolveKey(dataDir: string): Promise<Buffer> {
  const env = process.env.HYPER_EMAIL_MCP_KEY;
  if (env && env.length > 0) {
    const k = parseEnvKey(env);
    if (k) return k;
  }

  // Try OS keychain via keytar (optional dep).
  const fromKeytar = await tryKeytarGet();
  if (fromKeytar) return fromKeytar;

  // Local-dev fallback: persist a generated key to a 0600 file next to the
  // accounts blob so subsequent runs can decrypt. Hosted deployments should
  // always set HYPER_EMAIL_MCP_KEY explicitly.
  const keyFile = path.join(dataDir, "master.key");
  try {
    const existing = await fs.readFile(keyFile);
    if (existing.length === KEY_LEN) return existing;
  } catch {
    /* fall through to generate */
  }
  const gen = randomBytes(KEY_LEN);
  await fs.writeFile(keyFile, gen, { mode: 0o600 });
  await tryKeytarSet(gen);
  return gen;
}

async function tryKeytarGet(): Promise<Buffer | undefined> {
  try {
    const mod = (await import("keytar")) as typeof import("keytar");
    const val = await mod.getPassword("hyper-email-mcp", "master");
    if (val) {
      const buf = Buffer.from(val, "base64");
      if (buf.length === KEY_LEN) return buf;
    }
  } catch {
    /* keytar not installed or unsupported platform */
  }
  return undefined;
}

async function tryKeytarSet(key: Buffer): Promise<void> {
  try {
    const mod = (await import("keytar")) as typeof import("keytar");
    await mod.setPassword("hyper-email-mcp", "master", key.toString("base64"));
  } catch {
    /* ignore */
  }
}
