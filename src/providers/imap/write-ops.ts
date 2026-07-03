import { randomUUID } from "node:crypto";

import type { AccountRecord } from "../../store/account-store.js";
import type { ImapFlow } from "imapflow";
import MailComposer from "nodemailer/lib/mail-composer/index.js";

import type {
  DraftUpdateInput,
  SendInput,
} from "../types.js";
import { ImapClient, ImapClientFactory } from "./client.js";
import {
  decodeId,
  encodeId,
  ImapEnvelope,
  isTrashFolderAlias,
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
): Promise<{ id: string }> {
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

  return { id: info.messageId };
}

export async function saveDraft(
  clients: ImapClientFactory,
  account: AccountRecord,
  msg: SendInput,
): Promise<{ id: string }> {
  const client = clients.get(account);
  const rawMsg = await buildRawMessage(client, account, msg);
  let folder = "Drafts";
  try {
    const result = await client.run(async (imap) => {
      folder = resolveDraftMailbox((await imap.list()) as Iterable<ImapMailboxEntry>);
      return appendDraft(imap, folder, rawMsg);
    });
    return { id: encodeId(folder, appendUid(result, folder)) };
  } catch (err) {
    throw imapOperationError(`failed to save IMAP draft to ${folder}`, err);
  }
}

export async function updateDraft(
  clients: ImapClientFactory,
  account: AccountRecord,
  id: string,
  update: DraftUpdateInput,
): Promise<{ id: string }> {
  const client = clients.get(account);
  const { folder, uid } = decodeId(id);

  try {
    return await client.withMailbox(folder, async (imap) => {
      const existing = (await imap.fetchOne(
        uid,
        { source: true, envelope: true },
        { uid: true },
      )) as { source?: string | ArrayBuffer; envelope?: ImapEnvelope };
      if (!existing?.source) {
        throw new Error(`draft not found: ${id}`);
      }

      const origSubject = existing.envelope
        ? (existing.envelope as ImapEnvelope).subject ?? ""
        : "";

      const updatedMsg: Record<string, unknown> = {
        from: `${account.displayName ?? ""} <${account.email}>`,
        subject: update.subject ?? origSubject,
        attachDataUrls: true,
      };

      if (update.body !== undefined) {
        if (update.isHtml) {
          updatedMsg.html = update.body;
        } else {
          updatedMsg.text = update.body;
        }
      }

      const raw = await new Promise<Buffer>((resolve, reject) => {
        const mc = new MailComposer(updatedMsg);
        mc.compile().build((err: Error | null, buf: Buffer) => {
          if (err) reject(err);
          else resolve(buf);
        });
      });

      const result = await appendDraft(imap, folder, raw.toString("utf-8"));
      await imap.messageDelete(uid, { uid: true });
      return { id: encodeId(folder, appendUid(result, folder)) };
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
): Promise<void> {
  if (isTrashFolderAlias(destinationId)) {
    return trashEmail(clients, account, id);
  }

  const client = clients.get(account);
  const { folder, uid } = decodeId(id);
  const dest = resolveFolder(destinationId);

  return client.withMailbox(folder, async (imap) => {
    await imap.messageMove(uid, dest, { uid: true });
  });
}

export async function trashEmail(
  clients: ImapClientFactory,
  account: AccountRecord,
  id: string,
): Promise<void> {
  const client = clients.get(account);
  const { folder, uid } = decodeId(id);
  const dest = await client.run(async (imap) =>
    resolveTrashMailbox((await imap.list()) as Iterable<ImapMailboxEntry>),
  );

  return client.withMailbox(folder, async (lockedImap) => {
    await lockedImap.messageMove(uid, dest, { uid: true });
  });
}

export async function sendDraft(
  clients: ImapClientFactory,
  account: AccountRecord,
  id: string,
): Promise<{ id: string }> {
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

    return { id: info.messageId };
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
): Promise<void> {
  const client = clients.get(account);
  const { folder, uid } = decodeId(id);

  return client.withMailbox(folder, async (imap) => {
    if (isRead) {
      await imap.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
    } else {
      await imap.messageFlagsRemove(uid, ["\\Seen"], { uid: true });
    }
  });
}

async function buildMailOptions(
  client: ImapClient,
  account: AccountRecord,
  msg: SendInput,
  messageId?: string,
): Promise<import("nodemailer").SendMailOptions> {
  const mailOptions: import("nodemailer").SendMailOptions = {
    from: `${account.displayName ?? ""} <${account.email}>`,
    to: msg.to
      .map((a) => (a.name ? `"${a.name}" <${a.address}>` : a.address))
      .join(", "),
    subject: msg.subject,
    attachDataUrls: true,
  };

  if (msg.isHtml) {
    mailOptions.html = msg.body;
  } else {
    mailOptions.text = msg.body;
  }

  if (msg.cc && msg.cc.length > 0) {
    mailOptions.cc = msg.cc
      .map((a) => (a.name ? `"${a.name}" <${a.address}>` : a.address))
      .join(", ");
  }
  if (msg.bcc && msg.bcc.length > 0) {
    mailOptions.bcc = msg.bcc
      .map((a) => (a.name ? `"${a.name}" <${a.address}>` : a.address))
      .join(", ");
  }

  if (msg.attachments && msg.attachments.length > 0) {
    mailOptions.attachments = msg.attachments.map((att) => ({
      filename: att.name,
      content: Buffer.from(att.contentBytes, "base64"),
      contentType: att.contentType,
    }));
  }

  if (messageId) {
    mailOptions.messageId = messageId;
  }

  await applyReferenceMessage(client, mailOptions, msg);
  return mailOptions;
}

async function applyReferenceMessage(
  client: ImapClient,
  mailOptions: import("nodemailer").SendMailOptions,
  msg: SendInput,
): Promise<void> {
  if (!msg.inReplyTo && !msg.forwardMessageId) return;

  const refId = msg.inReplyTo || msg.forwardMessageId;
  if (!refId) return;

  try {
    const { folder: refFolder, uid: refUid } = decodeId(refId);
    const refMsg = (await client.withMailbox(refFolder, async (imap) => {
      return imap.fetchOne(
        refUid,
        { envelope: true, source: true },
        { uid: true },
      );
    })) as { envelope?: ImapEnvelope; source?: string | ArrayBuffer };

    if (refMsg?.envelope) {
      const env = refMsg.envelope as ImapEnvelope;
      if (msg.inReplyTo && env.messageId && !msg.forwardMessageId) {
        mailOptions.inReplyTo = env.messageId;
        mailOptions.references = env.messageId;
      }
    }

    if (msg.forwardMessageId && refMsg?.source) {
      const sourceStr =
        typeof refMsg.source === "string"
          ? refMsg.source
          : Buffer.from(refMsg.source as ArrayBuffer).toString("utf-8");
      const divider =
        '\n\n<div style="line-height:12px"><br></div>\n\n' +
        '<div style="border-left:2px solid #ccc; padding-left:8px; ' +
        'margin-left:0; color:#666">\n' +
        "---------- Forwarded message ---------<br>" +
        sourceStr +
        "\n</div>";
      if (mailOptions.html) {
        mailOptions.html = `${mailOptions.html}${divider}`;
      } else if (mailOptions.text) {
        mailOptions.text = `${mailOptions.text}\n\n---------- Forwarded message ---------\n${sourceStr}`;
      }
    }
  } catch {
    /* If we can't fetch the referenced message, proceed without threading. */
  }
}

async function buildRawMessage(
  client: ImapClient,
  account: AccountRecord,
  msg: SendInput,
  messageId?: string,
): Promise<string> {
  const mailOptions = await buildMailOptions(client, account, msg, messageId);
  return new Promise<string>((resolve, reject) => {
    const mc = new MailComposer(mailOptions);
    mc.compile().build((err: Error | null, buf: Buffer) => {
      if (err) reject(err);
      else resolve(buf.toString("utf-8"));
    });
  });
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
