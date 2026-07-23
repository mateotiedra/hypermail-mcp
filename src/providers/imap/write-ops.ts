import { randomUUID } from "node:crypto";

import type { AccountRecord } from "../../store/account-store.js";
import type { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer/index.js";

import type {
  DraftUpdateInput,
  EmailReference,
  SendInput,
} from "../types.js";
import { ImapClientFactory } from "./client.js";
import {
  addressText,
  buildMailOptions,
  buildRawMessage,
  formatAddresses,
  normalizeBodyLineEndings,
} from "./message-builder.js";
import {
  decodeId,
  encodeId,
  isTrashFolderAlias,
  webLinkUnavailableReference,
  resolveDraftMailbox,
  resolveFolder,
  resolveTrashMailbox,
} from "./helpers.js";
import type { BodyNode, ImapMailboxEntry } from "./helpers.js";
import {
  findAttachmentInMime,
  removeMimePart,
} from "./mime-utils.js";

/** Write operations for IMAP — send, draft, move, mark, folders. */

export async function sendEmail(
  clients: ImapClientFactory,
  account: AccountRecord,
  msg: SendInput,
): Promise<EmailReference> {
  const client = clients.get(account);
  const transporter = client.getTransporter();
  const mailOptions = await buildMailOptions(client, account, msg);
  const info = await transporter.sendMail(mailOptions);

  // Save a copy to Sent folder
  try {
    const rawMsg = await buildRawMessage(client, account, msg, info.messageId);
    await client.run(async (imap) => {
      await imap.append("Sent", rawMsg, ["\\Seen"]);
    });
  } catch {
    /* best-effort */
  }

  return webLinkUnavailableReference(info.messageId);
}

export async function saveDraft(
  clients: ImapClientFactory,
  account: AccountRecord,
  msg: SendInput,
): Promise<EmailReference> {
  const client = clients.get(account);
  const rawMsg = await buildRawMessage(client, account, msg, undefined, true);
  let folder = "Drafts";
  try {
    const result = await client.run(async (imap) => {
      folder = resolveDraftMailbox((await imap.list()) as Iterable<ImapMailboxEntry>);
      return appendDraft(imap, folder, rawMsg);
    });
    return webLinkUnavailableReference(encodeId(folder, appendUid(result, folder)));
  } catch (err) {
    throw imapOperationError(`failed to save IMAP draft to ${folder}`, err);
  }
}

export async function updateDraft(
  clients: ImapClientFactory,
  account: AccountRecord,
  id: string,
  update: DraftUpdateInput,
): Promise<EmailReference> {
  const client = clients.get(account);
  const { folder, uid } = decodeId(id);

  try {
    return await client.withMailbox(folder, async (imap) => {
      const existing = (await imap.fetchOne(
        uid,
        { source: true },
        { uid: true },
      )) as { source?: string | ArrayBuffer };
      if (!existing?.source) {
        throw new Error(`draft not found: ${id}`);
      }

      const source =
        typeof existing.source === "string"
          ? Buffer.from(existing.source, "utf-8")
          : Buffer.from(existing.source);
      const parsed: ParsedMail = await simpleParser(source);
      const existingHtml = parsed.html === false ? undefined : parsed.html;
      const text = normalizeBodyLineEndings(
        update.body !== undefined && !update.isHtml ? update.body : parsed.text,
      );
      const html = normalizeBodyLineEndings(
        update.body !== undefined && update.isHtml ? update.body : existingHtml,
      );
      const updatedMsg: Record<string, unknown> = {
        from: addressText(parsed.from) ?? `${account.displayName ?? ""} <${account.email}>`,
        to: update.to ? formatAddresses(update.to) : addressText(parsed.to),
        cc: update.cc ? formatAddresses(update.cc) : addressText(parsed.cc),
        bcc: update.bcc ? formatAddresses(update.bcc) : addressText(parsed.bcc),
        subject: update.subject ?? parsed.subject ?? "",
        text,
        html,
        inReplyTo: parsed.inReplyTo,
        references: parsed.references,
        attachments: parsed.attachments.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          contentType: attachment.contentType,
          contentDisposition: attachment.contentDisposition,
          cid: attachment.cid,
        })),
        attachDataUrls: true,
      };

      const raw = await new Promise<Buffer>((resolve, reject) => {
        const mc = new MailComposer(updatedMsg);
        const compiled = mc.compile();
        compiled.keepBcc = true;
        compiled.build((err: Error | null, buf: Buffer) => {
          if (err) reject(err);
          else resolve(buf);
        });
      });

      const result = await appendDraft(imap, folder, raw.toString("utf-8"));
      const appendedUid = appendUid(result, folder);
      const appended = (await imap.fetchOne(
        appendedUid,
        { source: true },
        { uid: true },
      )) as { source?: string | ArrayBuffer };
      if (!appended?.source) {
        throw new Error(`appended IMAP draft ${encodeId(folder, appendedUid)} is not readable`);
      }

      await imap.messageDelete(uid, { uid: true });
      return webLinkUnavailableReference(encodeId(folder, appendedUid));
    });
  } catch (err) {
    throw imapOperationError(`failed to update IMAP draft ${id}`, err);
  }
}

export async function moveEmail(
  clients: ImapClientFactory,
  account: AccountRecord,
  id: string,
  destinationId: string,
): Promise<EmailReference> {
  if (isTrashFolderAlias(destinationId)) {
    return trashEmail(clients, account, id);
  }

  const client = clients.get(account);
  const { folder, uid } = decodeId(id);
  const dest = resolveFolder(destinationId);

  return client.withMailbox(folder, async (imap) => {
    const result = await imap.messageMove(uid, dest, { uid: true });
    return movedMessageReference(result, dest, id, uid);
  });
}

export async function trashEmail(
  clients: ImapClientFactory,
  account: AccountRecord,
  id: string,
): Promise<EmailReference> {
  const client = clients.get(account);
  const { folder, uid } = decodeId(id);
  const dest = await client.run(async (imap) =>
    resolveTrashMailbox((await imap.list()) as Iterable<ImapMailboxEntry>),
  );

  return client.withMailbox(folder, async (lockedImap) => {
    const result = await lockedImap.messageMove(uid, dest, { uid: true });
    return movedMessageReference(result, dest, id, uid);
  });
}

export async function sendDraft(
  clients: ImapClientFactory,
  account: AccountRecord,
  id: string,
): Promise<EmailReference> {
  const client = clients.get(account);
  const { folder, uid } = decodeId(id);

  return client.withMailbox(folder, async (imap) => {
    const draft = (await imap.fetchOne(
      uid,
      { source: true },
      { uid: true },
    )) as { source?: string | ArrayBuffer };
    if (!draft?.source) {
      throw new Error(`draft not found: ${id}`);
    }

    const sourceStr =
      typeof draft.source === "string"
        ? draft.source
        : Buffer.from(draft.source as ArrayBuffer).toString("utf-8");

    const transporter = client.getTransporter();
    const info = await transporter.sendMail({ raw: sourceStr });

    try {
      await imap.messageMove(uid, "Sent", { uid: true });
    } catch {
      /* best-effort */
    }

    return webLinkUnavailableReference(info.messageId);
  });
}

export async function addAttachmentToDraft(
  clients: ImapClientFactory,
  account: AccountRecord,
  draftId: string,
  name: string,
  contentBytes: string,
  contentType?: string,
): Promise<{
  id: string;
  attachment: { id: string; name: string; contentType?: string };
}> {
  const client = clients.get(account);
  const { folder, uid } = decodeId(draftId);

  try {
    return await client.withMailbox(folder, async (imap) => {
      const existing = (await imap.fetchOne(
        uid,
        { source: true },
        { uid: true },
      )) as { source?: string | ArrayBuffer };
      if (!existing?.source) {
        throw new Error(`draft not found: ${draftId}`);
      }

      const sourceStr =
        typeof existing.source === "string"
          ? existing.source
          : Buffer.from(existing.source as ArrayBuffer).toString("utf-8");

      const built = await new Promise<Buffer>((resolve, reject) => {
        const mc = new MailComposer({
          raw: sourceStr,
          attachments: [
            {
              filename: name,
              content: Buffer.from(contentBytes, "base64"),
              contentType: contentType ?? "application/octet-stream",
            },
          ],
        });
        mc.compile().build((err: Error | null, buf: Buffer) => {
          if (err) reject(err);
          else resolve(buf);
        });
      });

      const result = await appendDraft(imap, folder, built.toString("utf-8"));
      await imap.messageDelete(uid, { uid: true });

      return {
        id: encodeId(folder, appendUid(result, folder)),
        attachment: {
          id: randomUUID(),
          name,
          contentType: contentType ?? "application/octet-stream",
        },
      };
    });
  } catch (err) {
    throw imapOperationError(`failed to add attachment to IMAP draft ${draftId}`, err);
  }
}

export async function removeAttachmentFromDraft(
  clients: ImapClientFactory,
  account: AccountRecord,
  draftId: string,
  attachmentId: string,
): Promise<void> {
  const client = clients.get(account);
  const { folder, uid } = decodeId(draftId);

  return client.withMailbox(folder, async (imap) => {
    const existing = (await imap.fetchOne(
      uid,
      { source: true, bodyStructure: true },
      { uid: true },
    )) as { source?: string | ArrayBuffer; bodyStructure?: BodyNode };
    if (!existing?.source) {
      throw new Error(`draft not found: ${draftId}`);
    }

    const sourceStr =
      typeof existing.source === "string"
        ? existing.source
        : Buffer.from(existing.source as ArrayBuffer).toString("utf-8");

    // Parse MIME to find the attachment to remove
    const targetInfo = findAttachmentInMime(existing.bodyStructure, attachmentId);
    if (!targetInfo) {
      throw new Error(`attachment not found: ${attachmentId}`);
    }

    // Remove the attachment from the MIME source
    const modifiedSource = removeMimePart(sourceStr, targetInfo.filename, targetInfo.contentType);

    // Delete old draft and append modified one
    await imap.messageDelete(uid, { uid: true });
    await imap.append(folder, modifiedSource, ["\\Draft"]);
  });
}

export async function markRead(
  clients: ImapClientFactory,
  account: AccountRecord,
  id: string,
  isRead: boolean,
): Promise<EmailReference> {
  const client = clients.get(account);
  const { folder, uid } = decodeId(id);

  return client.withMailbox(folder, async (imap) => {
    if (isRead) {
      await imap.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
    } else {
      await imap.messageFlagsRemove(uid, ["\\Seen"], { uid: true });
    }
    return webLinkUnavailableReference(id);
  });
}

function movedMessageReference(
  result: unknown,
  destination: string,
  fallbackId: string,
  sourceUid: number,
): EmailReference {
  const uidMap = result && typeof result === "object"
    ? (result as { uidMap?: unknown }).uidMap
    : undefined;
  const destinationUid = uidMap instanceof Map ? uidMap.get(sourceUid) : undefined;
  const id = typeof destinationUid === "number" && destinationUid > 0
    ? encodeId(destination, destinationUid)
    : fallbackId;
  return webLinkUnavailableReference(id);
}

async function appendDraft(
  imap: ImapFlow,
  folder: string,
  rawMsg: string,
): Promise<unknown> {
  try {
    return await imap.append(folder, rawMsg, ["\\Draft"]);
  } catch (err) {
    if (!isImapCommandFailure(err)) throw err;
    return imap.append(folder, rawMsg);
  }
}

function appendUid(result: unknown, folder: string): number {
  if (!result || typeof result !== "object") {
    throw new Error(`IMAP append to ${folder} did not return a UID`);
  }
  const uid = Number((result as { uid?: unknown }).uid);
  if (Number.isFinite(uid) && uid > 0) return uid;
  throw new Error(`IMAP append to ${folder} did not return a UID`);
}

function isImapCommandFailure(err: unknown): boolean {
  const e = err as { responseStatus?: unknown; message?: unknown };
  return (
    typeof e.responseStatus === "string" ||
    (typeof e.message === "string" && e.message.includes("Command failed"))
  );
}

function imapOperationError(message: string, err: unknown): Error {
  const detail = formatImapError(err);
  return new Error(`${message}: ${detail}`, { cause: err });
}

function formatImapError(err: unknown): string {
  const e = err as Record<string, unknown>;
  const parts: string[] = [];
  const message = err instanceof Error ? err.message : String(err);
  if (message) parts.push(message);

  for (const key of ["responseStatus", "responseText", "serverResponseCode", "response"]) {
    const value = e[key];
    if (value !== undefined && value !== null) {
      parts.push(`${key}=${safeErrorValue(value)}`);
    }
  }

  return parts.join("; ");
}

function safeErrorValue(value: unknown): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const text = raw ?? String(value);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}
