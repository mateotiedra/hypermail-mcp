import type { AccountRecord } from "../../store/account-store.js";
import type {
  AddAccountInput,
  AddAccountResult,
  CompleteAddAccountResult,
} from "../types.js";
import { ImapClientFactory, ImapTokens, isImapTokens } from "./client.js";

export async function addAccount(
  clients: ImapClientFactory,
  store: { upsertAccount(rec: AccountRecord): Promise<AccountRecord> },
  input: AddAccountInput,
): Promise<AddAccountResult> {
  const cfg = input.config ?? {};
  const host = String(cfg.host ?? "");
  const port = Number(cfg.port ?? 993);
  const secure = cfg.secure !== false;
  const user = String(cfg.user ?? input.email ?? "");
  const password = String(cfg.password ?? "");
  const smtpHost = String(cfg.smtpHost ?? host);
  const smtpPort = Number(cfg.smtpPort ?? 587);
  const smtpSecure = cfg.smtpSecure === true;

  if (!host || !user || !password) {
    throw new Error(
      "IMAP requires config: { host, port?, secure?, user, password, smtpHost?, smtpPort?, smtpSecure? }",
    );
  }

  const tokens: ImapTokens = {
    host,
    port,
    secure,
    user,
    password,
    smtpHost: smtpHost || host,
    smtpPort: smtpPort || 587,
    smtpSecure,
  };

  // Validate by connecting briefly.
  const client = clients.get({
    email: user.toLowerCase(),
    provider: "imap",
    tokens: tokens as unknown as Record<string, unknown>,
    addedAt: new Date().toISOString(),
  } as AccountRecord);

  try {
    await client.getImap();
  } finally {
    clients.invalidate(user.toLowerCase());
  }

  // Optionally validate SMTP — best-effort.
  try {
    const t = client.getTransporter();
    await t.verify();
  } catch {
    /* SMTP verification is optional */
  }

  const email = user.toLowerCase();
  const rec: AccountRecord = {
    email,
    provider: "imap",
    displayName: input.email ?? user,
    tokens: tokens as unknown as Record<string, unknown>,
    addedAt: new Date().toISOString(),
  };
  const saved = await store.upsertAccount(rec);
  return { status: "ready", account: saved };
}

export function completeAddAccount(): CompleteAddAccountResult {
  return {
    status: "error",
    error:
      "IMAP accounts are set up synchronously — no polling needed. " +
      "Call add_account with IMAP config to create the account directly.",
  };
}
