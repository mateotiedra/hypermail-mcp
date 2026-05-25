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
  /** Number of items to skip for pagination (offset-based). Defaults to 0. */
  skip?: number;
}

/** Paginated result from `listEmails`. */
export interface ListEmailsResult {
  items: EmailSummary[];
  hasMore: boolean;
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
  /** ID of the message being replied to. When set, the message is sent as a
   *  reply (or reply-all if `replyAll` is true), preserving thread history. */
  inReplyTo?: string;
  /** When true and `inReplyTo` is set, reply to all recipients instead of just
   *  the sender. Defaults to false. */
  replyAll?: boolean;
  /** ID of the message to forward. When set, the message is sent as a forward
   *  of the specified message, preserving the original content. Mutually
   *  exclusive with `inReplyTo`. */
  forwardMessageId?: string;
}

/**
 * Fields that can be updated on an existing draft. All fields are optional —
 * only the ones provided will be patched. `inReplyTo` / `replyAll` /
 * `forwardMessageId` are excluded because they are set at creation time and
 * cannot be changed on an existing draft.
 */
export interface DraftUpdateInput {
  to?: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject?: string;
  body?: string;
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

export interface FolderInfo {
  id: string;
  displayName: string;
  parentFolderId?: string;
  childFolderCount: number;
  totalItemCount: number;
  unreadItemCount: number;
}

export interface ListFoldersOptions {
  /** When provided, lists child folders of this folder. When omitted, lists
   *  top-level folders (children of the root). */
  parentFolderId?: string;
}

export interface CreateFolderInput {
  displayName: string;
  /** When provided, creates the folder as a child of this parent. When
   *  omitted, creates under the root folder. */
  parentFolderId?: string;
}

export interface EmailProvider {
  readonly id: ProviderId;

  addAccount(input: AddAccountInput): Promise<AddAccountResult>;
  /** Optional — only providers with async flows (device code) need this. */
  completeAddAccount?(handle: string): Promise<CompleteAddAccountResult>;

  listEmails(account: AccountRecord, opts: ListEmailsOptions): Promise<ListEmailsResult>;
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
  /**
   * Create a draft message from the given input without sending it.
   * Returns the draft message ID so the caller can later find it in the
   * Drafts folder, open it for further editing, or send it manually.
   */
  saveDraft(account: AccountRecord, msg: SendInput): Promise<{ id: string }>;
  /**
   * Update an existing draft message by ID. Only the fields present in
   * `update` are patched — the rest are left unchanged.
   * Returns the draft message ID.
   */
  updateDraft(
    account: AccountRecord,
    id: string,
    update: DraftUpdateInput,
  ): Promise<{ id: string }>;
  /**
   * Move a message to another folder.
   * `destinationId` can be a well-known folder name (e.g. "archive",
   * "deleteditems", "inbox") or a custom folder ID.
   */
  moveEmail(account: AccountRecord, id: string, destinationId: string): Promise<void>;
  /**
   * Send an existing draft message by ID.
   * Returns the message ID.
   */
  sendDraft(account: AccountRecord, id: string): Promise<{ id: string }>;
  /**
   * Add a file attachment to an existing draft message.
   * `contentBytes` must be base64-encoded file content.
   * Returns the draft ID and the created attachment metadata.
   */
  addAttachmentToDraft(
    account: AccountRecord,
    draftId: string,
    name: string,
    contentBytes: string,
    contentType?: string,
  ): Promise<{ id: string; attachment: { id: string; name: string; contentType?: string } }>;

  /** Mark a message as read (isRead=true) or unread (isRead=false). */
  markRead(account: AccountRecord, id: string, isRead: boolean): Promise<void>;

  /** List mail folders. When parentFolderId is omitted, lists top-level
   *  folders (children of the root). */
  listFolders(account: AccountRecord, opts: ListFoldersOptions): Promise<FolderInfo[]>;

  /** Create a new mail folder. When parentFolderId is omitted, creates
   *  under the root folder. Returns the created folder. */
  createFolder(account: AccountRecord, input: CreateFolderInput): Promise<FolderInfo>;

  /** Rename an existing mail folder. Returns the updated folder. */
  renameFolder(account: AccountRecord, folderId: string, newName: string): Promise<FolderInfo>;

  /** Delete a mail folder by ID. */
  deleteFolder(account: AccountRecord, folderId: string): Promise<void>;
}
