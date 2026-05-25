import { randomUUID } from "node:crypto";

import type { AccountRecord } from "../../store/account-store.js";
import MailComposer from "nodemailer/lib/mail-composer/index.js";

import type {
  AddAccountInput,
  AddAccountResult,
  CompleteAddAccountResult,
  CreateFolderInput,
  DraftUpdateInput,
  FolderInfo,
  SendInput,
} from "../types.js";
import { ImapClientFactory, ImapTokens, isImapTokens } from "./client.js";
import {
  decodeId,
  encodeId,
  ImapEnvelope,
  resolveFolder,
} from "./helpers.js";

/** Write operations for IMAP — send, draft, move, mark, folders. */

export async function addAccount(
  clients: ImapClientFactory,
  store: { upsertAccount(rec: AccountRecord): Promise<AccountRecord> },
  input: AddAccountInput,
): Promise<AddAccountResult> {
  const cfg = input.config ?? {};
  const host = String(cfg.host ?? "");
  const port = Number(cfg.port ?? 993);
  const secure = cfg.secure !== false;
  const user = String(cfg.user ?? input.email ?? "");
  const password = String(cfg.password ?? "");
  const smtpHost = String(cfg.smtpHost ?? host);
  const smtpPort = Number(cfg.smtpPort ?? 587);
  const smtpSecure = cfg.smtpSecure === true;

  if (!host || !user || !password) {
    throw new Error(
      "IMAP requires config: { host, port?, secure?, user, password, smtpHost?, smtpPort?, smtpSecure? }",
    );
  }

  const tokens: ImapTokens = {
    host,
    port,
    secure,
    user,
    password,
    smtpHost: smtpHost || host,
    smtpPort: smtpPort || 587,
    smtpSecure,
  };

  // Validate by connecting briefly.
  const client = clients.get({
    email: user.toLowerCase(),
    provider: "imap",
    tokens: tokens as unknown as Record<string, unknown>,
    addedAt: new Date().toISOString(),
  } as AccountRecord);

  try {
    await client.getImap();
  } finally {
    clients.invalidate(user.toLowerCase());
  }

  // Optionally validate SMTP — best-effort.
  try {
    const t = client.getTransporter();
    await t.verify();
  } catch {
    /* SMTP verification is optional */
  }

  const email = user.toLowerCase();
  const rec: AccountRecord = {
    email,
    provider: "imap",
    displayName: input.email ?? user,
    tokens: tokens as unknown as Record<string, unknown>,
    addedAt: new Date().toISOString(),
  };
  const saved = await store.upsertAccount(rec);
  return { status: "ready", account: saved };
}

export function completeAddAccount(): CompleteAddAccountResult {
  return {
    status: "error",
    error:
      "IMAP accounts are set up synchronously — no polling needed. " +
      "Call add_account with IMAP config to create the account directly.",
  };
}

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

export async function createFolder(
  clients: ImapClientFactory,
  account: AccountRecord,
  input: CreateFolderInput,
): Promise<FolderInfo> {
  const client = clients.get(account);
  const imap = await client.getImap();

  const path = input.parentFolderId
    ? `${input.parentFolderId}/${input.displayName}`
    : input.displayName;

  const result = await imap.mailboxCreate(path);

  return {
    id: result.path,
    displayName: result.path,
    parentFolderId: input.parentFolderId,
    childFolderCount: 0,
    totalItemCount: 0,
    unreadItemCount: 0,
  };
}

export async function renameFolder(
  clients: ImapClientFactory,
  account: AccountRecord,
  folderId: string,
  newName: string,
): Promise<FolderInfo> {
  const client = clients.get(account);
  const imap = await client.getImap();

  const lastSep = folderId.lastIndexOf("/");
  const newPath =
    lastSep === -1 ? newName : folderId.slice(0, lastSep + 1) + newName;

  const result = await imap.mailboxRename(folderId, newPath);

  return {
    id: result.path,
    displayName: result.path,
    parentFolderId: lastSep === -1 ? undefined : folderId.slice(0, lastSep),
    childFolderCount: 0,
    totalItemCount: 0,
    unreadItemCount: 0,
  };
}

export async function deleteFolder(
  clients: ImapClientFactory,
  account: AccountRecord,
  folderId: string,
): Promise<void> {
  const client = clients.get(account);
  const imap = await client.getImap();
  await imap.mailboxDelete(folderId);
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
