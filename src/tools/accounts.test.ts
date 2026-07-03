import { describe, expect, it, vi } from "vitest";

import { registerAccountTools } from "./accounts.js";
import type { ResolvedTools } from "../config.js";
import type { Registry } from "../providers/registry.js";

import type { AccountRecord, AccountStore } from "../store/account-store.js";

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

const tools: ResolvedTools = {
  enabledTools: new Set(["add_account", "complete_add_account"]),
  disabledTools: null,
};

const secretAccount: AccountRecord = {
  email: "user@example.com",
  provider: "imap",
  displayName: "User",
  tokens: {
    password: "secret-password",
    refreshToken: "secret-refresh-token",
  },
  addedAt: "2026-01-01T00:00:00.000Z",
  signature: "<p>Regards</p>",
};

function registerHandlers(provider: Record<string, unknown>): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, cb: Handler) => {
      handlers.set(name, cb);
    }),
  };
  const registry = {
    get: vi.fn(() => provider),
  } as unknown as Registry;

  registerAccountTools(server as never, {
    store: {} as AccountStore,
    registry,
    tools,
  });

  return handlers;
}

function structured(result: unknown): Record<string, unknown> | undefined {
  return (result as { structuredContent?: Record<string, unknown> }).structuredContent;
}

function textJson(result: unknown): unknown {
  const text = (result as { content?: Array<{ text: string }> }).content?.[0]?.text;
  return text ? JSON.parse(text) : undefined;
}

describe("account tools", () => {
  it("redacts tokens from ready add_account responses", async () => {
    const handlers = registerHandlers({
      addAccount: vi.fn(async () => ({ status: "ready", account: secretAccount })),
    });
    const handler = handlers.get("add_account");
    if (!handler) throw new Error("add_account was not registered");

    const result = await handler({ provider: "imap", email: secretAccount.email });

    expect(structured(result)).toEqual({
      status: "ready",
      account: {
        email: "user@example.com",
        provider: "imap",
        displayName: "User",
        addedAt: "2026-01-01T00:00:00.000Z",
        signature: "<p>Regards</p>",
        style: undefined,
      },
    });
    const rendered = JSON.stringify(textJson(result));
    expect(rendered).not.toContain("tokens");
    expect(rendered).not.toContain("secret-password");
    expect(rendered).not.toContain("secret-refresh-token");
  });

  it("redacts tokens from ready complete_add_account responses", async () => {
    const handlers = registerHandlers({
      addAccount: vi.fn(),
      completeAddAccount: vi.fn(async () => ({ status: "ready", account: secretAccount })),
    });
    const handler = handlers.get("complete_add_account");
    if (!handler) throw new Error("complete_add_account was not registered");

    const result = await handler({ provider: "gmail", handle: "handle-1" });

    expect(structured(result)).toMatchObject({
      status: "ready",
      account: {
        email: "user@example.com",
        provider: "imap",
        displayName: "User",
      },
    });
    const rendered = JSON.stringify(textJson(result));
    expect(rendered).not.toContain("tokens");
    expect(rendered).not.toContain("secret-password");
    expect(rendered).not.toContain("secret-refresh-token");
  });
});
