# Graph Report - hyper-email-mcp-0  (2026-06-08)

## Corpus Check
- 52 files · ~28,426 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 705 nodes · 1439 edges · 47 communities (39 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f6281153`
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
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]

## God Nodes (most connected - your core abstractions)
1. `AccountRecord` - 73 edges
2. `AccountStore` - 28 edges
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
- `README Changelog Update Before Release` --updates--> `24-Tool Email API Catalog`  [INFERRED]
  .pi/prompts/updatenpm.md → README.md
- `HTTP Hosting Mode (Streamable HTTP)` --enables--> `Docker Deployment`  [INFERRED]
  README.md → docs/hosting.md

## Hyperedges (group relationships)
- **Unified Email API Surface** — readmemd_unified_email_surface, readmemd_tool_catalog, agentsmd_tool_handlers [INFERRED 0.85]
- **Server Security Posture** — readmemd_account_encryption, hostingmd_encryption_key_management, readmemd_read_only_mode, readmemd_per_tool_filtering [INFERRED 0.80]
- **Multi-Provider Routing Stack** — agentsmd_provider_architecture, readmemd_multi_provider_routing, readmemd_ms_graph_client, readmemd_msal_node [INFERRED 0.90]

## Communities (47 total, 8 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.16
Nodes (17): acquireAccessToken(), awaitDeviceCodeReady(), beginDeviceCode(), buildPca(), DEFAULT_SCOPES, DeviceCodeBegin, isSerializedTokens(), makeConfig() (+9 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (51): extractTokens(), ImapClient, ImapClientFactory, ImapTokens, isImapTokens(), BodyNode, clampLimit(), decodeId() (+43 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (14): bin, hypermail-mcp, description, engines, node, files, keywords, license (+6 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (11): authFailures, consoleError, createWatcher(), enqueued, origPush, result, skips, slowPromise (+3 more)

### Community 5 - "Community 5"
Cohesion: 0.18
Nodes (11): Authentication (optional), code:yaml (agents:), code:yaml (# In docker-compose.yml:), Customizing the port, Deploy hypermail-mcp to Dokploy, Optional: Public domain with TLS, Provider credentials (optional), Troubleshooting (+3 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (53): acquireAccessToken(), awaitDeviceCodeReady(), beginDeviceCode(), buildOAuth2Client(), DEFAULT_SCOPES, DeviceCodeBegin, isSerializedGmailTokens(), SerializedGmailTokens (+45 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (23): Account Store (Token Persistence), Dev Workflow (edit→build→test→iterate), directTools Mode, hypermail-mcp Project Structure, Lazy Server Lifecycle, Provider Architecture (Outlook/IMAP/Gmail), Per-Tool Handler Implementations, tsup Build System (+15 more)

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
Nodes (4): MS_CLIENT_ID, MS_TENANT_ID, hypermail, node

### Community 14 - "Community 14"
Cohesion: 0.50
Nodes (4): Markdown-to-HTML Conversion (marked), 24-Tool Email API Catalog, Zod Input Validation, README Changelog Update Before Release

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

### Community 24 - "Community 24"
Cohesion: 0.08
Nodes (26): GmailProviderOptions, OutlookProviderOptions, AccountStore, decrypt(), encrypt(), OpenOptions, parseEnvKey(), resolveDataDir() (+18 more)

### Community 26 - "Community 26"
Cohesion: 0.15
Nodes (13): dependencies, @azure/msal-node, google-auth-library, googleapis, imapflow, isomorphic-fetch, js-yaml, marked (+5 more)

### Community 27 - "Community 27"
Cohesion: 0.18
Nodes (13): 2. Connect Git provider in Dokploy, 3. Create a Compose service, 4. Set environment variables, 4. Set required env var, 5. Add provider credentials (optional), 6. Deploy, 6. Verify it's running, 7. Verify (+5 more)

### Community 28 - "Community 28"
Cohesion: 0.29
Nodes (8): code:json ({), code:json ({), Connecting pi to the deployed server, Default: direct localhost, How agents connect, No auth (default — internal VPS), Optional: public domain via Dokploy Domains UI, With API key auth

### Community 29 - "Community 29"
Cohesion: 0.22
Nodes (9): scripts, build, dev, dev:http, prepublishOnly, start, test, test:watch (+1 more)

### Community 30 - "Community 30"
Cohesion: 0.25
Nodes (8): devDependencies, tsup, @types/isomorphic-fetch, @types/js-yaml, @types/node, @types/nodemailer, typescript, vitest

### Community 31 - "Community 31"
Cohesion: 0.29
Nodes (6): Deploying hypermail-mcp to Dokploy, Optional: Add a public domain, Prerequisites, Step 2: Create the Compose app in Dokploy, Step 3: Configure environment variables, Step 4: Deploy

### Community 32 - "Community 32"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 34 - "Community 34"
Cohesion: 0.67
Nodes (3): Authentication, Default: No auth, Optional: API key auth (multi-tenant)

### Community 35 - "Community 35"
Cohesion: 0.11
Nodes (22): CliOverrides, deepResolve(), GmailProviderConfig, gmailProviderSchema, HttpConfig, httpConfigSchema, KNOWN_TOOLS, loadConfig() (+14 more)

### Community 37 - "Community 37"
Cohesion: 0.25
Nodes (4): mapFolder(), CreateFolderInput, FolderInfo, ListFoldersOptions

### Community 38 - "Community 38"
Cohesion: 0.20
Nodes (8): AgentDef, agentDefSchema, AgentsConfig, agentsConfigSchema, EmailAccountDef, emailAccountDefSchema, LiveReloadHandle, loadAgentsConfig()

### Community 39 - "Community 39"
Cohesion: 0.36
Nodes (8): watchAgentsConfig(), buildRegistry(), AppConfig, resolveTools(), HttpSession, ServerOptions, startHttp(), startServer()

### Community 41 - "Community 41"
Cohesion: 0.08
Nodes (55): BuildRegistryOptions, Registry, EmailProvider, ProviderId, ProvidersConfig, ResolvedTools, htmlToMarkdown(), selectBody() (+47 more)

### Community 42 - "Community 42"
Cohesion: 0.25
Nodes (4): cfg, MANAGED_KEYS, resolved, SAVED_ENV

### Community 43 - "Community 43"
Cohesion: 0.40
Nodes (3): convertInlineImages(), body, result

### Community 44 - "Community 44"
Cohesion: 0.60
Nodes (4): main(), parseArgs(), ParsedArgs, printHelp()

### Community 45 - "Community 45"
Cohesion: 0.50
Nodes (3): WatchConfig, postWebhook(), sleep()

## Knowledge Gaps
- **235 isolated node(s):** `target`, `module`, `moduleResolution`, `lib`, `outDir` (+230 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AccountRecord` connect `Community 25` to `Community 0`, `Community 1`, `Community 2`, `Community 36`, `Community 37`, `Community 6`, `Community 4`, `Community 40`, `Community 41`, `Community 43`, `Community 46`, `Community 24`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `AccountStore` connect `Community 24` to `Community 0`, `Community 2`, `Community 36`, `Community 6`, `Community 39`, `Community 41`, `Community 45`, `Community 46`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Community 26` to `Community 3`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **What connects `target`, `module`, `moduleResolution` to the rest of the system?**
  _235 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06512890094979647 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._