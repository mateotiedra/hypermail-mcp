import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";

import { AccountStore } from "./store/account-store.js";
import { buildRegistry } from "./providers/registry.js";
import { registerTools } from "./tools/index.js";
import { VERSION } from "./version.js";

export interface ServerOptions {
  http?: boolean;
  port?: number;
  host?: string;
  dataDir?: string;
  readOnly?: boolean;
  /** When true, hide send_email and only expose draft_email. */
  draftOnly?: boolean;
}

export async function startServer(opts: ServerOptions = {}): Promise<void> {
  const store = await AccountStore.open({ dataDir: opts.dataDir });
  const registry = buildRegistry({ store });

  const server = new McpServer(
    { name: "hypermail-mcp", version: VERSION },
    { capabilities: { tools: {}, logging: {} } },
  );

  registerTools(server, { store, registry, readOnly: !!opts.readOnly, draftOnly: !!opts.draftOnly });

  if (opts.http) {
    await startHttp(server, opts.host ?? "127.0.0.1", opts.port ?? 3000);
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
