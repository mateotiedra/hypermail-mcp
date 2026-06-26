import type { Client } from "@microsoft/microsoft-graph-client";
import { describe, expect, it } from "vitest";

import { buildDraftFromReference, THREAD_MARKER } from "./write-ops.js";

interface PatchCall {
  endpoint: string;
  payload: unknown;
}

class FakeGraphRequest {
  constructor(
    private readonly endpoint: string,
    private readonly draftBody: { content?: string; contentType?: string },
    private readonly patches: PatchCall[],
  ) {}

  select(_fields: string): this {
    return this;
  }

  async post(_payload: unknown): Promise<{ id: string }> {
    return { id: "draft-1" };
  }

  async get(): Promise<{ body: { content?: string; contentType?: string } }> {
    return { body: this.draftBody };
  }

  async patch(payload: unknown): Promise<void> {
    this.patches.push({ endpoint: this.endpoint, payload });
  }
}

function fakeClient(draftBody: { content?: string; contentType?: string }): {
  client: Client;
  patches: PatchCall[];
} {
  const patches: PatchCall[] = [];
  const client = {
    api(endpoint: string) {
      return new FakeGraphRequest(endpoint, draftBody, patches);
    },
  } as unknown as Client;
  return { client, patches };
}

describe("buildDraftFromReference", () => {
  it("patches plain-text reply drafts as HTML and escapes the quoted text", async () => {
    const { client, patches } = fakeClient({
      contentType: "Text",
      content: "On Monday, Caroline wrote:\r\n<unsafe> & \"quoted\"",
    });

    const id = await buildDraftFromReference(
      client,
      "/me/messages/source/createReply",
      {},
      { body: "<p>Hello <strong>Caroline</strong></p>", attachments: [] },
    );

    expect(id).toBe("draft-1");
    expect(patches).toHaveLength(1);
    expect(patches[0]).toEqual({
      endpoint: "/me/messages/draft-1",
      payload: {
        body: {
          contentType: "HTML",
          content:
            "<p>Hello <strong>Caroline</strong></p>" +
            '<div style="line-height:12px"><br></div>' +
            THREAD_MARKER +
            "On Monday, Caroline wrote:<br>&lt;unsafe&gt; &amp; &quot;quoted&quot;",
        },
      },
    });
  });

  it("inserts HTML replies inside existing HTML body drafts without escaping them", async () => {
    const { client, patches } = fakeClient({
      contentType: "HTML",
      content: '<html><body class="mail"><p>Existing <em>thread</em></p></body></html>',
    });

    await buildDraftFromReference(
      client,
      "/me/messages/source/createReply",
      {},
      { body: "<p>New reply</p>", attachments: [] },
    );

    expect(patches).toHaveLength(1);
    expect(patches[0]?.payload).toEqual({
      body: {
        contentType: "HTML",
        content:
          '<html><body class="mail"><p>New reply</p>' +
          '<div style="line-height:12px"><br></div>' +
          THREAD_MARKER +
          "<p>Existing <em>thread</em></p></body></html>",
      },
    });
  });
});
