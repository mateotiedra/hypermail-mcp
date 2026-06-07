import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";

import { AccountStore } from "./store/account-store.js";
import { buildRegistry } from "./providers/registry.js";
import { registerTools } from "./tools/index.js";
import { VERSION } from "./version.js";
import { WatcherManager } from "./watcher/index.js";
import type { AppConfig, ResolvedTools } from "./config.js";
import { resolveTools } from "./config.js";

export interface ServerOptions {
  /** Fully resolved application config from hypermail-config.json. */
  config: AppConfig;
}

export async function startServer(opts: ServerOptions): Promise<void> {
  const { config } = opts;
  const store = await AccountStore.open({ dataDir: config.dataDir });
  const registry = buildRegistry({ store, providers: config.providers });
  const tools: ResolvedTools = resolveTools(config);

  // Start email watch loop if explicitly enabled (opt-in).
  // Works in both stdio and HTTP modes — setInterval fires normally
  // alongside the stdio transport's stdin listener.
  let watcher: WatcherManager | undefined;
  if (config.watch?.enabled) {
    watcher = new WatcherManager(store, registry, config.watch);
    watcher.start();
    const stop = () => watcher?.stop();
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  }

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

  if (config.http.enabled) {
    await startHttp(createServer, config.http.host, config.http.port);
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

async function startHttp(
  createServer: () => McpServer,
  host: string,
  port: number,
): Promise<void> {
  // One McpServer + transport per session, keyed by Mcp-Session-Id header.
  const sessions = new Map<string, HttpSession>();

  const http = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!req.url || !req.url.startsWith("/mcp")) {
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
