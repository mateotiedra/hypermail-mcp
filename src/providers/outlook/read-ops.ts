import { ResponseType } from "@microsoft/microsoft-graph-client";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import type { Client } from "@microsoft/microsoft-graph-client";

import type { AccountRecord } from "../../store/account-store.js";
import type {
  AttachmentContent,
  EmailFull,
  EmailSummary,
  ListEmailsOptions,
  ListEmailsResult,
  SearchEmailsOptions,
} from "../types.js";
import {
  clampLimit,
  type GraphAttachment,
  type GraphMessage,
  mapRecipient,
  mapSummary,
} from "./helpers.js";

export async function listEmails(
  client: Client,
  account: AccountRecord,
  opts: ListEmailsOptions,
): Promise<ListEmailsResult> {
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

export async function searchEmails(
  client: Client,
  account: AccountRecord,
  query: string,
  opts: SearchEmailsOptions,
): Promise<EmailSummary[]> {
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

export async function readEmail(
  client: Client,
  account: AccountRecord,
  id: string,
): Promise<EmailFull> {
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

export async function readAttachment(
  client: Client,
  account: AccountRecord,
  messageId: string,
  attachmentId: string,
): Promise<AttachmentContent> {
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
