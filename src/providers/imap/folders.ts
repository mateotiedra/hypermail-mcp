import type { AccountRecord } from "../../store/account-store.js";
import type {
  CreateFolderInput,
  FolderInfo,
} from "../types.js";
import { ImapClientFactory } from "./client.js";

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
