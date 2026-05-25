import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";

import { AccountStore } from "./store/account-store.js";
import { buildRegistry } from "./providers/registry.js";
import { registerTools } from "./tools/index.js";
import { VERSION } from "./version.js";
import type { AppConfig, ProvidersConfig, ResolvedTools } from "./config.js";
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

  const server = new McpServer(
    { name: "hypermail-mcp", version: VERSION },
    { capabilities: { tools: {}, logging: {} } },
  );

  registerTools(server, { store, registry, tools });

  if (config.http.enabled) {
    await startHttp(server, config.http.host, config.http.port);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

async function startHttp(server: McpServer, host: string, port: number): Promise<void> {
  // One transport per session, keyed by Mcp-Session-Id header.
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const http = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!req.url || !req.url.startsWith("/mcp")) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      const sessionId = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
      let transport = sessionId ? sessions.get(sessionId) : undefined;

      if (!transport) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            sessions.set(sid, transport!);
          },
        });
        transport.onclose = () => {
          if (transport!.sessionId) sessions.delete(transport!.sessionId);
        };
        await server.connect(transport);
      }

      // Buffer body for POST / DELETE
      let body: unknown = undefined;
      if (req.method === "POST" || req.method === "DELETE") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString("utf8");
        body = raw ? JSON.parse(raw) : undefined;
      }
      await transport.handleRequest(req, res, body);
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
