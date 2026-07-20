import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountRecord, AccountStore } from "../../store/account-store.js";
import {
  beginAuthorizationCode,
  completeAuthorizationCode,
} from "./auth.js";
import { GmailClientFactory } from "./client.js";
import { GmailProvider } from "./index.js";

vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth.js")>()),
  beginAuthorizationCode: vi.fn(),
  completeAuthorizationCode: vi.fn(),
}));

describe("GmailProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(beginAuthorizationCode).mockResolvedValue({
      userCode: "",
      verificationUri: "https://accounts.google.com/o/oauth2/v2/auth",
      message: "Authorize Gmail",
      expiresAt: "2026-07-20T21:16:54.948Z",
      state: "oauth-state",
      codeVerifier: "code-verifier",
      redirectUri: "http://127.0.0.1:33333/callback",
      scopes: ["https://www.googleapis.com/auth/gmail.modify"],
      clientId: "client-id",
      cancel: vi.fn(),
      consumeAuthorizationResponse: vi.fn(),
    });
    vi.mocked(completeAuthorizationCode).mockResolvedValue({
      email: "Mateo.Tiedra@OrionFestival.ch",
      tokens: {
        clientId: "client-id",
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiryDate: Date.now() + 3600_000,
        scopes: ["https://www.googleapis.com/auth/gmail.modify"],
        email: "Mateo.Tiedra@OrionFestival.ch",
      },
    });
  });

  it("replaces a cached client after reauthorization persists fresh tokens", async () => {
    const store = {
      upsertAccount: vi.fn(async (account: AccountRecord) => ({
        ...account,
        email: account.email.toLowerCase(),
      })),
    } as unknown as AccountStore;
    const provider = new GmailProvider({ store, clientId: "client-id" });
    const clients = (provider as unknown as { clients: GmailClientFactory }).clients;
    const existing: AccountRecord = {
      email: "mateo.tiedra@orionfestival.ch",
      provider: "gmail",
      displayName: "mateo.tiedra@orionfestival.ch",
      addedAt: "2026-07-20T20:00:00.000Z",
      tokens: {
        clientId: "client-id",
        accessToken: "old-access-token",
        refreshToken: "old-refresh-token",
        expiryDate: Date.now() - 3600_000,
        scopes: ["https://www.googleapis.com/auth/gmail.modify"],
        email: "mateo.tiedra@orionfestival.ch",
      },
    };
    const cached = clients.get(existing);

    const added = await provider.addAccount({ email: existing.email });
    if (added.status !== "pending") throw new Error("expected pending OAuth flow");

    const result = await provider.completeAddAccount(added.handle, {
      code: "authorization-code",
      state: "oauth-state",
    });
    if (result.status !== "ready" || !result.account) {
      throw new Error("expected ready account");
    }

    expect(clients.get(result.account)).not.toBe(cached);
  });
});
