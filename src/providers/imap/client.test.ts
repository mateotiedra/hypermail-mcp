import { beforeEach, describe, expect, it, vi } from "vitest";

const imapFlowMock = vi.hoisted(() => ({
  connectError: undefined as unknown,
  instances: [] as Array<{
    options: Record<string, unknown>;
    connect: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("imapflow", () => ({
  ImapFlow: vi.fn(function MockImapFlow(
    this: {
      options: Record<string, unknown>;
      connect: ReturnType<typeof vi.fn>;
      logout: ReturnType<typeof vi.fn>;
    },
    options: Record<string, unknown>,
  ) {
    this.options = options;
    this.connect = vi.fn(async () => {
      if (imapFlowMock.connectError) throw imapFlowMock.connectError;
    });
    this.logout = vi.fn(async () => undefined);
    imapFlowMock.instances.push(this);
  }),
}));

import {
  IMAP_CONNECTION_TIMEOUT_MS,
  IMAP_GREETING_TIMEOUT_MS,
  IMAP_OPERATION_TIMEOUT_MS,
  IMAP_SOCKET_TIMEOUT_MS,
  ImapClient,
} from "./client.js";

beforeEach(() => {
  imapFlowMock.connectError = undefined;
  imapFlowMock.instances.length = 0;
  vi.useRealTimers();
});

describe("ImapClient timeouts", () => {
  it("configures explicit ImapFlow connection and socket timeouts", async () => {
    const client = new ImapClient(tokens());

    await client.getImap();

    expect(imapFlowMock.instances).toHaveLength(1);
    expect(imapFlowMock.instances[0]!.options).toMatchObject({
      host: "imap.example.com",
      port: 993,
      secure: true,
      connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
      socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
    });
  });

  it("reports post-TLS authentication failures with remediation guidance", async () => {
    imapFlowMock.connectError = Object.assign(new Error("Unexpected close"), {
      authenticationFailed: true,
      error: { code: "ClosedAfterConnectTLS" },
      code: "NoConnection",
    });
    const client = new ImapClient(tokens());

    await expect(client.getImap()).rejects.toThrow(
      "IMAP authentication failed for account user@example.com (imap.example.com:993). Verify the password/app-password and IMAP access policy, then re-add or update the account. Provider error code: ClosedAfterConnectTLS.",
    );
  });

  it("does not classify unrelated connect errors as authentication failures", async () => {
    imapFlowMock.connectError = Object.assign(new Error("ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const client = new ImapClient(tokens());

    await expect(client.getImap()).rejects.toThrow("ECONNREFUSED");
    await expect(client.getImap()).rejects.not.toThrow("password/app-password");
  });

  it("rejects timed-out operations and resets the queue for the next call", async () => {
    vi.useFakeTimers();
    const client = new ImapClient(tokens());
    const logout = vi.fn(async () => undefined);
    (client as unknown as { imap: unknown }).imap = { logout };

    const pending = client.run(() => new Promise(() => undefined));
    const assertion = expect(pending).rejects.toThrow("IMAP operation timed out");
    await vi.advanceTimersByTimeAsync(IMAP_OPERATION_TIMEOUT_MS);

    await assertion;
    expect(logout).toHaveBeenCalledTimes(1);
    await expect(client.run(async () => "ok")).resolves.toBe("ok");
  });
});

describe("ImapClient operation serialization", () => {
  it("runs direct IMAP operations sequentially", async () => {
    const client = new ImapClient(tokens());
    (client as unknown as { imap: unknown }).imap = {};

    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = client.run(async () => {
      order.push("first-start");
      await firstMayFinish;
      order.push("first-end");
    });
    const second = client.run(async () => {
      order.push("second-start");
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(["first-start"]);

    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("serializes mailbox operations and releases locks", async () => {
    const client = new ImapClient(tokens());
    const releases: string[] = [];
    (client as unknown as { imap: unknown }).imap = {
      getMailboxLock: async (mailbox: string) => ({
        release: () => releases.push(mailbox),
      }),
    };

    await client.withMailbox("INBOX", async () => "ok");

    expect(releases).toEqual(["INBOX"]);
  });
});

function tokens() {
  return {
    host: "imap.example.com",
    port: 993,
    secure: true,
    user: "user@example.com",
    password: "secret",
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpSecure: false,
  };
}
