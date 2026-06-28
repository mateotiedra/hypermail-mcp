import { describe, expect, it, vi } from "vitest";

import type { AccountRecord } from "../../store/account-store.js";
import type { GmailClientFactory } from "./client.js";
import { moveEmail, trashEmail } from "./write-ops.js";

const account: AccountRecord = {
  email: "user@example.com",
  provider: "gmail",
  tokens: {},
  addedAt: "2026-01-01T00:00:00.000Z",
};

function clientsFor(gmail: unknown): GmailClientFactory {
  return {
    get: () => ({ gmail }),
  } as unknown as GmailClientFactory;
}

describe("Gmail trash operations", () => {
  it("uses Gmail's native trash endpoint", async () => {
    const trash = vi.fn().mockResolvedValue({});
    const modify = vi.fn().mockResolvedValue({});
    const clients = clientsFor({
      users: { messages: { trash, modify } },
    });

    await trashEmail(clients, account, "message-1");

    expect(trash).toHaveBeenCalledWith({ userId: "me", id: "message-1" });
    expect(modify).not.toHaveBeenCalled();
  });

  it("routes trash aliases through the native trash endpoint", async () => {
    const trash = vi.fn().mockResolvedValue({});
    const modify = vi.fn().mockResolvedValue({});
    const clients = clientsFor({
      users: { messages: { trash, modify } },
    });

    await moveEmail(clients, account, "message-1", "deleteditems");
    await moveEmail(clients, account, "message-2", "trash");

    expect(trash).toHaveBeenCalledWith({ userId: "me", id: "message-1" });
    expect(trash).toHaveBeenCalledWith({ userId: "me", id: "message-2" });
    expect(modify).not.toHaveBeenCalled();
  });
});
