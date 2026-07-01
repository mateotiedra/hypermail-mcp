import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { registerComposeTools } from "./compose.js";
import type { ResolvedTools } from "../config.js";
import type { EmailProvider } from "../providers/types.js";
import type { Registry } from "../providers/registry.js";
import type { AccountRecord, AccountStore } from "../store/account-store.js";

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

const tools: ResolvedTools = {
  enabledTools: new Set(["edit_draft"]),
  disabledTools: null,
};

const account: AccountRecord = {
  email: "user@example.com",
  provider: "outlook",
  tokens: {},
  addedAt: "2026-01-01T00:00:00.000Z",
};

function registerHandler(provider: EmailProvider): Handler {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, cb: Handler) => {
      handlers.set(name, cb);
    }),
  };
  const registry = {
    resolveByEmail: vi.fn(() => ({ provider, account })),
  } as unknown as Registry;

  registerComposeTools(server as never, {
    store: {} as AccountStore,
    registry,
    tools,
  });

  const handler = handlers.get("edit_draft");
  if (!handler) throw new Error("edit_draft was not registered");
  return handler;
}

function structured(result: unknown): Record<string, unknown> | undefined {
  return (result as { structuredContent?: Record<string, unknown> }).structuredContent;
}

function errorText(result: unknown): string | undefined {
  return (result as { content?: Array<{ text: string }> }).content?.[0]?.text;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("edit_draft", () => {
  it("replaces only old_text and preserves reply history", async () => {
    const originalHtml =
      "<p>Old answer</p><div style=\"line-height:12px\"><br></div><blockquote>Older thread</blockquote>";
    let currentHtml = originalHtml;
    const provider = {
      id: "outlook",
      readEmail: vi.fn(async () => ({
        id: "draft-1",
        subject: "Subject",
        bodyHtml: currentHtml,
      })),
      updateDraft: vi.fn(async (_account: AccountRecord, id: string, update) => {
        currentHtml = update.body ?? currentHtml;
        return { id };
      }),
    } as unknown as EmailProvider;
    const handler = registerHandler(provider);

    const result = await handler({
      account: account.email,
      id: "draft-1",
      old_text: "<p>Old answer</p>",
      new_text: "<p>New answer</p>",
      format: "html",
    });

    expect(provider.updateDraft).toHaveBeenCalledWith(
      account,
      "draft-1",
      expect.objectContaining({
        body:
          "<p>New answer</p><div style=\"line-height:12px\"><br></div><blockquote>Older thread</blockquote>",
        isHtml: true,
      }),
    );
    expect(structured(result)).toMatchObject({
      edited: true,
      id: "draft-1",
      draftHtml:
        "<p>New answer</p><div style=\"line-height:12px\"><br></div><blockquote>Older thread</blockquote>",
    });
  });

  it("rejects deprecated body without old_text", async () => {
    const provider = {
      id: "outlook",
      readEmail: vi.fn(),
      updateDraft: vi.fn(),
    } as unknown as EmailProvider;
    const handler = registerHandler(provider);

    const result = await handler({
      account: account.email,
      id: "draft-1",
      body: "<p>Replace everything</p>",
      format: "html",
    });

    expect(result).toMatchObject({ isError: true });
    expect(errorText(result)).toContain("Body-only full replacement is no longer supported");
    expect(provider.readEmail).not.toHaveBeenCalled();
    expect(provider.updateDraft).not.toHaveBeenCalled();
  });

  it("rejects ambiguous old_text matches", async () => {
    const provider = {
      id: "outlook",
      readEmail: vi.fn(async () => ({
        id: "draft-1",
        subject: "Subject",
        bodyHtml: "<p>Same</p><p>Same</p><blockquote>history</blockquote>",
      })),
      updateDraft: vi.fn(),
    } as unknown as EmailProvider;
    const handler = registerHandler(provider);

    const result = await handler({
      account: account.email,
      id: "draft-1",
      old_text: "<p>Same</p>",
      new_text: "<p>Updated</p>",
      format: "html",
    });

    expect(result).toMatchObject({ isError: true });
    expect(errorText(result)).toContain("old_text matched multiple sections");
    expect(provider.updateDraft).not.toHaveBeenCalled();
  });

  it("fails when a body edit is not observable after saving", async () => {
    vi.useFakeTimers();
    const provider = {
      id: "gmail",
      readEmail: vi.fn(async () => ({
        id: "draft-1",
        subject: "Subject",
        bodyHtml: "<p>Old answer</p>",
      })),
      updateDraft: vi.fn(async (_account: AccountRecord, id: string) => ({ id })),
    } as unknown as EmailProvider;
    const handler = registerHandler(provider);

    const pending = handler({
      account: account.email,
      id: "draft-1",
      old_text: "<p>Old answer</p>",
      new_text: "<p>New answer</p>",
      format: "html",
    });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result).toMatchObject({ isError: true });
    expect(errorText(result)).toContain("Draft body edit was not observable");
    expect(structured(result)).toBeUndefined();
  });

  it("replays Outlook body updates after stale attachment handling", async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), "hypermail-compose-test-"));
    const filePath = join(dir, "note.txt");
    writeFileSync(filePath, "attachment");

    try {
      const originalHtml = "<p>Old answer</p>";
      const updatedHtml = "<p>New answer</p>";
      let currentHtml = originalHtml;
      let updateCalls = 0;
      const provider = {
        id: "outlook",
        readEmail: vi.fn(async () => ({
          id: "draft-1",
          subject: "Subject",
          bodyHtml: currentHtml,
        })),
        updateDraft: vi.fn(async (_account: AccountRecord, id: string, update) => {
          updateCalls += 1;
          if (updateCalls > 1) currentHtml = update.body ?? currentHtml;
          return { id };
        }),
        addAttachmentToDraft: vi.fn(async (_account, draftId: string) => ({
          id: draftId,
          attachment: { id: "att-1", name: "note.txt" },
        })),
      } as unknown as EmailProvider;
      const handler = registerHandler(provider);

      const pending = handler({
        account: account.email,
        id: "draft-1",
        old_text: originalHtml,
        new_text: updatedHtml,
        format: "html",
        new_attachments: [{ filePath }],
      });
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(provider.addAttachmentToDraft).toHaveBeenCalled();
      expect(provider.updateDraft).toHaveBeenCalledTimes(2);
      expect(provider.updateDraft).toHaveBeenLastCalledWith(
        account,
        "draft-1",
        expect.objectContaining({ body: updatedHtml, isHtml: true }),
      );
      expect(structured(result)).toMatchObject({
        edited: true,
        id: "draft-1",
        draftHtml: updatedHtml,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not call updateDraft for attachment-only edits", async () => {
    const provider = {
      id: "outlook",
      updateDraft: vi.fn(),
      removeAttachmentFromDraft: vi.fn(async () => undefined),
      readEmail: vi.fn(async () => ({
        id: "draft-1",
        subject: "Subject",
        bodyHtml: "<p>Body</p>",
      })),
    } as unknown as EmailProvider;
    const handler = registerHandler(provider);

    const result = await handler({
      account: account.email,
      id: "draft-1",
      remove_attachments: ["att-1"],
    });

    expect(provider.updateDraft).not.toHaveBeenCalled();
    expect(provider.removeAttachmentFromDraft).toHaveBeenCalledWith(
      account,
      "draft-1",
      "att-1",
    );
    expect(structured(result)).toMatchObject({ edited: true, id: "draft-1" });
  });
});
