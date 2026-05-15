import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";

import { ResponseType } from "@microsoft/microsoft-graph-client";

import type { AccountRecord, AccountStore } from "../../store/account-store.js";
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
  EmailAddress,
} from "../types.js";
import { OutlookClientFactory } from "./client.js";
import {
  awaitDeviceCodeReady,
  beginDeviceCode,
  type DeviceCodeBegin,
  type SerializedTokens,
} from "./auth.js";

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
}

export class OutlookProvider implements EmailProvider {
  readonly id = "outlook" as const;
  private readonly clients: OutlookClientFactory;
  private readonly pending = new Map<string, PendingFlow>();

  constructor(private readonly opts: OutlookProviderOptions) {
    this.clients = new OutlookClientFactory(opts.store);
  }

  // ---------- account lifecycle ----------

  async addAccount(input: AddAccountInput): Promise<AddAccountResult> {
    const begin = beginDeviceCode();
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
  ): Promise<EmailSummary[]> {
    const client = this.clients.get(account);
    const limit = clampLimit(opts.limit, 25, 100);
    const folder = opts.folder ?? "inbox";
    const filterParts: string[] = [];
    if (opts.unreadOnly) filterParts.push("isRead eq false");

    let req = client
      .api(`/me/mailFolders/${encodeURIComponent(folder)}/messages`)
      .top(limit)
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

    const res = (await req.get()) as { value: GraphMessage[] };
    return res.value.map((m) => mapSummary(m, folder));
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

  async sendEmail(
    account: AccountRecord,
    msg: SendInput,
  ): Promise<{ id: string }> {
    const client = this.clients.get(account);
    const payload = {
      message: {
        subject: msg.subject,
        body: {
          contentType: msg.isHtml ? "HTML" : "Text",
          content: msg.body,
        },
        toRecipients: msg.to.map(toRecipient),
        ccRecipients: (msg.cc ?? []).map(toRecipient),
        bccRecipients: (msg.bcc ?? []).map(toRecipient),
      },
      saveToSentItems: true,
    };
    await client.api("/me/sendMail").post(payload);
    // Graph's sendMail returns 202 with no body; we don't have an id back.
    return { id: "" };
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
