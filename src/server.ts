import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";

import { buildRegistry } from "./providers/registry.js";
import { registerTools } from "./tools/index.js";
import { VERSION } from "./version.js";
import type { AppConfig, ResolvedTools } from "./config.js";
import { resolveTools } from "./config.js";
import { WatcherManager } from "./watcher/index.js";
import type { WatchNotification } from "./watcher/index.js";
import type { AgentContext } from "./tools/agent-context.js";
import type { ModePlugin, IAccountStore, IAgentStore } from "./mode/types.js";
import { AuthError } from "./mode/types.js";

export interface ServerOptions {
  /** Fully resolved application config from hypermail-config.json. */
  config: AppConfig;
  /** Mode plugin (solo or multi). */
  plugin: ModePlugin;
}

export async function startServer(opts: ServerOptions): Promise<void> {
  const { config, plugin } = opts;

  // 1. Init plugin (DB connect + migrate in multi mode)
  await plugin.init();

  // 2. Create stores via plugin
  const store: IAccountStore = await plugin.createAccountStore(config.dataDir);
  const agentStore: IAgentStore | null = await plugin.createAgentStore(config.dataDir);

  const registry = buildRegistry({ store, providers: config.providers });
  const tools: ResolvedTools = resolveTools(config);

  // 3. Notification buffer (HTTP + watch mode only)
  const watchEnabled = config.http.enabled && config.watch?.enabled !== false;
  const notificationBuffer: WatchNotification[] | undefined = watchEnabled
    ? []
    : undefined;

  // 4. MCP server factory (shared by both modes)
  const createServer = (agentContext: AgentContext | null = null): McpServer => {
    const s = new McpServer(
      { name: "hypermail-mcp", version: VERSION },
      { capabilities: { tools: {}, logging: {} } },
    );
    registerTools(s, { store, registry, tools, notificationBuffer, agentContext, agentStore });
    return s;
  };

  if (config.http.enabled) {
    // 5. Watcher account filter via plugin
    const accountFilter = plugin.getWatcherAccountFilter
      ? await plugin.getWatcherAccountFilter()
      : agentStore
        ? await (async () => {
            const all = new Set<string>();
            for (const agent of await agentStore.listAgents()) {
              for (const email of agent.accounts) {
                all.add(email.toLowerCase());
              }
            }
            return all.size > 0 ? [...all] : undefined;
          })()
        : undefined;

    const notifyTargets = new Set<(n: WatchNotification) => void>();

    if (watchEnabled) {
      const watcher = new WatcherManager({
        registry,
        store,
        pollIntervalSeconds: config.watch?.pollIntervalSeconds ?? 60,
        accountFilter,
        onNotification: (notification) => {
          for (const fn of notifyTargets) {
            fn(notification);
          }
        },
        buffer: notificationBuffer!,
      });
      watcher.start();
    }

    await startHttp(
      createServer,
      config.http.host,
      config.http.port,
      notifyTargets,
      plugin,
    );
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

// ── HTTP server ──

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
  plugin: ModePlugin,
): Promise<void> {
  const sessions = new Map<string, HttpSession>();

  const http = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // ── Admin routes (multi mode only) ──
      if (req.url?.startsWith("/admin")) {
        if (plugin.handleAdminRequest) {
          const handled = await plugin.handleAdminRequest(req, res);
          if (handled) return;
        }
        res.statusCode = 404;
        res.end("not found");
        return;
      }

      // ── MCP routes ──
      if (!req.url || !req.url.startsWith("/mcp")) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }

      const sessionId = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
      let session = sessionId ? sessions.get(sessionId) : undefined;

      if (!session) {
        // ── Auth via plugin ──
        let agentContext: AgentContext | null = null;
        try {
          agentContext = await plugin.authenticate(req);
        } catch (err) {
          if (err instanceof AuthError) {
            res.statusCode = err.statusCode;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: err.message }));
            return;
          }
          throw err;
        }

        const server = createServer(agentContext);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            sessions.set(sid, { transport, server, agentContext });

            // Register push notification target for this session.
            const agentAccounts = agentContext
              ? new Set(agentContext.accounts.map((a) => a.toLowerCase()))
              : null;
            const notifyFn = (n: WatchNotification) => {
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
