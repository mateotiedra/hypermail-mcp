import type { Client } from "@microsoft/microsoft-graph-client";
import { describe, expect, it } from "vitest";

import type { AccountRecord } from "../../store/account-store.js";
import {
  listEmails,
  OUTLOOK_IMMUTABLE_ID_PREFER,
  readAttachment,
  readEmail,
  searchEmails,
} from "./read-ops.js";

interface GraphCall {
  endpoint: string;
  headers: Record<string, string>;
  method?: "GET" | "POST";
  select?: string;
  top?: number;
  skip?: number;
  search?: string;
  orderby?: string;
  filter?: string;
  responseType?: unknown;
  body?: unknown;
}

type GraphResponse =
  | { result: unknown; error?: never }
  | { result?: never; error: unknown };

type ResponseMap = Record<string, GraphResponse[]>;

class FakeGraphRequest {
  private readonly call: GraphCall;

  constructor(
    endpoint: string,
    private readonly responses: ResponseMap,
    private readonly calls: GraphCall[],
  ) {
    this.call = { endpoint, headers: {} };
  }

  header(name: string, value: string): this {
    this.call.headers[name] = value;
    return this;
  }

  top(value: number): this {
    this.call.top = value;
    return this;
  }

  skip(value: number): this {
    this.call.skip = value;
    return this;
  }

  select(value: string): this {
    this.call.select = value;
    return this;
  }

  orderby(value: string): this {
    this.call.orderby = value;
    return this;
  }

  filter(value: string): this {
    this.call.filter = value;
    return this;
  }

  search(value: string): this {
    this.call.search = value;
    return this;
  }

  responseType(value: unknown): this {
    this.call.responseType = value;
    return this;
  }

  async get(): Promise<unknown> {
    return this.respond("GET");
  }

  async post(body?: unknown): Promise<unknown> {
    return this.respond("POST", body);
  }

  private async respond(method: "GET" | "POST", body?: unknown): Promise<unknown> {
    this.calls.push({
      ...this.call,
      method,
      body,
      headers: { ...this.call.headers },
    });
    const queue = this.responses[this.call.endpoint];
    if (!queue || queue.length === 0) {
      throw new Error(`No fake Graph response for ${this.call.endpoint}`);
    }

    const response = queue.shift()!;
    if (response.error) throw response.error;
    return response.result;
  }
}

function fakeClient(responses: ResponseMap): { client: Client; calls: GraphCall[] } {
  const calls: GraphCall[] = [];
  const client = {
    api(endpoint: string) {
      return new FakeGraphRequest(endpoint, responses, calls);
    },
  } as unknown as Client;
  return { client, calls };
}

function account(): AccountRecord {
  return {
    email: "user@example.com",
    provider: "outlook",
    tokens: {},
    addedAt: "2026-01-01T00:00:00.000Z",
  };
}

function message(id: string, subject = "Subject") {
  return {
    id,
    subject,
    from: { emailAddress: { address: "sender@example.com" } },
    toRecipients: [{ emailAddress: { address: "user@example.com" } }],
    receivedDateTime: "2026-01-02T00:00:00Z",
    bodyPreview: "Preview",
    isRead: true,
    hasAttachments: false,
    body: { contentType: "text" as const, content: "Body" },
  };
}

function graphError(
  code: string,
  messageText: string,
  statusCode = 404,
): Error & { code: string; statusCode: number; body: string } {
  const err = new Error(messageText) as Error & {
    code: string;
    statusCode: number;
    body: string;
  };
  err.code = code;
  err.statusCode = statusCode;
  err.body = JSON.stringify({
    error: {
      code,
      message: messageText,
      innerError: { "request-id": "request-1" },
    },
  });
  return err;
}

describe("Outlook read operations", () => {
  it("requests immutable IDs when listing emails", async () => {
    const { client, calls } = fakeClient({
      "/me/mailFolders/inbox/messages": [
        { result: { value: [message("immutable-1")], "@odata.nextLink": undefined } },
      ],
    });

    const res = await listEmails(client, account(), { folder: "inbox", limit: 5 });

    expect(res.items[0]?.id).toBe("immutable-1");
    expect(calls[0]?.headers).toEqual({ Prefer: OUTLOOK_IMMUTABLE_ID_PREFER });
  });

  it("falls back from localized folder display names to folder IDs", async () => {
    const folder = "Éléments envoyés";
    const folderId = "sentitems-id";
    const { client, calls } = fakeClient({
      [`/me/mailFolders/${encodeURIComponent(folder)}/messages`]: [
        { error: graphError("ErrorInvalidIdMalformed", "Id is malformed.", 400) },
      ],
      "/me/mailFolders": [
        { result: { value: [{ id: folderId, displayName: folder }] } },
      ],
      [`/me/mailFolders/${folderId}/messages`]: [
        { result: { value: [message("sent-1")], "@odata.nextLink": undefined } },
      ],
    });

    const res = await listEmails(client, account(), { folder, limit: 5 });

    expect(res.items[0]?.id).toBe("sent-1");
    expect(res.items[0]?.folder).toBe(folder);
    expect(calls.map((call) => call.endpoint)).toEqual([
      `/me/mailFolders/${encodeURIComponent(folder)}/messages`,
      "/me/mailFolders",
      `/me/mailFolders/${folderId}/messages`,
    ]);
  });

  it("requests immutable IDs when reading emails and falls back for legacy mutable IDs", async () => {
    const legacyId = "legacy-1";
    const endpoint = `/me/messages/${legacyId}`;
    const { client, calls } = fakeClient({
      [endpoint]: [
        {
          error: graphError(
            "ErrorItemNotFound",
            "The specified object was not found in the store.",
          ),
        },
        { result: message(legacyId) },
      ],
    });

    const res = await readEmail(client, account(), legacyId);

    expect(res.id).toBe(legacyId);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers).toEqual({ Prefer: OUTLOOK_IMMUTABLE_ID_PREFER });
    expect(calls[1]?.headers).toEqual({});
  });

  it("translates malformed message IDs before giving up on read", async () => {
    const malformedId = "malformed-search-id";
    const translatedId = "immutable-readable-id";
    const endpoint = `/me/messages/${malformedId}`;
    const translatedEndpoint = `/me/messages/${translatedId}`;
    const malformed = graphError("ErrorInvalidIdMalformed", "Id is malformed.", 400);
    const { client, calls } = fakeClient({
      [endpoint]: [{ error: malformed }, { error: malformed }],
      "/me/translateExchangeIds": [
        {
          result: {
            value: [{ sourceId: malformedId, targetId: translatedId }],
          },
        },
      ],
      [translatedEndpoint]: [{ result: message(translatedId) }],
    });

    const res = await readEmail(client, account(), malformedId);

    expect(res.id).toBe(translatedId);
    expect(calls.find((call) => call.endpoint === "/me/translateExchangeIds")).toEqual(
      expect.objectContaining({
        method: "POST",
        body: {
          inputIds: [malformedId],
          sourceIdType: "ewsId",
          targetIdType: "restImmutableEntryId",
        },
      }),
    );
    expect(calls.at(-1)?.endpoint).toBe(translatedEndpoint);
    expect(calls.at(-1)?.headers).toEqual({ Prefer: OUTLOOK_IMMUTABLE_ID_PREFER });
  });

  it("uses immutable IDs for attachment metadata and download requests", async () => {
    const messageId = "immutable-1";
    const attachmentId = "attachment-1";
    const metadataEndpoint = `/me/messages/${messageId}/attachments/${attachmentId}`;
    const valueEndpoint = `/me/messages/${messageId}/attachments/${attachmentId}/$value`;
    const { client, calls } = fakeClient({
      [metadataEndpoint]: [
        { result: { name: "file.pdf", contentType: "application/pdf" } },
      ],
      [valueEndpoint]: [{ result: new Uint8Array([1, 2, 3]).buffer }],
    });

    const res = await readAttachment(client, account(), messageId, attachmentId);

    expect(res.name).toBe("file.pdf");
    expect(calls.map((call) => call.headers)).toEqual([
      { Prefer: OUTLOOK_IMMUTABLE_ID_PREFER },
      { Prefer: OUTLOOK_IMMUTABLE_ID_PREFER },
    ]);
  });

  it("returns translated readable IDs for malformed search results", async () => {
    const malformedId = "malformed-search-id";
    const translatedId = "immutable-readable-id";
    const malformed = graphError("ErrorInvalidIdMalformed", "Id is malformed.", 400);
    const { client } = fakeClient({
      "/me/messages": [{ result: { value: [message(malformedId)] } }],
      [`/me/messages/${malformedId}`]: [{ error: malformed }, { error: malformed }],
      "/me/translateExchangeIds": [
        {
          result: {
            value: [{ sourceId: malformedId, targetId: translatedId }],
          },
        },
      ],
      [`/me/messages/${translatedId}`]: [{ result: { id: translatedId } }],
    });

    const res = await searchEmails(client, account(), "Subject", { limit: 10 });

    expect(res[0]).toEqual(expect.objectContaining({ id: translatedId }));
    expect(res[0]).not.toHaveProperty("stale");
  });

  it("marks only not-found search results as stale", async () => {
    const staleErr = graphError(
      "ErrorItemNotFound",
      "The specified object was not found in the store.",
    );
    const { client, calls } = fakeClient({
      "/me/messages": [
        { result: { value: [message("ok-1"), message("stale-1")] } },
      ],
      "/me/messages/ok-1": [{ result: { id: "ok-1" } }],
      "/me/messages/stale-1": [{ error: staleErr }, { error: staleErr }],
      "/me/translateExchangeIds": [
        { result: { value: [] } },
        { result: { value: [] } },
      ],
    });

    const res = await searchEmails(client, account(), "Subject", { limit: 10 });

    expect(res[0]).toEqual(expect.objectContaining({ id: "ok-1" }));
    expect(res[0]).not.toHaveProperty("stale");
    expect(res[1]).toEqual(expect.objectContaining({ id: "stale-1", stale: true }));
    expect(calls[0]?.headers).toEqual({
      ConsistencyLevel: "eventual",
      Prefer: OUTLOOK_IMMUTABLE_ID_PREFER,
    });
  });

  it("does not swallow unrelated search probe failures", async () => {
    const { client } = fakeClient({
      "/me/messages": [{ result: { value: [message("broken-1")] } }],
      "/me/messages/broken-1": [
        { error: graphError("InternalServerError", "Graph is unavailable", 500) },
      ],
    });

    await expect(searchEmails(client, account(), "Subject", {})).rejects.toThrow(
      "Graph is unavailable",
    );
  });
});
