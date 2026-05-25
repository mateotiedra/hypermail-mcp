import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";

import { ResponseType, type Client } from "@microsoft/microsoft-graph-client";

import { parseInlineImages } from "../shared/inline-images.js";

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
  EmailAddress,
} from "../types.js";
import { OutlookClientFactory } from "./client.js";
import {
  awaitDeviceCodeReady,
  beginDeviceCode,
  type DeviceCodeBegin,
  type SerializedTokens,
} from "./auth.js";

// ---------- inline image conversion ----------

interface InlineAttachment {
  "@odata.type": string;
  name: string;
  contentType: string;
  contentId: string;
  contentBytes: string;
  isInline: boolean;
}

/**
 * Scans HTML for data:image/...;base64,... URIs, extracts the raw base64
 * data, assigns unique contentIds, and returns the transformed body
 * (with src="cid:..." references) plus an array of inline fileAttachment
 * objects ready for the Graph API.
 *
 * Delegates the HTML parsing to the shared {@link parseInlineImages} and
 * then wraps each image in an Outlook-specific `@odata.type` attachment.
 *
 * Pass-through when there are no matches — returns the original body with
 * an empty attachments array.
 */
export function convertInlineImages(body: string): {
  body: string;
  attachments: InlineAttachment[];
} {
  const { body: transformed, images } = parseInlineImages(body);
  const attachments: InlineAttachment[] = images.map((img) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: img.filename,
    contentType: img.contentType,
    contentId: img.cid,
    contentBytes: img.contentBytes,
    isInline: true,
  }));
  return { body: transformed, attachments };
}

interface PendingFlow {
  begin: DeviceCodeBegin;
  emailHint?: string;
  startedAt: number;
  settled: "pending" | "ready" | "error" | "expired";
  account?: AccountRecord;
  error?: string;
}

export interface OutlookProviderOptions {
  store: AccountStore;
  clientId?: string;
  tenantId?: string;
}

export class OutlookProvider implements EmailProvider {
  readonly id = "outlook" as const;
  private readonly clients: OutlookClientFactory;
  private readonly pending = new Map<string, PendingFlow>();
  private readonly clientId?: string;
  private readonly tenantId?: string;

  constructor(private readonly opts: OutlookProviderOptions) {
    this.clientId = opts.clientId;
    this.tenantId = opts.tenantId;
    this.clients = new OutlookClientFactory(opts.store, opts.clientId, opts.tenantId);
  }

  // ---------- account lifecycle ----------

  async addAccount(input: AddAccountInput): Promise<AddAccountResult> {
    const begin = beginDeviceCode(undefined, this.clientId, this.tenantId);
    await awaitDeviceCodeReady(begin);

    const handle = randomUUID();
    const flow: PendingFlow = {
      begin,
      emailHint: input.email,
      startedAt: Date.now(),
      settled: "pending",
    };
    this.pending.set(handle, flow);

    // Fire-and-forget: when the user finishes, persist and update flow.
    begin.result
      .then(async ({ tokens, account }) => {
        const email = (account.username || input.email || "").toLowerCase();
        if (!email) {
          flow.settled = "error";
          flow.error = "no email returned from Microsoft account";
          return;
        }
        const rec: AccountRecord = {
          email,
          provider: "outlook",
          displayName: account.name ?? undefined,
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

  async completeAddAccount(handle: string): Promise<CompleteAddAccountResult> {
    const flow = this.pending.get(handle);
    if (!flow) return { status: "error", error: "unknown handle" };
    // expire after 20 minutes regardless
    if (Date.now() - flow.startedAt > 20 * 60_000 && flow.settled === "pending") {
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

  // ---------- email ops ----------

  async listEmails(
    account: AccountRecord,
    opts: ListEmailsOptions,
  ): Promise<ListEmailsResult> {
    const client = this.clients.get(account);
    const limit = clampLimit(opts.limit, 25, 100);
    const folder = opts.folder ?? "inbox";
    const filterParts: string[] = [];
    if (opts.unreadOnly) filterParts.push("isRead eq false");

    let req = client
      .api(`/me/mailFolders/${encodeURIComponent(folder)}/messages`)
      .top(limit)
      .skip(opts.skip ?? 0)
      .select([
        "id",
        "subject",
        "from",
        "toRecipients",
        "receivedDateTime",
        "bodyPreview",
        "isRead",
        "hasAttachments",
      ].join(","))
      .orderby("receivedDateTime DESC");

    if (filterParts.length > 0) req = req.filter(filterParts.join(" and "));

    const res = (await req.get()) as { value: GraphMessage[]; "@odata.nextLink"?: string };
    return {
      items: res.value.map((m) => mapSummary(m, folder)),
      hasMore: !!res["@odata.nextLink"],
    };
  }

  async searchEmails(
    account: AccountRecord,
    query: string,
    opts: SearchEmailsOptions,
  ): Promise<EmailSummary[]> {
    const client = this.clients.get(account);
    const limit = clampLimit(opts.limit, 25, 100);
    // $search requires the ConsistencyLevel: eventual header
    const res = (await client
      .api("/me/messages")
      .header("ConsistencyLevel", "eventual")
      .top(limit)
      .search(`"${query.replace(/"/g, '\\"')}"`)
      .select(
        [
          "id",
          "subject",
          "from",
          "toRecipients",
          "receivedDateTime",
          "bodyPreview",
          "isRead",
          "hasAttachments",
        ].join(","),
      )
      .get()) as { value: GraphMessage[] };
    return res.value.map((m) => mapSummary(m));
  }

  async readEmail(account: AccountRecord, id: string): Promise<EmailFull> {
    const client = this.clients.get(account);
    const m = (await client
      .api(`/me/messages/${encodeURIComponent(id)}`)
      .select(
        [
          "id",
          "subject",
          "from",
          "toRecipients",
          "ccRecipients",
          "bccRecipients",
          "receivedDateTime",
          "bodyPreview",
          "isRead",
          "hasAttachments",
          "body",
        ].join(","),
      )
      .get()) as GraphMessage;

    let attachments: EmailFull["attachments"] = undefined;
    if (m.hasAttachments) {
      try {
        const attRes = (await client
          .api(`/me/messages/${encodeURIComponent(id)}/attachments`)
          .select("id,name,contentType,size")
          .get()) as { value: GraphAttachment[] };
        attachments = attRes.value.map((a) => ({
          id: a.id,
          name: a.name,
          contentType: a.contentType,
          size: a.size,
        }));
      } catch {
        /* ignore attachment listing failure */
      }
    }

    const summary = mapSummary(m);
    const body = m.body;
    return {
      ...summary,
      cc: (m.ccRecipients ?? []).map(mapRecipient),
      bcc: (m.bccRecipients ?? []).map(mapRecipient),
      bodyText: body?.contentType === "text" ? body.content : undefined,
      bodyHtml: body?.contentType === "html" ? body.content : undefined,
      attachments,
    };
  }

  async readAttachment(
    account: AccountRecord,
    messageId: string,
    attachmentId: string,
  ): Promise<AttachmentContent> {
    const client = this.clients.get(account);
    // First, get the attachment metadata to know the filename
    const att = (await client
      .api(`/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`)
      .select("name,contentType")
      .get()) as { name: string; contentType?: string };

    // Download the raw content as ArrayBuffer
    const data = (await client
      .api(`/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`)
      .responseType(ResponseType.ARRAYBUFFER)
      .get()) as ArrayBuffer;

    // Write to temp file with original name
    const outPath = pathJoin(tmpdir(), att.name);
    writeFileSync(outPath, Buffer.from(data));

    return {
      name: att.name,
      contentType: att.contentType,
      path: outPath,
    };
  }

  // Shared helper — creates a draft from a reference message (forward or
  // reply), prepends our composed body before the existing content, and
  // attaches inline images. Returns the draft message ID.
  private async buildDraftFromReference(
    client: Client,
    createEndpoint: string,
    createPayload: Record<string, unknown>,
    converted: { body: string; attachments: InlineAttachment[] },
  ): Promise<string> {
    const draft: { id: string } = await client
      .api(createEndpoint)
      .post(createPayload);

    const draftMsg: { body?: { content?: string; contentType?: string } } =
      await client.api(`/me/messages/${draft.id}`).select("body").get();

    const draftBody = draftMsg.body?.content ?? "";
    const draftContentType = draftMsg.body?.contentType ?? "HTML";
    const spacer = '<div style="line-height:12px"><br></div>';
    const prepend = converted.body + spacer;
    const finalBody = draftBody.includes("<body")
      ? draftBody.replace(/(<body[^>]*>)/i, `$1${prepend}`)
      : prepend + draftBody;

    await client.api(`/me/messages/${draft.id}`).patch({
      body: { contentType: draftContentType, content: finalBody },
    });

    for (const att of converted.attachments) {
      await client.api(`/me/messages/${draft.id}/attachments`).post(att);
    }

    return draft.id;
  }

  // Shared backend for sendEmail and saveDraft — handles forward, reply, and
  // new-message paths. The `mode` controls whether the message is sent
  // immediately or saved as a draft.
  private async sendOrSave(
    account: AccountRecord,
    msg: SendInput,
    mode: "send" | "draft",
  ): Promise<{ id: string }> {
    const client = this.clients.get(account);
    const converted = convertInlineImages(msg.body);

    const toRecipients = msg.to.map(toRecipient);
    const ccRecipients = (msg.cc ?? []).map(toRecipient);
    const bccRecipients = (msg.bcc ?? []).map(toRecipient);

    // Forward — build a forward draft, then send if mode is "send".
    if (msg.forwardMessageId) {
      const draftId = await this.buildDraftFromReference(
        client,
        `/me/messages/${encodeURIComponent(msg.forwardMessageId)}/createForward`,
        { message: { toRecipients, ccRecipients, bccRecipients }, comment: "" },
        converted,
      );
      if (mode === "send") {
        await client.api(`/me/messages/${draftId}/send`).post({});
      }
      return { id: draftId };
    }

    // Reply — build a reply draft, then send if mode is "send".
    if (msg.inReplyTo) {
      const createEndpoint = msg.replyAll
        ? `/me/messages/${encodeURIComponent(msg.inReplyTo)}/createReplyAll`
        : `/me/messages/${encodeURIComponent(msg.inReplyTo)}/createReply`;
      const draftId = await this.buildDraftFromReference(
        client, createEndpoint, {}, converted,
      );
      if (mode === "send") {
        await client.api(`/me/messages/${draftId}/send`).post({});
      }
      return { id: draftId };
    }

    // New email — sendMail (mode=send) or POST /me/messages (mode=draft).
    const messagePayload: Record<string, unknown> = {
      subject: msg.subject,
      body: {
        contentType: msg.isHtml ? "HTML" : "Text",
        content: converted.body,
      },
      toRecipients,
      ccRecipients,
      bccRecipients,
    };
    if (converted.attachments.length > 0) {
      messagePayload.attachments = converted.attachments;
    }

    if (mode === "send") {
      await client.api("/me/sendMail").post({
        message: messagePayload,
        saveToSentItems: true,
      });
      // Graph's sendMail returns 202 with no body; we don't have an id back.
      return { id: "" };
    }

    const draft: { id: string } = await client
      .api("/me/messages")
      .post(messagePayload);
    return { id: draft.id };
  }

  async sendEmail(
    account: AccountRecord,
    msg: SendInput,
  ): Promise<{ id: string }> {
    return this.sendOrSave(account, msg, "send");
  }

  async saveDraft(
    account: AccountRecord,
    msg: SendInput,
  ): Promise<{ id: string }> {
    return this.sendOrSave(account, msg, "draft");
  }

  async updateDraft(
    account: AccountRecord,
    id: string,
    update: DraftUpdateInput,
  ): Promise<{ id: string }> {
    const client = this.clients.get(account);
    const payload: Record<string, unknown> = {};

    if (update.subject !== undefined) {
      payload.subject = update.subject;
    }
    if (update.to !== undefined) {
      payload.toRecipients = update.to.map(toRecipient);
    }
    if (update.cc !== undefined) {
      payload.ccRecipients = update.cc.map(toRecipient);
    }
    if (update.bcc !== undefined) {
      payload.bccRecipients = update.bcc.map(toRecipient);
    }
    if (update.body !== undefined) {
      const converted = convertInlineImages(update.body);
      payload.body = {
        contentType: update.isHtml ? "HTML" : "Text",
        content: converted.body,
      };
      if (converted.attachments.length > 0) {
        // Patch existing inline attachments: Graph will replace all
        // attachments on the message. We send only the new ones.
        payload.attachments = converted.attachments;
      }
    }

    await client
      .api(`/me/messages/${encodeURIComponent(id)}`)
      .patch(payload);

    return { id };
  }

  async moveEmail(
    account: AccountRecord,
    id: string,
    destinationId: string,
  ): Promise<void> {
    const client = this.clients.get(account);
    await client
      .api(`/me/messages/${encodeURIComponent(id)}/move`)
      .post({ destinationId });
  }

  async sendDraft(
    account: AccountRecord,
    id: string,
  ): Promise<{ id: string }> {
    const client = this.clients.get(account);
    await client.api(`/me/messages/${encodeURIComponent(id)}/send`).post({});
    return { id };
  }

  async addAttachmentToDraft(
    account: AccountRecord,
    draftId: string,
    name: string,
    contentBytes: string,
    contentType?: string,
  ): Promise<{ id: string; attachment: { id: string; name: string; contentType?: string } }> {
    const client = this.clients.get(account);
    const att = (await client
      .api(`/me/messages/${encodeURIComponent(draftId)}/attachments`)
      .post({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name,
        contentType: contentType ?? "application/octet-stream",
        contentBytes,
      })) as { id: string; name: string; contentType?: string };
    return {
      id: draftId,
      attachment: { id: att.id, name: att.name, contentType: att.contentType },
    };
  }

  async markRead(
    account: AccountRecord,
    id: string,
    isRead: boolean,
  ): Promise<void> {
    const client = this.clients.get(account);
    await client
      .api(`/me/messages/${encodeURIComponent(id)}`)
      .patch({ isRead });
  }

  async listFolders(
    account: AccountRecord,
    opts: ListFoldersOptions,
  ): Promise<FolderInfo[]> {
    const client = this.clients.get(account);
    const endpoint = opts.parentFolderId
      ? `/me/mailFolders/${encodeURIComponent(opts.parentFolderId)}/childFolders`
      : "/me/mailFolders";
    const res = (await client
      .api(endpoint)
      .select([
        "id",
        "displayName",
        "parentFolderId",
        "childFolderCount",
        "totalItemCount",
        "unreadItemCount",
      ].join(","))
      .get()) as { value: GraphFolder[] };
    return (res.value ?? []).map(mapFolder);
  }

  async createFolder(
    account: AccountRecord,
    input: CreateFolderInput,
  ): Promise<FolderInfo> {
    const client = this.clients.get(account);
    const parentId = input.parentFolderId ?? "msgfolderroot";
    const created = (await client
      .api(`/me/mailFolders/${encodeURIComponent(parentId)}/childFolders`)
      .post({ displayName: input.displayName })) as GraphFolder;
    return mapFolder(created);
  }

  async renameFolder(
    account: AccountRecord,
    folderId: string,
    newName: string,
  ): Promise<FolderInfo> {
    const client = this.clients.get(account);
    const updated = (await client
      .api(`/me/mailFolders/${encodeURIComponent(folderId)}`)
      .patch({ displayName: newName })) as GraphFolder;
    return mapFolder(updated);
  }

  async deleteFolder(
    account: AccountRecord,
    folderId: string,
  ): Promise<void> {
    const client = this.clients.get(account);
    await client
      .api(`/me/mailFolders/${encodeURIComponent(folderId)}`)
      .delete();
  }
}

// ---------- mapping helpers ----------

interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}
interface GraphMessage {
  id: string;
  subject?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  bodyPreview?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  body?: { contentType?: "text" | "html"; content?: string };
}
interface GraphAttachment {
  id: string;
  name: string;
  contentType?: string;
  size?: number;
}
interface GraphFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
  childFolderCount: number;
  totalItemCount: number;
  unreadItemCount: number;
}

function mapFolder(f: GraphFolder): FolderInfo {
  return {
    id: f.id,
    displayName: f.displayName,
    parentFolderId: f.parentFolderId,
    childFolderCount: f.childFolderCount,
    totalItemCount: f.totalItemCount,
    unreadItemCount: f.unreadItemCount,
  };
}

function mapRecipient(r: GraphRecipient): EmailAddress {
  return {
    name: r.emailAddress?.name,
    address: r.emailAddress?.address ?? "",
  };
}

function mapSummary(m: GraphMessage, folder?: string): EmailSummary {
  return {
    id: m.id,
    subject: m.subject ?? "",
    from: m.from ? mapRecipient(m.from) : undefined,
    to: (m.toRecipients ?? []).map(mapRecipient),
    receivedAt: m.receivedDateTime,
    preview: m.bodyPreview,
    isRead: m.isRead,
    hasAttachments: m.hasAttachments,
    folder,
  };
}

function toRecipient(a: EmailAddress): GraphRecipient {
  return { emailAddress: { name: a.name, address: a.address } };
}

function clampLimit(v: number | undefined, dflt: number, max: number): number {
  if (!v || v <= 0) return dflt;
  return Math.min(v, max);
}
