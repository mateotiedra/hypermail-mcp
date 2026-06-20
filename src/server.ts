import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";

import { AccountStore } from "./store/account-store.js";
import { buildRegistry, type Registry } from "./providers/registry.js";
import { registerTools } from "./tools/index.js";
import { VERSION } from "./version.js";
import { DEFAULT_GMAIL_OAUTH_CALLBACK_PATH } from "./providers/gmail/auth.js";
import type { AppConfig, ResolvedTools } from "./config.js";
import { resolveTools } from "./config.js";

export interface ServerOptions {
  /** Fully resolved application config from environment plus CLI overrides. */
  config: AppConfig;
}

export async function startServer(opts: ServerOptions): Promise<void> {
  const { config } = opts;
  const store = await AccountStore.open({ dataDir: config.dataDir });
  const registry = buildRegistry({ store, providers: config.providers });
  const tools: ResolvedTools = resolveTools(config);

  // Factory: creates a fresh McpServer with all tools registered.
  // HTTP mode creates one per session; stdio mode uses a single instance.
  const createServer = (): McpServer => {
    const s = new McpServer(
      { name: "hypermail-mcp", version: VERSION },
      { capabilities: { tools: {}, logging: {} } },
    );
    registerTools(s, { store, registry, tools });
    return s;
  };

  if (config.transport === "http") {
    await startHttp(createServer, registry, config.http.host, config.http.port);
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

interface HttpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requestBaseUrl(req: IncomingMessage): string {
  const proto = firstHeader(req.headers["x-forwarded-proto"]) ?? "http";
  const host =
    firstHeader(req.headers["x-forwarded-host"]) ??
    firstHeader(req.headers.host) ??
    "127.0.0.1";
  return `${proto}://${host}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sendOAuthHtml(res: ServerResponse, status: number, title: string, body: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></body>
</html>`);
}

async function handleGmailOAuthCallback(
  req: IncomingMessage,
  res: ServerResponse,
  registry: Registry,
): Promise<void> {
  const provider = registry.get("gmail");
  if (!provider.completeAddAccountFromRedirect) {
    sendOAuthHtml(res, 500, "Gmail authorization failed", "This server cannot complete Gmail OAuth callbacks.");
    return;
  }

  const authorizationResponse = new URL(req.url ?? "", requestBaseUrl(req)).toString();
  const result = await provider.completeAddAccountFromRedirect(authorizationResponse);
  if (result.status === "ready") {
    sendOAuthHtml(res, 200, "Gmail authorization complete", "You can close this tab and return to your MCP client.");
    return;
  }

  sendOAuthHtml(
    res,
    400,
    "Gmail authorization failed",
    result.status === "error"
      ? result.error ?? "Unknown Gmail OAuth error."
      : "The Gmail OAuth flow was not ready. Restart account setup and try again.",
  );
}

async function startHttp(
  createServer: () => McpServer,
  registry: Registry,
  host: string,
  port: number,
): Promise<void> {
  // One McpServer + transport per session, keyed by Mcp-Session-Id header.
  const sessions = new Map<string, HttpSession>();

  const http = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!req.url) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }

      const pathname = new URL(req.url, requestBaseUrl(req)).pathname;
      if (req.method === "GET" && pathname === DEFAULT_GMAIL_OAUTH_CALLBACK_PATH) {
        await handleGmailOAuthCallback(req, res, registry);
        return;
      }

      if (!req.url.startsWith("/mcp")) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      const sessionId = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
      let session = sessionId ? sessions.get(sessionId) : undefined;

      if (!session) {
        const server = createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            sessions.set(sid, { transport, server });
            transport.onclose = () => {
              if (transport.sessionId) sessions.delete(transport.sessionId);
            };
          },
        });
        await server.connect(transport);
        session = { transport, server };
      }

      // Buffer body for POST / DELETE
      let body: unknown = undefined;
      if (req.method === "POST" || req.method === "DELETE") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString("utf8");
        body = raw ? JSON.parse(raw) : undefined;
      }
      await session.transport.handleRequest(req, res, body);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[hypermail-mcp] http error:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("internal error");
      }
    }
  });

  await new Promise<void>((resolve) => http.listen(port, host, resolve));
  // eslint-disable-next-line no-console
  console.error(`[hypermail-mcp] listening on http://${host}:${port}/mcp`);
}
