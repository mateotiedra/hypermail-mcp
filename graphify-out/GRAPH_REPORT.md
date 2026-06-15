# Graph Report - hyper-email-mcp-0  (2026-06-10)

## Corpus Check
- 54 files · ~29,151 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 702 nodes · 1412 edges · 36 communities (33 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8db930d5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 41|Community 41]]

## God Nodes (most connected - your core abstractions)
1. `AccountRecord` - 71 edges
2. `AccountStore` - 27 edges
3. `OutlookProvider` - 24 edges
4. `GmailProvider` - 22 edges
5. `ImapProvider` - 21 edges
6. `hypermail-mcp` - 20 edges
7. `FolderInfo` - 19 edges
8. `Deploy hypermail-mcp to Dokploy` - 18 edges
9. `AgentStore` - 16 edges
10. `compilerOptions` - 15 edges

## Surprising Connections (you probably didn't know these)
- `Provider Architecture (Outlook/IMAP/Gmail)` --uses--> `OAuth Device-Code Authentication Flow`  [INFERRED]
  AGENTS.md → README.md
- `OAuth Device-Code Authentication Flow` --enables--> `Lazy Server Lifecycle`  [INFERRED]
  README.md → AGENTS.md
- `Encryption Key Management (HYPERMAIL_MCP_KEY)` --secures--> `Account Store (Token Persistence)`  [INFERRED]
  docs/hosting.md → AGENTS.md
- `HTTP Hosting Mode (Streamable HTTP)` --enables--> `Docker Deployment`  [INFERRED]
  README.md → docs/hosting.md
- `HttpSession` --references--> `AgentContext`  [EXTRACTED]
  src/server.ts → src/tools/agent-context.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Unified Email API Surface** — readmemd_unified_email_surface, readmemd_tool_catalog, agentsmd_tool_handlers [INFERRED 0.85]
- **Server Security Posture** — readmemd_account_encryption, hostingmd_encryption_key_management, readmemd_read_only_mode, readmemd_per_tool_filtering [INFERRED 0.80]
- **Multi-Provider Routing Stack** — agentsmd_provider_architecture, readmemd_multi_provider_routing, readmemd_ms_graph_client, readmemd_msal_node [INFERRED 0.90]

## Communities (36 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.12
Nodes (18): acquireAccessToken(), awaitDeviceCodeReady(), beginDeviceCode(), buildPca(), DEFAULT_SCOPES, DeviceCodeBegin, isSerializedTokens(), makeConfig() (+10 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (48): bin, hypermail-mcp, bugs, url, dependencies, @azure/msal-node, google-auth-library, googleapis (+40 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (56): extractTokens(), ImapClientFactory, ImapTokens, isImapTokens(), BodyNode, clampLimit(), decodeId(), encodeId() (+48 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (39): deepResolve(), loadConfig(), parseBool(), parseIntSafe(), parseStringArray(), resolveEnvVars(), validateToolNames(), ParsedPayload (+31 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (11): authFailures, consoleError, createWatcher(), enqueued, origPush, result, skips, slowPromise (+3 more)

### Community 5 - "Community 5"
Cohesion: 0.18
Nodes (11): Authentication (optional), code:yaml (agents:), code:yaml (# In docker-compose.yml:), Customizing the port, Deploy hypermail-mcp to Dokploy, Optional: Public domain with TLS, Provider credentials (optional), Troubleshooting (+3 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (45): acquireAccessToken(), awaitDeviceCodeReady(), beginDeviceCode(), buildOAuth2Client(), DEFAULT_SCOPES, DeviceCodeBegin, isSerializedGmailTokens(), SerializedGmailTokens (+37 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (20): Account Store (Token Persistence), Dev Workflow (edit→build→test→iterate), directTools Mode, hypermail-mcp Project Structure, Lazy Server Lifecycle, Provider Architecture (Outlook/IMAP/Gmail), Per-Tool Handler Implementations, tsup Build System (+12 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution (+9 more)

### Community 9 - "Community 9"
Cohesion: 0.14
Nodes (13): files, code, document, image, paper, video, graphifyignore_patterns, needs_graph (+5 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (17): dataDir, http, enabled, host, port, clientId, tenantId, providers (+9 more)

### Community 11 - "Community 11"
Cohesion: 0.14
Nodes (13): dataDir, http, enabled, host, port, clientId, tenantId, providers (+5 more)

### Community 12 - "Community 12"
Cohesion: 0.50
Nodes (5): Docker Deployment, Reverse Proxy Compatibility, Session Management (Mcp-Session-Id), Streamable HTTP Transport, HTTP Hosting Mode (Streamable HTTP)

### Community 13 - "Community 13"
Cohesion: 0.40
Nodes (4): HYPERMAIL_PROVIDERS_OUTLOOK_CLIENT_ID, HYPERMAIL_PROVIDERS_OUTLOOK_TENANT_ID, hypermail, node

### Community 14 - "Community 14"
Cohesion: 0.67
Nodes (3): Markdown-to-HTML Conversion (marked), 24-Tool Email API Catalog, Zod Input Validation

### Community 17 - "Community 17"
Cohesion: 0.09
Nodes (41): Add-account flow (Outlook), Add-account flow (Outlook), Add-account flow (Outlook), Add-account flow (Outlook), Add-account flow (Outlook), Add-account flow (Outlook), Add-account flow (Outlook), Agent multi-tenancy (+33 more)

### Community 18 - "Community 18"
Cohesion: 0.20
Nodes (9): code:block1 (src/), code:bash (pnpm build        # Compile TypeScript), Commands, Dev Workflow, Environment, hypermail-mcp, Key Dependencies, Purpose (+1 more)

### Community 19 - "Community 19"
Cohesion: 0.20
Nodes (9): code:bash (HYPERMAIL_MCP_KEY=$(openssl rand -base64 32) \), code:dockerfile (FROM node:20-slim), code:bash (docker run -d -p 3000:3000 \), Docker (minimal), Hosting hypermail-mcp, Quick start, Read-only mode, Required environment (+1 more)

### Community 20 - "Community 20"
Cohesion: 0.18
Nodes (13): 1. Create the Application, 1. Push to a Git repository, 2. Set the encryption key, 3. Configure persistent storage, 4. Add a domain, 5. Deploy, 6. Verify, code:block1 ([hypermail-mcp] listening on http://0.0.0.0:3000/mcp) (+5 more)

### Community 22 - "Community 22"
Cohesion: 0.15
Nodes (3): GmailProvider, CompleteAddAccountResult, EmailProvider

### Community 24 - "Community 24"
Cohesion: 0.08
Nodes (26): GmailProviderOptions, OutlookProviderOptions, AccountStore, decrypt(), encrypt(), OpenOptions, parseEnvKey(), resolveDataDir() (+18 more)

### Community 25 - "Community 25"
Cohesion: 0.19
Nodes (3): ImapProvider, AttachmentContent, AccountRecord

### Community 26 - "Community 26"
Cohesion: 0.27
Nodes (3): mapFolder(), FolderInfo, ListFoldersOptions

### Community 27 - "Community 27"
Cohesion: 0.18
Nodes (13): 2. Connect Git provider in Dokploy, 3. Create a Compose service, 4. Set environment variables, 4. Set required env var, 5. Add provider credentials (optional), 6. Deploy, 6. Verify it's running, 7. Verify (+5 more)

### Community 28 - "Community 28"
Cohesion: 0.29
Nodes (8): code:json ({), code:json ({), Connecting pi to the deployed server, Default: direct localhost, How agents connect, No auth (default — internal VPS), Optional: public domain via Dokploy Domains UI, With API key auth

### Community 30 - "Community 30"
Cohesion: 0.40
Nodes (3): convertInlineImages(), body, result

### Community 31 - "Community 31"
Cohesion: 0.29
Nodes (6): Deploying hypermail-mcp to Dokploy, Optional: Add a public domain, Prerequisites, Step 2: Create the Compose app in Dokploy, Step 3: Configure environment variables, Step 4: Deploy

### Community 34 - "Community 34"
Cohesion: 0.67
Nodes (3): Authentication, Default: No auth, Optional: API key auth (multi-tenant)

### Community 35 - "Community 35"
Cohesion: 0.09
Nodes (22): AgentDef, agentDefSchema, AgentsConfig, agentsConfigSchema, EmailAccountDef, emailAccountDefSchema, LiveReloadHandle, loadAgentsConfig() (+14 more)

### Community 41 - "Community 41"
Cohesion: 0.09
Nodes (50): Registry, ProviderId, ResolvedTools, htmlToMarkdown(), selectBody(), turndown, markdownToHtml(), registerAccountTools() (+42 more)

## Knowledge Gaps
- **228 isolated node(s):** `httpConfigSchema`, `toolsConfigSchema`, `outlookProviderSchema`, `gmailProviderSchema`, `providersConfigSchema` (+223 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AccountRecord` connect `Community 25` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 6`, `Community 41`, `Community 21`, `Community 22`, `Community 24`, `Community 26`, `Community 30`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Why does `AccountStore` connect `Community 24` to `Community 0`, `Community 2`, `Community 3`, `Community 35`, `Community 6`, `Community 41`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `ProvidersConfig` connect `Community 3` to `Community 41`, `Community 35`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **What connects `httpConfigSchema`, `toolsConfigSchema`, `outlookProviderSchema` to the rest of the system?**
  _228 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.04081632653061224 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06533646322378717 - nodes in this community are weakly interconnected._