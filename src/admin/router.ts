import type { IncomingMessage, ServerResponse } from "node:http";
import type { IAgentStore, IAccountStore } from "../mode/types.js";

/**
 * Check the admin bearer token. Returns true if authorized.
 */
function checkAdminAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const adminKey = process.env.HYPERMAIL_ADMIN_KEY;
  if (!adminKey) {
    // Admin API is not exposed — return 404 to avoid leaking existence
    res.statusCode = 404;
    res.end("not found");
    return false;
  }

  const auth = (req.headers["authorization"] as string | undefined) ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  const token = match?.[1];

  if (!token || token !== adminKey) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return false;
  }

  return true;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Create an admin HTTP request handler.
 * Returns a function that handles /admin/* requests.
 * Returns true if the request was handled (response sent), false otherwise.
 */
export function createAdminRouter(
  agentStore: IAgentStore,
  accountStore: IAccountStore,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    // ── Auth check (except OPTIONS for CORS preflight) ──
    if (req.method !== "OPTIONS" && !checkAdminAuth(req, res)) {
      return true; // response already sent
    }

    try {
      // ── GET /admin/agents ──
      if (req.method === "GET" && path === "/admin/agents") {
        const agents = await agentStore.listAgents();
        const data = agents.map((a) => ({
          id: a.id,
          name: a.name,
          accounts: a.accounts,
          provisioning: a.provisioning,
          createdAt: a.createdAt,
          // apiKeyHash is never exposed
        }));
        json(res, 200, data);
        return true;
      }

      // ── POST /admin/agents ──
      if (req.method === "POST" && path === "/admin/agents") {
        const body = await readBody(req);

        // Validate required fields
        const id = String(body.id ?? "").trim();
        if (!id || !/^[a-z0-9_-]+$/.test(id)) {
          json(res, 400, {
            error: "id is required and must contain only lowercase letters, digits, hyphens, and underscores",
          });
          return true;
        }

        const apiKey = String(body.api_key ?? "").trim();
        if (!apiKey || !/^hm_sk_[a-f0-9]{64}$/.test(apiKey)) {
          json(res, 400, {
            error: "api_key is required and must match hm_sk_ prefix + 64 hex chars",
          });
          return true;
        }

        const name = String(body.name ?? "").trim();
        if (!name) {
          json(res, 400, { error: "name is required" });
          return true;
        }

        const accounts = Array.isArray(body.accounts)
          ? body.accounts.map(String)
          : [];
        const provisioning = Boolean(body.provisioning);

        const agent = await agentStore.upsertAgent({
          id,
          plaintextApiKey: apiKey,
          name,
          accounts,
          provisioning,
        });

        json(res, 201, {
          id: agent.id,
          name: agent.name,
          accounts: agent.accounts,
          provisioning: agent.provisioning,
          createdAt: agent.createdAt,
        });
        return true;
      }

      // ── DELETE /admin/agents/:id ──
      const agentsMatch = path.match(/^\/admin\/agents\/([a-z0-9_-]+)$/);
      if (req.method === "DELETE" && agentsMatch) {
        const agentId = agentsMatch[1]!;
        const found = await agentStore.removeAgent(agentId);
        if (!found) {
          json(res, 404, { error: `agent "${agentId}" not found` });
          return true;
        }
        json(res, 200, { deleted: true, id: agentId });
        return true;
      }

      // ── GET /admin/accounts ──
      if (req.method === "GET" && path === "/admin/accounts") {
        const accounts = await accountStore.listAccounts();
        const data = accounts.map((a) => ({
          email: a.email,
          provider: a.provider,
          displayName: a.displayName,
          addedAt: a.addedAt,
          lastSeenAt: a.lastSeenAt,
        }));
        json(res, 200, data);
        return true;
      }

      // ── DELETE /admin/accounts/:email ──
      const accountsMatch = path.match(/^\/admin\/accounts\/(.+)$/);
      if (req.method === "DELETE" && accountsMatch) {
        const email = decodeURIComponent(accountsMatch[1]!);
        const found = await accountStore.removeAccount(email);
        if (!found) {
          json(res, 404, { error: `account "${email}" not found` });
          return true;
        }
        json(res, 200, { deleted: true, email });
        return true;
      }

      // ── Unknown admin route ──
      json(res, 404, { error: `unknown admin route: ${req.method} ${path}` });
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[hypermail-mcp] admin error:", err);
      if (!res.headersSent) {
        if (err instanceof SyntaxError) {
          json(res, 400, { error: "Invalid JSON body" });
        } else {
          json(res, 500, {
            error: err instanceof Error ? err.message : "Internal error",
          });
        }
      }
      return true;
    }
  };
}
