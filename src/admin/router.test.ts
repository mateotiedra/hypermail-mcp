import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createAdminRouter } from "./router.js";
import type { IAgentStore, IAccountStore } from "../mode/types.js";

function mockReq(method: string, path: string, headers: Record<string, string> = {}, body?: unknown): IncomingMessage {
  const chunks = body != null ? [Buffer.from(JSON.stringify(body))] : [];
  let index = 0;
  const req = {
    method,
    url: path,
    headers,
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        if (index < chunks.length) {
          return { value: chunks[index++], done: false };
        }
        return { value: undefined, done: true };
      },
    }),
  } as unknown as IncomingMessage;
  return req;
}

function mockRes(): { res: ServerResponse; body: () => unknown; status: () => number } {
  let statusCode = 200;
  let responseBody: unknown = null;
  const chunks: Buffer[] = [];
  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((chunk?: string) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      try {
        responseBody = JSON.parse(Buffer.concat(chunks).toString());
      } catch { /* not JSON */ }
      return res;
    }),
  } as unknown as ServerResponse & { statusCode: number };

  // Make statusCode writable via defineProperty
  Object.defineProperty(res, "statusCode", {
    get: () => statusCode,
    set: (v: number) => { statusCode = v; },
  });

  return {
    res,
    body: () => responseBody,
    status: () => statusCode,
  };
}

describe("createAdminRouter", () => {
  let agentStore: IAgentStore;
  let accountStore: IAccountStore;

  beforeEach(() => {
    process.env.HYPERMAIL_ADMIN_KEY = "test-admin-key";

    agentStore = {
      listAgents: vi.fn().mockResolvedValue([
        {
          id: "agent-1",
          apiKeyHash: "salt:hash",
          name: "Test Agent",
          accounts: ["test@example.com"],
          provisioning: true,
          createdAt: "2025-01-01T00:00:00Z",
        },
      ]),
      getAgent: vi.fn(),
      findAgentByApiKey: vi.fn(),
      upsertAgent: vi.fn().mockResolvedValue({
        id: "new-agent",
        apiKeyHash: "new-salt:new-hash",
        name: "New Agent",
        accounts: [],
        provisioning: false,
        createdAt: "2025-06-01T00:00:00Z",
      }),
      removeAgent: vi.fn().mockResolvedValue(true),
      assignAccount: vi.fn(),
      unassignAccount: vi.fn(),
    };

    accountStore = {
      listAccounts: vi.fn().mockResolvedValue([
        {
          email: "test@example.com",
          provider: "outlook",
          displayName: "Test User",
          tokens: {},
          addedAt: "2025-01-01T00:00:00Z",
          lastSeenAt: "2025-06-01T00:00:00Z",
          lastSeenIds: [],
        },
      ]),
      getAccount: vi.fn(),
      upsertAccount: vi.fn(),
      removeAccount: vi.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    delete process.env.HYPERMAIL_ADMIN_KEY;
  });

  it("returns 401 without auth header", async () => {
    const router = createAdminRouter(agentStore, accountStore);
    const { res, status, body } = mockRes();
    const handled = await router(mockReq("GET", "/admin/agents"), res);
    expect(handled).toBe(true);
    expect(status()).toBe(401);
    expect(body()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 with wrong bearer token", async () => {
    const router = createAdminRouter(agentStore, accountStore);
    const { res, status, body } = mockRes();
    const handled = await router(
      mockReq("GET", "/admin/agents", { authorization: "Bearer wrong-key" }),
      res,
    );
    expect(handled).toBe(true);
    expect(status()).toBe(401);
    expect(body()).toEqual({ error: "Unauthorized" });
  });

  it("lists agents with valid auth", async () => {
    const router = createAdminRouter(agentStore, accountStore);
    const { res, status, body } = mockRes();
    const handled = await router(
      mockReq("GET", "/admin/agents", { authorization: "Bearer test-admin-key" }),
      res,
    );
    expect(handled).toBe(true);
    expect(status()).toBe(200);
    const data = body() as Array<Record<string, unknown>>;
    expect(data).toHaveLength(1);
    expect(data[0]?.id).toBe("agent-1");
    expect(data[0]?.name).toBe("Test Agent");
    // apiKeyHash must NOT be exposed
    expect(data[0]).not.toHaveProperty("apiKeyHash");
  });

  it("creates agent with valid input", async () => {
    const router = createAdminRouter(agentStore, accountStore);
    const { res, status, body } = mockRes();
    const handled = await router(
      mockReq(
        "POST",
        "/admin/agents",
        { authorization: "Bearer test-admin-key" },
        {
          id: "new-agent",
          api_key: "hm_sk_" + "a".repeat(64),
          name: "New Agent",
          accounts: ["a@b.com"],
          provisioning: true,
        },
      ),
      res,
    );
    expect(handled).toBe(true);
    expect(status()).toBe(201);
    const data = body() as Record<string, unknown>;
    expect(data.id).toBe("new-agent");
    expect(data).not.toHaveProperty("apiKeyHash");
  });

  it("rejects agent creation with invalid api_key format", async () => {
    const router = createAdminRouter(agentStore, accountStore);
    const { res, status, body } = mockRes();
    const handled = await router(
      mockReq(
        "POST",
        "/admin/agents",
        { authorization: "Bearer test-admin-key" },
        { id: "bad-agent", api_key: "bad-key", name: "Bad" },
      ),
      res,
    );
    expect(handled).toBe(true);
    expect(status()).toBe(400);
    expect(body()).toHaveProperty("error");
  });

  it("deletes an agent", async () => {
    const router = createAdminRouter(agentStore, accountStore);
    const { res, status, body } = mockRes();
    const handled = await router(
      mockReq("DELETE", "/admin/agents/agent-1", { authorization: "Bearer test-admin-key" }),
      res,
    );
    expect(handled).toBe(true);
    expect(status()).toBe(200);
    expect(body()).toEqual({ deleted: true, id: "agent-1" });
  });

  it("lists accounts with valid auth", async () => {
    const router = createAdminRouter(agentStore, accountStore);
    const { res, status, body } = mockRes();
    const handled = await router(
      mockReq("GET", "/admin/accounts", { authorization: "Bearer test-admin-key" }),
      res,
    );
    expect(handled).toBe(true);
    expect(status()).toBe(200);
    const data = body() as Array<Record<string, unknown>>;
    expect(data).toHaveLength(1);
    expect(data[0]?.email).toBe("test@example.com");
    // tokens must NOT be exposed
    expect(data[0]).not.toHaveProperty("tokens");
  });

  it("returns 404 for unknown admin route", async () => {
    const router = createAdminRouter(agentStore, accountStore);
    const { res, status } = mockRes();
    const handled = await router(
      mockReq("GET", "/admin/unknown", { authorization: "Bearer test-admin-key" }),
      res,
    );
    expect(handled).toBe(true);
    expect(status()).toBe(404);
  });

  it("returns 404 when HYPERMAIL_ADMIN_KEY is not set", async () => {
    delete process.env.HYPERMAIL_ADMIN_KEY;
    const router = createAdminRouter(agentStore, accountStore);
    const { res, status } = mockRes();
    const handled = await router(mockReq("GET", "/admin/agents"), res);
    expect(handled).toBe(true);
    expect(status()).toBe(404);
  });
});
