import { randomUUID } from "node:crypto";

import type { AccountRecord } from "../../store/account-store.js";
import type { IAccountStore } from "../../mode/types.js";
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
import {
  awaitDeviceCodeReady,
  beginDeviceCode,
  type SerializedGmailTokens,
} from "./auth.js";
import { GmailClientFactory } from "./client.js";
import {
  listEmails,
  searchEmails,
  readEmail,
  readAttachment,
  listFolders,
} from "./read-ops.js";
import {
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

// ── pending flow (mirrors Outlook's PendingFlow pattern) ──

interface PendingFlow {
  begin: ReturnType<typeof beginDeviceCode>;
  emailHint?: string;
  startedAt: number;
  settled: "pending" | "ready" | "error" | "expired";
  account?: AccountRecord;
  error?: string;
}

// ── provider ──

export interface GmailProviderOptions {
  store: IAccountStore;
  clientId?: string;
  clientSecret?: string;
}

export class GmailProvider implements EmailProvider {
  readonly id = "gmail" as const;
  private readonly clients: GmailClientFactory;
  private readonly pending = new Map<string, PendingFlow>();
  private readonly clientId?: string;
  private readonly clientSecret?: string;

  constructor(private readonly opts: GmailProviderOptions) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.clients = new GmailClientFactory(
      opts.store,
      opts.clientId,
      opts.clientSecret,
    );
  }

  // ── account lifecycle ──

  async addAccount(input: AddAccountInput): Promise<AddAccountResult> {
    const begin = beginDeviceCode(
      undefined,
      this.clientId,
      this.clientSecret,
    );
    await awaitDeviceCodeReady(begin);

    const handle = randomUUID();
    const flow: PendingFlow = {
      begin,
      emailHint: input.email,
      startedAt: Date.now(),
      settled: "pending",
    };
    this.pending.set(handle, flow);

    begin.result
      .then(async ({ tokens, email }) => {
        const resolvedEmail = (email || input.email || "").toLowerCase();
        if (!resolvedEmail) {
          flow.settled = "error";
          flow.error = "no email returned from Google account";
          return;
        }
        const rec: AccountRecord = {
          email: resolvedEmail,
          provider: "gmail",
          displayName: resolvedEmail,
          tokens: tokens as unknown as Record<string, unknown>,
          addedAt: new Date().toISOString(),
        };
        const saved = await this.opts.store.upsertAccount(rec);
        flow.account = saved;
        flow.settled = "ready";
      })
      .catch((err: unknown) => {
        flow.settled = "error";
        flow.error = err instanceof Error ? err.message : String(err);
      });

    return {
      status: "pending",
      handle,
      verification: {
        userCode: begin.userCode,
        verificationUri: begin.verificationUri,
        expiresAt: begin.expiresAt,
        message: begin.message,
      },
    };
  }

  async completeAddAccount(
    handle: string,
  ): Promise<CompleteAddAccountResult> {
    const flow = this.pending.get(handle);
    if (!flow) return { status: "error", error: "unknown handle" };
    if (
      Date.now() - flow.startedAt > 20 * 60_000 &&
      flow.settled === "pending"
    ) {
      flow.settled = "expired";
      flow.begin.cancel();
    }
    if (flow.settled === "ready" && flow.account) {
      this.pending.delete(handle);
      return { status: "ready", account: flow.account };
    }
    if (flow.settled === "error") {
      this.pending.delete(handle);
      return { status: "error", error: flow.error ?? "unknown error" };
    }
    if (flow.settled === "expired") {
      this.pending.delete(handle);
      return { status: "expired" };
    }
    return { status: "pending" };
  }

  // ── browse ──

  async listEmails(
    account: AccountRecord,
    opts: ListEmailsOptions,
  ): Promise<ListEmailsResult> {
    return listEmails(this.clients, account, opts);
  }

  async searchEmails(
    account: AccountRecord,
    query: string,
    opts: SearchEmailsOptions,
  ): Promise<EmailSummary[]> {
    return searchEmails(this.clients, account, query, opts);
  }

  async readEmail(account: AccountRecord, id: string): Promise<EmailFull> {
    return readEmail(this.clients, account, id);
  }

  async readAttachment(
    account: AccountRecord,
    messageId: string,
    attachmentId: string,
  ): Promise<AttachmentContent> {
    return readAttachment(this.clients, account, messageId, attachmentId);
  }

  // ── compose ──

  async sendEmail(
    account: AccountRecord,
    msg: SendInput,
  ): Promise<{ id: string }> {
    return sendEmail(this.clients, account, msg);
  }

  async saveDraft(
    account: AccountRecord,
    msg: SendInput,
  ): Promise<{ id: string }> {
    return saveDraft(this.clients, account, msg);
  }

  async updateDraft(
    account: AccountRecord,
    id: string,
    update: DraftUpdateInput,
  ): Promise<{ id: string }> {
    return updateDraft(this.clients, account, id, update);
  }

  async moveEmail(
    account: AccountRecord,
    id: string,
    destinationId: string,
  ): Promise<void> {
    return moveEmail(this.clients, account, id, destinationId);
  }

  async sendDraft(
    account: AccountRecord,
    id: string,
  ): Promise<{ id: string }> {
    return sendDraft(this.clients, account, id);
  }

  async addAttachmentToDraft(
    account: AccountRecord,
    draftId: string,
    name: string,
    contentBytes: string,
    contentType?: string,
  ): Promise<{
    id: string;
    attachment: { id: string; name: string; contentType?: string };
  }> {
    return addAttachmentToDraft(
      this.clients,
      account,
      draftId,
      name,
      contentBytes,
      contentType,
    );
  }

  // ── organize ──

  async markRead(
    account: AccountRecord,
    id: string,
    isRead: boolean,
  ): Promise<void> {
    return markRead(this.clients, account, id, isRead);
  }

  // ── folders ──

  async listFolders(
    account: AccountRecord,
    opts: ListFoldersOptions,
  ): Promise<FolderInfo[]> {
    return listFolders(this.clients, account, opts);
  }

  async createFolder(
    account: AccountRecord,
    input: CreateFolderInput,
  ): Promise<FolderInfo> {
    return createFolder(this.clients, account, input);
  }

  async renameFolder(
    account: AccountRecord,
    folderId: string,
    newName: string,
  ): Promise<FolderInfo> {
    return renameFolder(this.clients, account, folderId, newName);
  }

  async deleteFolder(
    account: AccountRecord,
    folderId: string,
  ): Promise<void> {
    return deleteFolder(this.clients, account, folderId);
  }
}
