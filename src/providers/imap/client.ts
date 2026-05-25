import { ImapFlow } from "imapflow";
import type { Readable } from "node:stream";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

import type { AccountRecord } from "../../store/account-store.js";

// ---------- token shape ----------

export interface ImapTokens {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

/** Type guard — validates that an unknown value has the shape of ImapTokens. */
export function isImapTokens(obj: unknown): obj is ImapTokens {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.host === "string" &&
    typeof o.port === "number" &&
    typeof o.user === "string" &&
    typeof o.password === "string" &&
    typeof o.smtpHost === "string" &&
    typeof o.smtpPort === "number"
  );
}

/** Extract IMAP tokens from an account record, throwing if malformed. */
export function extractTokens(account: AccountRecord): ImapTokens {
  if (!isImapTokens(account.tokens)) {
    throw new Error(
      "IMAP account tokens are missing or corrupted — re-run add_account",
    );
  }
  return account.tokens as ImapTokens;
}

// ---------- client ----------

/**
 * Per-account IMAP+SMTP client. Wraps an {@link ImapFlow} connection and a
 * {@link Transporter} from nodemailer. The factory caches instances so a
 * single account reuses its connection across calls.
 */
export class ImapClient {
  private imap: ImapFlow | null = null;
  private transporter: Transporter | null = null;
  private connecting: Promise<void> | null = null;

  constructor(private readonly tokens: ImapTokens) {}

  /** Get (or create) the ImapFlow instance. */
  async getImap(): Promise<ImapFlow> {
    if (this.imap) return this.imap;

    this.imap = new ImapFlow({
      host: this.tokens.host,
      port: this.tokens.port,
      secure: this.tokens.secure,
      auth: {
        user: this.tokens.user,
        pass: this.tokens.password,
      },
      logger: false,
    });

    // Connect on first use and serialise concurrent callers.
    if (!this.connecting) {
      this.connecting = this.imap
        .connect()
        .catch((err) => {
          // Clear state so next caller retries
          this.imap = null;
          this.connecting = null;
          throw err;
        });
    }
    await this.connecting;
    return this.imap;
  }

  /** Get (or create) a nodemailer SMTP transporter. */
  getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    this.transporter = nodemailer.createTransport({
      host: this.tokens.smtpHost,
      port: this.tokens.smtpPort,
      secure: this.tokens.smtpSecure,
      auth: {
        user: this.tokens.user,
        pass: this.tokens.password,
      },
    });
    return this.transporter;
  }

  /**
   * Acquire a mailbox lock and run `fn` with the mailbox selected.
   * Releases the lock automatically after `fn` completes.
   */
  async withMailbox<T>(mailbox: string, fn: (imap: ImapFlow) => Promise<T>): Promise<T> {
    const imap = await this.getImap();
    const lock = await imap.getMailboxLock(mailbox);
    try {
      return await fn(imap);
    } finally {
      lock.release();
    }
  }

  /** Disconnect IMAP and close the SMTP pool. */
  async disconnect(): Promise<void> {
    if (this.imap) {
      try {
        await this.imap.logout();
      } catch {
        /* ignore */
      }
      this.imap = null;
      this.connecting = null;
    }
    if (this.transporter) {
      this.transporter.close();
      this.transporter = null;
    }
  }
}

// ---------- factory ----------

/**
 * Caches {@link ImapClient} instances per account email so connections are
 * reused across calls. Analogous to {@link OutlookClientFactory}.
 */
export class ImapClientFactory {
  private readonly cache = new Map<string, ImapClient>();

  get(account: AccountRecord): ImapClient {
    const key = account.email.toLowerCase();
    const existing = this.cache.get(key);
    if (existing) return existing;

    const tokens = extractTokens(account);
    const client = new ImapClient(tokens);
    this.cache.set(key, client);
    return client;
  }

  /** Drop a cached client (e.g. after removeAccount). */
  invalidate(email: string): void {
    const key = email.toLowerCase();
    const existing = this.cache.get(key);
    if (existing) {
      existing.disconnect().catch(() => {});
      this.cache.delete(key);
    }
  }
}
