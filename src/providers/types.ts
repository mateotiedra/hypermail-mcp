import type { AccountRecord } from "../store/account-store.js";

export type ProviderId = "outlook" | "imap" | "gmail";

export interface EmailStyle {
  fontFamily?: string;
  fontSize?: string;
  fontColor?: string;
}

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface EmailSummary {
  id: string;
  subject: string;
  from?: EmailAddress;
  to?: EmailAddress[];
  receivedAt?: string; // ISO
  preview?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  folder?: string;
}

export interface EmailFull extends EmailSummary {
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  bodyText?: string;
  bodyHtml?: string;
  attachments?: Array<{
    id: string;
    name: string;
    contentType?: string;
    size?: number;
  }>;
}

export interface ListEmailsOptions {
  folder?: string;
  limit?: number;
  unreadOnly?: boolean;
}

export interface SearchEmailsOptions {
  limit?: number;
}

export interface SendInput {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  body: string;
  isHtml?: boolean;
}

/**
 * Result of starting an add-account flow.
 *
 * - `pending` (e.g. device code): the caller must show `verification` to the
 *   user and later poll via `complete_add_account` with `handle`.
 * - `ready`: the account is fully provisioned and persisted.
 */
export type AddAccountResult =
  | {
      status: "pending";
      handle: string;
      verification: {
        userCode: string;
        verificationUri: string;
        expiresAt: string; // ISO
        message: string;
      };
    }
  | { status: "ready"; account: AccountRecord };

export interface AddAccountInput {
  /** Optional hint — the provider may infer/verify this from the auth result. */
  email?: string;
  /** Provider-specific extras (e.g. IMAP host/port/password) */
  config?: Record<string, unknown>;
}

export interface CompleteAddAccountResult {
  status: "pending" | "ready" | "expired" | "error";
  account?: AccountRecord;
  error?: string;
}

export interface AttachmentContent {
  name: string;
  contentType?: string;
  path: string;
}

export interface EmailProvider {
  readonly id: ProviderId;

  addAccount(input: AddAccountInput): Promise<AddAccountResult>;
  /** Optional — only providers with async flows (device code) need this. */
  completeAddAccount?(handle: string): Promise<CompleteAddAccountResult>;

  listEmails(account: AccountRecord, opts: ListEmailsOptions): Promise<EmailSummary[]>;
  searchEmails(
    account: AccountRecord,
    query: string,
    opts: SearchEmailsOptions,
  ): Promise<EmailSummary[]>;
  readEmail(account: AccountRecord, id: string): Promise<EmailFull>;
  readAttachment(
    account: AccountRecord,
    messageId: string,
    attachmentId: string,
  ): Promise<AttachmentContent>;
  sendEmail(account: AccountRecord, msg: SendInput): Promise<{ id: string }>;
}
