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

export const OUTLOOK_IMMUTABLE_ID_PREFER = 'IdType="ImmutableId"';

const MESSAGE_SELECT = [
  "id",
  "subject",
  "from",
  "toRecipients",
  "receivedDateTime",
  "bodyPreview",
  "isRead",
  "hasAttachments",
].join(",");

const FULL_MESSAGE_SELECT = [
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
].join(",");

function graphErrorFields(err: unknown): Array<string | number> {
  if (typeof err !== "object" || err === null) {
    return [String(err)];
  }

  const record = err as Record<string, unknown>;
  const fields: Array<string | number> = [];
  for (const key of ["code", "statusCode", "message"]) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") fields.push(value);
  }

  if (typeof record.body === "string") {
    try {
      const parsed = JSON.parse(record.body) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        const graphError = (parsed as Record<string, unknown>).error;
        if (typeof graphError === "object" && graphError !== null) {
          const graphRecord = graphError as Record<string, unknown>;
          for (const key of ["code", "message"]) {
            const value = graphRecord[key];
            if (typeof value === "string" || typeof value === "number") {
              fields.push(value);
            }
          }
        }
      }
    } catch {
      fields.push(record.body);
    }
  }

  return fields;
}

export function isStaleMessageIdError(err: unknown): boolean {
  const fields = graphErrorFields(err);
  if (fields.some((value) => value === 404)) return true;

  return fields.some((value) => {
    if (typeof value !== "string") return false;
    const normalized = value.toLowerCase();
    return (
      normalized.includes("erroritemnotfound") ||
      normalized.includes("invalidid") ||
      normalized.includes("object was not found in the store") ||
      normalized.includes("not found in the store")
    );
  });
}

async function probeMessage(
  client: Client,
  id: string,
  useImmutableIds: boolean,
): Promise<void> {
  let req = client
    .api(`/me/messages/${encodeURIComponent(id)}`)
    .select("id");
  if (useImmutableIds) req = req.header("Prefer", OUTLOOK_IMMUTABLE_ID_PREFER);
  await req.get();
}

async function probeSearchResult(client: Client, id: string): Promise<boolean> {
  try {
    await probeMessage(client, id, true);
    return true;
  } catch (err) {
    if (!isStaleMessageIdError(err)) throw err;
  }

  // Backward compatibility for any result ID Graph still returns as a legacy mutable ID.
  try {
    await probeMessage(client, id, false);
    return true;
  } catch (err) {
    if (isStaleMessageIdError(err)) return false;
    throw err;
  }
}

async function getMessage(
  client: Client,
  id: string,
): Promise<{ message: GraphMessage; useImmutableIds: boolean }> {
  try {
    const message = (await client
      .api(`/me/messages/${encodeURIComponent(id)}`)
      .header("Prefer", OUTLOOK_IMMUTABLE_ID_PREFER)
      .select(FULL_MESSAGE_SELECT)
      .get()) as GraphMessage;
    return { message, useImmutableIds: true };
  } catch (err) {
    if (!isStaleMessageIdError(err)) throw err;
  }

  const message = (await client
    .api(`/me/messages/${encodeURIComponent(id)}`)
    .select(FULL_MESSAGE_SELECT)
    .get()) as GraphMessage;
  return { message, useImmutableIds: false };
}

async function listAttachments(
  client: Client,
  messageId: string,
  useImmutableIds: boolean,
): Promise<GraphAttachment[]> {
  let req = client
    .api(`/me/messages/${encodeURIComponent(messageId)}/attachments`)
    .select("id,name,contentType,size");
  if (useImmutableIds) req = req.header("Prefer", OUTLOOK_IMMUTABLE_ID_PREFER);

  const attRes = (await req.get()) as { value: GraphAttachment[] };
  return attRes.value;
}

async function getAttachmentMetadata(
  client: Client,
  messageId: string,
  attachmentId: string,
  useImmutableIds: boolean,
): Promise<{ name: string; contentType?: string }> {
  let req = client
    .api(`/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`)
    .select("name,contentType");
  if (useImmutableIds) req = req.header("Prefer", OUTLOOK_IMMUTABLE_ID_PREFER);

  return (await req.get()) as { name: string; contentType?: string };
}

async function getAttachmentValue(
  client: Client,
  messageId: string,
  attachmentId: string,
  useImmutableIds: boolean,
): Promise<ArrayBuffer> {
  let req = client
    .api(`/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`)
    .responseType(ResponseType.ARRAYBUFFER);
  if (useImmutableIds) req = req.header("Prefer", OUTLOOK_IMMUTABLE_ID_PREFER);

  return (await req.get()) as ArrayBuffer;
}

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
    .header("Prefer", OUTLOOK_IMMUTABLE_ID_PREFER)
    .top(limit)
    .skip(opts.skip ?? 0)
    .select(MESSAGE_SELECT)
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
    .header("Prefer", OUTLOOK_IMMUTABLE_ID_PREFER)
    .top(limit)
    .search(`"${query.replace(/"/g, '\\"')}"`)
    .select(MESSAGE_SELECT)
    .get()) as { value: GraphMessage[] };

  const summaries = res.value.map((m) => mapSummary(m));
  return Promise.all(
    summaries.map(async (summary) => {
      const readable = await probeSearchResult(client, summary.id);
      return readable ? summary : { ...summary, stale: true };
    }),
  );
}

export async function readEmail(
  client: Client,
  account: AccountRecord,
  id: string,
): Promise<EmailFull> {
  const { message: m, useImmutableIds } = await getMessage(client, id);

  let attachments: EmailFull["attachments"] = undefined;
  if (m.hasAttachments) {
    try {
      const attRes = await listAttachments(client, m.id, useImmutableIds);
      attachments = attRes.map((a) => ({
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
  let useImmutableIds = true;
  let att: { name: string; contentType?: string };

  try {
    att = await getAttachmentMetadata(client, messageId, attachmentId, true);
  } catch (err) {
    if (!isStaleMessageIdError(err)) throw err;
    useImmutableIds = false;
    att = await getAttachmentMetadata(client, messageId, attachmentId, false);
  }

  let data: ArrayBuffer;
  try {
    data = await getAttachmentValue(client, messageId, attachmentId, useImmutableIds);
  } catch (err) {
    if (!useImmutableIds || !isStaleMessageIdError(err)) throw err;
    data = await getAttachmentValue(client, messageId, attachmentId, false);
  }

  // Write to temp file with original name
  const outPath = pathJoin(tmpdir(), att.name);
  writeFileSync(outPath, Buffer.from(data));

  return {
    name: att.name,
    contentType: att.contentType,
    path: outPath,
  };
}
