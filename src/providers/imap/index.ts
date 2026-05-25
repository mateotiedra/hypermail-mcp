import type { AccountRecord, AccountStore } from "../../store/account-store.js";
import type {
  AddAccountInput,
  AddAccountResult,
  AttachmentContent,
  CompleteAddAccountResult,
  CreateFolderInput,
  DraftUpdateInput,
  EmailFull,
  EmailProvider,
  EmailSummary,
  FolderInfo,
  ListEmailsOptions,
  ListEmailsResult,
  ListFoldersOptions,
  SearchEmailsOptions,
  SendInput,
} from "../types.js";
import { ImapClientFactory } from "./client.js";
import {
  listEmails,
  searchEmails,
  readEmail,
  readAttachment,
  listFolders,
} from "./read-ops.js";
import {
  addAccount,
  completeAddAccount,
  sendEmail,
  saveDraft,
  updateDraft,
  moveEmail,
  sendDraft,
  addAttachmentToDraft,
  markRead,
  createFolder,
  renameFolder,
  deleteFolder,
} from "./write-ops.js";

export class ImapProvider implements EmailProvider {
  readonly id = "imap" as const;
  private readonly clients = new ImapClientFactory();

  constructor(private readonly store?: AccountStore) {}

  // ---------- account lifecycle ----------

  async addAccount(input: AddAccountInput): Promise<AddAccountResult> {
    if (!this.store) throw new Error("IMAP provider requires an AccountStore");
    return addAccount(this.clients, this.store, input);
  }

  async completeAddAccount(_handle: string): Promise<CompleteAddAccountResult> {
    return completeAddAccount();
  }

  // ---------- browse ----------

  async listEmails(account: AccountRecord, opts: ListEmailsOptions): Promise<ListEmailsResult> {
    return listEmails(this.clients, account, opts);
  }

  async searchEmails(account: AccountRecord, query: string, opts: SearchEmailsOptions): Promise<EmailSummary[]> {
    return searchEmails(this.clients, account, query, opts);
  }

  async readEmail(account: AccountRecord, id: string): Promise<EmailFull> {
    return readEmail(this.clients, account, id);
  }

  async readAttachment(account: AccountRecord, messageId: string, attachmentId: string): Promise<AttachmentContent> {
    return readAttachment(this.clients, account, messageId, attachmentId);
  }

  // ---------- compose ----------

  async sendEmail(account: AccountRecord, msg: SendInput): Promise<{ id: string }> {
    return sendEmail(this.clients, account, msg);
  }

  async saveDraft(account: AccountRecord, msg: SendInput): Promise<{ id: string }> {
    return saveDraft(this.clients, account, msg);
  }

  async updateDraft(account: AccountRecord, id: string, update: DraftUpdateInput): Promise<{ id: string }> {
    return updateDraft(this.clients, account, id, update);
  }

  async moveEmail(account: AccountRecord, id: string, destinationId: string): Promise<void> {
    return moveEmail(this.clients, account, id, destinationId);
  }

  async sendDraft(account: AccountRecord, id: string): Promise<{ id: string }> {
    return sendDraft(this.clients, account, id);
  }

  async addAttachmentToDraft(
    account: AccountRecord,
    draftId: string,
    name: string,
    contentBytes: string,
    contentType?: string,
  ): Promise<{ id: string; attachment: { id: string; name: string; contentType?: string } }> {
    return addAttachmentToDraft(this.clients, account, draftId, name, contentBytes, contentType);
  }

  // ---------- organize ----------

  async markRead(account: AccountRecord, id: string, isRead: boolean): Promise<void> {
    return markRead(this.clients, account, id, isRead);
  }

  // ---------- folders ----------

  async listFolders(account: AccountRecord, opts: ListFoldersOptions): Promise<FolderInfo[]> {
    return listFolders(this.clients, account, opts);
  }

  async createFolder(account: AccountRecord, input: CreateFolderInput): Promise<FolderInfo> {
    return createFolder(this.clients, account, input);
  }

  async renameFolder(account: AccountRecord, folderId: string, newName: string): Promise<FolderInfo> {
    return renameFolder(this.clients, account, folderId, newName);
  }

  async deleteFolder(account: AccountRecord, folderId: string): Promise<void> {
    return deleteFolder(this.clients, account, folderId);
  }
}
