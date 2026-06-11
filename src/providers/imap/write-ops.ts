import { randomUUID } from "node:crypto";

import type { AccountRecord } from "../../store/account-store.js";
import MailComposer from "nodemailer/lib/mail-composer/index.js";

import type {
  DraftUpdateInput,
  SendInput,
} from "../types.js";
import { ImapClientFactory } from "./client.js";
import {
  decodeId,
  encodeId,
  ImapEnvelope,
  resolveFolder,
} from "./helpers.js";
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

  const mailOptions: import("nodemailer").SendMailOptions = {
    from: `${account.displayName ?? ""} <${account.email}>`,
    to: msg.to
      .map((a) => (a.name ? `"${a.name}" <${a.address}>` : a.address))
      .join(", "),
    subject: msg.subject,
  };

  if (msg.isHtml) {
    mailOptions.html = msg.body;
  } else {
    mailOptions.text = msg.body;
  }
  (mailOptions as Record<string, unknown>).attachDataUrls = true;

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

  // Handle reply and forward threading
  if (msg.inReplyTo || msg.forwardMessageId) {
    const refId = msg.inReplyTo ?? msg.forwardMessageId;
    if (refId) {
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
            (mailOptions as Record<string, unknown>).references =
              env.messageId;
          }
        }

        // Embed forwarded message
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
            mailOptions.html += divider;
          } else if (mailOptions.text) {
            mailOptions.text +=
              "\n\n---------- Forwarded message ---------\n" + sourceStr;
          }
        }
      } catch {
        /* If we can't fetch the referenced message, proceed without threading. */
      }
    }
  }

  const info = await transporter.sendMail(mailOptions);

  // Save a copy to Sent folder
  try {
    const rawMsg = await buildRawMessage(account, msg, info.messageId);
    await client.withMailbox("Sent", async (imap) => {
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
  const rawMsg = await buildRawMessage(account, msg);
  return client.withMailbox("Drafts", async (imap) => {
    const result = (await imap.append("Drafts", rawMsg, ["\\Draft"])) as { uid: number };
    return { id: encodeId("Drafts", result.uid) };
  });
}

export async function updateDraft(
  clients: ImapClientFactory,
  account: AccountRecord,
  id: string,
  update: DraftUpdateInput,
): Promise<{ id: string }> {
  const client = clients.get(account);
  const { folder, uid } = decodeId(id);

  return client.withMailbox(folder, async (imap) => {
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

    await imap.messageDelete(uid, { uid: true });
  const result = (await imap.append(folder, raw, ["\\Draft"])) as { uid: number };
    return { id: encodeId(folder, result.uid) };
  });
}

export async function moveEmail(
  clients: ImapClientFactory,
  account: AccountRecord,
  id: string,
  destinationId: string,
): Promise<void> {
  const client = clients.get(account);
  const { folder, uid } = decodeId(id);
  const dest = resolveFolder(destinationId);

  return client.withMailbox(folder, async (imap) => {
    await imap.messageMove(uid, dest, { uid: true });
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

  return client.withMailbox(folder, async (imap) => {
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

    await imap.messageDelete(uid, { uid: true });
  const result = (await imap.append(folder, built, ["\\Draft"])) as { uid: number };

    return {
      id: encodeId(folder, result.uid),
      attachment: {
        id: randomUUID(),
        name,
        contentType: contentType ?? "application/octet-stream",
      },
    };
  });
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
      { source: true, structure: true },
      { uid: true },
    )) as { source?: string | ArrayBuffer; structure?: any };
    if (!existing?.source) {
      throw new Error(`draft not found: ${draftId}`);
    }

    const sourceStr =
      typeof existing.source === "string"
        ? existing.source
        : Buffer.from(existing.source as ArrayBuffer).toString("utf-8");

    // Parse MIME to find the attachment to remove
    const targetInfo = findAttachmentInMime(existing.structure, attachmentId);
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

async function buildRawMessage(
  account: AccountRecord,
  msg: SendInput,
  messageId?: string,
): Promise<string> {
  const mailOptions: Record<string, unknown> = {
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

  // Add file attachments from msg.attachments
  if (msg.attachments && msg.attachments.length > 0) {
    const fileAttachments = msg.attachments.map((att) => ({
      filename: att.name,
      content: Buffer.from(att.contentBytes, "base64"),
      contentType: att.contentType,
    }));
    mailOptions.attachments = fileAttachments;
  }

  if (messageId) {
    mailOptions.messageId = messageId;
  }

  return new Promise<string>((resolve, reject) => {
    const mc = new MailComposer(mailOptions);
    mc.compile().build((err: Error | null, buf: Buffer) => {
      if (err) reject(err);
      else resolve(buf.toString("utf-8"));
    });
  });
}
