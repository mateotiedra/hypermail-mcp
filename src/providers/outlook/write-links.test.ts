import type { Client } from "@microsoft/microsoft-graph-client";
import { describe, expect, it } from "vitest";

import type { AccountRecord } from "../../store/account-store.js";
import { markRead, moveEmail, sendOrSave, updateDraft } from "./write-ops.js";
import { OUTLOOK_IMMUTABLE_ID_PREFER } from "./web-links.js";

type Response = { result?: unknown; error?: unknown };
interface Call { endpoint: string; method: string; headers: Record<string, string>; body?: unknown; select?: string }

class Request {
  private readonly headers: Record<string, string> = {};
  private selected?: string;
  constructor(private readonly endpoint: string, private readonly responses: Record<string, Response[]>, private readonly calls: Call[]) {}
  header(name: string, value: string): this { this.headers[name] = value; return this; }
  select(value: string): this { this.selected = value; return this; }
  async get(): Promise<unknown> { return this.respond("GET"); }
  async post(body?: unknown): Promise<unknown> { return this.respond("POST", body); }
  async patch(body?: unknown): Promise<unknown> { return this.respond("PATCH", body); }
  private async respond(method: string, body?: unknown): Promise<unknown> {
    this.calls.push({ endpoint: this.endpoint, method, headers: { ...this.headers }, body, select: this.selected });
    const response = this.responses[this.endpoint]?.shift();
    if (!response) throw new Error(`No response for ${this.endpoint}`);
    if (response.error) throw response.error;
    return response.result;
  }
}

function fakeClient(responses: Record<string, Response[]>): { client: Client; calls: Call[] } {
  const calls: Call[] = [];
  return { client: { api: (endpoint: string) => new Request(endpoint, responses, calls) } as unknown as Client, calls };
}

const account: AccountRecord = { email: "user@example.com", provider: "outlook", tokens: {}, addedAt: "2026-01-01T00:00:00.000Z" };

describe("Outlook write web links", () => {
  it("uses the returned moved ID and Graph link under immutable-ID preference", async () => {
    const { client, calls } = fakeClient({
      "/me/mailFolders/archive": [{ result: { id: "archive-id" } }],
      "/me/messages/old-id/move": [{ result: { id: "moved-id", parentFolderId: "archive-id", webLink: "https://outlook.example/moved" } }],
    });

    await expect(moveEmail(client, account, "old-id", "archive")).resolves.toEqual({
      id: "moved-id", webUrl: "https://outlook.example/moved",
    });
    expect(calls[1]).toEqual(expect.objectContaining({
      endpoint: "/me/messages/old-id/move",
      headers: { Prefer: OUTLOOK_IMMUTABLE_ID_PREFER },
      body: { destinationId: "archive" },
    }));
  });

  it("refetches the returned moved ID and strictly verifies its resolved destination", async () => {
    const { client, calls } = fakeClient({
      "/me/mailFolders/custom-alias": [{ result: { id: "custom-folder-id" } }],
      "/me/messages/old-id/move": [{ result: { id: "new-id" } }],
      "/me/messages/new-id": [{ result: { id: "new-id", parentFolderId: "custom-folder-id", webLink: "https://outlook.example/new" } }],
    });

    await expect(moveEmail(client, account, "old-id", "custom-alias")).resolves.toEqual({
      id: "new-id", webUrl: "https://outlook.example/new",
    });
    expect(calls[2]).toEqual(expect.objectContaining({
      endpoint: "/me/messages/new-id",
      headers: { Prefer: OUTLOOK_IMMUTABLE_ID_PREFER },
      select: "id,webLink,parentFolderId",
    }));
  });

  it("rejects a move whose resulting item is in a different folder", async () => {
    const { client } = fakeClient({
      "/me/mailFolders/archive": [{ result: { id: "archive-id" } }],
      "/me/messages/old-id/move": [{ result: { id: "new-id", parentFolderId: "wrong-folder", webLink: "https://outlook.example/new" } }],
    });

    await expect(moveEmail(client, account, "old-id", "archive")).rejects.toThrow("expected archive-id, got wrong-folder");
  });

  it("builds an OWA link when a verified move has no Graph link", async () => {
    const { client } = fakeClient({
      "/me/mailFolders/archive": [{ result: { id: "archive-id" } }],
      "/me/messages/old-id/move": [{ result: { id: "new-id" } }],
      "/me/messages/new-id": [{ result: { id: "new-id", parentFolderId: "archive-id" } }],
      "/me/translateExchangeIds": [{ result: { value: [{ targetId: "rest-id" }] } }],
    });

    await expect(moveEmail(client, account, "old-id", "archive")).resolves.toEqual({
      id: "new-id",
      webUrl: "https://outlook.office365.com/owa/?ItemID=rest-id&exvsurl=1&viewmodel=ReadMessageItem",
    });
  });

  it("returns resulting item references for draft updates and read-state changes", async () => {
    const { client } = fakeClient({
      "/me/messages/draft-id": [
        { result: { id: "updated-id", webLink: "https://outlook.example/updated" } },
        { result: { id: "marked-id", webLink: "https://outlook.example/marked" } },
      ],
    });

    await expect(updateDraft(client, account, "draft-id", { subject: "new" })).resolves.toEqual({
      id: "updated-id", webUrl: "https://outlook.example/updated",
    });
    await expect(markRead(client, account, "draft-id", true)).resolves.toEqual({
      id: "marked-id", webUrl: "https://outlook.example/marked",
    });
  });

  it("keeps a successful sendMail send successful when no sent item can be resolved", async () => {
    const { client } = fakeClient({ "/me/sendMail": [{ result: undefined }] });

    await expect(sendOrSave(client, account, {
      to: [{ address: "recipient@example.com" }], subject: "Subject", body: "Body", inReplyTo: false,
    }, "send")).resolves.toEqual({
      id: "",
      webUrlUnavailableReason: "Outlook did not return an ID for the resulting sent message.",
    });
  });
});
