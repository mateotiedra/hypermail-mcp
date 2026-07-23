import { describe, expect, it, vi } from "vitest";

import { registerOrganizeTools } from "./organize.js";
import type { ResolvedTools } from "../config.js";
import type { EmailProvider } from "../providers/types.js";
import type { Registry } from "../providers/registry.js";
import type { AccountRecord } from "../store/account-store.js";

const account: AccountRecord = {
  email: "user@example.com",
  provider: "outlook",
  tokens: {},
  addedAt: "2026-01-01T00:00:00.000Z",
};

const tools: ResolvedTools = {
  enabledTools: new Set([
    "archive_email",
    "trash_email",
    "move_email",
    "mark_read",
    "mark_unread",
  ]),
  disabledTools: null,
};

type Handler = (args: Record<string, unknown>) => Promise<unknown>;
type Schema = { parse(input: unknown): Record<string, unknown> };
type Registration = {
  config: { description: string; inputSchema: Schema; outputSchema: Schema };
  handler: Handler;
};

function register(provider: EmailProvider): Map<string, Registration> {
  const registrations = new Map<string, Registration>();
  const server = {
    registerTool: vi.fn((name: string, config: Registration["config"], handler: Handler) => {
      registrations.set(name, { config, handler });
    }),
  };
  const registry = {
    resolveByEmail: vi.fn(() => ({ account, provider })),
  } as unknown as Registry;

  registerOrganizeTools(server as never, { registry, tools });
  return registrations;
}

async function invoke(
  registrations: Map<string, Registration>,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const registration = registrations.get(name);
  if (!registration) throw new Error(`${name} was not registered`);
  const result = await registration.handler(registration.config.inputSchema.parse(args));
  const data = (result as { structuredContent: Record<string, unknown> }).structuredContent;
  registration.config.outputSchema.parse(data);
  return data;
}

describe("organize tools", () => {
  it("uses post-move IDs and refreshed web URLs while retaining action and destination", async () => {
    const provider = {
      id: "outlook",
      moveEmail: vi.fn(async (_account, _id, destination) => ({
        id: destination === "archive" ? "archived-id" : "moved-id",
        webUrl: `https://outlook.example/messages/${destination}`,
      })),
    } as unknown as EmailProvider;
    const registrations = register(provider);

    const archived = await invoke(registrations, "archive_email", {
      account: account.email,
      id: "original-id",
    });
    const moved = await invoke(registrations, "move_email", {
      account: account.email,
      id: "original-id",
      destination: "projects",
    });

    expect(provider.moveEmail).toHaveBeenNthCalledWith(1, account, "original-id", "archive");
    expect(provider.moveEmail).toHaveBeenNthCalledWith(2, account, "original-id", "projects");
    expect(archived).toEqual({
      archived: true,
      id: "archived-id",
      webUrl: "https://outlook.example/messages/archive",
    });
    expect(moved).toEqual({
      moved: true,
      id: "moved-id",
      destination: "projects",
      webUrl: "https://outlook.example/messages/projects",
    });
  });

  it("propagates an IMAP web-link unavailability reason after trashing", async () => {
    const provider = {
      id: "imap",
      trashEmail: vi.fn(async () => ({
        id: "trashed-id",
        webUrlUnavailableReason: "IMAP does not provide a native web-client link.",
      })),
    } as unknown as EmailProvider;
    const registrations = register(provider);

    const data = await invoke(registrations, "trash_email", {
      account: account.email,
      id: "original-id",
    });

    expect(data).toEqual({
      trashed: true,
      id: "trashed-id",
      webUrlUnavailableReason: "IMAP does not provide a native web-client link.",
    });
  });

  it.each([
    ["mark_read", true, "read-id"],
    ["mark_unread", false, "unread-id"],
  ])("keeps success and read state when %s returns a refreshed reference", async (name, isRead, id) => {
    const provider = {
      id: "outlook",
      markRead: vi.fn(async () => ({
        id,
        webUrl: `https://outlook.example/messages/${id}`,
      })),
    } as unknown as EmailProvider;
    const registrations = register(provider);

    const data = await invoke(registrations, name, {
      account: account.email,
      id: "original-id",
    });

    expect(provider.markRead).toHaveBeenCalledWith(account, "original-id", isRead);
    expect(data).toEqual({
      marked: true,
      id,
      isRead,
      webUrl: `https://outlook.example/messages/${id}`,
    });
  });

  it("documents the post-operation native web-client link for every organize tool", () => {
    const registrations = register({ id: "outlook" } as EmailProvider);

    for (const name of tools.enabledTools!) {
      const description = registrations.get(name)?.config.description ?? "";
      expect(description).toContain("shareable native web-client link");
      expect(description).toContain("post-operation message");
      expect(description).toContain("webUrlUnavailableReason");
    }
  });
});
