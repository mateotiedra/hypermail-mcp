import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

import { AccountStore } from "./store/account-store.js";
import { AgentStore } from "./store/agent-store.js";
import { buildRegistry } from "./providers/registry.js";
import { registerTools } from "./tools/index.js";
import { VERSION } from "./version.js";
import type { AppConfig, ResolvedTools } from "./config.js";
import { resolveTools } from "./config.js";
import { WatcherManager } from "./watcher/index.js";
import type { WatchNotification } from "./watcher/index.js";
import {
  loadAgentsConfig,
  watchAgentsConfig,
} from "./config/agents-config.js";
import type { AgentContext } from "./tools/agent-context.js";

export interface ServerOptions {
  /** Fully resolved application config from hypermail-config.json. */
  config: AppConfig;
}

export async function startServer(opts: ServerOptions): Promise<void> {
  const { config } = opts;
  const store = await AccountStore.open({ dataDir: config.dataDir });
  const registry = buildRegistry({ store, providers: config.providers });
  const tools: ResolvedTools = resolveTools(config);

  // Shared notification buffer: the watcher pushes, the check_notifications
  // tool drains. Only created in HTTP mode — watching requires a long-lived
  // server process. In stdio mode the check_notifications tool is not registered.
  const notificationBuffer: WatchNotification[] | undefined = config.http.enabled
    ? []
    : undefined;

  // Factory: creates a fresh McpServer with all tools registered.
  // HTTP mode creates one per session; stdio mode uses a single instance.
  let agentStoreForFactory: AgentStore | undefined;
  const createServer = (agentContext: AgentContext | null = null): McpServer => {
    const s = new McpServer(
      { name: "hypermail-mcp", version: VERSION },
      { capabilities: { tools: {}, logging: {} } },
    );
    registerTools(s, { store, registry, tools, notificationBuffer, agentContext, agentStore: agentStoreForFactory });
    return s;
  };

  if (config.http.enabled) {
    // Open AgentStore and load agents.yaml (HTTP mode only).
    let liveReloadHandle: { close(): void } | undefined;
    if (config.agentsConfigPath) {
      agentStoreForFactory = await AgentStore.open({ dataDir: config.dataDir });
      liveReloadHandle = watchAgentsConfig(
        path.resolve(config.agentsConfigPath),
        agentStoreForFactory!,
        (_removedIds) => {
          // Sessions use the same agentStore instance — they'll pick up
          // updated agents on next lookup. Removed agents' existing sessions
          // remain valid until they disconnect (local-trust model).
        },
        (err) => {
          // eslint-disable-next-line no-console
          console.error("[hypermail-mcp] agents.yaml reload error:", err.message);
        },
      );
    }

    // Per-session notification targets — the watcher pushes to all of them.
    const notifyTargets = new Set<(n: WatchNotification) => void>();

    const watcher = new WatcherManager({
      registry,
      store,
      pollIntervalSeconds: config.watch?.pollIntervalSeconds ?? 60,
      onNotification: (notification) => {
        for (const fn of notifyTargets) {
          fn(notification);
        }
      },
      buffer: notificationBuffer!,
    });
    watcher.start();

    await startHttp(
      createServer,
      config.http.host,
      config.http.port,
      notifyTargets,
      agentStoreForFactory,
    );

    // Cleanup on shutdown
    if (liveReloadHandle) {
      process.on("SIGINT", () => liveReloadHandle!.close());
      process.on("SIGTERM", () => liveReloadHandle!.close());
    }
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

interface HttpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  agentContext: AgentContext | null;
}

async function startHttp(
  createServer: (agentContext: AgentContext | null) => McpServer,
  host: string,
  port: number,
  notifyTargets: Set<(n: WatchNotification) => void>,
  agentStore?: AgentStore,
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
        // ── Session-init API key validation ──
        let agentContext: AgentContext | null = null;
        if (agentStore) {
          const apiKey = (req.headers["x-api-key"] as string | undefined)?.trim();
          if (!apiKey) {
            res.statusCode = 401;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Missing x-api-key header" }));
            return;
          }
          const agent = agentStore.findAgentByApiKey(apiKey);
          if (!agent) {
            res.statusCode = 401;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid API key" }));
            return;
          }
          agentContext = {
            agentId: agent.id,
            accounts: agent.accounts,
            provisioning: agent.provisioning,
          };
        }

        const server = createServer(agentContext);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            sessions.set(sid, { transport, server, agentContext });

            // Register push notification target for this session.
            // Scope to this agent's accounts only.
            const agentAccounts = agentContext
              ? new Set(agentContext.accounts.map((a) => a.toLowerCase()))
              : null;
            const notifyFn = (n: WatchNotification) => {
              // Only deliver notifications for accounts this agent can access.
              if (agentAccounts && !agentAccounts.has(n.account.toLowerCase())) {
                return;
              }
              server.server
                .notification({
                  method: "notifications/message",
                  params: {
                    level: n.type === "new_emails" ? "notice" : "warning",
                    logger: "hypermail-watch",
                    data: n,
                  },
                })
                .catch(() => {
                  /* SSE not connected — fallback via check_notifications */
                });
            };
            notifyTargets.add(notifyFn);
            transport.onclose = () => {
              if (transport.sessionId) sessions.delete(transport.sessionId);
              notifyTargets.delete(notifyFn);
            };
          },
        });
        await server.connect(transport);
        session = { transport, server, agentContext };
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
