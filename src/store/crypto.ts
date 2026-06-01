import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const ALGO = "aes-256-gcm";
export const KEY_LEN = 32;

// ── AES-256-GCM encrypt / decrypt ──

/** Encrypt JSON-serializable data with AES-256-GCM. Returns [1-byte version=1][12 iv][16 tag][ct...]. */
export function encrypt(data: unknown, key: Buffer): Buffer {
  if (key.length !== KEY_LEN) throw new Error(`key must be ${KEY_LEN} bytes`);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), "utf8");
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, tag, ct]);
}

/** Decrypt a buffer produced by {@link encrypt}. Returns the parsed JSON value. */
export function decrypt<T = unknown>(buf: Buffer, key: Buffer): T {
  if (key.length !== KEY_LEN) throw new Error(`key must be ${KEY_LEN} bytes`);
  if (buf.length < 1 + 12 + 16 + 1) throw new Error("encrypted data truncated");
  const v = buf[0];
  if (v !== 1) throw new Error(`unsupported data version: ${v}`);
  const iv = buf.subarray(1, 13);
  const tag = buf.subarray(13, 29);
  const ct = buf.subarray(29);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}

// ── key + path resolution ──

export function resolveDataDir(explicit?: string): string {
  if (explicit && explicit.length > 0) return path.resolve(explicit);
  const env = process.env.HYPERMAIL_MCP_DATA_DIR;
  if (env && env.length > 0) return path.resolve(env);
  return path.join(homedir(), ".hypermail-mcp");
}

export function parseEnvKey(raw: string): Buffer | undefined {
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
  // last-resort: derive 32 bytes via SHA-256 over the raw string
  return createHash("sha256").update(s, "utf8").digest();
}

export async function resolveKey(dataDir: string): Promise<Buffer> {
  const env = process.env.HYPERMAIL_MCP_KEY;
  if (env && env.length > 0) {
    const k = parseEnvKey(env);
    if (k) return k;
  }

  // Try OS keychain via keytar (optional dep).
  const fromKeytar = await tryKeytarGet();
  if (fromKeytar) return fromKeytar;

  // Local-dev fallback: persist a generated key to a 0600 file.
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

// ── API key hashing (scrypt — built into Node, no native deps) ──

/**
 * Hash an API key with scrypt. Returns "salt:hash" (both hex-encoded) for
 * storage. Suitable for <10 agents — scrypt is purpose-built for password
 * hashing and runs in-process with no native compilation.
 */
export function hashApiKey(apiKey: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(apiKey, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify a plaintext API key against a stored "salt:hash" string produced by
 * {@link hashApiKey}. Uses constant-time comparison.
 */
export function verifyApiKey(apiKey: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const computed = scryptSync(apiKey, salt, 32);
    const expected = Buffer.from(hash, "hex");
    if (computed.length !== expected.length) return false;
    return timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

// ── atomic file write ──

/** Write `data` to `filePath` atomically (tmp + rename). */
export async function writeAtomic(filePath: string, data: Buffer): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, filePath);
}

// ── keytar helpers (private) ──

async function tryKeytarGet(): Promise<Buffer | undefined> {
  try {
    const mod = (await import("keytar")) as typeof import("keytar");
    const val = await mod.getPassword("hypermail-mcp", "master");
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
    await mod.setPassword("hypermail-mcp", "master", key.toString("base64"));
  } catch {
    /* ignore */
  }
}
