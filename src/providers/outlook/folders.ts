import type { Client } from "@microsoft/microsoft-graph-client";
import type { AccountRecord } from "../../store/account-store.js";
import type {
  CreateFolderInput,
  FolderInfo,
  ListFoldersOptions,
} from "../types.js";
import { type GraphFolder, mapFolder } from "./helpers.js";

export async function listFolders(
  client: Client,
  account: AccountRecord,
  opts: ListFoldersOptions,
): Promise<FolderInfo[]> {
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

export async function createFolder(
  client: Client,
  account: AccountRecord,
  input: CreateFolderInput,
): Promise<FolderInfo> {
  const parentId = input.parentFolderId ?? "msgfolderroot";
  const created = (await client
    .api(`/me/mailFolders/${encodeURIComponent(parentId)}/childFolders`)
    .post({ displayName: input.displayName })) as GraphFolder;
  return mapFolder(created);
}

export async function renameFolder(
  client: Client,
  account: AccountRecord,
  folderId: string,
  newName: string,
): Promise<FolderInfo> {
  const updated = (await client
    .api(`/me/mailFolders/${encodeURIComponent(folderId)}`)
    .patch({ displayName: newName })) as GraphFolder;
  return mapFolder(updated);
}

export async function deleteFolder(
  client: Client,
  account: AccountRecord,
  folderId: string,
): Promise<void> {
  await client
    .api(`/me/mailFolders/${encodeURIComponent(folderId)}`)
    .delete();
}
