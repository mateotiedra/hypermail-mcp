import type { AccountRecord } from "../../store/account-store.js";
import type {
  AddAccountInput,
  AddAccountResult,
  AttachmentContent,
  CompleteAddAccountResult,
  EmailFull,
  EmailProvider,
  EmailSummary,
  ListEmailsOptions,
  SearchEmailsOptions,
  SendInput,
} from "../types.js";

const NOT_IMPLEMENTED =
  "IMAP provider is not yet implemented in v1. Tracked at " +
  "src/providers/imap/index.ts — see src/providers/types.ts for the contract.";

/**
 * Placeholder IMAP provider — registered so the contract is locked in and
 * `add_account` returns a clear "coming soon" error instead of "unknown provider".
 *
 * v2 plan: use `imapflow` + `nodemailer` (for send). Tokens shape will be
 * `{ host, port, secure, user, password|appPassword }` encrypted at rest by
 * the AccountStore, identical to how Outlook's MSAL cache is stored.
 */
export class ImapProvider implements EmailProvider {
  readonly id = "imap" as const;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async addAccount(_input: AddAccountInput): Promise<AddAccountResult> {
    throw new Error(NOT_IMPLEMENTED);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async completeAddAccount(_handle: string): Promise<CompleteAddAccountResult> {
    return { status: "error", error: NOT_IMPLEMENTED };
  }

  async listEmails(
    _account: AccountRecord,
    _opts: ListEmailsOptions,
  ): Promise<EmailSummary[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async searchEmails(
    _account: AccountRecord,
    _query: string,
    _opts: SearchEmailsOptions,
  ): Promise<EmailSummary[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async readEmail(_account: AccountRecord, _id: string): Promise<EmailFull> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async readAttachment(
    _account: AccountRecord,
    _messageId: string,
    _attachmentId: string,
  ): Promise<AttachmentContent> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async sendEmail(
    _account: AccountRecord,
    _msg: SendInput,
  ): Promise<{ id: string }> {
    throw new Error(NOT_IMPLEMENTED);
  }
}
