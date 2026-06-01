import { readFileSync, watch, type FSWatcher } from "node:fs";
import { load as loadYaml } from "js-yaml";
import { z } from "zod";

import type { AgentStore } from "../store/agent-store.js";

// ── Schema ──

const agentDefSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9_-]+$/,
      "agent id must contain only lowercase letters, digits, hyphens, and underscores",
    ),
  api_key: z
    .string()
    .min(1)
    .regex(
      /^hm_sk_[a-f0-9]{64}$/,
      "api_key must match hm_sk_ prefix + 64 hex chars (use `hypermail-mcp generate-key`)",
    ),
  name: z.string().min(1),
  accounts: z.array(z.string().email()).optional().default([]),
  provisioning: z.boolean().optional().default(false),
});

const emailAccountDefSchema = z.object({
  provider: z.enum(["outlook", "imap", "gmail"]),
  display_name: z.string().optional(),
});

const agentsConfigSchema = z.object({
  agents: z.array(agentDefSchema).optional().default([]),
  email_accounts: z
    .record(z.string().email(), emailAccountDefSchema)
    .optional()
    .default({}),
});

// ── Types ──

export interface AgentDef {
  id: string;
  api_key: string;
  name: string;
  accounts: string[];
  provisioning: boolean;
}

export interface EmailAccountDef {
  provider: "outlook" | "imap" | "gmail";
  display_name?: string;
}

export interface AgentsConfig {
  agents: AgentDef[];
  email_accounts: Record<string, EmailAccountDef>;
}

// ── Loading ──

/**
 * Load and validate `agents.yaml`.
 *
 * @param configPath  Absolute or relative path to the YAML file.
 * @returns  The parsed and validated {@link AgentsConfig}.
 */
export function loadAgentsConfig(configPath: string): AgentsConfig {
  let raw: unknown;
  try {
    raw = loadYaml(readFileSync(configPath, "utf-8"));
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Agents config file not found: ${configPath}. ` +
          "Create an agents.yaml with at least one agent to enable HTTP multi-tenant mode.",
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse agents config "${configPath}": ${detail}`);
  }

  const parsed = agentsConfigSchema.parse(raw ?? {});

  // Validate: no duplicate agent ids
  const ids = new Set<string>();
  for (const a of parsed.agents) {
    if (ids.has(a.id)) {
      throw new Error(`Duplicate agent id "${a.id}" in agents config`);
    }
    ids.add(a.id);
  }

  return {
    agents: parsed.agents.map((a) => ({
      id: a.id,
      api_key: a.api_key,
      name: a.name,
      accounts: a.accounts,
      provisioning: a.provisioning,
    })),
    email_accounts: parsed.email_accounts as Record<string, EmailAccountDef>,
  };
}

// ── Syncing ──

/**
 * Sync agent definitions from the parsed YAML config into the AgentStore.
 *
 * - New agents (in config but not in store) are upserted with their plaintext API key hashed.
 * - Existing agents (in both) are updated (name, accounts, provisioning). API key hash is
 *   NOT touched unless the plaintext key changed — avoids re-hashing on every reload.
 * - Stale agents (in store but not in config) are removed.
 * - Auto-assigned accounts (added via `add_account` tool) are preserved — they are merged
 *   with the YAML-defined assignments per agent.
 *
 * @returns  The list of agent ids that were removed (so their sessions can be invalidated).
 */
export async function syncAgentsToStore(
  config: AgentsConfig,
  store: AgentStore,
): Promise<string[]> {
  const configAgentIds = new Set(config.agents.map((a) => a.id));
  const storedAgents = store.listAgents();

  // Upsert config-defined agents
  for (const def of config.agents) {
    await store.upsertAgent({
      id: def.id,
      plaintextApiKey: def.api_key,
      name: def.name,
      accounts: def.accounts,
      provisioning: def.provisioning,
    });
  }

  // Remove agents not in config anymore
  const removed: string[] = [];
  for (const stored of storedAgents) {
    if (!configAgentIds.has(stored.id)) {
      await store.removeAgent(stored.id);
      removed.push(stored.id);
    }
  }

  return removed;
}

// ── Live reload ──

export interface LiveReloadHandle {
  /** Stop watching for changes. */
  close(): void;
}

/**
 * Watch `agents.yaml` for changes and sync into the AgentStore on every
 * modification. Debounces rapid writes (e.g. editor atomic saves).
 *
 * @param configPath   Absolute path to agents.yaml.
 * @param store         The AgentStore to sync into.
 * @param onChange      Called after each sync with the list of removed agent ids.
 * @param onError       Called on parse/sync errors (logged, not fatal).
 */
export function watchAgentsConfig(
  configPath: string,
  store: AgentStore,
  onChange: (removedIds: string[]) => void,
  onError: (err: Error) => void,
): LiveReloadHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;

  const reload = async () => {
    try {
      const config = loadAgentsConfig(configPath);
      const removed = await syncAgentsToStore(config, store);
      onChange(removed);
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  // Initial load
  reload().catch((err) => onError(err));

  // Watch for changes
  try {
    watcher = watch(configPath, (_eventType) => {
      // Debounce: coalesce rapid successive events into one reload.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        reload().catch((err) => onError(err));
      }, 200);
    });
  } catch (err) {
    // fs.watch may fail on some platforms (e.g. network mounts) — not fatal;
    // config can still be loaded once at startup.
  }

  return {
    close() {
      if (timer) clearTimeout(timer);
      if (watcher) watcher.close();
    },
  };
}
